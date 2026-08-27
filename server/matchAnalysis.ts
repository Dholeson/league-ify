import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MatchAnalysis } from "../shared/types.ts";

// ---------------------------------------------------------------------------
// BUILD & DRAFT ANALYSIS
//
// Grades your item build for a game — against standard high-winrate builds AND
// the specific enemy composition (did you get armor into an AD comp, antiheal
// into sustain, etc.) — plus a draft score for each team. Generated with Claude
// and cached to disk by Riot match id: one token spend per game, then free.
// ---------------------------------------------------------------------------

const CACHE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "match-analysis.json"
);

type Cache = Record<string, MatchAnalysis>;
let cache: Cache | null = null;
const inflight = new Map<string, Promise<MatchAnalysis>>();

function loadCache(): Cache {
  if (cache) return cache;
  if (existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Cache;
      return cache;
    } catch {
      /* fall through */
    }
  }
  cache = {};
  return cache;
}

function saveCache() {
  try {
    const dir = dirname(CACHE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache ?? {}, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}

function hasAnthropic() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export interface AnalysisInput {
  matchId: string;
  patch: string;
  queue: string; // "RANKED_SOLO_5x5" | "ARAM" | ...
  win: boolean;
  me: {
    champion: string;
    role: string;
    items: string[]; // item names, build order
    keystone: string | null;
    spells: string[]; // summoner spell names
  };
  myTeam: { champion: string; role: string }[];
  enemyTeam: { champion: string; role: string }[];
}

const DraftSchema = z.object({
  score: z.number(),
  label: z.string(),
  notes: z.array(z.string()),
});
const AnalysisSchema = z.object({
  buildScore: z.number(),
  buildVerdict: z.string(),
  buildNotes: z.array(z.string()),
  myTeam: DraftSchema,
  enemyTeam: DraftSchema,
  matchup: z.string(),
});

const strArr = { type: "array", items: { type: "string" } } as const;
const draftJson = {
  type: "object",
  additionalProperties: false,
  properties: { score: { type: "number" }, label: { type: "string" }, notes: strArr },
  required: ["score", "label", "notes"],
} as const;
const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    buildScore: { type: "number" },
    buildVerdict: { type: "string" },
    buildNotes: strArr,
    myTeam: draftJson,
    enemyTeam: draftJson,
    matchup: { type: "string" },
  },
  required: ["buildScore", "buildVerdict", "buildNotes", "myTeam", "enemyTeam", "matchup"],
} as const;

const SYSTEM = `You are a Challenger-level League of Legends coach grading one game's item build and both teams' drafts. Be specific, current-meta accurate, and honest.

Grade the player's BUILD (0-100):
- Compare to the standard high-winrate build for that champion/role this patch.
- Reward situational adaptation to the ENEMY comp: armor vs AD-heavy, magic resist vs AP-heavy, anti-heal (Executioner's/Mortal Reminder/Chempunk/Morellonomicon) vs sustain, tenacity/Mercs vs heavy CC, Maw/hexdrinker vs burst.
- buildVerdict: 2-4 words, e.g. "Standard & adapted", "Missing anti-heal", "Off-meta path".
- buildNotes: 2-4 short bullets — what was right, what was missing given the enemy comp. No preamble.

Grade each TEAM's DRAFT (0-100) on: frontline/backline balance, engage + disengage, peel, damage-type mix (AD/AP), crowd control, and scaling. label: 1-3 words. notes: 2-3 short bullets naming the key strengths/holes (reference champions).

matchup: one sentence — which draft is favored and the main reason.

For ARAM: there's no role, no lane; judge the build for a single-lane teamfight brawl and the draft on poke/engage/sustain/teamfight. Keep every string tight.`;

async function generate(input: AnalysisInput): Promise<MatchAnalysis> {
  const client = new Anthropic();
  const isAram = input.queue.toUpperCase().includes("ARAM");
  const comp = (t: { champion: string; role: string }[]) =>
    t.map((p) => (isAram ? p.champion : `${p.champion} (${p.role})`)).join(", ");

  const prompt = [
    `Patch: ${input.patch}`,
    `Queue: ${isAram ? "ARAM (Howling Abyss)" : input.queue}`,
    `Result: ${input.win ? "Win" : "Loss"}`,
    ``,
    `YOU: ${input.me.champion}${isAram ? "" : ` (${input.me.role})`}`,
    `Your build (in order): ${input.me.items.join(", ") || "no items"}`,
    input.me.keystone ? `Keystone: ${input.me.keystone}` : ``,
    input.me.spells.length ? `Summoners: ${input.me.spells.join(" + ")}` : ``,
    ``,
    `Your team: ${comp(input.myTeam)}`,
    `Enemy team: ${comp(input.enemyTeam)}`,
    ``,
    `Grade the build and both drafts.`,
  ].filter(Boolean).join("\n");

  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1800,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ANALYSIS_JSON_SCHEMA },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("no text output");
  const parsed = AnalysisSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("analysis failed validation");
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    found: true,
    champion: input.me.champion,
    buildScore: clamp(parsed.data.buildScore),
    buildVerdict: parsed.data.buildVerdict,
    buildNotes: parsed.data.buildNotes,
    myTeam: { ...parsed.data.myTeam, score: clamp(parsed.data.myTeam.score) },
    enemyTeam: { ...parsed.data.enemyTeam, score: clamp(parsed.data.enemyTeam.score) },
    matchup: parsed.data.matchup,
    generatedBy: "llm",
    error: null,
  };
}

// No API key → a light heuristic so the panel still says something.
function fallback(input: AnalysisInput): MatchAnalysis {
  const items = input.me.items.length;
  return {
    found: true,
    champion: input.me.champion,
    buildScore: Math.min(100, 40 + items * 9),
    buildVerdict: items >= 5 ? "Full build" : "Build in progress",
    buildNotes: [
      `Completed ${items} item${items === 1 ? "" : "s"} this game.`,
      "Add an Anthropic API key for a build graded against the enemy comp.",
    ],
    myTeam: { score: 50, label: "Not graded", notes: ["Draft grading needs an Anthropic API key."] },
    enemyTeam: { score: 50, label: "Not graded", notes: [] },
    matchup: "Draft comparison needs an Anthropic API key.",
    generatedBy: "fallback",
    error: null,
  };
}

export async function getMatchAnalysis(input: AnalysisInput, opts: { refresh?: boolean } = {}): Promise<MatchAnalysis> {
  const key = `${input.matchId}|${input.patch}`;
  const store = loadCache();
  if (!opts.refresh && store[key]) return store[key];
  if (inflight.has(key)) return inflight.get(key)!;

  const job = (async () => {
    let out: MatchAnalysis;
    if (hasAnthropic()) {
      try {
        out = await generate(input);
      } catch (e) {
        console.warn("Match analysis LLM failed, using fallback:", (e as Error).message);
        out = fallback(input);
      }
    } else {
      out = fallback(input);
    }
    if (out.generatedBy === "llm") {
      store[key] = out;
      cache = store;
      saveCache();
    }
    return out;
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}
