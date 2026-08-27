import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EnrichedMatch,
  NextGamePlan,
  StatCard,
  Insight,
  GoalProgress,
} from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll } from "./engine/enrich.ts";
import { buildStatBoard } from "./engine/statboard.ts";
import { buildInsights } from "./engine/insights.ts";
import { recommend } from "./engine/recommend.ts";
import { groupSessions } from "./engine/session.ts";
import { detectBorrowedLp } from "./engine/classify.ts";
import { evaluateGoal } from "./engine/goals.ts";
import { matchInBlock } from "./engine/blocks.ts";

const DEATH_CAUSE_LABELS: Record<string, string> = {
  laning_mistake: "laning mistakes",
  greedy_recall: "greedy recalls",
  facecheck: "facechecks",
  objective_setup: "objective setups",
  overextension: "overextension",
  shutdown_donation: "donated shutdowns",
  teamfight_execution: "teamfight execution",
  sidelane_greed: "side-lane greed",
  mechanical_misplay: "mechanical misplays",
  unavoidable_team_collapse: "team collapses",
};

// ---------------------------------------------------------------------------
// THE COACH — the reasoning engine that decides what you do next.
//
// It compiles your whole recent history into a brief, reasons over it (with
// Claude when a key is present, deterministically otherwise), and hands back
// 1–3 concrete goals for your NEXT game. This is the product's front door: the
// answer to "what should I go do?"
// ---------------------------------------------------------------------------

interface Signals {
  games: number;
  rank: string;
  record: { wins: number; losses: number; winRate: number; netLp: number };
  weakStats: StatCard[];
  strongStats: StatCard[];
  focusGoal: GoalProgress | null;
  insights: Insight[];
  champion: { champion: string | null; role: string | null; rationale: string };
  session: {
    games: number;
    wins: number;
    losses: number;
    netLp: number;
    avgProcess: number;
    peakTilt: number;
    lossStreak: number;
    healthScore: number;
    guardrail: string | null;
  } | null;
  borrowedLp: string | null;
  topDeathCause: string | null;
  identity: string;
}

function hasAnthropic() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// Match the global game-type filter to a predicate (mirrors the dashboard).
function queuePredicate(queue: string): (q: string) => boolean {
  const map: Record<string, (q: string) => boolean> = {
    all: () => true,
    ranked_solo: (q) => q.includes("RANKED_SOLO"),
    ranked_flex: (q) => q.includes("RANKED_FLEX"),
    swiftplay: (q) => q.includes("SWIFTPLAY") || q.includes("QUICKPLAY"),
    draft: (q) => q.includes("DRAFT") || q.includes("BLIND"),
    aram: (q) => q.includes("ARAM"),
  };
  return map[queue] ?? map.all;
}

function compile(queue = "all"): { signals: Signals; brief: string } {
  const pool = store.activePool();
  const mainRole = store.profile().mainRole;
  const seasons = store.seasons();
  const pred = queuePredicate(queue);
  const career = enrichAll(store.matches(), seasons, pool).filter((m) => pred((m.objective.queue ?? "").toUpperCase()));
  const recent = career.slice(-20);

  const statBoard = buildStatBoard(career);
  const weakStats = statBoard
    .filter((s) => s.better === false && s.delta != null && s.value !== s.baseline)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
    .slice(0, 4);
  const strongStats = statBoard.filter((s) => s.better === true).slice(0, 3);

  const insights = buildInsights(career).slice(0, 3);

  const rec = recommend(career, pool, mainRole);
  const champRec = rec.plan.roster.find((r) => r.champion) ?? rec.plan.roster[0];

  const season = store.activeSeason();
  const seasonEnriched = season ? career.filter((m) => matchInBlock(m, season)) : [];
  const goals = season
    ? store.goalsForSeason(season.id).map((g) => evaluateGoal(g, seasonEnriched))
    : [];
  const focusGoal = [...goals].filter((g) => !g.met).sort((a, b) => a.pct - b.pct)[0] ?? null;

  const sessions = groupSessions(career, store.settings().sessionGapMinutes);
  const last = sessions[sessions.length - 1];
  const session = last
    ? {
        games: last.games,
        wins: last.wins,
        losses: last.losses,
        netLp: last.netLp,
        avgProcess: last.avgProcess,
        peakTilt: last.peakTilt,
        lossStreak: last.currentLossStreak,
        healthScore: last.healthScore,
        guardrail: last.guardrails.find((g) => g.severity === "stop")?.message
          ?? last.guardrails[0]?.message
          ?? null,
      }
    : null;

  const borrowed = detectBorrowedLp(career);

  const causeCounts = new Map<string, number>();
  for (const m of recent) {
    const c = m.scorecard.firstDeathCause;
    if (c) causeCounts.set(c, (causeCounts.get(c) ?? 0) + 1);
  }
  const topCause = [...causeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const latestRank = [...career].reverse().find((m) => m.objective.tier)?.objective;
  const wins = career.filter((m) => m.objective.win).length;
  const losses = career.filter((m) => m.objective.win === false).length;

  const signals: Signals = {
    games: career.length,
    rank: latestRank?.tier
      ? `${cap(latestRank.tier)} ${latestRank.division ?? ""} ${latestRank.leaguePoints ?? 0} LP`.trim()
      : "Unranked",
    record: {
      wins,
      losses,
      winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
      netLp: career.reduce((a, m) => a + (m.objective.lpDelta ?? 0), 0),
    },
    weakStats,
    strongStats,
    focusGoal,
    insights,
    champion: {
      champion: champRec?.champion ?? null,
      role: mainRole,
      rationale: champRec?.rationale ?? "your most reliable pick",
    },
    session,
    borrowedLp: borrowed.borrowed ? borrowed.message : null,
    topDeathCause: topCause ? DEATH_CAUSE_LABELS[topCause] ?? topCause : null,
    identity: rec.identityName,
  };

  return { signals, brief: renderBrief(signals) };
}

function renderBrief(s: Signals): string {
  const lines: string[] = [];
  lines.push(`Rank: ${s.rank}. Career record: ${s.record.wins}W ${s.record.losses}L (${s.record.winRate}% WR, ${s.record.netLp >= 0 ? "+" : ""}${s.record.netLp} LP) over ${s.games} logged games. Playing as "${s.identity}".`);
  if (s.weakStats.length)
    lines.push(`Declining vs my recent baseline: ${s.weakStats.map((w) => `${w.label} ${w.valueFmt} (was ${w.baseline})`).join("; ")}.`);
  if (s.strongStats.length)
    lines.push(`Holding up or improving: ${s.strongStats.map((w) => `${w.label} ${w.valueFmt}`).join("; ")}.`);
  if (s.focusGoal)
    lines.push(`Active block goal furthest behind: "${s.focusGoal.goal.title}" — currently ${s.focusGoal.current ?? "?"} vs target ${s.focusGoal.goal.direction === "lower" ? "≤" : "≥"}${s.focusGoal.goal.target} ${s.focusGoal.goal.unit}.`);
  for (const ins of s.insights) lines.push(`Insight: ${ins.title}. ${ins.detail}`);
  if (s.topDeathCause) lines.push(`Most common first-death cause lately: ${s.topDeathCause}.`);
  if (s.session)
    lines.push(`Current session: ${s.session.wins}W ${s.session.losses}L, ${s.session.netLp >= 0 ? "+" : ""}${s.session.netLp} LP, avg process ${s.session.avgProcess}, peak tilt ${s.session.peakTilt}/5, loss streak ${s.session.lossStreak}, session-health ${s.session.healthScore}/100.${s.session.guardrail ? " Guardrail: " + s.session.guardrail : ""}`);
  if (s.borrowedLp) lines.push(`Warning: ${s.borrowedLp}`);
  lines.push(`Recommended champion/role: ${s.champion.champion ?? "a comfort pick"} ${s.champion.role ?? ""} — ${s.champion.rationale}.`);
  return lines.join("\n");
}

// ---- LLM plan -------------------------------------------------------------

const DirectiveSchema = z.object({
  title: z.string().describe("A short imperative goal, e.g. 'Farm to 70 CS by 10 minutes'"),
  why: z.string().describe("One sentence of rationale that cites the player's data"),
  metricLabel: z.string().describe("The stat this maps to, e.g. 'CS@10', 'Deaths<15', 'KP'"),
  target: z.string().describe("The concrete target, e.g. '70+', '≤2', '55%'"),
  tone: z.enum(["good", "bad", "neutral"]),
});
const PlanSchema = z.object({
  headline: z.string().describe("One encouraging line telling the player what this next game is about"),
  directives: z.array(DirectiveSchema).describe("1 to 3 concrete, measurable goals for the NEXT game"),
  championCall: z.object({
    champion: z.string().nullable(),
    role: z.string().nullable(),
    line: z.string().describe("One line on why to play this"),
  }),
  mentalNote: z.string().describe("Queue-discipline / tilt / stop-or-keep-playing guidance"),
});

const SYSTEM = `You are a sharp, encouraging League of Legends improvement coach — like a manager in a task tracker who hands the player exactly what to focus on next. You are given a compiled brief of their recent stats, trends, goals, and session state.

Your job: produce a plan for their NEXT game. Rules:
- 1 to 3 directives, each a concrete, MEASURABLE goal tied to a real stat from the brief (CS@10, deaths before 15, kill participation, vision, gold@15, etc.). Never vague ("play better").
- Lead with the single biggest leak from the data. Cite the numbers in the rationale.
- Set tone: "bad" for a leak to fix, "good" for a strength to lean into, "neutral" otherwise.
- The mental note reads the session: if they're on a loss streak or tilt is high, tell them to stop or reset; if they're calm and winning, encourage another. Be direct but supportive.
- Recommend the champion/role from the brief. If none, say to pick a comfort main.
- Keep it tight and action-oriented. The point is to make them WANT to go play with a clear focus. No preamble.`;

// Raw JSON schema for the API's structured-output constraint (Zod v4 helper is
// unavailable, so we validate the returned JSON with the Zod v3 schema above).
const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    directives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          metricLabel: { type: "string" },
          target: { type: "string" },
          tone: { type: "string", enum: ["good", "bad", "neutral"] },
        },
        required: ["title", "why", "metricLabel", "target", "tone"],
      },
    },
    championCall: {
      type: "object",
      additionalProperties: false,
      properties: {
        champion: { type: ["string", "null"] },
        role: { type: ["string", "null"] },
        line: { type: "string" },
      },
      required: ["champion", "role", "line"],
    },
    mentalNote: { type: "string" },
  },
  required: ["headline", "directives", "championCall", "mentalNote"],
} as const;

async function llmPlan(brief: string): Promise<Omit<NextGamePlan, "generatedBy" | "generatedAt" | "basedOnGames">> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2500,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: PLAN_JSON_SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Here is my compiled brief. Give me my plan for the next game.\n\n${brief}`,
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("no text output");
  const parsed = PlanSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("plan failed validation");
  const p = parsed.data;
  return {
    headline: p.headline,
    directives: p.directives.slice(0, 3),
    championCall: p.championCall,
    mentalNote: p.mentalNote,
  };
}

// ---- Heuristic plan (fallback / no key) -----------------------------------

function heuristicPlan(s: Signals): Omit<NextGamePlan, "generatedBy" | "generatedAt" | "basedOnGames"> {
  const directives: NextGamePlan["directives"] = [];

  if (s.focusGoal) {
    const g = s.focusGoal.goal;
    directives.push({
      title: g.title,
      why: `Your block goal that's furthest behind — ${s.focusGoal.current ?? "?"} vs a ${g.direction === "lower" ? "≤" : "≥"}${g.target} target.`,
      metricLabel: g.title,
      target: `${g.direction === "lower" ? "≤" : "≥"}${g.target} ${g.unit}`.trim(),
      tone: "bad",
    });
  }
  for (const w of s.weakStats) {
    if (directives.length >= 3) break;
    if (s.focusGoal && w.label.toLowerCase().includes(s.focusGoal.goal.title.toLowerCase().slice(0, 4))) continue;
    directives.push({
      title: `Bring ${w.label} back up`,
      why: `It slipped from ${w.baseline} to ${w.valueFmt} over your last 10 games.`,
      metricLabel: w.label,
      target: `back above ${w.baseline}${w.unit === "%" ? "%" : ""}`,
      tone: "bad",
    });
  }
  if (directives.length === 0 && s.strongStats[0]) {
    const g = s.strongStats[0];
    directives.push({
      title: `Keep pressing ${g.label}`,
      why: `It's trending up (${g.valueFmt}). Lean into what's working.`,
      metricLabel: g.label,
      target: `hold ${g.valueFmt}`,
      tone: "good",
    });
  }
  if (directives.length === 0) {
    directives.push({
      title: "Play a clean, calm game",
      why: "Not enough data yet — log this one so the coach can start reading your patterns.",
      metricLabel: "Process",
      target: "grade it honestly",
      tone: "neutral",
    });
  }

  let mentalNote = "You're in a good spot — queue up with a clear focus.";
  if (s.session) {
    if (s.session.lossStreak >= 3 || s.session.peakTilt >= 4)
      mentalNote = `You're ${s.session.lossStreak} down and tilt hit ${s.session.peakTilt}/5. The winning move is to stop — your MMR is fine tomorrow, your judgment isn't fine right now.`;
    else if (s.session.lossStreak === 2)
      mentalNote = "Two losses in a row. One more, decided now to be the last — win or lose, then reassess.";
    else if (s.borrowedLp) mentalNote = s.borrowedLp;
  }

  const headline = s.session && (s.session.lossStreak >= 3 || s.session.peakTilt >= 4)
    ? "Before the next game — read this."
    : `Your next game: ${directives[0].title.toLowerCase()}.`;

  return {
    headline,
    directives,
    championCall: {
      champion: s.champion.champion,
      role: s.champion.role,
      line: s.champion.rationale,
    },
    mentalNote,
  };
}

// ---- Orchestrator ---------------------------------------------------------

export async function buildCoachPlan(opts: { force?: boolean; queue?: string } = {}): Promise<NextGamePlan> {
  const queue = opts.queue ?? "all";
  const mode = store.coachMode(); // "llm" (Claude) or "engine" (deterministic)
  const { signals, brief } = compile(queue);
  const cached = store.coachPlan();
  if (!opts.force && cached && cached.forGameCount === signals.games && (cached.forQueue ?? "all") === queue && (cached.forMode ?? "llm") === mode) {
    return cached.plan;
  }

  let core: Omit<NextGamePlan, "generatedBy" | "generatedAt" | "basedOnGames">;
  let by: "llm" | "heuristic" = "heuristic";
  // The deterministic engine is the heuristic path; the switch forces it so you
  // can compare it against the Claude-synthesized plan without spending tokens.
  if (mode === "llm" && hasAnthropic() && signals.games > 0) {
    try {
      core = await llmPlan(brief);
      by = "llm";
    } catch (e) {
      console.warn("Coach LLM failed, using heuristic:", (e as Error).message);
      core = heuristicPlan(signals);
    }
  } else {
    core = heuristicPlan(signals);
  }

  const plan: NextGamePlan = {
    ...core,
    generatedBy: by,
    generatedAt: new Date().toISOString(),
    basedOnGames: signals.games,
  };
  store.setCoachPlan(plan, signals.games, queue, mode);
  // Cache the reasoning as a training pair — brief in, plan out. Over time this
  // becomes a dataset we could distill our own model of the coach's reasoning
  // from, without spending tokens generating it.
  recordReasoning(brief, signals, plan);
  return plan;
}

const DATASET_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "coach-dataset.jsonl"
);

function recordReasoning(brief: string, signals: Signals, plan: NextGamePlan) {
  try {
    const dir = dirname(DATASET_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const record = {
      ts: plan.generatedAt,
      generatedBy: plan.generatedBy,
      games: signals.games,
      brief,
      signals: {
        record: signals.record,
        weak: signals.weakStats.map((s) => `${s.label} ${s.valueFmt}`),
        strong: signals.strongStats.map((s) => s.label),
        focusGoal: signals.focusGoal?.goal.title ?? null,
        session: signals.session,
      },
      plan: {
        headline: plan.headline,
        directives: plan.directives,
        championCall: plan.championCall,
        mentalNote: plan.mentalNote,
      },
    };
    appendFileSync(DATASET_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch {
    /* dataset logging is best-effort */
  }
}

function cap(s: string) {
  return s ? s[0] + s.slice(1).toLowerCase() : s;
}
