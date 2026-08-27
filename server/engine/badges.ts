import type { EnrichedMatch, Badge } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// BADGES / ACHIEVEMENTS
//
// Earned over history, not per game. These are identity milestones — evidence
// that a habit has actually set, not that you got lucky once.
// ---------------------------------------------------------------------------

interface BadgeDef {
  id: string;
  name: string;
  description: string;
  // Returns [earned, progressLabel]. progressLabel shows "3/5" style status.
  evaluate: (ms: EnrichedMatch[]) => { earned: boolean; label: string };
}

function longestStreak(ms: EnrichedMatch[], pred: (m: EnrichedMatch) => boolean) {
  const sorted = [...ms].sort(
    (a, b) => +new Date(a.playedAt) - +new Date(b.playedAt)
  );
  let best = 0;
  let cur = 0;
  for (const m of sorted) {
    if (pred(m)) cur++, (best = Math.max(best, cur));
    else cur = 0;
  }
  return best;
}

const DEFS: BadgeDef[] = [
  {
    id: "no_hero_tax",
    name: "No Hero Tax",
    description: "10 games in a row with no greed/overextension first-death.",
    evaluate: (ms) => {
      const s = longestStreak(
        ms,
        (m) =>
          m.scorecard.firstDeathCause !== "shutdown_donation" &&
          m.scorecard.firstDeathCause !== "overextension" &&
          m.scorecard.firstDeathCause !== "sidelane_greed"
      );
      return { earned: s >= 10, label: `${Math.min(s, 10)}/10 streak` };
    },
  },
  {
    id: "the_monk",
    name: "The Monk",
    description: "Ended 5 sessions after a loss without revenge-queueing (tilt ≤2 on last loss).",
    evaluate: (ms) => {
      // Approximation over history: losses that ended at low tilt.
      const calm = ms.filter(
        (m) => m.objective.win === false && m.scorecard.tiltAfter <= 2
      ).length;
      return { earned: calm >= 5, label: `${Math.min(calm, 5)}/5` };
    },
  },
  {
    id: "the_surgeon",
    name: "The Surgeon",
    description: "20 full reviews — you can name the exact moment games turned.",
    evaluate: (ms) => {
      const n = ms.filter(
        (m) => m.scorecard.reviewed && m.scorecard.biggestMistake.trim()
      ).length;
      return { earned: n >= 20, label: `${Math.min(n, 20)}/20` };
    },
  },
  {
    id: "stonewall",
    name: "Stonewall",
    description: "8-game streak of clean early games (≤2 deaths pre-15).",
    evaluate: (ms) => {
      const s = longestStreak(ms, (m) => (m.objective.deathsBefore15 ?? 99) <= 2);
      return { earned: s >= 8, label: `${Math.min(s, 8)}/8 streak` };
    },
  },
  {
    id: "good_loser",
    name: "The Good Loser",
    description: "10 'good losses' — you kept playing well when the result didn't.",
    evaluate: (ms) => {
      const n = ms.filter((m) => m.verdict === "good_loss").length;
      return { earned: n >= 10, label: `${Math.min(n, 10)}/10` };
    },
  },
  {
    id: "no_flame_100",
    name: "Silent Assassin",
    description: "25 straight games with no flame.",
    evaluate: (ms) => {
      const s = longestStreak(ms, (m) => !m.scorecard.flamed);
      return { earned: s >= 25, label: `${Math.min(s, 25)}/25 streak` };
    },
  },
  {
    id: "adult_in_room",
    name: "Adult in the Room",
    description: "15 games ended at tilt ≤2.",
    evaluate: (ms) => {
      const n = ms.filter((m) => m.scorecard.tiltAfter <= 2).length;
      return { earned: n >= 15, label: `${Math.min(n, 15)}/15` };
    },
  },
];

export function evaluateBadges(ms: EnrichedMatch[]): Badge[] {
  return DEFS.map((def) => {
    const { earned, label } = def.evaluate(ms);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      earned,
      progressLabel: label,
    };
  });
}
