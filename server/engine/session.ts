import type {
  EnrichedMatch,
  SessionSummary,
  SessionGuardrail,
} from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// SESSION & GUARDRAIL ENGINE
//
// Ranked improvement is emotional regulation as much as skill. This groups
// games into sessions (by time gap) and fires guardrails — sharp but sparing,
// only at real thresholds. The goal is to help you STOP when your judgment is
// compromised, and to reward you for stopping well.
// ---------------------------------------------------------------------------

export function groupSessions(
  matches: EnrichedMatch[],
  gapMinutes: number
): SessionSummary[] {
  const sorted = [...matches].sort(
    (a, b) => +new Date(a.playedAt) - +new Date(b.playedAt)
  );
  const groups: EnrichedMatch[][] = [];
  const gapMs = gapMinutes * 60_000;

  for (const m of sorted) {
    const last = groups[groups.length - 1];
    if (!last) {
      groups.push([m]);
      continue;
    }
    const prev = last[last.length - 1];
    if (+new Date(m.playedAt) - +new Date(prev.playedAt) > gapMs) {
      groups.push([m]);
    } else {
      last.push(m);
    }
  }

  return groups.map(summarize);
}

function summarize(games: EnrichedMatch[]): SessionSummary {
  const wins = games.filter((g) => g.objective.win).length;
  const losses = games.filter((g) => g.objective.win === false).length;
  const netLp = games.reduce((a, g) => a + (g.objective.lpDelta ?? 0), 0);
  const avgProcess = Math.round(
    games.reduce((a, g) => a + g.process.score, 0) / games.length
  );
  const peakTilt = Math.max(...games.map((g) => g.scorecard.tiltAfter), 0);

  // Trailing loss streak within the session.
  let currentLossStreak = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i].objective.win === false) currentLossStreak++;
    else break;
  }

  const guardrails = evaluateGuardrails(games, {
    currentLossStreak,
    peakTilt,
  });

  const healthScore = sessionHealth(games, peakTilt, avgProcess);

  return {
    id: games[0].id,
    startedAt: games[0].playedAt,
    endedAt: games[games.length - 1].playedAt,
    matchIds: games.map((g) => g.id),
    games: games.length,
    wins,
    losses,
    netLp,
    avgProcess,
    currentLossStreak,
    peakTilt,
    guardrails,
    healthScore,
  };
}

function evaluateGuardrails(
  games: EnrichedMatch[],
  ctx: { currentLossStreak: number; peakTilt: number }
): SessionGuardrail[] {
  const rails: SessionGuardrail[] = [];
  const last = games[games.length - 1];
  const tiltAfter = last?.scorecard.tiltAfter ?? 0;

  // Best-of-3 broken: 2 losses in a row with rising heat.
  if (ctx.currentLossStreak === 2 && tiltAfter >= 3) {
    rails.push({
      code: "best_of_3",
      severity: "caution",
      title: "Best-of-3 broken",
      message:
        "Two down and the temperature's up. One more game — but decide now that it's the LAST one, win or lose. Don't let the queue decide for you.",
    });
  }

  // Hard stop: 3+ losses, or molten tilt.
  if (ctx.currentLossStreak >= 3 || tiltAfter >= 4) {
    rails.push({
      code: "hard_stop",
      severity: "stop",
      title: "Hard stop recommended",
      message:
        ctx.currentLossStreak >= 3
          ? "Three straight. Your MMR is fine tomorrow; your judgment is not fine right now. The Monk move is to close the client. Log it as a win for the mental game."
          : "Tilt is at molten. Nothing good queues from here. Stop is the correct play — that's not weakness, it's the read.",
    });
  }

  // "Casino has you": a fast re-queue right after a tilting loss.
  if (games.length >= 2) {
    const prev = games[games.length - 2];
    const gapMin =
      (+new Date(last.playedAt) - +new Date(prev.playedAt)) / 60000;
    if (
      prev.objective.win === false &&
      prev.scorecard.tiltAfter >= 4 &&
      gapMin < 8
    ) {
      rails.push({
        code: "casino",
        severity: "caution",
        title: "The casino has you",
        message:
          "You re-queued fuming, fast, to 'fix it.' That's the one-more-to-get-it-back reflex. The house wins those. Step away for ten minutes before the next call.",
      });
    }
  }

  // Session length: past 5 games, diminishing returns and fatigue set in.
  if (games.length >= 6) {
    rails.push({
      code: "fatigue",
      severity: "info",
      title: "Long session",
      message: `${games.length} games in. Focus decays even when tilt doesn't. If the last two felt sloppy rather than tilted, that's fatigue — a clean stop beats a foggy climb.`,
    });
  }

  return rails;
}

// A session can be a "success" even at 0 net LP: did you play clean, keep your
// head, and stop before the wheels came off?
function sessionHealth(
  games: EnrichedMatch[],
  peakTilt: number,
  avgProcess: number
): number {
  let score = avgProcess; // start from how well you actually played
  score -= peakTilt * 4; // heat is a tax
  if (games.some((g) => g.scorecard.flamed)) score -= 10;
  // Overrunning a tilted session is the real leak.
  const trailingLosses = trailing(games);
  if (trailingLosses >= 3) score -= 15;
  if (games.length > 6) score -= (games.length - 6) * 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function trailing(games: EnrichedMatch[]): number {
  let n = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i].objective.win === false) n++;
    else break;
  }
  return n;
}
