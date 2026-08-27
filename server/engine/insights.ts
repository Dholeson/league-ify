import type { EnrichedMatch, Insight } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// INSIGHTS
//
// Data-driven "here's how you actually win" observations. Each is a comparison
// between two conditions; we only surface it when both samples are real and the
// gap is meaningful. These are the difference between a data graveyard and a
// coach.
// ---------------------------------------------------------------------------

const wr = (ms: EnrichedMatch[]) =>
  ms.length ? Math.round((ms.filter((m) => m.objective.win).length / ms.length) * 100) : 0;

interface Split {
  id: string;
  icon: string;
  when: (m: EnrichedMatch) => boolean | null; // true=A, false=B, null=exclude
  headline: (a: number, b: number) => string;
  detail: (a: number, b: number) => string;
  href: string | null;
  // good if condition-A win rate is higher (a behaviour to keep), bad otherwise
  goodWhenAHigher: boolean;
}

const SPLITS: Split[] = [
  {
    id: "cs10",
    icon: "ti-pick",
    when: (m) => (m.objective.csAt10 == null ? null : m.objective.csAt10 >= 70),
    headline: (a) => `You win ${a}% when you hit 70 CS by 10`,
    detail: (a, b) => `Versus ${b}% when you don't. Farming the early game is your single highest-leverage habit.`,
    href: "/progress",
    goodWhenAHigher: true,
  },
  {
    id: "early_deaths",
    icon: "ti-skull",
    when: (m) => (m.objective.deathsBefore15 == null ? null : m.objective.deathsBefore15 <= 1),
    headline: (a) => `${a}% win rate when you survive the early game`,
    detail: (a, b) => `With 1 or fewer deaths before 15 you win ${a}%; with more it drops to ${b}%. Stay alive, stay ahead.`,
    href: "/progress",
    goodWhenAHigher: true,
  },
  {
    id: "calm",
    icon: "ti-flame",
    when: (m) => m.scorecard.tiltBefore <= 1,
    headline: (a) => `Calm queues win ${a}% for you`,
    detail: (a, b) => `Queueing calm you win ${a}%; queueing hot, ${b}%. The tilt tax is real — take the break.`,
    href: "/progress",
    goodWhenAHigher: true,
  },
  {
    id: "flame",
    icon: "ti-message-report",
    when: (m) => !m.scorecard.flamed,
    headline: (a) => `Muted, you win ${a}%`,
    detail: (a, b) => `When you don't type you win ${a}%; when you flame, ${b}%. Chat has never carried a game.`,
    href: null,
    goodWhenAHigher: true,
  },
  {
    id: "kp",
    icon: "ti-users",
    when: (m) => (m.objective.killParticipation == null ? null : m.objective.killParticipation >= 0.6),
    headline: (a) => `${a}% win rate when you're in the fights`,
    detail: (a, b) => `With 60%+ kill participation you win ${a}%; below that, ${b}%. Show up for the map's plays.`,
    href: "/progress",
    goodWhenAHigher: true,
  },
  {
    id: "gold15",
    icon: "ti-coins",
    when: (m) => (m.objective.goldDiffAt15 == null ? null : m.objective.goldDiffAt15 >= 0),
    headline: (a) => `Even-or-ahead at 15 → ${a}% wins`,
    detail: (a, b) => `When you're not behind in gold at 15 you win ${a}%; behind, ${b}%. The lane still decides a lot.`,
    href: "/progress",
    goodWhenAHigher: true,
  },
  {
    id: "low_deaths",
    icon: "ti-shield-half",
    when: (m) => (m.objective.deaths == null ? null : m.objective.deaths <= 4),
    headline: (a) => `Under 5 deaths, you win ${a}%`,
    detail: (a, b) => `Keeping deaths to 4 or fewer wins ${a}%; more than that drops to ${b}%. Fewer deaths, more wins.`,
    href: "/progress",
    goodWhenAHigher: true,
  },
  {
    id: "objectives",
    icon: "ti-topology-star-3",
    when: (m) => {
      const o = m.objective;
      if (o.dragons == null && o.heralds == null && o.barons == null) return null;
      return (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0) >= 4;
    },
    headline: (a) => `${a}% when your team stacks objectives`,
    detail: (a, b) => `Games with 4+ major objectives win ${a}%; fewer, ${b}%. Play the map, not just the lane.`,
    href: "/progress",
    goodWhenAHigher: true,
  },
];

function daySessionPosition(career: EnrichedMatch[]): Map<string, number> {
  // Approximate "how deep into a session" by ordering games within a local day.
  const pos = new Map<string, number>();
  const byDay = new Map<string, EnrichedMatch[]>();
  for (const m of career) {
    const d = new Date(m.playedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(m);
  }
  for (const ms of byDay.values()) {
    ms.sort((a, b) => +new Date(a.playedAt) - +new Date(b.playedAt));
    ms.forEach((m, i) => pos.set(m.id, i));
  }
  return pos;
}

export function buildInsights(career: EnrichedMatch[]): Insight[] {
  if (career.length < 6) return [];
  const out: { insight: Insight; gap: number }[] = [];

  for (const sp of SPLITS) {
    const a = career.filter((m) => sp.when(m) === true);
    const b = career.filter((m) => sp.when(m) === false);
    if (a.length < 4 || b.length < 4) continue;
    const wa = wr(a);
    const wb = wr(b);
    const gap = wa - wb;
    if (Math.abs(gap) < 12) continue;
    // A habit we KNOW is good (farm, survive, show up for fights) that correlates
    // with *losing* is almost always reverse causation — e.g. kill participation
    // is inflated in games you're already losing (you're grouped and desperate).
    // Surfacing "you win less when you fight → so don't fight" is bad advice, so
    // we only keep the split when the data confirms the expected direction.
    if (sp.goodWhenAHigher && gap < 0) continue;
    if (!sp.goodWhenAHigher && gap > 0) continue;
    const tone: Insight["tone"] = sp.goodWhenAHigher ? "good" : "bad";
    out.push({
      gap: Math.abs(gap),
      insight: {
        id: sp.id,
        tone,
        icon: sp.icon,
        title: sp.headline(wa, wb),
        detail: sp.detail(wa, wb),
        href: sp.href,
      },
    });
  }

  // Session fatigue.
  const pos = daySessionPosition(career);
  const fresh = career.filter((m) => (pos.get(m.id) ?? 0) <= 1);
  const deep = career.filter((m) => (pos.get(m.id) ?? 0) >= 3);
  if (fresh.length >= 4 && deep.length >= 4) {
    const wf = wr(fresh);
    const wd = wr(deep);
    if (wf - wd >= 12) {
      out.push({
        gap: wf - wd,
        insight: {
          id: "fatigue",
          tone: "bad",
          icon: "ti-battery-2",
          title: `Your win rate falls to ${wd}% deep in a session`,
          detail: `Games 1–2 of a session win ${wf}%; game 4+ drops to ${wd}%. This is where the "one more" habit costs you LP.`,
          href: "/progress",
        },
      });
    }
  }

  // Champion mismatch: your best champ isn't your most-played.
  const byChamp = new Map<string, EnrichedMatch[]>();
  for (const m of career) {
    const c = m.objective.champion;
    if (!c) continue;
    (byChamp.get(c) ?? byChamp.set(c, []).get(c)!).push(m);
  }
  const champStats = [...byChamp.entries()]
    .filter(([, ms]) => ms.length >= 3)
    .map(([champion, ms]) => ({
      champion,
      games: ms.length,
      proc: Math.round(ms.reduce((a, m) => a + m.process.score, 0) / ms.length),
    }));
  if (champStats.length >= 2) {
    const byProc = [...champStats].sort((a, b) => b.proc - a.proc);
    const byGames = [...champStats].sort((a, b) => b.games - a.games);
    const best = byProc[0];
    if (best.champion !== byGames[0].champion && best.proc - byProc[byProc.length - 1].proc >= 8) {
      out.push({
        gap: 20,
        insight: {
          id: "champ_mismatch",
          tone: "neutral",
          icon: "ti-star",
          title: `${best.champion} is your highest-process champ`,
          detail: `Process ${best.proc} on ${best.champion}, yet ${byGames[0].champion} gets more games. Consider leaning into what works.`,
          href: `/champions/${best.champion}`,
        },
      });
    }
  }

  return out.sort((a, b) => b.gap - a.gap).slice(0, 6).map((x) => x.insight);
}

// A personal, performance-based champion tier (not a meta tier). Rewards win
// rate + process, penalized by tiny samples so 2-game flukes don't hit S.
export function championPersonalTier(
  winRate: number,
  avgProcess: number,
  games: number
): "S" | "A" | "B" | "C" | "D" {
  const score = winRate * 0.5 + avgProcess * 0.5;
  const confidence = Math.min(1, games / 6);
  const adjusted = 40 + (score - 40) * confidence; // pull toward the middle when low sample
  if (adjusted >= 70) return "S";
  if (adjusted >= 60) return "A";
  if (adjusted >= 50) return "B";
  if (adjusted >= 42) return "C";
  return "D";
}

export function championForm(processChrono: number[]): "up" | "down" | "flat" {
  if (processChrono.length < 4) return "flat";
  const half = Math.floor(processChrono.length / 2);
  const early = processChrono.slice(0, half);
  const late = processChrono.slice(half);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = avg(late) - avg(early);
  if (delta >= 5) return "up";
  if (delta <= -5) return "down";
  return "flat";
}
