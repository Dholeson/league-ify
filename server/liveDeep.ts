import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LiveCompanionResponse, LiveDeepRead } from "../shared/types.ts";
import { getChampions } from "./ddragon.ts";

// ---------------------------------------------------------------------------
// LIVE DEEP READ — the optional LLM layer on top of the rules-based companion.
//
// The rules engine (liveCompanion.ts) is instant and free and always runs. This
// adds an on-demand Claude synthesis: a narrative game plan, the win condition,
// a deep matchup read that uses the player's OWN tendencies, and nuanced build
// reasoning. Button-triggered, cached per champ-select signature so re-clicking
// the same lobby doesn't re-spend, and degrades to available:false with no key.
// ---------------------------------------------------------------------------

function hasAnthropic() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// A stable fingerprint of the lobby so identical calls hit the cache. Enemy
// picks trickle in during champ select, so this changes as the comp fills — a
// new read each time the picture meaningfully changes, but not on re-clicks.
function signature(c: LiveCompanionResponse): string {
  const team = [c.mine?.champion, ...c.allies.map((a) => a.champion)].filter(Boolean).sort().join(",");
  const enemies = c.enemies.map((e) => e.champion).sort().join(",");
  return `${c.source}|${c.mode}|${c.mine?.champion ?? "?"}|${c.mine?.role ?? "?"}|${c.enemyLaner?.champion ?? "?"}|T:${team}|E:${enemies}`;
}

const cache = new Map<string, LiveDeepRead>();

// ---- brief -----------------------------------------------------------------
// Everything the rules engine already computed, rendered as grounded facts for
// Claude to synthesize — the player's real matchup history included.
function renderBrief(c: LiveCompanionResponse, nameOf: (id: string) => string): string {
  const L: string[] = [];
  const name = (ch: string) => nameOf(ch);
  const team = c.mine ? [c.mine, ...c.allies] : c.allies;
  L.push(`Mode: ${c.mode}${c.hasLanes ? " (lane-based)" : " (no fixed lanes)"}.`);
  if (c.mine) L.push(`You are playing ${name(c.mine.champion)}${c.mine.role ? ` (${c.mine.role})` : ""}.`);
  L.push(`Your team: ${team.map((p) => `${name(p.champion)}${p.role ? ` ${p.role}` : ""}`).join(", ") || "—"}.`);
  L.push(`Enemy team: ${c.enemies.map((p) => `${name(p.champion)}${p.role ? ` ${p.role}` : ""}`).join(", ") || "—"}.`);
  if (c.enemyLaner) L.push(`Your direct opponent: ${name(c.enemyLaner.champion)}.`);

  const m = c.matchup;
  if (m) {
    L.push("");
    L.push(`YOUR HISTORY (from this player's logged games — use it, don't invent numbers):`);
    if (m.opponent && m.vsGames >= 2) {
      L.push(`- Into ${name(m.opponent)} specifically: ${m.vsGames} games, ${m.vsWinRate}% win rate.`);
    } else {
      L.push(`- Overall on ${name(m.champion)}: ${m.champGames} games, ${m.champWinRate ?? "?"}% win rate. ${m.note}`);
    }
    if (m.stats.length) L.push(`- Key stats (sampled from those games): ${m.stats.map((s) => `${s.label} ${s.value} (${s.tone})`).join("; ")}.`);
    if (m.strengths.length) L.push(`- What this player does WELL here: ${m.strengths.join(" ")}`);
    if (m.focus.length) L.push(`- What this player should FOCUS on: ${m.focus.join(" ")}`);
  }

  const b = c.build;
  if (b) {
    L.push("");
    L.push(`BUILD: ${b.summary}`);
    if (b.teamNeeds.length) L.push(`Your team's gaps: ${b.teamNeeds.join(" ")}`);
    const rec = b.options.find((o) => o.recommended) ?? b.options[0];
    if (rec) {
      L.push(`Recommended build — ${rec.label} (${rec.fit}):`);
      for (const ph of rec.phases) L.push(`- ${ph.phase} (${ph.when}): ${ph.items.map((i) => `${i.name} — ${i.reason}`).join(" | ")}`);
      const alts = b.options.filter((o) => !o.recommended).map((o) => o.label);
      if (alts.length) L.push(`Alternative builds available: ${alts.join(", ")}.`);
    }
  }
  const d = c.draft;
  if (d) {
    L.push("");
    L.push(`DRAFT: your damage ${d.yourDamage}, enemy damage ${d.enemyDamage}. Rules verdict: ${d.readout}`);
    if (d.yourNotes.length) L.push(`Advantages: ${d.yourNotes.join(" ")}`);
    if (d.enemyNotes.length) L.push(`Watch for: ${d.enemyNotes.join(" ")}`);
  }
  return L.join("\n");
}

// ---- schema ----------------------------------------------------------------
const PhaseSchema = z.object({ phase: z.string(), advice: z.string() });
const DeepSchema = z.object({
  headline: z.string(),
  winCondition: z.string(),
  gamePlan: z.array(PhaseSchema),
  matchupPlan: z.string(),
  keyThreats: z.array(z.string()),
  buildNote: z.string(),
});

const DEEP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    winCondition: { type: "string" },
    gamePlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { phase: { type: "string" }, advice: { type: "string" } },
        required: ["phase", "advice"],
      },
    },
    matchupPlan: { type: "string" },
    keyThreats: { type: "array", items: { type: "string" } },
    buildNote: { type: "string" },
  },
  required: ["headline", "winCondition", "gamePlan", "matchupPlan", "keyThreats", "buildNote"],
} as const;

const SYSTEM = `You are an elite League of Legends draft-and-game-plan analyst embedded in a personal coaching app. You are handed a data brief about a game the player is ABOUT to play: both team comps, the mode, and — crucially — the player's OWN logged history on their champion and in this exact matchup.

Turn it into a tight, actionable pre-game read. Rules:
- Ground everything in the brief. When you reference the player's tendencies, use the real numbers and the "does well / should focus" notes provided — never invent stats.
- headline: one sentence naming what this game is really about for the player.
- winCondition: your TEAM's single clearest path to winning, given both comps.
- gamePlan: phase-by-phase. For lane modes use "Early game", "Mid game", "Late game"; for ARAM/Arena use phases that fit (e.g. "Opening", "Mid", "Late"). Each advice line concrete and specific to these champions.
- matchupPlan: a deep read of the player's lane (or their role in the fight, for laneless modes) vs the enemy, explicitly tying advice to what THIS player does well and needs to focus on. This is the most valuable section — make it personal.
- keyThreats: the enemy champions or patterns to respect most, most dangerous first, each with the specific threat (ability, spike, engage).
- buildNote: nuanced itemization reasoning that goes beyond the rules-based item list — timing, what to rush vs delay, and why, given the comp.
- Be specific and confident. No hedging, no preamble, no restating the brief.`;

async function callClaude(brief: string): Promise<Omit<LiveDeepRead, "available">> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 3000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: DEEP_JSON_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Here is the pre-game brief. Give me the deep read.\n\n${brief}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("no text output");
  const parsed = DeepSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("deep read failed validation");
  return parsed.data;
}

export async function buildDeepRead(companion: LiveCompanionResponse): Promise<LiveDeepRead> {
  if (!companion.inGame || !companion.mine) {
    return { available: false, reason: "Waiting for a champ select or game." };
  }
  if (!hasAnthropic()) {
    return { available: false, reason: "Add an ANTHROPIC_API_KEY to the server .env to enable the deep read." };
  }
  const key = signature(companion);
  const hit = cache.get(key);
  if (hit) return hit;

  // Resolve DDragon ids → display names for a readable brief ("MonkeyKing" → "Wukong").
  const byId = new Map<string, string>();
  try {
    const { champions } = await getChampions();
    for (const ch of champions) byId.set(ch.id.toLowerCase(), ch.name);
  } catch { /* fall back to raw ids */ }
  const nameOf = (id: string) => byId.get(id.toLowerCase()) ?? id;

  try {
    const core = await callClaude(renderBrief(companion, nameOf));
    const read: LiveDeepRead = { available: true, generatedAt: new Date().toISOString(), ...core };
    cache.set(key, read);
    return read;
  } catch (e) {
    console.warn("Live deep read failed:", (e as Error).message);
    return { available: false, reason: "The deep read couldn't be generated right now — try again." };
  }
}
