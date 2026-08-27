import type {
  Match,
  ChampionPoolEntry,
  ProcessBreakdown,
  Verdict,
  XpAward,
  MatchFlag,
  LevelState,
  EnrichedMatch,
  PromotionQuestProgress,
} from "../../shared/types.ts";
import { getTemplate } from "./goals.ts";

// ---------------------------------------------------------------------------
// XP & PROGRESSION
//
// XP is awarded for PROCESS, never for winning. You cannot buy levels with LP.
// This is the whole point: make the right behavior feel like progress even
// when the scoreboard Riot gives you says you failed.
// ---------------------------------------------------------------------------

export function matchXp(
  match: Match,
  process: ProcessBreakdown,
  verdict: Verdict
): XpAward[] {
  const awards: XpAward[] = [];
  const s = match.scorecard;
  const o = match.objective;

  awards.push({ reason: "Logged the game", amount: 10 });

  if (s.reviewed && s.oneAdjustment.trim() && s.biggestMistake.trim()) {
    awards.push({ reason: "Full review (mistake + adjustment)", amount: 15 });
  } else if (s.oneAdjustment.trim()) {
    awards.push({ reason: "Wrote one adjustment", amount: 8 });
  }

  if (!s.flamed && s.mutedAppropriately) {
    awards.push({ reason: "Clean comms (no flame, muted well)", amount: 10 });
  }

  // Clean early game: 0–2 deaths pre-15 and not behind.
  if (
    o.deathsBefore15 != null &&
    o.deathsBefore15 <= 2 &&
    (o.goldDiffAt15 ?? 0) >= -500
  ) {
    awards.push({ reason: "Clean early game", amount: 20 });
  }

  // The most important reward in the system: playing well despite losing.
  if (verdict === "good_loss") {
    awards.push({ reason: "Good loss — process over outcome", amount: 25 });
  }

  // High process floor regardless of result.
  if (process.score >= 80) {
    awards.push({ reason: "Excellent process (80+)", amount: 15 });
  }

  // Kept the head cool through a rough one.
  if (o.win === false && s.tiltAfter <= 2) {
    awards.push({ reason: "Lost without tilting", amount: 12 });
  }

  return awards;
}

export function matchFlags(match: Match, pool: ChampionPoolEntry[]): MatchFlag[] {
  const flags: MatchFlag[] = [];
  const s = match.scorecard;
  const o = match.objective;

  // "No culinary innovation in ranked" — a ranked game on a lab-pool champ.
  if (o.champion && (o.queue?.includes("RANKED") ?? true)) {
    const entry = pool.find(
      (p) => p.champion.toLowerCase() === o.champion!.toLowerCase()
    );
    if (entry?.tier === "lab") {
      flags.push({
        kind: "warn",
        code: "no_culinary_innovation",
        message: `${o.champion} is in your lab pool, not your ranked pool. No culinary innovation in ranked — experiment in normals, climb on your mains.`,
      });
    } else if (!entry && pool.length > 0) {
      flags.push({
        kind: "warn",
        code: "off_pool",
        message: `${o.champion} isn't in this block's champion pool at all. If this was a fill or an autofill, fine. If it was a whim, that's how blocks lose their thesis.`,
      });
    }
  }

  // "You are not the anime protagonist" — a donated shutdown or greed death.
  if (
    s.firstDeathCause === "shutdown_donation" ||
    s.firstDeathCause === "overextension" ||
    s.firstDeathCause === "sidelane_greed"
  ) {
    flags.push({
      kind: "info",
      code: "not_the_protagonist",
      message:
        "First death was a greed/overextension death. You are not the anime protagonist — the 1v3 backdoor works in the highlight reel, not the ranked ladder.",
    });
  }

  // Bad win: the quiet killer. You won, so you won't review it. Do it anyway.
  if (o.win && !s.reviewed) {
    flags.push({
      kind: "info",
      code: "review_the_win",
      message:
        "Wins get skipped in review — that's how bad habits survive. Thirty seconds: what did you get away with today?",
    });
  }

  // Doomed collapse: absolve the score, but log it so it doesn't become a crutch.
  if (s.doomedCollapse) {
    flags.push({
      kind: "info",
      code: "doomed",
      message:
        "Marked as a team collapse — score adjusted. If more than ~1 in 4 games are 'doomed,' the common denominator conversation is due.",
    });
  }

  return flags;
}

// ---- Levels ---------------------------------------------------------------

interface PromotionQuestSpec {
  id: string;
  templateId: string;
  target: number;
  window: number;
  rationale: string;
}

interface LevelSpec {
  level: number;
  title: string;
  xpToNext: number;
  promotionQuests: PromotionQuestSpec[];
}

const LEVEL_SPECS: LevelSpec[] = [
  {
    level: 0,
    title: "Queueing With Intent",
    xpToNext: 60,
    promotionQuests: [
      {
        id: "l1-process",
        templateId: "avg_process",
        target: 55,
        window: 3,
        rationale: "Start with a basic process floor. No one gets promoted on vibes.",
      },
      {
        id: "l1-review",
        templateId: "full_review_rate",
        target: 100,
        window: 3,
        rationale: "Every game should leave behind one mistake and one adjustment.",
      },
    ],
  },
  {
    level: 1,
    title: "Footing",
    xpToNext: 70,
    promotionQuests: [
      {
        id: "l2-calm",
        templateId: "tilt_control",
        target: 70,
        window: 4,
        rationale: "Promotions should be calm, not emotional coin flips.",
      },
      {
        id: "l2-clean",
        templateId: "deaths_before_15",
        target: 2.5,
        window: 4,
        rationale: "A playable early game is the minimum cost of admission.",
      },
    ],
  },
  {
    level: 2,
    title: "Stabilizing",
    xpToNext: 80,
    promotionQuests: [
      {
        id: "l3-farm",
        templateId: "cs10",
        target: 62,
        window: 5,
        rationale: "Farm is the most repeatable lead you can manufacture yourself.",
      },
      {
        id: "l3-noflame",
        templateId: "no_flame_rate",
        target: 100,
        window: 5,
        rationale: "We do not let chat sabotage the block.",
      },
    ],
  },
  {
    level: 3,
    title: "Review Habit",
    xpToNext: 90,
    promotionQuests: [
      {
        id: "l4-process",
        templateId: "avg_process",
        target: 60,
        window: 5,
        rationale: "The floor needs to stay above random ladder chaos.",
      },
      {
        id: "l4-early",
        templateId: "clean_early_rate",
        target: 60,
        window: 5,
        rationale: "Low-variance openings are how blocks survive bad matchmaking.",
      },
    ],
  },
  {
    level: 4,
    title: "Lane Floor",
    xpToNext: 100,
    promotionQuests: [
      {
        id: "l5-gold",
        templateId: "gold_diff_15",
        target: 50,
        window: 5,
        rationale: "Stability should start converting into real lane value.",
      },
      {
        id: "l5-vision",
        templateId: "vision_per_min",
        target: 0.8,
        window: 5,
        rationale: "If you want cleaner decisions, pay the vision tax.",
      },
    ],
  },
  {
    level: 5,
    title: "Reliable Reset",
    xpToNext: 110,
    promotionQuests: [
      {
        id: "l6-objects",
        templateId: "objectives",
        target: 4,
        window: 6,
        rationale: "Lane only matters if it cashes out into map control.",
      },
      {
        id: "l6-deaths",
        templateId: "deaths_per_game",
        target: 5,
        window: 6,
        rationale: "Midgame throws do not get a free pass.",
      },
    ],
  },
  {
    level: 6,
    title: "Tempo Learner",
    xpToNext: 120,
    promotionQuests: [
      {
        id: "l7-close",
        templateId: "close_out_time",
        target: 33,
        window: 6,
        rationale: "A lead is only real when you close with it.",
      },
      {
        id: "l7-review",
        templateId: "full_review_rate",
        target: 100,
        window: 6,
        rationale: "Review discipline should hold even when games feel routine.",
      },
    ],
  },
  {
    level: 7,
    title: "Map Respect",
    xpToNext: 130,
    promotionQuests: [
      {
        id: "l8-process",
        templateId: "avg_process",
        target: 63,
        window: 7,
        rationale: "The whole block should now feel more deliberate.",
      },
      {
        id: "l8-gold",
        templateId: "gold_diff_15",
        target: 125,
        window: 7,
        rationale: "Winning the map starts with arriving with more resources.",
      },
    ],
  },
  {
    level: 8,
    title: "Objective Student",
    xpToNext: 140,
    promotionQuests: [
      {
        id: "l9-early",
        templateId: "clean_early_rate",
        target: 70,
        window: 7,
        rationale: "You should be reliably showing up to the first objectives alive.",
      },
      {
        id: "l9-objects",
        templateId: "objectives",
        target: 4.5,
        window: 7,
        rationale: "Better setups should start showing up on the map count.",
      },
    ],
  },
  {
    level: 9,
    title: "Comfort Pilot",
    xpToNext: 150,
    promotionQuests: [
      {
        id: "l10-cs",
        templateId: "cs10",
        target: 66,
        window: 8,
        rationale: "Comfort should make lane cleaner, not lazier.",
      },
      {
        id: "l10-kp",
        templateId: "kill_participation",
        target: 55,
        window: 8,
        rationale: "Your clean lanes should now be reaching the fights that matter.",
      },
    ],
  },
  {
    level: 10,
    title: "Block Grinder",
    xpToNext: 160,
    promotionQuests: [
      {
        id: "l11-process",
        templateId: "avg_process",
        target: 65,
        window: 8,
        rationale: "This is the line where the scoreboard you built starts beating the one Riot gives you.",
      },
      {
        id: "l11-tilt",
        templateId: "tilt_control",
        target: 80,
        window: 8,
        rationale: "Consistency is emotional discipline wearing work clothes.",
      },
    ],
  },
  {
    level: 11,
    title: "Lead Converter",
    xpToNext: 170,
    promotionQuests: [
      {
        id: "l12-gold",
        templateId: "gold_diff_15",
        target: 175,
        window: 9,
        rationale: "If lane is solved, the lead should be visible.",
      },
      {
        id: "l12-close",
        templateId: "close_out_time",
        target: 31,
        window: 9,
        rationale: "You do not need extra scenes once the game is already yours.",
      },
    ],
  },
  {
    level: 12,
    title: "Fight Chooser",
    xpToNext: 180,
    promotionQuests: [
      {
        id: "l13-vision",
        templateId: "vision_per_min",
        target: 1,
        window: 9,
        rationale: "Fight selection gets much easier when the map stops being dark.",
      },
      {
        id: "l13-objects",
        templateId: "objectives",
        target: 5,
        window: 9,
        rationale: "Objective play should now be a habit, not a reminder.",
      },
    ],
  },
  {
    level: 13,
    title: "Pressure Holder",
    xpToNext: 190,
    promotionQuests: [
      {
        id: "l14-cs",
        templateId: "cs10",
        target: 68,
        window: 10,
        rationale: "Pressure players still farm their way into relevance.",
      },
      {
        id: "l14-survive",
        templateId: "deaths_before_15",
        target: 1.8,
        window: 10,
        rationale: "You should be very hard to kill before the map opens.",
      },
    ],
  },
  {
    level: 14,
    title: "Closer",
    xpToNext: 200,
    promotionQuests: [
      {
        id: "l15-process",
        templateId: "avg_process",
        target: 68,
        window: 10,
        rationale: "This is no longer about flashes of good play. It is about a strong average.",
      },
      {
        id: "l15-kp",
        templateId: "kill_participation",
        target: 58,
        window: 10,
        rationale: "Closing players are present when games actually end.",
      },
    ],
  },
  {
    level: 15,
    title: "Anchor",
    xpToNext: 999999,
    promotionQuests: [],
  },
];

const MAX_LEVEL = LEVEL_SPECS[LEVEL_SPECS.length - 1].level;

function specFor(level: number) {
  return LEVEL_SPECS[Math.max(0, Math.min(level, MAX_LEVEL))];
}

export function xpForLevel(level: number): number {
  return specFor(level).xpToNext;
}

export function cumulativeXpThreshold(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

export function titleForLevel(level: number): string {
  return specFor(level).title;
}

function pctToward(value: number, target: number, direction: "higher" | "lower") {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  if (direction === "higher") return clamp(target === 0 ? 100 : (value / target) * 100);
  if (value <= target) return 100;
  return clamp(value === 0 ? 100 : (target / value) * 100);
}

function buildPromotionQuest(
  spec: PromotionQuestSpec,
  matches: EnrichedMatch[]
): PromotionQuestProgress {
  const tpl = getTemplate(spec.templateId);
  const scope = matches.slice(-spec.window);
  if (!tpl) {
    return {
      id: spec.id,
      title: "Unknown promotion quest",
      description: "This promotion quest references an unavailable metric.",
      rationale: spec.rationale,
      current: null,
      target: spec.target,
      unit: "",
      direction: "higher",
      pct: 0,
      complete: false,
      sampleSize: 0,
      detail: "unknown template",
    };
  }
  const measurement = tpl.measure(scope);
  const complete =
    measurement.value != null &&
    (tpl.direction === "higher"
      ? measurement.value >= spec.target
      : measurement.value <= spec.target);

  return {
    id: spec.id,
    title: tpl.title(),
    description: tpl.describe(spec.target),
    rationale: spec.rationale,
    current: measurement.value,
    target: spec.target,
    unit: tpl.unit,
    direction: tpl.direction,
    pct: measurement.value == null ? 0 : pctToward(measurement.value, spec.target, tpl.direction),
    complete,
    sampleSize: measurement.sampleSize,
    detail: measurement.sampleSize > 0 ? `${measurement.detail} · last ${scope.length} games` : "no data yet",
  };
}

export function levelFromXp(totalXp: number, matches: EnrichedMatch[] = []): LevelState {
  let level = 0;

  for (let nextLevel = 1; nextLevel <= MAX_LEVEL; nextLevel++) {
    const threshold = cumulativeXpThreshold(nextLevel);
    const quests = specFor(nextLevel - 1).promotionQuests.map((q) =>
      buildPromotionQuest(q, matches)
    );
    const questsReady = quests.every((q) => q.complete);
    if (totalXp >= threshold && questsReady) level = nextLevel;
    else break;
  }

  const currentSpec = specFor(level);
  const nextLevel = level >= MAX_LEVEL ? null : level + 1;
  const currentThreshold = cumulativeXpThreshold(level);
  const nextThreshold = nextLevel == null ? null : cumulativeXpThreshold(nextLevel);
  const promotionQuests =
    nextLevel == null
      ? []
      : currentSpec.promotionQuests.map((q) => buildPromotionQuest(q, matches));
  const xpReady = nextThreshold == null ? true : totalXp >= nextThreshold;
  const promotionReady = xpReady && promotionQuests.every((q) => q.complete);
  const xpForNextLevel = nextThreshold == null ? 0 : nextThreshold - currentThreshold;
  const xpIntoLevel =
    nextThreshold == null ? 0 : Math.min(totalXp - currentThreshold, xpForNextLevel);

  return {
    totalXp,
    level,
    xpIntoLevel,
    xpForNextLevel,
    title: currentSpec.title,
    nextLevel,
    nextTitle: nextLevel == null ? null : specFor(nextLevel).title,
    currentThreshold,
    nextThreshold,
    xpReady,
    promotionReady,
    promotionQuests,
  };
}
