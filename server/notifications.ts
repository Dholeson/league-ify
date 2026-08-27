import type { NotificationItem, NotificationsResponse } from "../shared/types.ts";
import { store } from "./store.ts";
import { buildAchievements } from "./achievements.ts";
import { enrichAll } from "./engine/enrich.ts";
import { evaluateGoal } from "./engine/goals.ts";

// ---------------------------------------------------------------------------
// NOTIFICATIONS
//
// The "you did a thing" layer. After games read in, we diff the current career
// state against the last-seen snapshot and emit a notification for each new
// win: an achievement tier-up, a profile level-up, or a goal completion. The
// first run just baselines (so we don't dump every already-earned milestone).
// ---------------------------------------------------------------------------

const TIER_COLOR = ["#a9713f", "#9aa0a6", "#d6a24e", "#6f93a3", "#9b8bd0"]; // bronze..diamond
const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();

function make(type: NotificationItem["type"], title: string, body: string, icon: string, accent?: string, link?: string): NotificationItem {
  return { id: uuid(), type, title, body, icon, accent, link, createdAt: now(), read: false };
}

// Compute the current achieved state, diff it against what we last saw, and
// return (and persist) any new notifications. Idempotent: repeated calls with
// no career change produce nothing. Always computed against ALL-TIME data
// (store.allMatches) so switching the season/all-time view never spams.
export function refreshNotifications(): NotificationItem[] {
  const allMatches = store.allMatches();
  const ach = buildAchievements(allMatches);
  if (!ach.found) return [];

  // Current state.
  const tiers: Record<string, number> = {};
  for (const a of ach.achievements) tiers[a.id] = a.tier;
  const level = ach.level;

  const pool = store.activePool();
  const career = enrichAll(allMatches, store.seasons(), pool);
  const metGoals = store
    .goals()
    .filter((g) => g.status !== "archived")
    .map((g) => ({ g, met: evaluateGoal(g, career).met }))
    .filter((x) => x.met)
    .map((x) => x.g.id);

  const seen = store.notifSeen();

  // First ever run: baseline silently so we don't notify for the whole backlog.
  if (!seen) {
    store.setNotifSeen({ tiers, goals: metGoals, level });
    return [];
  }

  const fresh: NotificationItem[] = [];

  // Achievement tier-ups (including first unlock: 0 -> 1).
  for (const a of ach.achievements) {
    const prev = seen.tiers[a.id] ?? 0;
    if (a.tier > prev) {
      const tierName = a.tierNames[a.tier - 1] ?? `Tier ${a.tier}`;
      const first = prev === 0;
      fresh.push(
        make(
          "achievement",
          first ? "Achievement unlocked" : "Achievement leveled up",
          `${a.name} — ${tierName}`,
          a.icon,
          TIER_COLOR[Math.min(a.tier - 1, TIER_COLOR.length - 1)],
          `/achievements?focus=${a.id}`
        )
      );
    }
  }

  // Profile level-up (one entry even if you jumped several).
  if (level > seen.level) {
    fresh.push(make("level", "Level up", `You reached Profile Level ${level}`, "ti-arrow-big-up-lines", "var(--gold)", "/achievements?focus=level"));
  }

  // Goal completions (id newly in the met set). A champion goal links to that
  // champion's goals section; a block goal links to the block it lives in.
  const seenGoals = new Set(seen.goals);
  const goalById = new Map(store.goals().map((g) => [g.id, g]));
  for (const id of metGoals) {
    if (!seenGoals.has(id)) {
      const g = goalById.get(id);
      if (g) {
        const link = g.champion
          ? `/champions/${encodeURIComponent(g.champion)}?focus=goals`
          : `/?focus=block`;
        fresh.push(make("goal", "Goal complete", g.title, "ti-target-arrow", "var(--green)", link));
      }
    }
  }

  store.setNotifSeen({ tiers, goals: metGoals, level });
  if (fresh.length) store.pushNotifications(fresh);
  return fresh;
}

export function getNotifications(): NotificationsResponse {
  // Refresh on read so accomplishments surface even without a manual sync.
  refreshNotifications();
  const items = store.notifications();
  return { items, unread: items.filter((n) => !n.read).length };
}
