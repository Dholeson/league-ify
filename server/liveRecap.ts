import type { LiveRecap, LiveRecapGoal, LiveRecapPoint, EnrichedMatch } from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll } from "./engine/enrich.ts";
import { evaluateGoal } from "./engine/goals.ts";

// ---------------------------------------------------------------------------
// POST-GAME RECAP
//
// Distills the most recently finished game for the Live page: the result, your
// line, the process verdict, the game's highlight tags, and — the part that
// makes it a coaching tool — how the game moved each active block goal. Reads
// straight from the stored match (the same data the full match detail renders),
// so the recap card and "view full match" never disagree.
// ---------------------------------------------------------------------------

function modeLabel(q?: string): string {
  const s = (q ?? "").toUpperCase();
  if (s.includes("RANKED_SOLO")) return "Ranked Solo/Duo";
  if (s.includes("RANKED_FLEX")) return "Ranked Flex";
  if (s.includes("SWIFTPLAY")) return "Swiftplay";
  if (s.includes("QUICKPLAY")) return "Quickplay";
  if (s.includes("DRAFT")) return "Normal Draft";
  if (s.includes("BLIND")) return "Normal Blind";
  if (s.includes("ARAM")) return "ARAM";
  if (s.includes("ARENA")) return "Arena";
  if (s.includes("URF")) return "URF";
  if (s.includes("NEXUS")) return "Nexus Blitz";
  if (s.includes("CLASH")) return "Clash";
  return q ? q.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Game";
}

// Did the block average move in the goal's good direction?
function movement(before: number | null, after: number | null, dir: "higher" | "lower"): "up" | "down" | "flat" {
  if (before == null || after == null) return "flat";
  const d = after - before;
  if (Math.abs(d) < 1e-6) return "flat";
  const better = dir === "higher" ? d > 0 : d < 0;
  return better ? "up" : "down";
}

function recapGoals(game: EnrichedMatch): LiveRecapGoal[] {
  const season = store.activeSeason();
  if (!season) return [];
  const seasons = store.seasons();
  const pool = store.activePool();
  // Block games, oldest→newest (enrichAll sorts ascending).
  const seasonAll = enrichAll(store.matchesForSeason(season.id), seasons, pool);
  const inSeason = seasonAll.some((m) => m.id === game.id);
  const priorSeason = seasonAll.filter((m) => m.id !== game.id);

  const out: LiveRecapGoal[] = [];
  for (const g of store.goalsForSeason(season.id)) {
    // "games"/"wins" goals are cumulative tallies (countOf); everything else is a
    // per-game average (avgOf). They read very differently in a recap.
    const kind: "avg" | "count" = /games|wins/i.test(g.unit) ? "count" : "avg";
    const gv = inSeason ? evaluateGoal(g, [game]).current : null; // count: 0/1 · avg: this game's metric
    const before = evaluateGoal(g, priorSeason).current;
    const after = evaluateGoal(g, seasonAll).current;
    const metThisGame = kind === "count"
      ? (gv ?? 0) >= 1 // this game counted toward the tally
      : gv != null && (g.direction === "higher" ? gv >= g.target : gv <= g.target); // cleared the per-game bar
    out.push({
      title: g.title,
      unit: g.unit,
      direction: g.direction,
      kind,
      target: g.target,
      gameValue: gv,
      metThisGame,
      runningBefore: before,
      runningAfter: after,
      moved: movement(before, after, g.direction),
    });
  }
  return out;
}

// The process sub-metrics, each 0..1, turned into keep-doing / work-on lines.
// This is the "what did I do well / what do I fix next game" deeper dive, from
// the same engine that scores every game — no extra token spend.
const SUBMETRIC: Record<string, { label: string; good: string; bad: string }> = {
  earlyStability: { label: "Early game", good: "Laned steady — you didn't fall behind before your items.", bad: "Rough starts — prioritize safe farming and don't give up early gold/deaths." },
  deathDiscipline: { label: "Death discipline", good: "Disciplined — you didn't feed the map.", bad: "Too many deaths — respect the map and play to your power spikes, not coin-flips." },
  objectiveMacro: { label: "Objectives", good: "Good objective play — you were there for the map's currency.", bad: "Objectives slipped — group and set up drakes/grubs/baron with vision first." },
  teamfight: { label: "Teamfights", good: "You showed up in fights and did real work.", bad: "Teamfighting was rough — fix positioning and pick the fights you can win." },
  mental: { label: "Mental", good: "Calm and focused throughout.", bad: "Tilt crept in — reset between games and mute early if it helps." },
  review: { label: "Self-review", good: "Honest, useful self-review.", bad: "Reflect harder on the one decision that cost you most." },
};

function coachingPoints(game: EnrichedMatch): { didWell: LiveRecapPoint[]; workOn: LiveRecapPoint[] } {
  const subs = Object.entries(game.process.subMetrics)
    .filter(([k]) => SUBMETRIC[k])
    .map(([k, v]) => ({ k, v: v as number }));
  const didWell: LiveRecapPoint[] = [];
  const workOn: LiveRecapPoint[] = [];
  // Strongest first for keep-doing; weakest first for work-on.
  for (const { k, v } of [...subs].sort((a, b) => b.v - a.v)) {
    if (v >= 0.62) didWell.push({ label: SUBMETRIC[k].label, detail: SUBMETRIC[k].good, value: `${Math.round(v * 100)}` });
  }
  for (const { k, v } of [...subs].sort((a, b) => a.v - b.v)) {
    if (v <= 0.48) workOn.push({ label: SUBMETRIC[k].label, detail: SUBMETRIC[k].bad, value: `${Math.round(v * 100)}` });
  }
  // Fold in the game's op.gg-style tags as extra context (good → did well, bad → work on).
  for (const t of game.tags ?? []) {
    if (t.tone === "good" && didWell.length < 4) didWell.push({ label: t.label, detail: t.hint });
    else if (t.tone === "bad" && workOn.length < 4) workOn.push({ label: t.label, detail: t.hint });
  }
  return { didWell: didWell.slice(0, 4), workOn: workOn.slice(0, 4) };
}

export function buildRecap(): LiveRecap {
  const seasons = store.seasons();
  const pool = store.activePool();
  // allMatches (not the span-filtered matches) so the just-played game is always
  // findable even under a "This season" view. enrichAll sorts oldest→newest.
  const all = enrichAll(store.allMatches(), seasons, pool);
  const game = [...all].reverse().find((m) => m.source === "riot") ?? all[all.length - 1];
  if (!game) return { available: false, reason: "No games logged yet." };

  const o = game.objective;
  const k = o.kills ?? 0, d = o.deaths ?? 0, a = o.assists ?? 0;
  const mins = o.durationSec ? o.durationSec / 60 : null;
  const { didWell, workOn } = coachingPoints(game);
  return {
    available: true,
    matchId: game.id,
    champion: o.champion ?? undefined,
    role: o.role,
    mode: modeLabel(o.queue),
    win: o.win ?? null,
    placement: o.placement ?? null,
    durationSec: o.durationSec ?? null,
    kills: k, deaths: d, assists: a,
    kda: Math.round(((k + a) / Math.max(1, d)) * 10) / 10,
    cs: o.totalCs ?? null,
    csPerMin: o.totalCs != null && mins ? Math.round((o.totalCs / mins) * 10) / 10 : null,
    damage: o.damageToChampions ?? null,
    damageShare: o.teamDamageShare ?? null,
    kp: o.killParticipation ?? null,
    vision: o.visionScore ?? null,
    processScore: Math.round(game.process.score),
    verdict: game.verdict,
    xp: game.xpAwarded.reduce((acc, x) => acc + x.amount, 0),
    highlights: game.tags ?? [],
    didWell,
    workOn,
    goals: recapGoals(game),
    playedAt: o.playedAt ?? game.playedAt,
  };
}
