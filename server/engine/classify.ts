import type { Match, EnrichedMatch, Verdict } from "../../shared/types.ts";

// Verdict thresholds on the process score. Tunable knobs, not sacred numbers.
export const GOOD = 65; // played well
export const BAD = 45; // played badly

export function classify(
  win: boolean | undefined,
  process: number,
  good = GOOD,
  bad = BAD
): Verdict {
  if (win === undefined) return "standard";
  if (win) return process >= good ? "clean_win" : process < bad ? "bad_win" : "standard";
  return process >= good ? "good_loss" : process < bad ? "deserved_loss" : "standard";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  clean_win: "Clean Win",
  bad_win: "Bad Win",
  good_loss: "Good Loss",
  deserved_loss: "Deserved Loss",
  standard: "Standard",
};

// ---------------------------------------------------------------------------
// BORROWED LP
//
// The single most important false signal in ranked: results going up while
// behavior goes down. We detect it as "LP trending up, process trending down"
// over a trailing window. When that fires, your climb is a loan — the market
// will call it in.
// ---------------------------------------------------------------------------

function slope(ys: number[]): number {
  // Least-squares slope over evenly spaced x = 0..n-1.
  const n = ys.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export interface BorrowedLpVerdict {
  borrowed: boolean;
  lpSlope: number; // LP per game
  processSlope: number; // process points per game
  window: number;
  message: string | null;
}

export function detectBorrowedLp(
  enriched: EnrichedMatch[],
  window = 8
): BorrowedLpVerdict {
  const recent = enriched.slice(-window);
  const lp = recent.map((m) => m.objective.lpDelta ?? 0);
  const cumulativeLp: number[] = [];
  lp.reduce((acc, d, i) => (cumulativeLp[i] = acc + d), 0);
  const proc = recent.map((m) => m.process.score);

  const lpSlope = slope(cumulativeLp);
  const processSlope = slope(proc);

  // Climbing (LP up) but decaying (process down meaningfully).
  const borrowed = recent.length >= 4 && lpSlope > 0 && processSlope < -1.2;

  return {
    borrowed,
    lpSlope: Math.round(lpSlope * 10) / 10,
    processSlope: Math.round(processSlope * 10) / 10,
    window: recent.length,
    message: borrowed
      ? "Borrowed LP: your rank is climbing but your play is decaying. This is a loan, not a trend — tighten the process before it gets called in."
      : null,
  };
}

// The inverse recognition: process improving even if LP is flat or down.
export interface GoodBlockVerdict {
  goodBlock: boolean;
  processSlope: number;
  message: string | null;
}

export function detectGoodBlock(
  enriched: EnrichedMatch[],
  window = 10
): GoodBlockVerdict {
  const recent = enriched.slice(-window);
  const proc = recent.map((m) => m.process.score);
  const lp = recent.map((m) => m.objective.lpDelta ?? 0);
  const cumulativeLp: number[] = [];
  lp.reduce((acc, d, i) => (cumulativeLp[i] = acc + d), 0);

  const processSlope = slope(proc);
  const lpSlope = slope(cumulativeLp);

  const goodBlock = recent.length >= 5 && processSlope > 1 && lpSlope <= 0;
  return {
    goodBlock,
    processSlope: Math.round(processSlope * 10) / 10,
    message: goodBlock
      ? "Good block: LP is flat or down, but your process is trending up. This is what improvement looks like before the results catch up. Keep going."
      : null,
  };
}
