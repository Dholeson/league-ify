import type { EnrichedMatch, StatCard } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// THE STAT BOARD (glance cards)
//
// The PRD's atomic unit: a stat shown against a baseline with a directional
// arrow. Here the baseline is "your prior window" (recent form vs. the games
// before it) — the vs-past-self baseline. Rank/team/conditional baselines plug
// in later behind the same StatCard shape.
// ---------------------------------------------------------------------------

const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const perMin = (v: number | undefined, dur: number | undefined) =>
  v != null && dur ? v / (dur / 60) : null;

type BoardMode = "sr" | "aram";

interface MetricDef {
  id: string;
  label: string;
  unit: string;
  direction: "higher" | "lower";
  hint: string;
  href: string | null;
  fmt: (v: number) => string;
  modes: BoardMode[]; // which boards this metric belongs on
  // aggregate a set of games into one value (null if no data)
  agg: (ms: EnrichedMatch[]) => number | null;
}

const round = (v: number, d = 1) => {
  const p = 10 ** d;
  return Math.round(v * p) / p;
};

const avgOf = (ms: EnrichedMatch[], pick: (m: EnrichedMatch) => number | null | undefined) => {
  const v = avg(ms.map(pick).filter(def));
  return v == null ? null : round(v);
};

const METRICS: MetricDef[] = [
  {
    id: "winrate",
    label: "Win rate",
    unit: "%",
    direction: "higher",
    hint: "Wins over the window.",
    href: "/progress",
    fmt: (v) => `${Math.round(v)}%`,
    modes: ["sr", "aram"],
    agg: (ms) => (ms.length ? Math.round((ms.filter((m) => m.objective.win).length / ms.length) * 100) : null),
  },
  {
    id: "kda",
    label: "KDA",
    unit: "",
    direction: "higher",
    hint: "(Kills + assists) / deaths.",
    href: "/progress",
    fmt: (v) => `${round(v, 2)}`,
    modes: ["sr", "aram"],
    agg: (ms) => {
      const vals = ms
        .filter((m) => m.objective.deaths != null)
        .map((m) => (m.objective.kills! + m.objective.assists!) / Math.max(1, m.objective.deaths!));
      return avg(vals) == null ? null : round(avg(vals)!, 2);
    },
  },
  {
    id: "kp",
    label: "Kill participation",
    unit: "%",
    direction: "higher",
    hint: "Share of your team's kills you're part of.",
    href: "/progress",
    fmt: (v) => `${Math.round(v)}%`,
    modes: ["sr", "aram"],
    agg: (ms) => avgOf(ms, (m) => (m.objective.killParticipation != null ? m.objective.killParticipation * 100 : null)),
  },
  {
    id: "kills",
    label: "Kills / game",
    unit: "",
    direction: "higher",
    hint: "Average kills — the ARAM aggression metric.",
    href: "/progress",
    fmt: (v) => `${round(v)}`,
    modes: ["aram"],
    agg: (ms) => avgOf(ms, (m) => m.objective.kills),
  },
  {
    id: "dmgmin",
    label: "Damage / min",
    unit: "",
    direction: "higher",
    hint: "Damage to champions per minute — the ARAM output metric.",
    href: "/progress",
    fmt: (v) => `${round(v)}`,
    modes: ["aram"],
    agg: (ms) => avgOf(ms, (m) => perMin(m.objective.damageToChampions, m.objective.durationSec)),
  },
  {
    id: "cs10",
    label: "CS @ 10",
    unit: "",
    direction: "higher",
    hint: "Creep score at 10 minutes.",
    href: "/progress",
    fmt: (v) => `${round(v)}`,
    modes: ["sr"],
    agg: (ms) => avgOf(ms, (m) => m.objective.csAt10),
  },
  {
    id: "csmin",
    label: "CS / min",
    unit: "",
    direction: "higher",
    hint: "Total creep score per minute.",
    href: "/progress",
    fmt: (v) => `${round(v)}`,
    modes: ["sr"],
    agg: (ms) => avgOf(ms, (m) => perMin(m.objective.totalCs, m.objective.durationSec)),
  },
  {
    id: "gold15",
    label: "Gold @ 15",
    unit: "",
    direction: "higher",
    hint: "Gold difference vs your lane opponent at 15.",
    href: "/progress",
    fmt: (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`,
    modes: ["sr"],
    agg: (ms) => avgOf(ms, (m) => m.objective.goldDiffAt15),
  },
  {
    id: "vision",
    label: "Vision / min",
    unit: "",
    direction: "higher",
    hint: "Vision score per minute.",
    href: "/progress",
    fmt: (v) => `${round(v)}`,
    modes: ["sr"],
    agg: (ms) => avgOf(ms, (m) => perMin(m.objective.visionScore, m.objective.durationSec)),
  },
  {
    id: "deaths15",
    label: "Deaths < 15",
    unit: "",
    direction: "lower",
    hint: "Average deaths before 15 minutes. Lower is better.",
    href: "/progress",
    fmt: (v) => `${round(v)}`,
    modes: ["sr"],
    agg: (ms) => avgOf(ms, (m) => m.objective.deathsBefore15),
  },
  {
    id: "deaths",
    label: "Deaths / game",
    unit: "",
    direction: "lower",
    hint: "Average deaths. Lower is better.",
    href: "/progress",
    fmt: (v) => `${round(v)}`,
    modes: ["sr", "aram"],
    agg: (ms) => avgOf(ms, (m) => m.objective.deaths),
  },
  {
    id: "process",
    label: "Process",
    unit: "",
    direction: "higher",
    hint: "How well you played, independent of the result.",
    href: "/progress",
    fmt: (v) => `${Math.round(v)}`,
    modes: ["sr", "aram"],
    agg: (ms) => avgOf(ms, (m) => m.process.score),
  },
];

// Per-game value of each metric — used for the sparkline over the recent window.
const PICKS: Record<string, (m: EnrichedMatch) => number | null> = {
  winrate: (m) => (m.objective.win === true ? 100 : m.objective.win === false ? 0 : null),
  kda: (m) => (m.objective.deaths != null ? (m.objective.kills! + m.objective.assists!) / Math.max(1, m.objective.deaths!) : null),
  kp: (m) => (m.objective.killParticipation != null ? m.objective.killParticipation * 100 : null),
  kills: (m) => m.objective.kills ?? null,
  dmgmin: (m) => perMin(m.objective.damageToChampions, m.objective.durationSec),
  cs10: (m) => m.objective.csAt10 ?? null,
  csmin: (m) => perMin(m.objective.totalCs, m.objective.durationSec),
  gold15: (m) => m.objective.goldDiffAt15 ?? null,
  vision: (m) => perMin(m.objective.visionScore, m.objective.durationSec),
  deaths15: (m) => m.objective.deathsBefore15 ?? null,
  deaths: (m) => m.objective.deaths ?? null,
  process: (m) => m.process.score,
};

export function buildStatBoard(
  career: EnrichedMatch[],
  mode: BoardMode = "sr",
  windowSize = 10
): StatCard[] {
  // Chronological; recent window vs the window before it (vs past self).
  const recent = career.slice(-windowSize);
  const prior = career.slice(-windowSize * 2, -windowSize);

  return METRICS.filter((m) => m.modes.includes(mode)).map((m) => {
    const value = m.agg(recent);
    const baseline = prior.length >= 3 ? m.agg(prior) : null;
    const series = PICKS[m.id] ? recent.map(PICKS[m.id]).filter(def).map((v) => round(v, 2)) : [];
    const delta = value != null && baseline != null ? round(value - baseline, 2) : null;
    const better =
      value != null && baseline != null
        ? m.direction === "higher"
          ? value > baseline
          : value < baseline
        : null;
    return {
      id: m.id,
      label: m.label,
      unit: m.unit,
      value,
      valueFmt: value == null ? "—" : m.fmt(value),
      baseline,
      delta,
      direction: m.direction,
      better,
      hint: m.hint,
      href: m.href,
      series,
    };
  });
}
