import type {
  Match,
  Identity,
  ProcessBreakdown,
  ProcessWeights,
  ObjectiveData,
  Scorecard,
  DeathCause,
} from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// THE PROCESS SCORE
//
// A 0..100 number that answers "did I play well?" — deliberately decoupled
// from win/loss. Each sub-metric is a transparent 0..1 function of the data.
// The identity weights decide how they combine. Sub-metrics with no data are
// dropped and the remaining weights renormalized, so a missing Riot pull can
// never quietly wreck the score.
//
// Everything here is meant to be read and tuned by a human. No black boxes.
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ARAM (Howling Abyss) has no lanes, no CS race, no epic monsters, and constant
// fighting — so the SR sub-metrics (early laning, objective macro) don't apply
// and deaths run much higher. We score it on impact instead.
const isAram = (o: ObjectiveData) => (o.queue ?? "").toUpperCase().includes("ARAM");

// Deaths that were, in principle, on you vs. genuinely not your fault.
const AVOIDABLE: DeathCause[] = [
  "greedy_recall",
  "facecheck",
  "overextension",
  "shutdown_donation",
  "sidelane_greed",
  "mechanical_misplay",
];

function earlyStability(o: ObjectiveData, s: Scorecard): number | null {
  if (isAram(o)) return null; // no lane phase in ARAM — dropped + renormalized
  // Prefer Riot data; fall back to self-graded laning if the pull is missing.
  const signals: number[] = [];

  if (o.deathsBefore15 != null) {
    // 0 deaths = 1.0, 2 deaths ~ 0.5, 4+ = 0.0
    signals.push(clamp01(1 - o.deathsBefore15 / 4));
  }
  if (o.goldDiffAt15 != null) {
    // +1500 gold -> 1.0, even -> 0.5, -1500 -> 0.0
    signals.push(clamp01(0.5 + o.goldDiffAt15 / 3000));
  } else if (o.goldDiffAt10 != null) {
    signals.push(clamp01(0.5 + o.goldDiffAt10 / 2000));
  }
  if (o.csAt10 != null) {
    // 80 cs@10 is excellent, 50 is fine-ish, 30 is rough. Role-agnostic proxy.
    signals.push(clamp01((o.csAt10 - 30) / 50));
  }

  if (signals.length === 0) {
    // No objective early data — lean on the self grade as a weak prior.
    return gradePrior(s.grade) * 0.9;
  }
  return avg(signals);
}

function deathDiscipline(o: ObjectiveData, s: Scorecard): number | null {
  const signals: number[] = [];

  if (o.deaths != null && o.durationSec != null) {
    // Deaths per 10 min. ARAM fights nonstop, so its "disciplined" baseline is
    // much higher (~4/10min) than SR (~1/10min).
    const per10 = o.deaths / (o.durationSec / 600);
    const good = isAram(o) ? 4 : 1;
    const span = isAram(o) ? 8 : 5;
    signals.push(clamp01(1 - (per10 - good) / span));
  }

  // The self-reported first-death cause is the sharpest signal we have about
  // whether a death was earned or donated.
  if (s.firstDeathCause) {
    if (s.firstDeathCause === "unavoidable_team_collapse") signals.push(0.8);
    else if (AVOIDABLE.includes(s.firstDeathCause)) signals.push(0.25);
    else signals.push(0.55); // laning_mistake / objective_setup / teamfight_execution
  }

  // A genuinely doomed game shouldn't be scored as if you threw it.
  if (s.doomedCollapse && signals.length > 0) {
    return clamp01(Math.max(...signals, 0.6));
  }

  if (signals.length === 0) return null;
  return avg(signals);
}

function objectiveMacro(o: ObjectiveData, s: Scorecard): number | null {
  // ARAM has no epic monsters — score "impact" (damage share + kill
  // participation) here instead of penalizing a missing dragon.
  if (isAram(o)) {
    const sig: number[] = [];
    if (o.teamDamageShare != null) sig.push(clamp01(o.teamDamageShare / 0.28));
    if (o.killParticipation != null) sig.push(clamp01(o.killParticipation / 0.7));
    return sig.length ? avg(sig) : null;
  }
  // Mostly a self-report question ("were you in position for objectives?"),
  // nudged by team objective volume as weak context.
  const signals: number[] = [];

  // Self-report is folded in via bestDecision/oneAdjustment presence + grade,
  // but the cleanest macro proxy we have without per-event attribution is:
  // "did the team actually take objectives while you were alive/present?"
  if (o.dragons != null || o.heralds != null || o.barons != null || o.voidgrubs != null) {
    const taken =
      (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0) + (o.voidgrubs ?? 0) * 0.25;
    // Normalize loosely: ~6 "objective units" in a healthy game.
    signals.push(clamp01(taken / 6));
  }
  if (o.visionScore != null && o.durationSec != null) {
    const vpm = o.visionScore / (o.durationSec / 60);
    // ~1.2 vision/min is strong for a laner, ~2+ for support.
    signals.push(clamp01(vpm / 1.5));
  }

  if (signals.length === 0) return gradePrior(s.grade) * 0.85;
  return avg(signals);
}

function teamfight(o: ObjectiveData, s: Scorecard): number | null {
  const signals: number[] = [];
  if (o.teamDamageShare != null) {
    // Carry roles want high share; this is a soft reward, capped.
    signals.push(clamp01(o.teamDamageShare / 0.3));
  }
  if (o.kills != null && o.assists != null && o.deaths != null) {
    const kda = (o.kills + o.assists) / Math.max(1, o.deaths);
    signals.push(clamp01(kda / 5));
  }
  // In ARAM, being in every fight is the whole game.
  if (isAram(o) && o.killParticipation != null) {
    signals.push(clamp01(o.killParticipation / 0.7));
  }
  if (signals.length === 0) return gradePrior(s.grade) * 0.85;
  return avg(signals);
}

function mental(s: Scorecard): number {
  let score = 1;
  // Tilt AFTER the game is the thing that follows you into the next queue.
  score -= s.tiltAfter * 0.12; // tilt 5 -> -0.6
  if (s.flamed) score -= 0.35;
  if (!s.mutedAppropriately && s.tiltAfter >= 3) score -= 0.1;
  return clamp01(score);
}

function review(s: Scorecard): number {
  let score = 0;
  if (s.reviewed) score += 0.4;
  if (s.oneAdjustment.trim().length > 0) score += 0.35;
  if (s.biggestMistake.trim().length > 0) score += 0.15;
  if (s.bestDecision.trim().length > 0) score += 0.1;
  return clamp01(score);
}

function gradePrior(grade: Scorecard["grade"]): number {
  return { A: 0.9, B: 0.72, C: 0.55, D: 0.35, F: 0.15 }[grade];
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function computeProcess(match: Match, identity: Identity): ProcessBreakdown {
  const { objective: o, scorecard: s } = match;

  // Auto-ingested Riot games have no self-report, so the mental and review
  // sub-metrics are dropped and the score is computed from objective data only.
  const selfReported = match.source !== "riot";

  const raw: Partial<Record<keyof ProcessWeights, number | null>> = {
    earlyStability: earlyStability(o, s),
    deathDiscipline: deathDiscipline(o, s),
    objectiveMacro: objectiveMacro(o, s),
    teamfight: teamfight(o, s),
    mental: selfReported ? mental(s) : null,
    review: selfReported ? review(s) : null,
  };

  const subMetrics: Partial<Record<keyof ProcessWeights, number>> = {};
  const usedWeights: Partial<ProcessWeights> = {};
  let weightSum = 0;
  let acc = 0;

  (Object.keys(raw) as (keyof ProcessWeights)[]).forEach((k) => {
    const v = raw[k];
    if (v == null) return;
    const weight = identity.weights[k];
    subMetrics[k] = Math.round(v * 100) / 100;
    usedWeights[k] = weight;
    weightSum += weight;
    acc += v * weight;
  });

  const score = weightSum > 0 ? Math.round((acc / weightSum) * 100) : 50;
  return { score, subMetrics, usedWeights };
}
