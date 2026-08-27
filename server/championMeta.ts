import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChampionMeta } from "../shared/types.ts";
import { getChampions } from "./ddragon.ts";

// ---------------------------------------------------------------------------
// CHAMPION CONTEXT
//
// The per-champion "who is this pick" panel: role, patch tier, strengths,
// weaknesses, matchups, synergies, win conditions. Riot's static data doesn't
// carry meta opinion, so we generate it with Claude and cache it to disk keyed
// by champion + patch — one token spend per champion per patch, then free.
// ---------------------------------------------------------------------------

const CACHE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "champion-meta.json"
);

type Cache = Record<string, ChampionMeta>;
let cache: Cache | null = null;
const inflight = new Map<string, Promise<ChampionMeta>>();

function loadCache(): Cache {
  if (cache) return cache;
  if (existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Cache;
      return cache;
    } catch {
      /* fall through to empty */
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

// Scrub synergy phrasing the player doesn't want: drop the word "duo", and
// remove vague composition descriptors ("Dive/tempo compositions") that aren't
// actionable. Applied on read so already-cached metas get cleaned without a
// regeneration.
function sanitizeMeta(meta: ChampionMeta): ChampionMeta {
  const synergies = (meta.synergies ?? [])
    .map((s) => s.replace(/\s*\(duo\)/gi, "").replace(/\bduo\b/gi, "").replace(/\s{2,}/g, " ").trim())
    .filter((s) => s && !/dive\s*\/\s*tempo/i.test(s) && !/\btempo compositions?\b/i.test(s));
  return { ...meta, synergies };
}

const MetaSchema = z.object({
  role: z.string(),
  tier: z.string(),
  difficulty: z.string(),
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  powerSpikes: z.array(z.string()),
  goodInto: z.array(z.string()),
  strugglesInto: z.array(z.string()),
  synergies: z.array(z.string()),
  winConditions: z.array(z.string()),
  combos: z.array(z.string()),
  positioning: z.string(),
  playRatings: z.array(z.object({ aspect: z.string(), rating: z.number() })),
});

const strArr = { type: "array", items: { type: "string" } } as const;
const META_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    role: { type: "string" },
    tier: { type: "string" },
    difficulty: { type: "string" },
    summary: { type: "string" },
    strengths: strArr,
    weaknesses: strArr,
    powerSpikes: strArr,
    goodInto: strArr,
    strugglesInto: strArr,
    synergies: strArr,
    winConditions: strArr,
    combos: strArr,
    positioning: { type: "string" },
    playRatings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { aspect: { type: "string" }, rating: { type: "number" } },
        required: ["aspect", "rating"],
      },
    },
  },
  required: [
    "role",
    "tier",
    "difficulty",
    "summary",
    "strengths",
    "weaknesses",
    "powerSpikes",
    "goodInto",
    "strugglesInto",
    "synergies",
    "winConditions",
    "combos",
    "positioning",
    "playRatings",
  ],
} as const;

const SYSTEM = `You are a Challenger-level League of Legends analyst. Given a champion, their primary role, and the current patch, produce a concise scouting brief for a player who mains them. Be specific and current-meta accurate.
Rules:
- role: the champion's primary competitive role in one word (Top, Jungle, Mid, Bot, Support).
- tier: a single letter meta tier for that role this patch (S, A, B, C, or D).
- difficulty: Low, Medium, or High.
- summary: one sentence on how the champion wins games.
- strengths / weaknesses: 3-4 short phrases each (not sentences).
- powerSpikes: 2-3 key spikes (levels/items), short phrases.
- goodInto / strugglesInto: 3-4 specific enemy champion names each (favorable / unfavorable matchups for this champion's role).
- synergies: 3-4 short items — name specific champions that pair well with this pick (for bot/support, name lane partners by champion name). Avoid vague phrases like "dive comps" or "tempo compositions".
- winConditions: 2-3 short imperative phrases the player should execute to win on this champion.
- combos: 2-3 concrete ability combos using ability letters (Q/W/E/R) and key items, short (e.g. "E in → Q → auto-reset → W").
- positioning: one short sentence on where to stand and what to do in a teamfight on this champion.
- playRatings: exactly these four aspects with a 1-5 integer rating of how strong the champion is at each — {"aspect":"Tower pushing","rating":N}, {"aspect":"Teamfighting","rating":N}, {"aspect":"Objectives","rating":N}, {"aspect":"Picks / roams","rating":N}.
Keep every item tight. No preamble.`;

async function generateMeta(champion: string, role: string, patch: string): Promise<ChampionMeta> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1600,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: META_JSON_SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Champion: ${champion}\nLikely role: ${role}\nPatch: ${patch}\n\nGive me the scouting brief.`,
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("no text output");
  const parsed = MetaSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("meta failed validation");
  return {
    champion,
    ...parsed.data,
    patch,
    generatedBy: "llm",
    generatedAt: new Date().toISOString(),
  };
}

// Deterministic fallback from Data Dragon tags when there's no API key.
async function fallbackMeta(champion: string, role: string, patch: string): Promise<ChampionMeta> {
  let tags: string[] = [];
  let title = "";
  try {
    const { champions } = await getChampions();
    const c = champions.find(
      (x) => x.name.toLowerCase() === champion.toLowerCase() || x.id.toLowerCase() === champion.toLowerCase()
    );
    tags = c?.tags ?? [];
    title = c?.title ?? "";
  } catch {
    /* offline — generic */
  }
  const primary = tags[0] ?? "Fighter";
  const kit: Record<string, { s: string[]; w: string[] }> = {
    Fighter: { s: ["Strong dueling", "Sustained damage", "Sticky to targets"], w: ["Kited by ranged", "Weak early", "Needs items"] },
    Tank: { s: ["Frontline + engage", "Peels for carries", "Objective control"], w: ["Low solo damage", "Needs a lead team", "Ignored in poke comps"] },
    Mage: { s: ["Wave control", "Burst / DPS", "Long range poke"], w: ["Squishy", "Cooldown reliant", "Dove easily"] },
    Assassin: { s: ["Snowball threat", "Picks side lanes", "High burst"], w: ["Falls off vs armor", "Team-reliant when behind", "Punished if caught"] },
    Marksman: { s: ["Scaling DPS", "Objective damage", "Range advantage"], w: ["Fragile", "Needs peel", "Weak pre-items"] },
    Support: { s: ["Vision + utility", "Enables carries", "Map control"], w: ["Low personal carry", "Gold-starved", "Punished off-position"] },
    Slayer: { s: ["Duel pressure", "Snowballs picks", "Mobile"], w: ["Squishier", "Needs a lead", "Kited"] },
  };
  const k = kit[primary] ?? kit.Fighter;
  return {
    champion,
    role,
    tier: "—",
    difficulty: "Medium",
    summary: title ? `${champion}, ${title}.` : `${champion} plays as a ${primary.toLowerCase()}.`,
    strengths: k.s,
    weaknesses: k.w,
    powerSpikes: ["Level 6 (ultimate)", "First completed item", "Two-item spike"],
    goodInto: [],
    strugglesInto: [],
    synergies: [],
    winConditions: ["Play to your champion's strengths", "Snowball your advantage into objectives"],
    patch,
    generatedBy: "fallback",
    generatedAt: new Date().toISOString(),
  };
}

export async function getChampionMeta(
  champion: string,
  role = "",
  opts: { refresh?: boolean } = {}
): Promise<ChampionMeta> {
  let patch = "current";
  try {
    patch = (await getChampions()).version;
  } catch {
    /* keep "current" */
  }
  const key = `${champion.toLowerCase()}|${patch}|v2`; // v2 = adds how-to-play tips
  const store = loadCache();
  if (!opts.refresh && store[key]) return sanitizeMeta(store[key]);
  if (inflight.has(key)) return inflight.get(key)!;

  const job = (async () => {
    let meta: ChampionMeta;
    if (hasAnthropic()) {
      try {
        meta = await generateMeta(champion, role || "unknown", patch);
      } catch (e) {
        console.warn("Champion meta LLM failed, using fallback:", (e as Error).message);
        meta = await fallbackMeta(champion, role, patch);
      }
    } else {
      meta = await fallbackMeta(champion, role, patch);
    }
    // Only cache successful LLM results long-term; a fallback can be upgraded
    // later once a key is present.
    if (meta.generatedBy === "llm") {
      store[key] = meta;
      cache = store;
      saveCache();
    }
    return sanitizeMeta(meta);
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}
