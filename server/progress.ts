import type {
  ProgressResponse,
  MetricMeta,
  MetricSeriesPoint,
  BlockSummary,
  DayActivity,
  StreakStat,
  RadarPoint,
  EnrichedMatch,
  ProcessWeights,
  ComparisonRow,
  LevelMilestone,
} from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll, totalXp } from "./engine/enrich.ts";
import { matchInBlock } from "./engine/blocks.ts";
import { buildInsights } from "./engine/insights.ts";
import { getIdentity } from "./engine/identities.ts";
import { cumulativeXpThreshold, levelFromXp, titleForLevel } from "./engine/xp.ts";

// ---------------------------------------------------------------------------
// PROGRESS
//
// The career view. Everything else answers "how am I doing right now"; this
// answers the question the whole system exists for: "am I actually improving
// over time?" as trends across blocks, not a single volatile number.
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;

const perMin = (v: number | undefined, durSec: number | undefined) =>
  v != null && durSec ? v / (durSec / 60) : null;

interface MetricDef extends MetricMeta {
  pick: (m: EnrichedMatch) => number | null;
}

const METRICS: MetricDef[] = [
  {
    key: "process",
    label: "Game score",
    unit: "",
    direction: "higher",
    pick: (m) => m.process.score,
  },
  {
    key: "cs10",
    label: "CS @ 10",
    unit: "cs",
    direction: "higher",
    pick: (m) => m.objective.csAt10 ?? null,
  },
  {
    key: "csPerMin",
    label: "CS / min",
    unit: "/min",
    direction: "higher",
    pick: (m) => {
      const v = perMin(m.objective.totalCs, m.objective.durationSec);
      return v == null ? null : round1(v);
    },
  },
  {
    key: "deaths15",
    label: "Deaths before 15",
    unit: "",
    direction: "lower",
    pick: (m) => m.objective.deathsBefore15 ?? null,
  },
  {
    key: "deaths",
    label: "Deaths",
    unit: "",
    direction: "lower",
    pick: (m) => m.objective.deaths ?? null,
  },
  {
    key: "kp",
    label: "Kill participation",
    unit: "%",
    direction: "higher",
    pick: (m) =>
      m.objective.killParticipation != null
        ? Math.round(m.objective.killParticipation * 100)
        : null,
  },
  {
    key: "gold15",
    label: "Gold diff @ 15",
    unit: "g",
    direction: "higher",
    pick: (m) => m.objective.goldDiffAt15 ?? null,
  },
  {
    key: "vision",
    label: "Vision / min",
    unit: "/min",
    direction: "higher",
    pick: (m) => {
      const v = perMin(m.objective.visionScore, m.objective.durationSec);
      return v == null ? null : round1(v);
    },
  },
  {
    key: "tilt",
    label: "Tilt after",
    unit: "",
    direction: "lower",
    pick: (m) => m.scorecard.tiltAfter,
  },
];

const RADAR_METRICS: { key: keyof ProcessWeights; label: string }[] = [
  { key: "earlyStability", label: "Early" },
  { key: "deathDiscipline", label: "Deaths" },
  { key: "objectiveMacro", label: "Macro" },
  { key: "teamfight", label: "Fights" },
  { key: "mental", label: "Mental" },
  { key: "review", label: "Review" },
];

function localDay(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function streaks(ms: EnrichedMatch[], pred: (m: EnrichedMatch) => boolean) {
  let current = 0;
  let longest = 0;
  let run = 0;
  for (const m of ms) {
    if (pred(m)) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  for (let i = ms.length - 1; i >= 0; i--) {
    if (pred(ms[i])) current++;
    else break;
  }
  return { current, longest };
}

function protectedStreak(
  ms: EnrichedMatch[],
  pred: (m: EnrichedMatch) => boolean,
  earnedShields: number
) {
  let kept = 0;
  let used = 0;
  for (let i = ms.length - 1; i >= 0; i--) {
    if (pred(ms[i])) {
      kept++;
      continue;
    }
    if (used < earnedShields) {
      used++;
      continue;
    }
    break;
  }
  return { protectedCount: kept, shieldsLeft: Math.max(0, earnedShields - used) };
}

function nextMilestone(current: number): number {
  for (const m of [3, 5, 10, 15, 20, 25, 30, 50, 75, 100]) {
    if (m > current) return m;
  }
  return current + 25;
}

function buildLevelPath(totalXpValue: number, matches: EnrichedMatch[]): LevelMilestone[] {
  const currentLevel = levelFromXp(totalXpValue, matches).level;
  const start = Math.max(0, currentLevel - 1);
  const end = currentLevel + 4;
  const path: LevelMilestone[] = [];
  for (let level = start; level <= end; level++) {
    const threshold = cumulativeXpThreshold(level);
    path.push({
      level,
      title: titleForLevel(level),
      xpThreshold: threshold,
      reached: totalXpValue >= threshold,
      current: level === currentLevel,
    });
  }
  return path;
}

function subAvg(ms: EnrichedMatch[], key: keyof ProcessWeights): number {
  const vals = ms.map((m) => m.process.subMetrics[key]).filter(def);
  return vals.length ? avg(vals) : 0;
}

function computeBests(ms: EnrichedMatch[]) {
  const bests: { label: string; value: string; when: string; matchId: string }[] = [];
  const best = (
    label: string,
    pick: (m: EnrichedMatch) => number | null,
    fmt: (n: number) => string,
    dir: "max" | "min" = "max"
  ) => {
    const withVal = ms
      .map((m) => ({ m, v: pick(m) }))
      .filter((x): x is { m: EnrichedMatch; v: number } => x.v != null);
    if (!withVal.length) return;
    const winner = withVal.reduce((a, b) =>
      dir === "max" ? (b.v > a.v ? b : a) : b.v < a.v ? b : a
    );
    bests.push({
      label,
      value: fmt(winner.v),
      when: localDay(winner.m.playedAt),
      matchId: winner.m.id,
    });
  };
  best("Best process score", (m) => m.process.score, (n) => String(n));
  best("Highest CS @ 10", (m) => m.objective.csAt10 ?? null, (n) => String(n));
  best(
    "Biggest gold lead @ 15",
    (m) => m.objective.goldDiffAt15 ?? null,
    (n) => `+${n}`
  );
  best(
    "Longest game survived",
    (m) => m.objective.durationSec ?? null,
    (n) => `${Math.round(n / 60)}m`
  );
  return bests;
}

function compareMetric(
  key: string,
  label: string,
  unit: string,
  direction: "higher" | "lower",
  nowVals: number[],
  thenVals: number[]
): ComparisonRow | null {
  if (nowVals.length === 0 || thenVals.length === 0) return null;
  const now = round1(avg(nowVals));
  const then = round1(avg(thenVals));
  const delta = round1(now - then);
  const improved =
    direction === "higher" ? delta > 0 : direction === "lower" ? delta < 0 : null;
  return { key, label, unit, direction, now, then, delta, improved };
}

function buildPastComparison(ms: EnrichedMatch[]) {
  const window = Math.max(5, Math.min(10, Math.floor(ms.length / 2)));
  const nowSlice = ms.slice(-window);
  const thenSlice = ms.slice(-window * 2, -window);

  if (nowSlice.length === 0 || thenSlice.length === 0) {
    return { rows: [] as ComparisonRow[], window };
  }

  const row = (...args: Parameters<typeof compareMetric>) => compareMetric(...args);
  const rows = [
    row(
      "process",
      "Game score",
      "",
      "higher",
      nowSlice.map((m) => m.process.score),
      thenSlice.map((m) => m.process.score)
    ),
    row(
      "cs10",
      "CS @ 10",
      "cs",
      "higher",
      nowSlice.map((m) => m.objective.csAt10).filter(def),
      thenSlice.map((m) => m.objective.csAt10).filter(def)
    ),
    row(
      "gold15",
      "Gold diff @ 15",
      "g",
      "higher",
      nowSlice.map((m) => m.objective.goldDiffAt15).filter(def),
      thenSlice.map((m) => m.objective.goldDiffAt15).filter(def)
    ),
    row(
      "deaths15",
      "Deaths before 15",
      "",
      "lower",
      nowSlice.map((m) => m.objective.deathsBefore15).filter(def),
      thenSlice.map((m) => m.objective.deathsBefore15).filter(def)
    ),
    row(
      "tilt",
      "Tilt after",
      "",
      "lower",
      nowSlice.map((m) => m.scorecard.tiltAfter),
      thenSlice.map((m) => m.scorecard.tiltAfter)
    ),
    row(
      "review",
      "Review completion",
      "%",
      "higher",
      [
        Math.round(
          (nowSlice.filter(
            (m) =>
              m.scorecard.reviewed &&
              m.scorecard.oneAdjustment.trim().length > 0 &&
              m.scorecard.biggestMistake.trim().length > 0
          ).length /
            nowSlice.length) *
            100
        ),
      ],
      [
        Math.round(
          (thenSlice.filter(
            (m) =>
              m.scorecard.reviewed &&
              m.scorecard.oneAdjustment.trim().length > 0 &&
              m.scorecard.biggestMistake.trim().length > 0
          ).length /
            thenSlice.length) *
            100
        ),
      ]
    ),
  ].filter(def);

  return { rows, window };
}

export function buildProgress(): ProgressResponse {
  const seasons = store.seasons();
  const pool = store.activePool();
  const enriched = enrichAll(store.matches(), seasons, pool);

  const metrics: MetricMeta[] = METRICS.map(({ key, label, unit, direction }) => ({
    key,
    label,
    unit,
    direction,
  }));

  if (enriched.length === 0) {
    return {
      hasData: false,
      totalGames: 0,
      metrics,
      series: [],
      matches: [],
      insights: [],
      blocks: [],
      calendar: [],
      streaks: [],
      radar: [],
      lpTimeline: [],
      personalBests: [],
      levelPath: [],
      pastComparison: [],
      pastComparisonWindow: 0,
    };
  }

  const seasonName = new Map(seasons.map((s) => [s.id, s.name]));

  const series: MetricSeriesPoint[] = enriched.map((m, i) => {
    const values: Record<string, number | null> = {};
    for (const md of METRICS) values[md.key] = md.pick(m);
    return {
      index: i + 1,
      date: m.playedAt,
      blockId: m.seasonId ?? "career",
      blockName: (m.seasonId && seasonName.get(m.seasonId)) || "Career",
      win: m.objective.win ?? null,
      values,
    };
  });

  // Per-game match cards aligned to the series index, most-recent first.
  const matches = enriched
    .map((m, i) => ({
      index: i + 1,
      matchId: m.id,
      champion: m.objective.champion ?? null,
      queue: m.objective.queue ?? null,
      win: m.objective.win ?? null,
      kills: m.objective.kills ?? 0,
      deaths: m.objective.deaths ?? 0,
      assists: m.objective.assists ?? 0,
      process: m.process.score,
      verdict: m.verdict,
      playedAt: m.playedAt,
    }))
    .reverse();

  const blocks: BlockSummary[] = [...seasons]
    .sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt))
    .map((s) => {
      const bm = enriched.filter((m) => matchInBlock(m, s));
      const wins = bm.filter((m) => m.objective.win).length;
      const metricAvgs: Record<string, number | null> = {};
      for (const md of METRICS) {
        const vals = bm.map(md.pick).filter(def);
        metricAvgs[md.key] = vals.length ? round1(avg(vals)) : null;
      }
      return {
        id: s.id,
        name: s.name,
        identityName: getIdentity(s.identityId).name,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        games: bm.length,
        wins,
        winRate: bm.length ? Math.round((wins / bm.length) * 100) : 0,
        netLp: bm.reduce((a, m) => a + (m.objective.lpDelta ?? 0), 0),
        avgProcess: bm.length ? Math.round(avg(bm.map((m) => m.process.score))) : 0,
        metrics: metricAvgs,
      };
    })
    .filter((b) => b.games > 0);

  const byDay = new Map<string, EnrichedMatch[]>();
  for (const m of enriched) {
    const d = localDay(m.playedAt);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(m);
  }
  const calendar: DayActivity[] = [...byDay.entries()]
    .map(([date, ds]) => ({
      date,
      games: ds.length,
      avgProcess: Math.round(avg(ds.map((m) => m.process.score))),
      reviewedRate: ds.filter((m) => m.scorecard.reviewed).length / ds.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const streakDefs: {
    key: string;
    label: string;
    unit: string;
    pred: (m: EnrichedMatch) => boolean;
  }[] = [
    {
      key: "review",
      label: "Review streak",
      unit: "games",
      pred: (m) =>
        m.scorecard.reviewed && m.scorecard.oneAdjustment.trim().length > 0,
    },
    {
      key: "noFlame",
      label: "No-flame streak",
      unit: "games",
      pred: (m) => !m.scorecard.flamed,
    },
    {
      key: "cleanEarly",
      label: "Clean-early streak",
      unit: "games",
      pred: (m) => (m.objective.deathsBefore15 ?? 99) <= 2,
    },
    {
      key: "calm",
      label: "Calm-exit streak",
      unit: "games",
      pred: (m) => m.scorecard.tiltAfter <= 2,
    },
  ];
  const streakStats: StreakStat[] = streakDefs.map((d) => {
    const raw = streaks(enriched, d.pred);
    const earnedShields = Math.min(2, Math.floor(raw.longest / 5));
    const forgiven = protectedStreak(enriched, d.pred, earnedShields);
    return {
      key: d.key,
      label: d.label,
      current: raw.current,
      protected: forgiven.protectedCount,
      shields: forgiven.shieldsLeft,
      longest: raw.longest,
      nextMilestone: nextMilestone(forgiven.protectedCount),
      unit: d.unit,
    };
  });

  const active = store.activeSeason();
  const activeMatches = active ? enriched.filter((m) => matchInBlock(m, active)) : enriched;
  const radar: RadarPoint[] = RADAR_METRICS.map(({ key, label }) => ({
    metric: key,
    label,
    current: Math.round(subAvg(activeMatches, key) * 100),
    career: Math.round(subAvg(enriched, key) * 100),
  }));

  // LP only exists in ranked, and Riot doesn't expose per-game LP in batch — so
  // when we have no real deltas we estimate the trajectory from wins/losses
  // (~+20 / -18). This turns a flat line into a readable climb/slide.
  const rankedGames = enriched.filter((m) => (m.objective.queue ?? "").toUpperCase().includes("RANKED"));
  let cum = 0;
  const lpTimeline = rankedGames.map((m, i) => {
    const delta = m.objective.lpDelta ?? (m.objective.win === true ? 20 : m.objective.win === false ? -18 : 0);
    cum += delta;
    return {
      index: i + 1,
      date: m.playedAt,
      cumulativeLp: cum,
      leaguePoints: m.objective.leaguePoints ?? null,
    };
  });

  const personalBests = computeBests(enriched);
  const totalCareerXp = totalXp(enriched);
  const levelPath = buildLevelPath(totalCareerXp, enriched);
  const past = buildPastComparison(enriched);

  return {
    hasData: true,
    totalGames: enriched.length,
    metrics,
    series,
    matches,
    insights: buildInsights(enriched),
    blocks,
    calendar,
    streaks: streakStats,
    radar,
    lpTimeline,
    personalBests,
    levelPath,
    pastComparison: past.rows,
    pastComparisonWindow: past.window,
  };
}
