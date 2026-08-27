import type { BlockType, ProposedGoal, BlockPlanProposal } from "../shared/types.ts";
import { IDENTITIES } from "./engine/identities.ts";
import { store } from "./store.ts";
import { enrichAll } from "./engine/enrich.ts";
import {
  getTemplate,
  computeBaselines,
  personalizedTarget,
  baselineKeyFor,
  WHAT_COUNTS,
} from "./engine/goals.ts";

// ---------------------------------------------------------------------------
// COACH BLOCK DRAFTING
//
// Turn a player's pitch — a champion and/or a focus area — into a ready block.
// Goals are chosen from a large candidate pool, ranked by where the player is
// actually weakest (from their own history), and every measurable target is set
// relative to their current baseline. So "improve vision" becomes "1.0 vis/min
// (you're at 0.75)", not a generic number.
// ---------------------------------------------------------------------------

export interface BlockPitch {
  champion?: string | null;
  focus?: string | null;
  blockType?: BlockType;
}

export const FOCUS_AREAS: { key: string; label: string; icon: string }[] = [
  { key: "carry", label: "Carrying / impact", icon: "ti-swords" },
  { key: "survival", label: "Dying less", icon: "ti-shield-half" },
  { key: "farm", label: "Farming", icon: "ti-coins" },
  { key: "objectives", label: "Objectives", icon: "ti-topology-star-3" },
  { key: "vision", label: "Vision", icon: "ti-eye" },
  { key: "general", label: "Just consistency", icon: "ti-progress-check" },
];

const idFor = (want: string) => IDENTITIES.find((i) => i.id === want)?.id ?? IDENTITIES[0].id;

// A broad candidate pool per focus — the ranker trims it to the player's leaks.
const CANDIDATES: Record<string, string[]> = {
  champion: ["champion_focus", "positive_games", "carry_games", "clean_lane_games", "disciplined_games", "cs10", "kill_participation", "champion_winrate"],
  carry: ["carry_games", "positive_games", "kill_participation", "solo_kills", "gold_diff_15", "disciplined_games"],
  survival: ["clean_lane_games", "disciplined_games", "deaths_before_15", "deaths_per_game", "deathless_openings", "positive_games"],
  farm: ["cs10", "cs_per_min", "clean_lane_games", "gold_diff_15", "positive_games", "disciplined_games"],
  objectives: ["objective_games", "objectives", "vision_per_min", "kill_participation", "positive_games", "disciplined_games"],
  vision: ["vision_per_min", "objective_games", "disciplined_games", "clean_lane_games", "positive_games", "kill_participation"],
  general: ["positive_games", "disciplined_games", "win_count", "clean_lane_games", "avg_process", "carry_games"],
};

const ACHIEVEMENTS = new Set([
  "positive_games", "carry_games", "clean_lane_games", "deathless_openings",
  "disciplined_games", "comeback_wins", "objective_games", "win_count",
]);

// ARAM has no lanes, no jungle, no neutral objectives, no wards, and constant
// 5v5 fights — so lane/farm/vision/solo-kill goals are nonsense there. Draft ARAM
// blocks from a pool built around teamfight output, damage share, and discipline.
const ARAM_CANDIDATES: Record<string, string[]> = {
  champion: ["champion_focus", "positive_games", "carry_games", "damage_share", "kill_participation", "champion_winrate"],
  carry: ["carry_games", "positive_games", "damage_share", "kill_participation", "disciplined_games"],
  survival: ["disciplined_games", "deaths_per_game", "positive_games", "carry_games"],
  farm: ["cs_per_min", "positive_games", "disciplined_games", "carry_games"],
  objectives: ["kill_participation", "carry_games", "positive_games", "damage_share"],
  vision: ["disciplined_games", "positive_games", "kill_participation", "carry_games"],
  general: ["positive_games", "disciplined_games", "win_count", "carry_games", "avg_process", "damage_share"],
};

// "Good enough" reference values — used to score how far a baseline is from fine.
const REF: Record<string, number> = {
  cs10: 75, cs_per_min: 7, deaths: 4, deaths_before_15: 1.5, kill_participation: 60,
  solo_kills: 1.5, gold_diff_15: 300, objectives: 5, vision_per_min: 1.2, avg_process: 65,
  damage_share: 25,
};

function needScore(templateId: string, baselines: Record<string, number | null>): number {
  const key = baselineKeyFor(templateId);
  if (!key) return ACHIEVEMENTS.has(templateId) ? 0.6 : 0.55;
  const b = baselines[key];
  if (b == null) return 0.5;
  const ref = REF[key];
  if (ref == null) return 0.5;
  const tpl = getTemplate(templateId)!;
  const gap = tpl.direction === "higher" ? (ref - b) / ref : (b - ref) / Math.max(1, ref);
  return Math.max(0.05, Math.min(1, gap + 0.15));
}

function buildProposed(
  templateId: string,
  champ: string | null,
  baselines: Record<string, number | null>
): ProposedGoal | null {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;
  const key = baselineKeyFor(templateId);
  const baseline = key ? baselines[key] ?? null : null;
  let target = tpl.defaultTarget;
  if (key && baseline != null) target = personalizedTarget(key, baseline);
  const champion = tpl.needsChampion ? champ : null;
  return {
    templateId,
    title: tpl.title(champion),
    description: tpl.describe(target, champion),
    whatCounts: WHAT_COUNTS[templateId] ?? null,
    category: tpl.category,
    unit: tpl.unit,
    direction: tpl.direction,
    target,
    baseline,
    champion,
  };
}

const META: Record<string, { name: (c: string | null) => string; theme: string; goal: string; identity: string; games: number }> = {
  champion: { name: (c) => `${c ?? "Champion"} mastery block`, theme: "Stack reps and turn them into clean, winning games.", goal: "Get consistent and dangerous on this pick.", identity: "lane_bully", games: 20 },
  carry: { name: () => "Carry harder block", theme: "Stop hoping the team carries — take games over yourself.", goal: "Turn good games into carried games.", identity: "lane_bully", games: 24 },
  survival: { name: () => "Stop dying block", theme: "Respect the map. Stay alive long enough to matter.", goal: "Cut the throws — fewer deaths, cleaner starts.", identity: "stonewall", games: 24 },
  farm: { name: () => "Farm floor block", theme: "Gold you can manufacture yourself, every game.", goal: "Build a repeatable farming floor.", identity: "lane_bully", games: 24 },
  objectives: { name: () => "Objective control block", theme: "Win the map, not just the lane.", goal: "Play around drakes, heralds, and barons on purpose.", identity: "shotcaller_monk", games: 24 },
  vision: { name: () => "Light up the map block", theme: "You can't make good calls in the dark.", goal: "Pay the vision tax and make cleaner decisions.", identity: "shotcaller_monk", games: 24 },
  general: { name: () => "Consistency block", theme: "String together clean, disciplined games.", goal: "Raise your floor — fewer throws, more positive games.", identity: "stonewall", games: 25 },
};

const fmtBaseline = (key: string, b: number) =>
  key === "kill_participation" ? `${Math.round(b)}%` : `${b}`;

export function generateBlockPlan(pitch: BlockPitch): BlockPlanProposal {
  const champ = pitch.champion?.trim() || null;
  const blockType: BlockType = pitch.blockType ?? "ranked";
  const aram = blockType === "aram";
  const area = pitch.focus || (champ ? "champion" : "general");

  const pool = store.activePool();
  const career = enrichAll(store.matches(), store.seasons(), pool);
  const champCareer = champ
    ? career.filter((m) => m.objective.champion?.toLowerCase() === champ.toLowerCase())
    : career;
  // If we have enough games on the champion, personalize to THAT champion.
  const baselines = computeBaselines(champ && champCareer.length >= 4 ? champCareer : career);

  const pool_ = aram ? ARAM_CANDIDATES : CANDIDATES;
  let candidates = [...(pool_[area] ?? pool_.general)];
  if (champ && area !== "champion") candidates = ["champion_focus", ...candidates];
  candidates = [...new Set(candidates)];

  // Always surface the focus's own measurable metric (so there's a personalized
  // baseline→target meter) and champion_focus for champion blocks; then fill the
  // rest by where the player is weakest.
  const pinnedSet = new Set<string>();
  if (candidates.includes("champion_focus")) pinnedSet.add("champion_focus");
  const baselineLead = candidates.find((id) => baselineKeyFor(id));
  if (baselineLead) pinnedSet.add(baselineLead);
  const ranked = candidates
    .filter((id) => !pinnedSet.has(id))
    .map((id) => ({ id, n: needScore(id, baselines) }))
    .sort((a, b) => b.n - a.n)
    .map((r) => r.id);
  let picks = [...pinnedSet, ...ranked].slice(0, 4);
  if (!picks.some((id) => ACHIEVEMENTS.has(id))) picks = [...picks.slice(0, 3), "positive_games"];

  const goals = picks
    .map((id) => buildProposed(id, champ, baselines))
    .filter((g): g is ProposedGoal => g !== null);

  const meta = META[area] ?? META.general;
  let name = meta.name(champ);
  if (champ && area !== "champion") name = `${champ}: ${meta.name(champ).toLowerCase()}`;
  if (aram && !/aram/i.test(name)) name = `ARAM ${name.charAt(0).toLowerCase()}${name.slice(1)}`;

  // Rationale — the coach's read, citing the actual baselines it aimed at.
  const cited = goals
    .map((g) => {
      const key = baselineKeyFor(g.templateId);
      if (key && g.baseline != null) return `${g.title.toLowerCase()} (you're at ${fmtBaseline(key, g.baseline)}, aiming ${g.target})`;
      return null;
    })
    .filter(Boolean)
    .slice(0, 2);
  const rationale = champ && champCareer.length >= 4
    ? `Read off your last ${champCareer.length} games on ${champ}. ${cited.length ? "Biggest gaps: " + cited.join("; ") + "." : "Focused on turning reps into wins."}`
    : cited.length
    ? `Aimed at your current leaks: ${cited.join("; ")}.`
    : "Built to raise your floor with mostly achievement goals you can't grind out.";

  return {
    name,
    theme: meta.theme,
    goal: meta.goal,
    rationale,
    blockType,
    targetGames: meta.games,
    focusChampion: champ,
    identityId: idFor(meta.identity),
    focus: area,
    goals,
  };
}
