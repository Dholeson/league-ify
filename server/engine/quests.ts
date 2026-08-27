import type {
  EnrichedMatch,
  Quest,
  QuestProgress,
} from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// QUESTS
//
// Small, process-shaped goals. Daily quests reset with the day; season quests
// span the block. Each is a predicate + a target count. The active identity
// decides which float to the top.
// ---------------------------------------------------------------------------

interface QuestDef extends Quest {
  target: number;
  predicate: (m: EnrichedMatch) => boolean;
  focusKey?: string;
}

const DEFS: QuestDef[] = [
  {
    id: "no_early_deaths",
    title: "No Early Deaths",
    description: "Max 1 death before 10 minutes.",
    scope: "daily",
    xp: 20,
    target: 2,
    focusKey: "clean_early",
    predicate: (m) => (m.objective.deathsBefore10 ?? 0) <= 1,
  },
  {
    id: "clean_early",
    title: "Clean Early Game",
    description: "≤2 deaths before 15 and not behind in gold.",
    scope: "daily",
    xp: 20,
    target: 2,
    focusKey: "clean_early",
    predicate: (m) =>
      (m.objective.deathsBefore15 ?? 99) <= 2 &&
      (m.objective.goldDiffAt15 ?? 0) >= -500,
  },
  {
    id: "cs_milestone",
    title: "CS Milestone",
    description: "70+ CS at 10 minutes.",
    scope: "daily",
    xp: 15,
    target: 2,
    focusKey: "cs_milestone",
    predicate: (m) => (m.objective.csAt10 ?? 0) >= 70,
  },
  {
    id: "not_first_dead",
    title: "Not First to Die",
    description: "Self-report: you weren't the opener in the fights that mattered.",
    scope: "daily",
    xp: 20,
    target: 2,
    focusKey: "not_first_dead",
    predicate: (m) =>
      m.scorecard.firstDeathCause !== "teamfight_execution" &&
      m.scorecard.firstDeathCause !== "facecheck",
  },
  {
    id: "objective_present",
    title: "Present for Objectives",
    description: "Grade the game B or better — you were where the map needed you.",
    scope: "daily",
    xp: 15,
    target: 2,
    focusKey: "objective_present",
    predicate: (m) => ["A", "B"].includes(m.scorecard.grade),
  },
  {
    id: "reset_discipline",
    title: "Reset Discipline",
    description: "No greedy-recall first deaths.",
    scope: "daily",
    xp: 15,
    target: 3,
    focusKey: "reset_discipline",
    predicate: (m) => m.scorecard.firstDeathCause !== "greedy_recall",
  },
  {
    id: "no_flame",
    title: "No Flame",
    description: "Zero chat nonsense. Muted when needed.",
    scope: "daily",
    xp: 15,
    target: 3,
    focusKey: "no_flame",
    predicate: (m) => !m.scorecard.flamed && m.scorecard.mutedAppropriately,
  },
  {
    id: "adult_in_room",
    title: "The Adult in the Room",
    description: "Ended the game at tilt ≤2 regardless of result.",
    scope: "daily",
    xp: 15,
    target: 2,
    focusKey: "adult_in_room",
    predicate: (m) => m.scorecard.tiltAfter <= 2,
  },
  {
    id: "review_streak",
    title: "Review Everything",
    description: "Full review (mistake + adjustment) on every game today.",
    scope: "daily",
    xp: 20,
    target: 3,
    focusKey: "review_streak",
    predicate: (m) =>
      m.scorecard.reviewed &&
      m.scorecard.oneAdjustment.trim().length > 0 &&
      m.scorecard.biggestMistake.trim().length > 0,
  },
];

export function evaluateQuests(
  todaysMatches: EnrichedMatch[],
  focusIds: string[]
): QuestProgress[] {
  const progress = DEFS.map((def) => {
    const current = todaysMatches.filter(def.predicate).length;
    return {
      quest: {
        id: def.id,
        title: def.title,
        description: def.description,
        scope: def.scope,
        xp: def.xp,
      },
      current: Math.min(current, def.target),
      target: def.target,
      complete: current >= def.target,
    } satisfies QuestProgress;
  });

  // Focus quests (from the identity) first, then the rest.
  return progress.sort((a, b) => {
    const af = focusIds.includes(a.quest.id) ? 0 : 1;
    const bf = focusIds.includes(b.quest.id) ? 0 : 1;
    if (af !== bf) return af - bf;
    return Number(a.complete) - Number(b.complete);
  });
}

const WEEKLY_DEFS: QuestDef[] = [
  {
    id: "weekly_clean_early",
    title: "Stable Openings",
    description: "Bank 4 clean early games this week.",
    scope: "season",
    xp: 50,
    target: 4,
    focusKey: "clean_early",
    predicate: DEFS.find((d) => d.id === "clean_early")!.predicate,
  },
  {
    id: "weekly_review",
    title: "Review Habit",
    description: "Complete 5 full reviews this week.",
    scope: "season",
    xp: 55,
    target: 5,
    focusKey: "review_streak",
    predicate: DEFS.find((d) => d.id === "review_streak")!.predicate,
  },
  {
    id: "weekly_no_flame",
    title: "Zero Chat Tax",
    description: "Play 6 games with clean comms this week.",
    scope: "season",
    xp: 45,
    target: 6,
    focusKey: "no_flame",
    predicate: DEFS.find((d) => d.id === "no_flame")!.predicate,
  },
  {
    id: "weekly_cs",
    title: "Farm Stays Honest",
    description: "Hit 70+ CS at 10 in 4 games this week.",
    scope: "season",
    xp: 45,
    target: 4,
    focusKey: "cs_milestone",
    predicate: DEFS.find((d) => d.id === "cs_milestone")!.predicate,
  },
  {
    id: "weekly_calm",
    title: "Leave Queue Calm",
    description: "Finish 5 games at tilt 2 or lower this week.",
    scope: "season",
    xp: 45,
    target: 5,
    focusKey: "adult_in_room",
    predicate: DEFS.find((d) => d.id === "adult_in_room")!.predicate,
  },
];

export function evaluateWeeklyQuests(
  recentMatches: EnrichedMatch[],
  focusIds: string[]
): QuestProgress[] {
  const progress = WEEKLY_DEFS.map((def) => {
    const current = recentMatches.filter(def.predicate).length;
    return {
      quest: {
        id: def.id,
        title: def.title,
        description: def.description,
        scope: def.scope,
        xp: def.xp,
      },
      current: Math.min(current, def.target),
      target: def.target,
      complete: current >= def.target,
    } satisfies QuestProgress;
  });

  return progress.sort((a, b) => {
    const aDef = WEEKLY_DEFS.find((d) => d.id === a.quest.id);
    const bDef = WEEKLY_DEFS.find((d) => d.id === b.quest.id);
    const af = aDef?.focusKey && focusIds.includes(aDef.focusKey) ? 0 : 1;
    const bf = bDef?.focusKey && focusIds.includes(bDef.focusKey) ? 0 : 1;
    if (af !== bf) return af - bf;
    return Number(a.complete) - Number(b.complete);
  });
}
