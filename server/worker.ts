// Cloudflare Pages Function entry for league-ify's API.
//
// Deployed into the dhole.dev site as functions/api/league-ify/[[path]].js (a
// single esbuild bundle — see scripts/build-worker.mjs). Every request to
// /api/league-ify/* lands here.
//
// The lifecycle mirrors what server/storage/contract.ts describes: point the
// store at D1, load the documents this request needs, run the same handler the
// Node server runs, then persist what changed.
//
//   1. copy the operator's static config (Riot key, identity) into process.env,
//      which riot.ts / coach.ts read;
//   2. install the D1 adapter and reset store.ts's in-memory caches, because a
//      Worker isolate is reused across requests and those caches would otherwise
//      leak one request's data into the next;
//   3. hydrate meta/profile, decide which database (live/demo) + profile the
//      request touches, hydrate those;
//   4. dispatch under the request's active-profile context;
//   5. flush staged writes back to D1.

import { registerRoutes } from "./routes.ts";
import { createRouter } from "./workerRouter.ts";
import { profileContextFor } from "./http.ts";
import { runWithProfile } from "./activeProfile.ts";
import { docs, useD1, resolveKeys } from "./storage/index.ts";
import { store, resetStoreCaches } from "./store.ts";
import type { D1Database } from "./storage/d1Store.ts";

// The router is built once per isolate; handlers are stateless (all state lives
// in the per-request store caches, reset below).
const { app, dispatch } = createRouter();
registerRoutes(app);

export interface Env {
  DB: D1Database;
  RIOT_API_KEY?: string;
  RIOT_GAME_NAME?: string;
  RIOT_TAG_LINE?: string;
  RIOT_PLATFORM?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

// Operator-static config — identical for every request, so copying it onto the
// shared process.env is safe even with concurrent requests in one isolate.
const CONFIG_KEYS = [
  "RIOT_API_KEY",
  "RIOT_GAME_NAME",
  "RIOT_TAG_LINE",
  "RIOT_PLATFORM",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

interface PagesContext {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, env, params } = context;

  // 1. operator config -> process.env
  for (const k of CONFIG_KEYS) {
    const v = env[k];
    if (v != null) (process.env as Record<string, string>)[k] = v;
  }

  // 2. per-request store setup
  useD1(env.DB);
  resetStoreCaches();

  // 3. logical path: /api/league-ify/dashboard -> /api/dashboard
  const rest = Array.isArray(params.path) ? params.path.join("/") : params.path ?? "";
  const logicalPath = "/api/" + rest;

  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (!(key in query)) query[key] = value;
  });

  const method = request.method.toUpperCase();
  let body: any = undefined;
  if (method !== "GET" && method !== "HEAD") {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
  }

  const getHeader = (name: string) => request.headers.get(name) ?? undefined;

  try {
    // 3b. hydrate the small always-on docs, then the ones this request needs.
    await docs().hydrate(["meta", "profile"]);
    const demoMode = store.demoState().enabled;
    const ctx = profileContextFor(logicalPath, getHeader);
    const keys = resolveKeys({
      demoMode,
      activeProfileKey: ctx.key,
      isSelf: ctx.isSelf,
    });
    await docs().hydrate(keys);

    // 4. dispatch under the active-profile context
    const result = await runWithProfile(ctx, () =>
      dispatch(method, logicalPath, query, body, getHeader)
    );

    // 5. persist staged writes (only on success — a thrown handler discards)
    await docs().flush();

    return jsonResponse(result.body, result.status);
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 500);
  }
};
