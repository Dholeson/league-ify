// The logged-in user for the current request.
//
// Multi-tenant league-ify has two independent request-scoped contexts:
//   activeProfile.ts  — WHICH Riot profile is being viewed (self vs a scouted
//                        summoner), orthogonal to who is logged in.
//   userContext.ts    — WHO is logged in (this file): their account + the Riot
//                        identity their "self" views resolve to.
//
// The Worker sets this from the session (server/worker.ts). The Node dev server
// never sets it, so currentUser() is null there and identity falls back to the
// RIOT_* env vars — i.e. `npm run dev` stays single-user and unchanged.

import { AsyncLocalStorage } from "node:async_hooks";

export interface CurrentUser {
  userId: number;
  email: string;
  displayName: string;
  gameName: string | null;
  tagLine: string | null;
  platform: string | null;
}

const als = new AsyncLocalStorage<CurrentUser>();

export function runWithUser<T>(user: CurrentUser, fn: () => T): T {
  return als.run(user, fn);
}

export function currentUser(): CurrentUser | null {
  return als.getStore() ?? null;
}

/**
 * The Riot identity that "self" views use: the logged-in user's linked Riot ID,
 * or the RIOT_* env vars when no user is in context (Node dev). The Riot API KEY
 * is never here — it is always the shared server secret (process.env.RIOT_API_KEY).
 */
export function selfIdentity(): { gameName: string | null; tagLine: string | null; platform: string } {
  const u = currentUser();
  return {
    gameName: u?.gameName ?? process.env.RIOT_GAME_NAME ?? null,
    tagLine: u?.tagLine ?? process.env.RIOT_TAG_LINE ?? null,
    platform: u?.platform ?? process.env.RIOT_PLATFORM ?? "na1",
  };
}
