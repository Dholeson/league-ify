import type {
  EnrichedMatch,
  Goal,
  GoalProgress,
  GoalCategory,
} from "../../shared/types.ts";

export interface Measurement {
  value: number | null;
  sampleSize: number;
  detail: string;
}

export interface GoalTemplate {
  id: string;
  category: GoalCategory;
  unit: string;
  direction: "higher" | "lower";
  defaultTarget: number;
  needsChampion?: boolean;
  title: (champion?: string | null) => string;
  describe: (target: number, champion?: string | null) => string;
  measure: (ms: EnrichedMatch[], champion?: string | null) => Measurement;
}

const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const round1 = (n: number) => Math.round(n * 10) / 10;
const mins = (m: EnrichedMatch) =>
  m.objective.durationSec ? m.objective.durationSec / 60 : null;

function scoped(ms: EnrichedMatch[], champion?: string | null) {
  return champion
    ? ms.filter(
        (m) => m.objective.champion?.toLowerCase() === champion.toLowerCase()
      )
    : ms;
}

function avgOf(
  ms: EnrichedMatch[],
  pick: (m: EnrichedMatch) => number | null | undefined,
  label: string
): Measurement {
  const vals = ms.map(pick).filter(def);
  if (vals.length === 0) return { value: null, sampleSize: 0, detail: "no data yet" };
  const value = round1(vals.reduce((a, b) => a + b, 0) / vals.length);
  return { value, sampleSize: vals.length, detail: `avg over ${vals.length} ${label}` };
}

function rateOf(
  ms: EnrichedMatch[],
  pred: (m: EnrichedMatch) => boolean | null,
  guard: (m: EnrichedMatch) => boolean,
  label: string
): Measurement {
  const eligible = ms.filter(guard);
  if (eligible.length === 0) return { value: null, sampleSize: 0, detail: "no data yet" };
  const hits = eligible.filter((m) => pred(m) === true).length;
  return {
    value: Math.round((hits / eligible.length) * 100),
    sampleSize: eligible.length,
    detail: `${hits}/${eligible.length} ${label}`,
  };
}

// Count how many games clear a bar. The point of these: a bad game doesn't
// count, so you can't grind them out — you have to actually play well N times.
function countOf(
  ms: EnrichedMatch[],
  pred: (m: EnrichedMatch) => boolean,
  label: string
): Measurement {
  const hits = ms.filter(pred).length;
  return { value: hits, sampleSize: ms.length, detail: `${hits} so far · ${label}` };
}

const kdaOf = (m: EnrichedMatch) => {
  const { kills, deaths, assists } = m.objective;
  if (kills == null || deaths == null || assists == null) return null;
  return (kills + assists) / Math.max(1, deaths);
};
const objsOf = (m: EnrichedMatch) =>
  (m.objective.dragons ?? 0) + (m.objective.heralds ?? 0) + (m.objective.barons ?? 0);

// Failable achievement goals — each needs N *good* games, so they can't be
// farmed by queuing bad ones. These lead the coach's block plans now.
const ACHIEVEMENTS: GoalTemplate[] = [
  {
    id: "positive_games",
    category: "achievement",
    unit: "games",
    direction: "higher",
    defaultTarget: 10,
    title: (c) => (c ? `${c}: finish positive` : "Finish games positive"),
    describe: (t, c) =>
      `Get ${t} games where your takedowns beat your deaths${c ? ` on ${c}` : ""} — no coin-flip int games.`,
    measure: (ms, c) =>
      countOf(scoped(ms, c), (m) => {
        const k = m.objective.kills, d = m.objective.deaths, a = m.objective.assists;
        return k != null && d != null && a != null && k + a > d;
      }, "positive KDA"),
  },
  {
    id: "carry_games",
    category: "achievement",
    unit: "games",
    direction: "higher",
    defaultTarget: 5,
    title: (c) => (c ? `${c}: carry games` : "Stack carry games"),
    describe: (t, c) => `Get ${t} games where you carried — 60%+ kill participation and a 3+ KDA${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      countOf(scoped(ms, c), (m) => (m.objective.killParticipation ?? 0) >= 0.6 && (kdaOf(m) ?? 0) >= 3, "carried"),
  },
  {
    id: "clean_lane_games",
    category: "achievement",
    unit: "games",
    direction: "higher",
    defaultTarget: 8,
    title: (c) => (c ? `${c}: clean laning` : "Clean laning games"),
    describe: (t, c) => `Get ${t} games with a calm early game — at most 1 death before 15 minutes${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      countOf(scoped(ms, c), (m) => m.objective.deathsBefore15 != null && m.objective.deathsBefore15 <= 1, "clean starts"),
  },
  {
    id: "deathless_openings",
    category: "achievement",
    unit: "games",
    direction: "higher",
    defaultTarget: 5,
    title: (c) => (c ? `${c}: deathless openings` : "Deathless openings"),
    describe: (t, c) => `Get ${t} games where you take zero deaths before 15 minutes${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) => countOf(scoped(ms, c), (m) => m.objective.deathsBefore15 === 0, "flawless starts"),
  },
  {
    id: "disciplined_games",
    category: "achievement",
    unit: "games",
    direction: "higher",
    defaultTarget: 12,
    title: (c) => (c ? `${c}: disciplined games` : "Disciplined games"),
    describe: (t, c) => `Get ${t} games at 4 deaths or fewer — respect the map${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) => countOf(scoped(ms, c), (m) => m.objective.deaths != null && m.objective.deaths <= 4, "low-death games"),
  },
  {
    id: "comeback_wins",
    category: "achievement",
    unit: "wins",
    direction: "higher",
    defaultTarget: 3,
    title: () => "Comeback wins",
    describe: (t) => `Win ${t} games you were losing at 15 — down 1000+ gold and still closed it.`,
    measure: (ms) =>
      countOf(ms, (m) => m.objective.win === true && (m.objective.goldDiffAt15 ?? 0) <= -1000, "comebacks"),
  },
  {
    id: "objective_games",
    category: "achievement",
    unit: "games",
    direction: "higher",
    defaultTarget: 6,
    title: () => "Objective dominance",
    describe: (t) => `Get ${t} games where your team stacks 6+ major objectives (drakes / heralds / barons).`,
    measure: (ms) => countOf(ms, (m) => objsOf(m) >= 6, "objective games"),
  },
  {
    id: "win_count",
    category: "achievement",
    unit: "wins",
    direction: "higher",
    defaultTarget: 10,
    title: (c) => (c ? `${c}: rack up wins` : "Rack up wins"),
    describe: (t, c) => `Win ${t} games this block${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) => countOf(scoped(ms, c), (m) => m.objective.win === true, "wins"),
  },
];

export const TEMPLATES: GoalTemplate[] = [
  ...ACHIEVEMENTS,
  {
    id: "cs10",
    category: "farm",
    unit: "CS@10",
    direction: "higher",
    defaultTarget: 70,
    title: (c) => (c ? `${c}: CS at 10 minutes` : "CS at 10 minutes"),
    describe: (t, c) => `Average ${t}+ CS by 10 minutes${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) => avgOf(scoped(ms, c), (m) => m.objective.csAt10, "games"),
  },
  {
    id: "cs_per_min",
    category: "farm",
    unit: "CS/min",
    direction: "higher",
    defaultTarget: 6.5,
    title: (c) => (c ? `${c}: CS per minute` : "CS per minute"),
    describe: (t, c) =>
      `Average ${t}+ CS per minute across the game${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(
        scoped(ms, c),
        (m) => {
          const mm = mins(m);
          return m.objective.totalCs != null && mm ? m.objective.totalCs / mm : null;
        },
        "games"
      ),
  },
  {
    id: "deaths_before_15",
    category: "survival",
    unit: "deaths <15",
    direction: "lower",
    defaultTarget: 2,
    title: (c) => (c ? `${c}: Deaths before 15` : "Deaths before 15"),
    describe: (t, c) =>
      `No more than ${t} deaths before 15 minutes, on average${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(scoped(ms, c), (m) => m.objective.deathsBefore15, "games"),
  },
  {
    id: "deaths_per_game",
    category: "survival",
    unit: "deaths",
    direction: "lower",
    defaultTarget: 5,
    title: (c) => (c ? `${c}: Deaths per game` : "Deaths per game"),
    describe: (t, c) => `Keep average deaths at or below ${t}${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) => avgOf(scoped(ms, c), (m) => m.objective.deaths, "games"),
  },
  {
    id: "clean_early_rate",
    category: "survival",
    unit: "%",
    direction: "higher",
    defaultTarget: 70,
    title: (c) => (c ? `${c}: Clean early games` : "Clean early games"),
    describe: (t, c) =>
      `${t}%+ of games with <=1 death before 10 minutes${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      rateOf(
        scoped(ms, c),
        (m) => (m.objective.deathsBefore10 ?? 99) <= 1,
        (m) => m.objective.deathsBefore10 != null,
        "clean"
      ),
  },
  {
    id: "kill_participation",
    category: "aggression",
    unit: "% KP",
    direction: "higher",
    defaultTarget: 55,
    title: (c) => (c ? `${c}: Kill participation` : "Kill participation"),
    describe: (t, c) =>
      `Be involved in ${t}%+ of your team's kills${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(
        scoped(ms, c),
        (m) =>
          m.objective.killParticipation != null
            ? m.objective.killParticipation * 100
            : null,
        "games"
      ),
  },
  {
    id: "solo_kills",
    category: "aggression",
    unit: "solo kills",
    direction: "higher",
    defaultTarget: 1,
    title: (c) => (c ? `${c}: Solo kills` : "Solo kills"),
    describe: (t, c) => `Average ${t}+ solo kills${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) => avgOf(scoped(ms, c), (m) => m.objective.soloKills, "games"),
  },
  {
    id: "gold_diff_15",
    category: "aggression",
    unit: "gold@15",
    direction: "higher",
    defaultTarget: 250,
    title: (c) => (c ? `${c}: Gold lead at 15` : "Gold lead at 15"),
    describe: (t, c) =>
      `Average +${t} gold vs your lane opponent by 15${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(scoped(ms, c), (m) => m.objective.goldDiffAt15, "games"),
  },
  {
    id: "damage_share",
    category: "aggression",
    unit: "% dmg",
    direction: "higher",
    defaultTarget: 25,
    title: (c) => (c ? `${c}: Damage share` : "Team damage share"),
    describe: (t, c) =>
      `Deal ${t}%+ of your team's champion damage${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(
        scoped(ms, c),
        (m) => (m.objective.teamDamageShare != null ? m.objective.teamDamageShare * 100 : null),
        "games"
      ),
  },
  {
    id: "objectives",
    category: "objectives",
    unit: "obj/game",
    direction: "higher",
    defaultTarget: 5,
    title: (c) => (c ? `${c}: Objectives secured` : "Objectives secured"),
    describe: (t, c) =>
      `Team averages ${t}+ major objectives per game${c ? ` when you play ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(
        scoped(ms, c),
        (m) => {
          const o = m.objective;
          if (o.dragons == null && o.heralds == null && o.barons == null) return null;
          return (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0);
        },
        "games"
      ),
  },
  {
    id: "vision_per_min",
    category: "vision",
    unit: "vis/min",
    direction: "higher",
    defaultTarget: 1.0,
    title: (c) => (c ? `${c}: Vision per minute` : "Vision per minute"),
    describe: (t, c) =>
      `Average ${t}+ vision score per minute${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(
        scoped(ms, c),
        (m) => {
          const mm = mins(m);
          return m.objective.visionScore != null && mm
            ? m.objective.visionScore / mm
            : null;
        },
        "games"
      ),
  },
  {
    id: "avg_process",
    category: "process",
    unit: "process",
    direction: "higher",
    defaultTarget: 65,
    title: (c) => (c ? `${c}: Process score` : "Process score"),
    describe: (t, c) =>
      `Keep your average process score at ${t}+${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) => avgOf(scoped(ms, c), (m) => m.process.score, "games"),
  },
  {
    id: "full_review_rate",
    category: "process",
    unit: "%",
    direction: "higher",
    defaultTarget: 80,
    title: () => "Full review rate",
    describe: (t) =>
      `${t}%+ of games fully reviewed with both a mistake and a next adjustment logged.`,
    measure: (ms) =>
      rateOf(
        ms,
        (m) =>
          m.scorecard.reviewed &&
          m.scorecard.oneAdjustment.trim().length > 0 &&
          m.scorecard.biggestMistake.trim().length > 0,
        () => true,
        "fully reviewed"
      ),
  },
  {
    id: "tilt_control",
    category: "mental",
    unit: "%",
    direction: "higher",
    defaultTarget: 70,
    title: (c) => (c ? `${c}: Tilt control` : "Tilt control"),
    describe: (t, c) =>
      `End ${t}%+ of games at tilt <=2${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      rateOf(scoped(ms, c), (m) => m.scorecard.tiltAfter <= 2, () => true, "calm"),
  },
  {
    id: "no_flame_rate",
    category: "mental",
    unit: "%",
    direction: "higher",
    defaultTarget: 100,
    title: (c) => (c ? `${c}: No flame` : "No flame"),
    describe: (t, c) =>
      `${t}% of games with zero chat nonsense${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      rateOf(scoped(ms, c), (m) => !m.scorecard.flamed, () => true, "clean"),
  },
  {
    id: "close_out_time",
    category: "tempo",
    unit: "min (wins)",
    direction: "lower",
    defaultTarget: 30,
    title: (c) => (c ? `${c}: Close games out` : "Close games out"),
    describe: (t, c) =>
      `Average winning-game length under ${t} min${c ? ` on ${c}` : ""}.`,
    measure: (ms, c) =>
      avgOf(
        scoped(ms, c).filter((m) => m.objective.win === true),
        (m) => mins(m),
        "wins"
      ),
  },
  {
    id: "champion_focus",
    category: "champion",
    unit: "games",
    direction: "higher",
    defaultTarget: 10,
    needsChampion: true,
    title: (c) => `Commit to ${c ?? "a champion"}`,
    describe: (t, c) => `Play ${c ?? "your pick"} at least ${t} games this block.`,
    measure: (ms, c) => {
      const n = scoped(ms, c).length;
      return { value: n, sampleSize: ms.length, detail: `${n} games on ${c ?? "?"}` };
    },
  },
  {
    id: "champion_winrate",
    category: "champion",
    unit: "% WR",
    direction: "higher",
    defaultTarget: 55,
    needsChampion: true,
    title: (c) => `Win rate on ${c ?? "a champion"}`,
    describe: (t, c) => `Hit ${t}%+ win rate on ${c ?? "your pick"}.`,
    measure: (ms, c) => {
      const on = scoped(ms, c);
      if (on.length === 0) return { value: null, sampleSize: 0, detail: "no games yet" };
      const wins = on.filter((m) => m.objective.win).length;
      return {
        value: Math.round((wins / on.length) * 100),
        sampleSize: on.length,
        detail: `${wins}/${on.length} on ${c ?? "?"}`,
      };
    },
  },
];

export function getTemplate(id: string): GoalTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

// The per-game criteria that define "passing" a goal — shown inside the goal so
// the player knows exactly which stats to hit in their next game.
export const WHAT_COUNTS: Record<string, string> = {
  cs10: "Your creep score at the 10-minute mark, averaged.",
  cs_per_min: "Total CS ÷ minutes played.",
  deaths_before_15: "Deaths you take before 15 minutes.",
  deaths_per_game: "Total deaths per game.",
  clean_early_rate: "Share of games with ≤1 death before 10 minutes.",
  kill_participation: "Your share of the team's kills (kills + assists ÷ team kills).",
  solo_kills: "Kills you get with no ally assisting.",
  gold_diff_15: "Your gold minus your lane opponent's at 15 minutes.",
  damage_share: "Your champion damage as a share of your team's total.",
  objectives: "Dragons + heralds + barons your team secures.",
  vision_per_min: "Vision score ÷ minutes played.",
  avg_process: "Your game-score — how clean you played, independent of the win.",
  full_review_rate: "Games you logged with both a mistake and an adjustment.",
  tilt_control: "Games you finished at tilt 2 or lower.",
  no_flame_rate: "Games with zero chat nonsense.",
  close_out_time: "Average length of your winning games.",
  champion_focus: "Games played on this champion.",
  champion_winrate: "Win rate on this champion.",
  positive_games: "Counts a game when kills + assists is greater than deaths.",
  carry_games: "Counts a game with 60%+ kill participation AND a 3.0+ KDA.",
  clean_lane_games: "Counts a game with 1 or fewer deaths before 15 minutes.",
  deathless_openings: "Counts a game with zero deaths before 15 minutes.",
  disciplined_games: "Counts a game with 4 or fewer deaths total.",
  comeback_wins: "Counts a win where you were down 1000+ gold at 15 minutes.",
  objective_games: "Counts a game where your team took 6+ major objectives.",
  win_count: "Counts a win.",
};

// Which templates take a target relative to the player's current baseline.
const BASELINE_KEY: Record<string, string> = {
  cs10: "cs10",
  cs_per_min: "cs_per_min",
  deaths_before_15: "deaths_before_15",
  deaths_per_game: "deaths",
  kill_participation: "kill_participation",
  solo_kills: "solo_kills",
  gold_diff_15: "gold_diff_15",
  damage_share: "damage_share",
  objectives: "objectives",
  vision_per_min: "vision_per_min",
  avg_process: "avg_process",
};

export function baselineKeyFor(templateId: string): string | null {
  return BASELINE_KEY[templateId] ?? null;
}

// The player's current values for the baseline metrics (recent window). Used to
// personalize goal targets and to draw the baseline→target fill.
export function computeBaselines(career: EnrichedMatch[], windowN = 20): Record<string, number | null> {
  const recent = career.slice(-windowN);
  const av = (pick: (m: EnrichedMatch) => number | null | undefined) => {
    const v = recent.map(pick).filter(def);
    return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  return {
    cs10: av((m) => m.objective.csAt10),
    cs_per_min: av((m) => {
      const mm = mins(m);
      return m.objective.totalCs != null && mm ? m.objective.totalCs / mm : null;
    }),
    deaths: av((m) => m.objective.deaths),
    deaths_before_15: av((m) => m.objective.deathsBefore15),
    kill_participation: av((m) => (m.objective.killParticipation != null ? m.objective.killParticipation * 100 : null)),
    solo_kills: av((m) => m.objective.soloKills),
    gold_diff_15: av((m) => m.objective.goldDiffAt15),
    damage_share: av((m) => (m.objective.teamDamageShare != null ? m.objective.teamDamageShare * 100 : null)),
    objectives: av((m) => {
      const o = m.objective;
      if (o.dragons == null && o.heralds == null && o.barons == null) return null;
      return (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0);
    }),
    vision_per_min: av((m) => {
      const mm = mins(m);
      return m.objective.visionScore != null && mm ? m.objective.visionScore / mm : null;
    }),
    avg_process: av((m) => m.process.score),
  };
}

// A sensible "next step up" from where the player is now.
export function personalizedTarget(key: string, baseline: number): number {
  switch (key) {
    case "cs10": return Math.round(baseline + 8);
    case "cs_per_min": return round1(baseline + 0.6);
    case "deaths": return Math.max(2, round1(baseline - 1));
    case "deaths_before_15": return Math.max(1, round1(baseline - 0.7));
    case "kill_participation": return Math.min(80, Math.round(baseline + 6));
    case "damage_share": return Math.min(45, Math.round(baseline + 4));
    case "solo_kills": return round1(baseline + 0.5);
    case "gold_diff_15": return Math.round(baseline + 250);
    case "objectives": return round1(baseline + 0.8);
    case "vision_per_min": return round1(baseline + 0.25);
    case "avg_process": return Math.min(85, Math.round(baseline + 6));
    default: return baseline;
  }
}

function pctToward(value: number, target: number, direction: "higher" | "lower") {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  if (direction === "higher") return clamp(target === 0 ? 100 : (value / target) * 100);
  if (value <= target) return 100;
  return clamp(value === 0 ? 100 : (target / value) * 100);
}

// Progress across the baseline→target gap (0% at baseline, 100% at target),
// so a goal bar visibly fills as you improve. Works for higher- and
// lower-is-better goals since target is always the improved value.
function fillToward(baseline: number | null, current: number | null, target: number): number {
  if (baseline == null || current == null || target === baseline) return 0;
  const prog = (current - baseline) / (target - baseline);
  return Math.max(0, Math.min(100, Math.round(prog * 100)));
}

export function evaluateGoal(goal: Goal, ms: EnrichedMatch[]): GoalProgress {
  const tpl = getTemplate(goal.templateId);
  const whatCounts = WHAT_COUNTS[goal.templateId] ?? null;
  if (!tpl) {
    return {
      goal, current: null, target: goal.target, baseline: goal.baseline ?? null,
      pct: 0, fillPct: 0, met: false, sampleSize: 0, detail: "unknown metric", whatCounts,
    };
  }
  const m = tpl.measure(ms, goal.champion);
  const met =
    m.value != null &&
    (goal.direction === "higher" ? m.value >= goal.target : m.value <= goal.target);
  const baseline = goal.baseline ?? null;
  return {
    goal,
    current: m.value,
    target: goal.target,
    baseline,
    pct: m.value == null ? 0 : pctToward(m.value, goal.target, goal.direction),
    fillPct: baseline != null ? fillToward(baseline, m.value, goal.target) : (m.value == null ? 0 : pctToward(m.value, goal.target, goal.direction)),
    met,
    sampleSize: m.sampleSize,
    detail: m.detail,
    whatCounts,
  };
}

export function goalFromTemplate(
  templateId: string,
  opts: { seasonId: string | null; target?: number; champion?: string | null; baseline?: number | null }
): Goal | null {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;
  const target = opts.target ?? tpl.defaultTarget;
  return {
    id: globalThis.crypto.randomUUID(),
    seasonId: opts.seasonId,
    templateId,
    title: tpl.title(opts.champion),
    description: tpl.describe(target, opts.champion),
    category: tpl.category,
    target,
    unit: tpl.unit,
    direction: tpl.direction,
    champion: opts.champion ?? null,
    baseline: opts.baseline ?? null,
    createdAt: new Date().toISOString(),
    status: "active",
  };
}
