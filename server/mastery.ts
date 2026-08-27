import type {
  ChampionDetail,
  ChampionPoolEntry,
  EnrichedMatch,
  MatchupStat,
  RecommendedGoal,
  Role,
} from "../shared/types.ts";
import { store } from "./store.ts";
import { activeProfile } from "./activeProfile.ts";
import { enrichAll } from "./engine/enrich.ts";
import { getTemplate } from "./engine/goals.ts";
import { buildChampionTrack } from "./engine/championTrack.ts";
import { benchFor, rankLabel } from "./engine/benchmarks.ts";
import type { StatComparison } from "../shared/types.ts";

const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const round1 = (n: number) => Math.round(n * 10) / 10;

function avg(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function kdaOf(ms: EnrichedMatch[]) {
  const kills = ms.map((m) => m.objective.kills).filter(def);
  const deaths = ms.map((m) => m.objective.deaths).filter(def);
  const assists = ms.map((m) => m.objective.assists).filter(def);
  const k = round1(avg(kills));
  const d = round1(avg(deaths));
  const a = round1(avg(assists));
  return {
    k,
    d,
    a,
    ratio: round1((k + a) / Math.max(1, d)),
  };
}

function poolTier(pool: ChampionPoolEntry[], champion: string) {
  return (
    pool.find((p) => p.champion.toLowerCase() === champion.toLowerCase())?.tier ?? null
  );
}

function championSuggestions(champion: string, ms: EnrichedMatch[]): RecommendedGoal[] {
  const suggestions: RecommendedGoal[] = [];

  const cs10Vals = ms.map((m) => m.objective.csAt10).filter(def);
  if (cs10Vals.length >= 3) {
    const current = round1(avg(cs10Vals));
    if (current < 70) {
      const tpl = getTemplate("cs10")!;
      suggestions.push({
        templateId: tpl.id,
        category: tpl.category,
        title: `${champion}: ${tpl.title()}`,
        description: tpl.describe(70),
        target: 70,
        unit: tpl.unit,
        direction: tpl.direction,
        champion,
        rationale: `${champion} is averaging ${current} CS@10. More stable farm turns this pick into a real win condition.`,
        severity: Math.min(1, (70 - current) / 70),
        current,
      });
    }
  }

  const goldVals = ms.map((m) => m.objective.goldDiffAt15).filter(def);
  if (goldVals.length >= 3) {
    const current = round1(avg(goldVals));
    if (current < 250) {
      const tpl = getTemplate("gold_diff_15")!;
      suggestions.push({
        templateId: tpl.id,
        category: tpl.category,
        title: `${champion}: ${tpl.title()}`,
        description: tpl.describe(250),
        target: 250,
        unit: tpl.unit,
        direction: tpl.direction,
        champion,
        rationale: `${champion} is only at ${current >= 0 ? "+" : ""}${current} gold@15 on average. The lane pressure is not cashing out yet.`,
        severity: Math.min(1, (250 - current) / 250),
        current,
      });
    }
  }

  const deathVals = ms.map((m) => m.objective.deathsBefore15).filter(def);
  if (deathVals.length >= 3) {
    const current = round1(avg(deathVals));
    if (current > 2) {
      const tpl = getTemplate("deaths_before_15")!;
      suggestions.push({
        templateId: tpl.id,
        category: tpl.category,
        title: `${champion}: ${tpl.title()}`,
        description: tpl.describe(2),
        target: 2,
        unit: tpl.unit,
        direction: tpl.direction,
        champion,
        rationale: `${champion} is dying ${current} times before 15 on average. This pick needs a calmer opening to scale into the game.`,
        severity: Math.min(1, (current - 2) / 3),
        current,
      });
    }
  }

  const firstDeathVals = ms.map((m) => m.objective.firstDeathSec).filter(def);
  if (firstDeathVals.length >= 3) {
    const current = Math.round(avg(firstDeathVals));
    if (current < 360) {
      const tpl = getTemplate("deaths_before_15")!;
      suggestions.push({
        templateId: tpl.id,
        category: tpl.category,
        title: `${champion}: survive to first reset`,
        description: "Push your first death later by stabilizing lane, recalls, and jungle respect.",
        target: 2,
        unit: "deaths <15",
        direction: tpl.direction,
        champion,
        rationale: `${champion} is first dying around ${Math.round(current / 60)}:${String(current % 60).padStart(2, "0")}. The early lane is leaking before the game opens up.`,
        severity: Math.min(1, (360 - current) / 180),
        current: round1(current / 60),
      });
    }
  }

  if (ms.length >= 5) {
    const wins = ms.filter((m) => m.objective.win).length;
    const current = Math.round((wins / ms.length) * 100);
    if (current < 55) {
      const tpl = getTemplate("champion_winrate")!;
      suggestions.push({
        templateId: tpl.id,
        category: tpl.category,
        title: tpl.title(champion),
        description: tpl.describe(55, champion),
        target: 55,
        unit: tpl.unit,
        direction: tpl.direction,
        champion,
        rationale: `${champion} is at ${current}% win rate over ${ms.length} games. Tighten the details before adding more experimentation elsewhere.`,
        severity: Math.min(1, (55 - current) / 30),
        current,
      });
    }
  }

  const processVals = ms.map((m) => m.process.score);
  const avgProcess = round1(avg(processVals));
  if (avgProcess < 65) {
    const tpl = getTemplate("avg_process")!;
    suggestions.push({
      templateId: tpl.id,
      category: tpl.category,
      title: `${champion}: ${tpl.title()}`,
      description: tpl.describe(65),
      target: 65,
      unit: tpl.unit,
      direction: tpl.direction,
      champion,
      rationale: `${champion} is averaging ${avgProcess} process. The wins may come and go, but the floor still needs work.`,
      severity: Math.min(1, (65 - avgProcess) / 25),
      current: avgProcess,
    });
  }

  // Always leave a next step — if nothing sharp fired (or the champ has only
  // ARAM data, where lane stats are absent), add stretch goals just above the
  // current value so a block always has homework to seed.
  if (suggestions.length < 2) {
    const have = new Set(suggestions.map((s) => s.templateId));
    const wins = ms.filter((m) => m.objective.win).length;
    const wrNow = ms.length ? Math.round((wins / ms.length) * 100) : 0;
    const avgProc = round1(avg(ms.map((m) => m.process.score)));

    if (!have.has("champion_winrate") && ms.length >= 3) {
      const target = Math.min(75, Math.max(wrNow + 5, 55));
      const tpl = getTemplate("champion_winrate")!;
      suggestions.push({
        templateId: tpl.id, category: tpl.category, title: tpl.title(champion), description: tpl.describe(target, champion),
        target, unit: tpl.unit, direction: tpl.direction, champion,
        rationale: `${champion} is at ${wrNow}% over ${ms.length} games — push it toward ${target}%.`,
        severity: 0.4, current: wrNow,
      });
      have.add(tpl.id);
    }
    if (!have.has("avg_process")) {
      const target = Math.min(95, Math.max(Math.round(avgProc) + 6, 65));
      const tpl = getTemplate("avg_process")!;
      suggestions.push({
        templateId: tpl.id, category: tpl.category, title: `${champion}: ${tpl.title()}`, description: tpl.describe(target),
        target, unit: tpl.unit, direction: tpl.direction, champion,
        rationale: `${champion} averages ${avgProc} performance — aim for ${target} to raise the floor.`,
        severity: 0.35, current: avgProc,
      });
      have.add(tpl.id);
    }
    const cs10Now = cs10Vals.length ? round1(avg(cs10Vals)) : null;
    if (!have.has("cs10") && cs10Now != null) {
      const target = Math.min(90, Math.round(cs10Now) + 8);
      const tpl = getTemplate("cs10")!;
      suggestions.push({
        templateId: tpl.id, category: tpl.category, title: `${champion}: ${tpl.title()}`, description: tpl.describe(target),
        target, unit: tpl.unit, direction: tpl.direction, champion,
        rationale: `${champion} farms ${cs10Now} CS@10 — tighten it to ${target}.`,
        severity: 0.3, current: cs10Now,
      });
    }
  }

  // Dedupe by template (the early-death and first-death checks both map to
  // deaths_before_15) — keep the most severe of each.
  const byTemplate = new Map<string, RecommendedGoal>();
  for (const s of suggestions.sort((a, b) => b.severity - a.severity)) {
    if (!byTemplate.has(s.templateId)) byTemplate.set(s.templateId, s);
  }
  return [...byTemplate.values()].slice(0, 5);
}

export function buildChampionDetail(champion: string, roleFilter: string | null = null): ChampionDetail | null {
  const seasons = store.seasons();
  const pool = store.activePool();
  const enriched = enrichAll(store.matches(), seasons, pool);
  const allOnChamp = enriched.filter(
    (m) => m.objective.champion?.toLowerCase() === champion.toLowerCase()
  );

  if (allOnChamp.length === 0) return null;

  // Roles this champ has been played in — a Vayne played top *and* ADC gets a
  // toggle to slice each context. Filter the game set when one is picked.
  const availableRoles = [...new Set(
    allOnChamp.map((m) => m.objective.role).filter((r): r is Role => !!r && r !== "UNKNOWN")
  )];
  const activeRole = roleFilter && availableRoles.includes(roleFilter as Role) ? (roleFilter as Role) : null;
  const onChamp = activeRole ? allOnChamp.filter((m) => m.objective.role === activeRole) : allOnChamp;

  const wins = onChamp.filter((m) => m.objective.win).length;
  const matchupsMap = new Map<string, EnrichedMatch[]>();
  for (const match of onChamp) {
    const opponent = match.objective.opponentChampion;
    if (!opponent) continue;
    (matchupsMap.get(opponent) ?? matchupsMap.set(opponent, []).get(opponent)!).push(match);
  }
  const matchups: MatchupStat[] = [...matchupsMap.entries()]
    .map(([opponent, ms]) => {
      const matchupWins = ms.filter((m) => m.objective.win).length;
      const goldVals = ms.map((m) => m.objective.goldDiffAt15).filter(def);
      return {
        opponent,
        games: ms.length,
        wins: matchupWins,
        winRate: Math.round((matchupWins / ms.length) * 100),
        avgGoldDiff15: goldVals.length ? round1(avg(goldVals)) : null,
        avgProcess: Math.round(avg(ms.map((m) => m.process.score))),
      };
    })
    .sort((a, b) => b.games - a.games || a.winRate - b.winRate);

  const cs10Vals = onChamp.map((m) => m.objective.csAt10).filter(def);
  const deaths15Vals = onChamp.map((m) => m.objective.deathsBefore15).filter(def);
  const firstDeathVals = onChamp.map((m) => m.objective.firstDeathSec).filter(def);
  const gold15Vals = onChamp.map((m) => m.objective.goldDiffAt15).filter(def);

  const poolRoles = pool.find((p) => p.champion.toLowerCase() === champion.toLowerCase())?.roles;
  const track = buildChampionTrack(champion, onChamp, poolRoles?.[0]);

  // ---- one-sheet extras ----
  const wr = Math.round((wins / onChamp.length) * 100);
  const avgProc = Math.round(avg(onChamp.map((m) => m.process.score)));
  const cs10 = cs10Vals.length ? round1(avg(cs10Vals)) : null;
  const d15 = deaths15Vals.length ? round1(avg(deaths15Vals)) : null;
  const g15 = gold15Vals.length ? round1(avg(gold15Vals)) : null;
  const kpVals = onChamp.map((m) => m.objective.killParticipation).filter(def);
  const kp = kpVals.length ? Math.round(avg(kpVals) * 100) : null;
  const visVals = onChamp
    .map((m) => (m.objective.visionScore != null && m.objective.durationSec ? m.objective.visionScore / (m.objective.durationSec / 60) : null))
    .filter(def);
  const vis = visVals.length ? round1(avg(visVals)) : null;
  const soloVals = onChamp.map((m) => m.objective.soloKills).filter(def);
  const solo = soloVals.length ? round1(avg(soloVals)) : null;
  const objVals = onChamp
    .map((m) => {
      const o = m.objective;
      if (o.dragons == null && o.heralds == null && o.barons == null) return null;
      return (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0);
    })
    .filter(def);
  const objAvg = objVals.length ? round1(avg(objVals)) : null;
  const sgn = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

  // ---- data-driven playstyle tags (Mobalytics-style) ----
  // Fire several at once — strengths AND weaknesses — each earned by a stat and
  // explainable on hover. Thresholds flex for ARAM (no lanes, higher kill/death
  // counts). Ordered by how defining they are, then capped.
  const k = kdaOf(onChamp);
  const aram = onChamp.filter((m) => (m.objective.queue ?? "").toUpperCase().includes("ARAM")).length / onChamp.length >= 0.5;
  const dmgShareVals = onChamp.map((m) => m.objective.teamDamageShare).filter(def);
  const dmgShare = dmgShareVals.length ? Math.round(avg(dmgShareVals) * 100) : null;

  type PTag = { label: string; tone: "good" | "neutral" | "bad"; hint: string; pri: number };
  const pt: PTag[] = [];
  const add = (cond: boolean, pri: number, label: string, tone: PTag["tone"], hint: string) => { if (cond) pt.push({ label, tone, hint, pri }); };

  // Outcome / reliability
  add(wr >= 58 && onChamp.length >= 5, 10, "Comfort pick", "good", `${wr}% win rate across ${onChamp.length} games — a proven, reliable pick.`);
  add(wr <= 40 && onChamp.length >= 5, 10, "Struggle pick", "bad", `${wr}% win rate across ${onChamp.length} games — the results aren't there yet.`);
  add(k.ratio >= 4, 8, "Reliable", "good", `${k.ratio} average KDA — rarely a liability.`);
  add(k.ratio <= 1.6, 9, "Feeding risk", "bad", `${k.ratio} average KDA — deaths are outrunning impact.`);
  // Combat identity
  add(dmgShare != null && dmgShare >= 28, 8, "Damage carry", "good", `${dmgShare}% of your team's champion damage — the output engine.`);
  add(dmgShare != null && dmgShare <= 15, 7, "Low output", "bad", `${dmgShare}% team damage share — struggling to contribute damage.`);
  add(kp != null && kp >= 62, 6, "Always in the fight", "good", `${kp}% average kill participation — present for the team's plays.`);
  add(kp != null && kp <= 42, 7, "Missing fights", "bad", `${kp}% kill participation — often absent from the map's fights.`);
  add(k.k >= (aram ? 11 : 7), 6, "Aggressive", "good", `${k.k} kills per game — you hunt for plays.`);
  add(k.a >= (aram ? 18 : 11), 6, "Playmaker", "good", `${k.a} assists per game — you set the table.`);
  add(k.k >= 6 && k.d >= (aram ? 9 : 7), 5, "Feast or famine", "neutral", `${k.k} kills but ${k.d} deaths — high-variance, all-in style.`);
  add(solo != null && solo >= 1.3, 5, "Lane duelist", "good", `${solo} solo kills per game — you win the 1v1.`);
  // Farming / economy (SR)
  add(cs10 != null && cs10 >= 72, 6, "Farm machine", "good", `${cs10} CS@10 on average — elite early farm.`);
  add(cs10 != null && cs10 < 55, 6, "Farms low", "bad", `${cs10} CS@10 — gold is being left on the map.`);
  add(g15 != null && g15 >= 200, 7, "Lane bully", "good", `+${Math.round(g15 ?? 0)} gold@15 on average — you win lane early.`);
  add(g15 != null && g15 <= -300, 7, "Loses lane", "bad", `${Math.round(g15 ?? 0)} gold@15 on average — starting games behind.`);
  // Survivability
  add(k.d >= (aram ? 9 : 6.5), 8, "Dies a lot", "bad", `${k.d} deaths per game — too many, too fast.`);
  add(d15 != null && d15 >= 3, 6, "Fed early", "bad", `${d15} deaths before 15 — the opening is leaking.`);
  add(d15 != null && d15 <= 1.5, 5, "Ice in the veins", "good", `${d15} deaths before 15 — disciplined early game.`);
  // Macro
  add(vis != null && vis >= 1.2, 4, "Map hawk", "good", `${vis} vision score per minute — you light up the map.`);
  add(objAvg != null && objAvg >= 5, 4, "Objective hound", "good", `${objAvg} team objectives per game — you play the map.`);
  add(avgProc >= 68, 5, "High floor", "good", `${avgProc} average performance — consistently clean games.`);
  add(avgProc < 45, 5, "Low floor", "bad", `${avgProc} average performance — the baseline needs raising.`);

  pt.sort((a, b) => b.pri - a.pri);
  const playstyle: { label: string; tone: "good" | "neutral" | "bad"; hint: string }[] = pt.slice(0, 7).map(({ pri, ...t }) => t);
  if (playstyle.length === 0) {
    playstyle.push({ label: `${onChamp.length}-game read`, tone: "neutral", hint: `Only ${onChamp.length} game${onChamp.length === 1 ? "" : "s"} logged — play more to read a clear style.` });
  }

  const strengths: string[] = [];
  const improvements: string[] = [];
  const push = (ok: boolean, good: string, bad: string) => (ok ? strengths : improvements).push(ok ? good : bad);
  if (cs10 != null) push(cs10 >= 70, `Strong early farm — ${cs10} CS@10`, `Farm floor is low — ${cs10} CS@10 (aim 70+)`);
  if (d15 != null) push(d15 <= 2, `Disciplined early — ${d15} deaths before 15`, `Dying too early — ${d15} deaths before 15`);
  if (g15 != null) push(g15 >= 0, `Winning your lane — ${sgn(g15)} gold@15`, `Losing lane gold — ${sgn(g15)} gold@15`);
  if (kp != null) push(kp >= 55, `Present for fights — ${kp}% kill participation`, `Missing fights — ${kp}% kill participation`);
  push(avgProc >= 60, `Clean games — ${avgProc} avg performance`, `Raise your floor — ${avgProc} avg performance`);

  const clamp = (n: number) => Math.max(4, Math.min(100, Math.round(n)));
  const phases = [
    { phase: "early", label: "Early game", value: `${cs10 ?? "—"} CS@10 · ${d15 ?? "—"} deaths<15`, score: cs10 != null ? clamp((cs10 / 85) * 100) : 50, hint: "Laning: farm and survive to your first reset." },
    { phase: "mid", label: "Mid game", value: `${g15 != null ? sgn(g15) : "—"} gold@15 · ${kp ?? "—"}% KP`, score: kp != null ? clamp(kp * 1.3) : g15 != null ? clamp(50 + g15 / 20) : 50, hint: "Skirmishes and objectives from ~15–25 min." },
    { phase: "late", label: "Late game", value: `${wr}% WR · ${kdaOf(onChamp).ratio} KDA`, score: clamp(wr), hint: "Closing: teamfights and converting the lead." },
  ];
  const recentMatches = [...onChamp].reverse().slice(0, 10);

  // Per-stat comparison against the rank average (setting, else own tier, else Gold).
  const ownTier = [...onChamp].reverse().find((m) => m.objective.tier)?.objective.tier ?? null;
  const { rank: benchRank, bench } = benchFor(
    activeProfile().isSelf ? store.profile().preferredRank : null,
    ownTier
  );
  const cmp = (
    key: string, label: string, value: number | null, benchmark: number,
    unit: string, direction: "higher" | "lower"
  ): StatComparison => {
    const better = value != null && (direction === "higher" ? value >= benchmark : value <= benchmark);
    let pct = 50;
    if (value != null) {
      const mag = Math.max(1, Math.abs(benchmark));
      const imp = direction === "higher" ? value - benchmark : benchmark - value;
      pct = Math.max(4, Math.min(100, Math.round(50 + (imp / mag) * 50)));
    }
    return { key, label, value, benchmark, unit, direction, better, pct };
  };
  const comparison = [
    cmp("cs10", "CS @ 10", cs10, bench.cs10, "", "higher"),
    cmp("deaths15", "Deaths before 15", d15, bench.deaths15, "", "lower"),
    cmp("gold15", "Gold @ 15", g15, bench.gold15, "gold", "higher"),
    cmp("kp", "Kill participation", kp, bench.kp, "%", "higher"),
    cmp("vision", "Vision / min", vis, bench.vision, "", "higher"),
    cmp("kda", "KDA", kdaOf(onChamp).ratio, bench.kda, "", "higher"),
    cmp("solo", "Solo (lane) kills", solo, bench.solo, "", "higher"),
    cmp("obj", "Team objectives", objAvg, bench.obj, "", "higher"),
  ].filter((c) => c.value != null);

  return {
    champion,
    role: activeRole ?? track.role,
    availableRoles,
    activeRole,
    track,
    playstyle,
    strengths,
    improvements,
    comparison,
    comparisonRank: rankLabel(benchRank),
    phases,
    recentMatches,
    tier: poolTier(pool, champion),
    games: onChamp.length,
    wins,
    winRate: Math.round((wins / onChamp.length) * 100),
    netLp: onChamp.reduce((a, m) => a + (m.objective.lpDelta ?? 0), 0),
    avgProcess: Math.round(avg(onChamp.map((m) => m.process.score))),
    kda: kdaOf(onChamp),
    avgCs10: cs10Vals.length ? round1(avg(cs10Vals)) : null,
    avgDeathsBefore15: deaths15Vals.length ? round1(avg(deaths15Vals)) : null,
    avgFirstDeathSec: firstDeathVals.length ? Math.round(avg(firstDeathVals)) : null,
    avgGoldDiff15: gold15Vals.length ? round1(avg(gold15Vals)) : null,
    trend: onChamp.map((m, i) => ({
      index: i + 1,
      date: m.playedAt,
      process: m.process.score,
      cs10: m.objective.csAt10 ?? null,
      win: m.objective.win ?? null,
    })),
    matchups,
    suggestedGoals: championSuggestions(champion, onChamp),
  };
}
