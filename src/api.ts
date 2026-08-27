import type {
  AppConfig,
  Identity,
  Season,
  Scorecard,
  ObjectiveData,
  EnrichedMatch,
  MatchScoreboard,
  MatchTimeline,
  MatchAnalysis,
  StatsResponse,
  AchievementsResponse,
  NotificationsResponse,
  ObjectivesResponse,
  DashboardResponse,
  ProgressResponse,
  Champion,
  ChampionDetail,
  Profile,
  Goal,
  Recommendation,
  NextGamePlan,
  ChampionMeta,
  BlockReview,
  BlockPlanProposal,
  BlockCardSummary,
  SummonerProfile,
  ProfileHeader,
  FavoriteProfile,
  LiveCompanionResponse,
  LiveDeepRead,
  LiveRecap,
} from "../shared/types.ts";

export interface GoalInput {
  templateId: string;
  target?: number;
  champion?: string | null;
  baseline?: number | null;
}

export interface GoalTemplateInfo {
  id: string;
  category: string;
  unit: string;
  direction: "higher" | "lower";
  defaultTarget: number;
  needsChampion: boolean;
  title: string;
  description: string;
}

export interface DemoState {
  enabled: boolean;
  available: boolean;
}

export interface SyncResult {
  added: number;
  perQueue: Record<string, number>;
  skipped: boolean;
  error: string | null;
  lastSyncAt: string | null;
  rateLimited?: boolean;
  upgraded?: number;
  remaining?: number;
}

// The profile you're viewing rides along on every request; the server resolves
// the store to that profile's matches/blocks/goals.
function activeProfileHeader(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const a = JSON.parse(localStorage.getItem("activeProfile") || "null");
    if (a && a.gameName && a.tagLine && a.platform) {
      headers["x-profile"] = `${encodeURIComponent(a.gameName)}|${encodeURIComponent(a.tagLine)}|${encodeURIComponent(a.platform)}`;
    }
  } catch {
    /* ignore */
  }
  // Season view scope: default "season"; "all" opens the full history.
  try {
    const f = JSON.parse(localStorage.getItem("globalFilter") || "null");
    headers["x-span"] = f && f.span === "all" ? "all" : "season";
  } catch {
    /* ignore */
  }
  return headers;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...activeProfileHeader(), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg =
      (body && (body.error?.formErrors?.[0] || body.error)) || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body as T;
}

export const api = {
  config: () => req<AppConfig>("/api/config"),
  identities: () => req<Identity[]>("/api/identities"),
  dashboard: (queue?: string, role?: string | null) => {
    const p = new URLSearchParams();
    if (queue && queue !== "all") p.set("queue", queue);
    if (role) p.set("role", role);
    const qs = p.toString();
    return req<DashboardResponse>(`/api/dashboard${qs ? `?${qs}` : ""}`);
  },
  progress: () => req<ProgressResponse>("/api/progress"),
  objectives: () => req<ObjectivesResponse>("/api/objectives"),
  live: (mock?: boolean, opponent?: string | null) => {
    const p = new URLSearchParams();
    if (mock) p.set("mock", "1");
    if (opponent) p.set("opponent", opponent);
    const qs = p.toString();
    return req<LiveCompanionResponse>(`/api/live${qs ? `?${qs}` : ""}`);
  },
  liveDeep: (mock?: boolean, opponent?: string | null) => {
    const p = new URLSearchParams();
    if (mock) p.set("mock", "1");
    if (opponent) p.set("opponent", opponent);
    const qs = p.toString();
    return req<LiveDeepRead>(`/api/live/deep${qs ? `?${qs}` : ""}`);
  },
  liveStatus: () => req<{ clientDetected: boolean; phase: string; inGame: boolean }>("/api/live/status"),
  liveRecap: () => req<LiveRecap>("/api/live/recap"),
  coachPlan: (queue?: string) =>
    req<{ plan: NextGamePlan; mode?: "llm" | "engine" }>(`/api/coach/plan${queue && queue !== "all" ? `?queue=${queue}` : ""}`),
  refreshCoachPlan: (queue?: string) =>
    req<{ plan: NextGamePlan }>(`/api/coach/plan/refresh${queue && queue !== "all" ? `?queue=${queue}` : ""}`, { method: "POST" }),
  setCoachMode: (mode: "llm" | "engine") =>
    req<{ mode: string }>("/api/coach/mode", { method: "POST", body: JSON.stringify({ mode }) }),
  sync: (force?: boolean) =>
    req<SyncResult>(`/api/sync${force ? "?force=1" : ""}`, { method: "POST" }),

  seasons: () => req<Season[]>("/api/seasons"),
  blockPlan: (body: { champion?: string | null; focus?: string | null; blockType?: string }) =>
    req<BlockPlanProposal>("/api/blocks/plan", { method: "POST", body: JSON.stringify(body) }),
  createSeason: (body: {
    name: string;
    theme?: string;
    goal?: string;
    identityId: string;
    targetGames?: number;
    blockType?: string;
    focusChampion?: string | null;
    goals?: GoalInput[];
  }) => req<Season>("/api/seasons", { method: "POST", body: JSON.stringify(body) }),
  activateSeason: (id: string) =>
    req<{ ok: true }>(`/api/seasons/${id}/activate`, { method: "POST" }),
  completeSeason: (id: string, retro: Record<string, string>) =>
    req<{ ok: true }>(`/api/seasons/${id}/complete`, {
      method: "POST",
      body: JSON.stringify(retro),
    }),

  recentRiot: () =>
    req<{ matches: { matchId: string; alreadyLogged: boolean }[] }>(
      "/api/riot/recent"
    ),

  logMatch: (body: {
    riotMatchId?: string;
    objective?: Partial<ObjectiveData>;
    scorecard: Scorecard;
    playedAt?: string;
  }) =>
    req<{ match: EnrichedMatch; warnings: string[] }>("/api/matches", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  matchList: () => req<{ matches: EnrichedMatch[] }>("/api/match-history"),
  matchDetail: (id: string) => req<EnrichedMatch>(`/api/matches/${encodeURIComponent(id)}`),
  matchScoreboard: (id: string) => req<MatchScoreboard>(`/api/matches/${encodeURIComponent(id)}/scoreboard`),
  matchTimeline: (id: string) => req<MatchTimeline>(`/api/matches/${encodeURIComponent(id)}/timeline`),
  matchAnalysis: (id: string) => req<MatchAnalysis>(`/api/matches/${encodeURIComponent(id)}/analysis`),
  deleteMatch: (id: string) =>
    req<{ ok: true }>(`/api/matches/${id}`, { method: "DELETE" }),

  champions: () => req<{ version: string; champions: Champion[] }>("/api/champions"),
  championDetail: (champion: string, role?: string | null) =>
    req<ChampionDetail>(`/api/champions/${encodeURIComponent(champion)}${role ? `?role=${encodeURIComponent(role)}` : ""}`),
  championMeta: (champion: string, role?: string) =>
    req<ChampionMeta>(
      `/api/champion-meta/${encodeURIComponent(champion)}${role ? `?role=${encodeURIComponent(role)}` : ""}`
    ),
  blockReview: (id: string) => req<BlockReview>(`/api/seasons/${id}/review`),
  blockSummaries: () => req<BlockCardSummary[]>("/api/blocks/summaries"),
  summoner: (game: string, tag: string, platform?: string) =>
    req<SummonerProfile>(
      `/api/summoner?game=${encodeURIComponent(game)}&tag=${encodeURIComponent(tag)}${
        platform ? `&platform=${encodeURIComponent(platform)}` : ""
      }`
    ),
  achievements: () => req<AchievementsResponse>("/api/achievements"),
  notifications: () => req<NotificationsResponse>("/api/notifications"),
  markNotificationsRead: () => req<{ ok: true }>("/api/notifications/read", { method: "POST" }),
  clearNotifications: () => req<{ ok: true }>("/api/notifications", { method: "DELETE" }),
  stats: (queue: string, role?: string | null) =>
    req<StatsResponse>(`/api/stats?queue=${encodeURIComponent(queue)}${role ? `&role=${encodeURIComponent(role)}` : ""}`),
  me: () => req<ProfileHeader>("/api/me"),
  favorites: () => req<FavoriteProfile[]>("/api/favorites"),
  addFavorite: (b: FavoriteProfile) =>
    req<FavoriteProfile[]>("/api/favorites", { method: "POST", body: JSON.stringify(b) }),
  removeFavorite: (game: string, tag: string) =>
    req<FavoriteProfile[]>(`/api/favorites?game=${encodeURIComponent(game)}&tag=${encodeURIComponent(tag)}`, { method: "DELETE" }),
  demoState: () => req<DemoState>("/api/demo"),
  enableDemo: () => req<DemoState>("/api/demo/enable", { method: "POST" }),
  disableDemo: () => req<DemoState>("/api/demo/disable", { method: "POST" }),
  resetDemo: () => req<DemoState>("/api/demo/reset", { method: "POST" }),

  profile: () => req<Profile>("/api/profile"),
  updateProfile: (body: Partial<Profile>) =>
    req<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(body) }),

  goalTemplates: () => req<GoalTemplateInfo[]>("/api/goal-templates"),
  recommendations: () => req<Recommendation>("/api/recommendations"),

  addGoal: (body: GoalInput & { seasonId?: string }) =>
    req<Goal & { createdBlock?: { name: string } | null }>("/api/goals", { method: "POST", body: JSON.stringify(body) }),
  deleteGoal: (id: string) =>
    req<{ ok: true }>(`/api/goals/${id}`, { method: "DELETE" }),
  claimRollingQuest: (familyKey: string) =>
    req<{ ok: true }>(`/api/rolling-quests/${encodeURIComponent(familyKey)}/claim`, {
      method: "POST",
    }),
};
