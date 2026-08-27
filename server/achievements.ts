import type { EnrichedMatch, Achievement, AchievementsResponse, Match } from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll } from "./engine/enrich.ts";

// ---------------------------------------------------------------------------
// ACHIEVEMENTS
//
// Account-level, tiered milestones computed from the whole career — the "fun
// records" layer (DPM.LOL / Riot Challenges class). Each is a cumulative total
// or a single-game record with ascending tiers; the page sorts by progress and
// dims the ones you haven't started.
// ---------------------------------------------------------------------------

const TIER_NAMES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];

// Exponential ramp so nothing→Bronze is easy and Platinum→Diamond is a real
// grind (roughly ×5, ×3, ×2.7, ×2.5 between tiers).
const ramp = (base: number, round = true): number[] => {
  const raw = [base, base * 5, base * 15, base * 40, base * 100];
  return round ? raw.map((n) => (n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n))) : raw;
};

interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  unit: string;
  tiers: number[];
  // Reduce the career to this achievement's current value.
  value: (ms: EnrichedMatch[]) => number;
}

const kda = (m: EnrichedMatch) => {
  const { kills, deaths, assists } = m.objective;
  return kills != null && deaths != null && assists != null ? (kills + assists) / Math.max(1, deaths) : 0;
};
const sum = (ms: EnrichedMatch[], pick: (m: EnrichedMatch) => number | null | undefined) =>
  ms.reduce((a, m) => a + (pick(m) ?? 0), 0);
const count = (ms: EnrichedMatch[], pred: (m: EnrichedMatch) => boolean) => ms.filter(pred).length;
const max = (ms: EnrichedMatch[], pick: (m: EnrichedMatch) => number) =>
  ms.reduce((a, m) => Math.max(a, pick(m)), 0);

function longestWinStreak(ms: EnrichedMatch[]): number {
  let best = 0, cur = 0;
  for (const m of ms) {
    if (m.objective.win === true) { cur++; best = Math.max(best, cur); }
    else if (m.objective.win === false) cur = 0;
  }
  return best;
}

const DEFS: AchievementDef[] = [
  // --- Consistency / volume ---
  { id: "games_played", name: "The Grind", description: "Play ranked and normal games — they all count.", category: "Dedication", icon: "ti-swords", unit: "games", tiers: ramp(10), value: (ms) => ms.length },
  { id: "wins", name: "Winner", description: "Win games. Simple as that.", category: "Dedication", icon: "ti-trophy", unit: "wins", tiers: ramp(8), value: (ms) => count(ms, (m) => m.objective.win === true) },
  { id: "win_streak", name: "On Fire", description: "Win multiple games in a row.", category: "Dedication", icon: "ti-flame", unit: "in a row", tiers: [3, 5, 8, 12, 20], value: longestWinStreak },
  { id: "positive_games", name: "In the Green", description: "Finish games with more takedowns than deaths.", category: "Dedication", icon: "ti-arrow-up-right", unit: "games", tiers: ramp(10), value: (ms) => count(ms, (m) => { const o = m.objective; return o.kills != null && o.deaths != null && o.assists != null && o.kills + o.assists > o.deaths; }) },

  // --- Combat ---
  { id: "total_kills", name: "Bloodthirsty", description: "Rack up champion kills across your career.", category: "Combat", icon: "ti-sword", unit: "kills", tiers: ramp(100), value: (ms) => sum(ms, (m) => m.objective.kills) },
  { id: "total_assists", name: "Team Player", description: "Get in on your team's kills.", category: "Combat", icon: "ti-users-group", unit: "assists", tiers: ramp(120), value: (ms) => sum(ms, (m) => m.objective.assists) },
  { id: "carry_games", name: "Hard Carry", description: "Take games over — 60%+ KP and a 3+ KDA.", category: "Combat", icon: "ti-hand-finger", unit: "games", tiers: ramp(3), value: (ms) => count(ms, (m) => (m.objective.killParticipation ?? 0) >= 0.6 && kda(m) >= 3) },
  { id: "high_kda_games", name: "Untouchable", description: "Finish games with a 5.0+ KDA.", category: "Combat", icon: "ti-shield-check", unit: "games", tiers: ramp(2), value: (ms) => count(ms, (m) => kda(m) >= 5) },
  { id: "most_kills_game", name: "Killing Spree", description: "Most kills in a single game.", category: "Combat", icon: "ti-target", unit: "kills", tiers: [10, 16, 22, 28, 40], value: (ms) => max(ms, (m) => m.objective.kills ?? 0) },
  { id: "total_damage", name: "Damage Dealer", description: "Pile up damage to champions.", category: "Combat", icon: "ti-bolt", unit: "dmg", tiers: ramp(150000), value: (ms) => sum(ms, (m) => m.objective.damageToChampions) },

  // --- Farming ---
  { id: "total_cs", name: "Minion Slayer", description: "Last-hit minions and monsters.", category: "Farming", icon: "ti-coins", unit: "CS", tiers: ramp(1500), value: (ms) => sum(ms, (m) => m.objective.totalCs) },
  { id: "cs10_games", name: "Wave Manager", description: "Hit 80+ CS by 10 minutes.", category: "Farming", icon: "ti-plant-2", unit: "games", tiers: ramp(2), value: (ms) => count(ms, (m) => (m.objective.csAt10 ?? 0) >= 80) },

  // --- Objectives ---
  { id: "total_dragons", name: "Dragon Tamer", description: "Help your team stack dragons.", category: "Objectives", icon: "ti-flame", unit: "dragons", tiers: ramp(10), value: (ms) => sum(ms, (m) => m.objective.dragons) },
  { id: "total_barons", name: "Baron Nasher", description: "Help your team take barons.", category: "Objectives", icon: "ti-skull", unit: "barons", tiers: ramp(5), value: (ms) => sum(ms, (m) => m.objective.barons) },
  { id: "total_towers", name: "Siege Engine", description: "Bring down enemy turrets.", category: "Objectives", icon: "ti-tower", unit: "towers", tiers: ramp(10), value: (ms) => sum(ms, (m) => m.objective.towers) },

  // --- Vision & survival ---
  { id: "total_vision", name: "All-Seeing", description: "Rack up vision score across games.", category: "Vision", icon: "ti-eye", unit: "vision", tiers: ramp(500), value: (ms) => Math.round(sum(ms, (m) => m.objective.visionScore)) },
  { id: "deathless_openings", name: "Flawless Start", description: "Take zero deaths before 15 minutes.", category: "Survival", icon: "ti-shield-half", unit: "games", tiers: ramp(2), value: (ms) => count(ms, (m) => m.objective.deathsBefore15 === 0) },
  { id: "comeback_wins", name: "Never Say Die", description: "Win games you were losing at 15 (down 1000+ gold).", category: "Survival", icon: "ti-heart-bolt", unit: "wins", tiers: ramp(1), value: (ms) => count(ms, (m) => m.objective.win === true && (m.objective.goldDiffAt15 ?? 0) <= -1000) },

  // --- Process / variety ---
  { id: "clean_games", name: "Textbook", description: "Post a 90+ performance score in a game.", category: "Mastery", icon: "ti-sparkles", unit: "games", tiers: ramp(1), value: (ms) => count(ms, (m) => m.process.score >= 90) },
  { id: "best_process", name: "Perfect Game", description: "Your single best performance score.", category: "Mastery", icon: "ti-award", unit: "score", tiers: [70, 80, 90, 95, 100], value: (ms) => max(ms, (m) => m.process.score) },
  { id: "unique_champs", name: "Jack of All Champs", description: "Play different champions.", category: "Mastery", icon: "ti-layout-grid", unit: "champs", tiers: [5, 15, 30, 60, 100], value: (ms) => new Set(ms.map((m) => m.objective.champion).filter(Boolean)).size },
  { id: "roles_played", name: "Fill Diff", description: "Play every position on the map.", category: "Mastery", icon: "ti-map-pin", unit: "roles", tiers: [2, 3, 4, 5], value: (ms) => new Set(ms.map((m) => m.objective.role).filter((r) => r && r !== "UNKNOWN")).size },
];

function evaluate(def: AchievementDef, value: number): Achievement {
  let tier = 0;
  for (const t of def.tiers) if (value >= t) tier++;
  const nextTarget = tier < def.tiers.length ? def.tiers[tier] : null;
  const prev = tier > 0 ? def.tiers[tier - 1] : 0;
  const pct = nextTarget == null ? 100 : Math.max(0, Math.min(100, Math.round(((value - prev) / (nextTarget - prev)) * 100)));
  // Each cleared tier is worth more than the last (tier 1 = 100, tier 2 = +200…).
  let xp = 0;
  for (let i = 1; i <= tier; i++) xp += i * 100;
  const nextTierXp = nextTarget == null ? 0 : (tier + 1) * 100;
  return {
    id: def.id, name: def.name, description: def.description, category: def.category,
    icon: def.icon, unit: def.unit, value: Math.round(value), tiers: def.tiers,
    tierNames: def.tiers.map((_, i) => TIER_NAMES[i] ?? `Tier ${i + 1}`),
    tier, nextTarget, pct, started: value > 0, xp, nextTierXp,
  };
}

export function buildAchievements(matches?: Match[]): AchievementsResponse {
  const pool = store.activePool();
  // Notifications pass all-time matches so the diff is view-independent; the
  // page passes nothing and gets the current season span.
  const career = enrichAll(matches ?? store.matches(), store.seasons(), pool);

  const achievements = DEFS.map((d) => evaluate(d, d.value(career)))
    // Sort by overall progress: cleared tiers first, then progress to next, then
    // value. Not-started ones sink to the bottom.
    .sort((a, b) => {
      const ap = a.tier + (a.nextTarget == null ? 1 : a.pct / 100);
      const bp = b.tier + (b.nextTarget == null ? 1 : b.pct / 100);
      if (Number(b.started) !== Number(a.started)) return Number(b.started) - Number(a.started);
      return bp - ap;
    });

  // XP: each cleared tier is worth more than the last (tier 1 = 100, tier 2 =
  // +200, …), so deep progress on one achievement counts. Levels ramp like a
  // Warframe mastery rank — each takes progressively more XP.
  const xp = achievements.reduce((acc, a) => acc + a.xp, 0);
  // cumulative XP to reach level L = 1500 * L(L+1)/2
  const cumForLevel = (L: number) => 1500 * (L * (L + 1)) / 2;
  let level = 0;
  while (cumForLevel(level + 1) <= xp) level++;
  const base = cumForLevel(level);
  const next = cumForLevel(level + 1);
  const xpIntoLevel = xp - base;
  const xpForNext = next - base;

  return {
    found: career.length > 0,
    total: achievements.length,
    unlocked: achievements.filter((a) => a.tier >= 1).length,
    maxed: achievements.filter((a) => a.nextTarget == null).length,
    categories: [...new Set(DEFS.map((d) => d.category))],
    achievements,
    level,
    xp,
    xpIntoLevel,
    xpForNext,
    levelPct: xpForNext ? Math.round((xpIntoLevel / xpForNext) * 100) : 0,
  };
}
