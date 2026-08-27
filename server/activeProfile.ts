import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// ACTIVE PROFILE CONTEXT
//
// The app can view any Riot profile, and each profile keeps its OWN matches,
// blocks, and goals. We carry the "which profile is this request for" as a
// request-scoped context (set by middleware from the x-profile header), so the
// store resolves to the right per-profile data without threading a param
// through every function.
// ---------------------------------------------------------------------------

export interface ActiveProfile {
  isSelf: boolean;
  key: string | null; // filename-safe key for non-self profiles
  gameName: string | null;
  tagLine: string | null;
  platform: string | null;
  // Season view scope: games older than this epoch-ms are hidden from data
  // views (null = all-time). Set per-request from the x-span header.
  spanCutoff?: number | null;
}

// "Current season" window used for both the pull scope and the season view.
export const SEASON_WINDOW_DAYS = 150;
export const seasonCutoffMs = () => Date.now() - SEASON_WINDOW_DAYS * 86400000;

export const SELF_PROFILE: ActiveProfile = {
  isSelf: true,
  key: null,
  gameName: null,
  tagLine: null,
  platform: null,
};

const als = new AsyncLocalStorage<ActiveProfile>();

export function runWithProfile<T>(p: ActiveProfile, fn: () => T): T {
  return als.run(p, fn);
}

export function activeProfile(): ActiveProfile {
  return als.getStore() ?? SELF_PROFILE;
}

export function fileKey(gameName: string, tagLine: string, platform: string): string {
  return `${gameName}-${tagLine}-${platform}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

// Header format: encodeURIComponent(gameName) | tagLine | platform
export function parseProfileHeader(header?: string): ActiveProfile {
  if (!header) return SELF_PROFILE;
  const parts = header.split("|");
  if (parts.length < 3) return SELF_PROFILE;
  try {
    const gameName = decodeURIComponent(parts[0]).trim();
    const tagLine = decodeURIComponent(parts[1]).trim();
    const platform = decodeURIComponent(parts[2]).trim();
    if (!gameName || !tagLine || !platform) return SELF_PROFILE;
    return { isSelf: false, key: fileKey(gameName, tagLine, platform), gameName, tagLine, platform };
  } catch {
    return SELF_PROFILE;
  }
}
