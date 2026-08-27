import type {
  BlockReview,
  BlockProgressPoint,
  BlockCardSummary,
  BlockImageryKind,
  BlockStatGain,
  EnrichedMatch,
} from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll } from "./engine/enrich.ts";
import { evaluateGoal } from "./engine/goals.ts";
import { buildChampionStats } from "./engine/championStats.ts";
import { matchInBlock } from "./engine/blocks.ts";

function avg(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

// Which stats to surface, and how to read them off a game.
const GAIN_STATS: { key: string; label: string; unit: string; dir: "higher" | "lower"; pick: (m: EnrichedMatch) => number | null }[] = [
  { key: "process", label: "Performance", unit: "", dir: "higher", pick: (m) => m.process.score },
  { key: "kda", label: "KDA", unit: "", dir: "higher", pick: (m) => { const o = m.objective; return o.deaths != null ? Math.round(((o.kills! + o.assists!) / Math.max(1, o.deaths)) * 100) / 100 : null; } },
  { key: "kp", label: "Kill participation", unit: "%", dir: "higher", pick: (m) => (m.objective.killParticipation != null ? Math.round(m.objective.killParticipation * 100) : null) },
  { key: "cs10", label: "CS @ 10", unit: "", dir: "higher", pick: (m) => m.objective.csAt10 ?? null },
  { key: "deaths", label: "Deaths / game", unit: "", dir: "lower", pick: (m) => m.objective.deaths ?? null },
  { key: "deaths15", label: "Deaths before 15", unit: "", dir: "lower", pick: (m) => m.objective.deathsBefore15 ?? null },
  { key: "gold15", label: "Gold @ 15", unit: "", dir: "higher", pick: (m) => m.objective.goldDiffAt15 ?? null },
  { key: "dmgshare", label: "Damage share", unit: "%", dir: "higher", pick: (m) => (m.objective.teamDamageShare != null ? Math.round(m.objective.teamDamageShare * 100) : null) },
];

// Block averages vs the games before the block started — ranked by relative
// improvement so the biggest wins float up.
function computeStatGains(blockGames: EnrichedMatch[], priorGames: EnrichedMatch[]): BlockStatGain[] {
  const mean = (ms: EnrichedMatch[], pick: (m: EnrichedMatch) => number | null) => {
    const v = ms.map(pick).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const gains: (BlockStatGain & { rel: number })[] = [];
  for (const s of GAIN_STATS) {
    const after = mean(blockGames, s.pick);
    if (after == null) continue;
    const before = mean(priorGames, s.pick);
    const delta = before == null ? 0 : r1(after - before);
    const better = before == null ? true : s.dir === "higher" ? after >= before : after <= before;
    const rel = before == null ? 0 : Math.abs(delta) / Math.max(1, Math.abs(before));
    gains.push({ key: s.key, label: s.label, unit: s.unit, before: before == null ? null : r1(before), after: r1(after), delta, better, rel });
  }
  // Improvements first (by relative size), then the rest.
  return gains
    .sort((a, b) => Number(b.better) - Number(a.better) || b.rel - a.rel)
    .slice(0, 5)
    .map(({ rel, ...g }) => g);
}

// The block review: every game stacked into the block, obvious progression
// toward the block's goals, and how the process floor moved from start to now.
export function buildBlockReview(seasonId: string): BlockReview | null {
  const season = store.getSeason(seasonId);
  if (!season) return null;

  const pool = store.activePool();
  const career = enrichAll(store.matches(), store.seasons(), pool);
  const games = career.filter((m) => matchInBlock(m, season));

  const goals = store.goalsForSeason(season.id).map((g) => evaluateGoal(g, games));

  const wins = games.filter((m) => m.objective.win).length;
  const losses = games.filter((m) => m.objective.win === false).length;

  const WINDOW = 5;
  const progression: BlockProgressPoint[] = games.map((m, i) => {
    const from = Math.max(0, i - WINDOW + 1);
    const slice = games.slice(from, i + 1);
    return {
      index: i + 1,
      playedAt: m.playedAt,
      process: m.process.score,
      processAvg: Math.round(slice.reduce((a, x) => a + x.process.score, 0) / slice.length),
      win: m.objective.win ?? null,
      champion: m.objective.champion ?? null,
    };
  });

  const third = Math.max(1, Math.floor(games.length / 3));
  const startProcess = avg(games.slice(0, third).map((m) => m.process.score));
  const recentProcess = avg(games.slice(-third).map((m) => m.process.score));

  // Compare the block's games to what you were doing before it started.
  const startedAt = +new Date(season.startedAt);
  const priorGames = career.filter((m) => +new Date(m.playedAt) < startedAt);
  const statGains = computeStatGains(games, priorGames);

  return {
    season,
    isActive: store.settings().activeSeasonId === season.id,
    games: games.length,
    target: season.targetGames,
    wins,
    losses,
    winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
    netLp: games.reduce((a, m) => a + (m.objective.lpDelta ?? 0), 0),
    avgProcess: avg(games.map((m) => m.process.score)) ?? 0,
    startProcess,
    recentProcess,
    goals,
    progression,
    champions: buildChampionStats(games, pool),
    matches: [...games].reverse(),
    statGains,
  };
}

// Compact summaries for every block — powers the Blocks-page quick cards. One
// pass over the career, so the page needs a single request.
export function buildBlockSummaries(): BlockCardSummary[] {
  const pool = store.activePool();
  const career = enrichAll(store.matches(), store.seasons(), pool);
  const activeId = store.settings().activeSeasonId;

  return store.seasons().map((season) => {
    const games = career.filter((m) => matchInBlock(m, season));
    const rawGoals = store.goalsForSeason(season.id);
    const goals = rawGoals.map((g) => evaluateGoal(g, games));
    const wins = games.filter((m) => m.objective.win).length;
    const losses = games.filter((m) => m.objective.win === false).length;

    // Representative imagery: champion first, else the dominant goal category.
    let kind: BlockImageryKind = "general";
    const champ = season.focusChampion ?? null;
    if (champ) kind = "champion";
    else {
      const cats = new Set(rawGoals.map((g) => g.category));
      if (cats.has("objectives")) kind = "objectives";
      else if (cats.has("vision")) kind = "vision";
      else if (cats.has("survival")) kind = "survival";
      else if (cats.has("farm")) kind = "farm";
      else if (cats.has("aggression")) kind = "carry";
    }

    return {
      season,
      isActive: season.id === activeId,
      games: games.length,
      target: season.targetGames,
      wins,
      losses,
      winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
      avgProcess: avg(games.map((m) => m.process.score)) ?? 0,
      goalsMet: goals.filter((g) => g.met).length,
      goalsTotal: goals.length,
      goals: goals
        .map((g) => ({
          title: g.goal.title,
          current: g.current,
          target: g.goal.target,
          direction: g.goal.direction,
          unit: g.goal.unit,
          pct: g.pct,
          met: g.met,
        }))
        .sort((a, b) => Number(a.met) - Number(b.met) || b.pct - a.pct),
      imagery: { kind, champion: champ },
    };
  });
}
