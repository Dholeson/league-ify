import type { Identity, ProcessWeights } from "../../shared/types.ts";

// The archetype roster. Each identity is a lens: it decides what the process
// score rewards and which quests get pushed to the top. Pick one per block.
//
// Weights are relative, not absolute — the engine renormalizes over whichever
// sub-metrics actually have data for a given game, so a missing Riot pull
// never silently tanks your score.

const w = (o: Partial<ProcessWeights>): ProcessWeights => ({
  earlyStability: 1,
  deathDiscipline: 1,
  objectiveMacro: 1,
  teamfight: 1,
  mental: 1,
  review: 1,
  ...o,
});

export const IDENTITIES: Identity[] = [
  {
    id: "stonewall",
    name: "The Stonewall Climber",
    tagline: "Stable laning, low deaths, boring on purpose. You win by not losing.",
    weights: w({ earlyStability: 3, deathDiscipline: 3, mental: 1.5, teamfight: 1 }),
    focusQuests: ["no_early_deaths", "clean_early", "review_streak"],
  },
  {
    id: "tempo_goblin",
    name: "The Tempo Goblin",
    tagline: "Roams, resets, map pressure. You are always somewhere useful.",
    weights: w({ objectiveMacro: 3, earlyStability: 1.5, deathDiscipline: 1.5 }),
    focusQuests: ["objective_present", "reset_discipline", "clean_early"],
  },
  {
    id: "teamfight_architect",
    name: "The Teamfight Architect",
    tagline: "Positioning, fight timing, target discipline. Never first to die.",
    weights: w({ teamfight: 3, objectiveMacro: 2, deathDiscipline: 1.5 }),
    focusQuests: ["not_first_dead", "objective_present", "review_streak"],
  },
  {
    id: "lane_bully",
    name: "The Lane Bully",
    tagline: "Pressure, CS leads, plates, controlled aggression. Own the lane.",
    weights: w({ earlyStability: 3, objectiveMacro: 1.5, deathDiscipline: 2 }),
    focusQuests: ["cs_milestone", "no_early_deaths", "clean_early"],
  },
  {
    id: "shotcaller_monk",
    name: "The Shotcaller Monk",
    tagline: "Clean pings, calm macro, zero chat nonsense. The adult in the room.",
    weights: w({ mental: 3, objectiveMacro: 2, review: 1.5 }),
    focusQuests: ["no_flame", "adult_in_room", "review_streak"],
  },
];

export function getIdentity(id: string | null | undefined): Identity {
  return IDENTITIES.find((i) => i.id === id) ?? IDENTITIES[0];
}
