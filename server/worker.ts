// Cloudflare Pages Function entry for league-ify's API.
//
// Deployed into the dhole.dev site as functions/api/league-ify/[[path]].js (a
// single esbuild bundle — see scripts/build-worker.mjs). Every request to
// /api/league-ify/* lands here.
//
// Two request shapes:
//   /api/auth/*  — signup / login / logout / me. No session or tenant needed;
//                  talks to lu_users / lu_sessions directly (server/authRoutes).
//   everything else — requires a valid session. The lifecycle then mirrors
//                  server/storage/contract.ts: install the D1 adapter SCOPED TO
//                  THE USER (tenant "u/<id>"), reset store caches (the isolate
//                  is reused across requests), hydrate the docs this request
//                  needs, dispatch under the user + active-profile contexts,
//                  then flush.

import { registerRoutes } from "./routes.ts";
import { createRouter } from "./workerRouter.ts";
import { profileContextFor } from "./http.ts";
import { runWithProfile } from "./activeProfile.ts";
import { runWithUser } from "./userContext.ts";
import { docs, useD1, profileDocKey } from "./storage/index.ts";
import { resetStoreCaches } from "./store.ts";
import { readSessionCookie, requestIsSecure } from "./auth.ts";
import { signup, login, logout, resolveSession, type AuthResult } from "./authRoutes.ts";
import type { DocKey } from "./storage/contract.ts";
import type { D1Database } from "./storage/d1Store.ts";

const { app, dispatch } = createRouter();
registerRoutes(app);

export interface Env {
  DB: D1Database;
  RIOT_API_KEY?: string;
  RIOT_PLATFORM?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

// Shared server config (NOT per-user identity — that comes from the account).
const CONFIG_KEYS = ["RIOT_API_KEY", "RIOT_PLATFORM", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

interface PagesContext {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}

// Every response here is about one user's session or data, so nothing may be
// stored by the browser or any cache in between. This has to be set here: the
// site's _headers file (its "/api/* Cache-Control: no-store" rule) is not
// applied to Pages Function responses.
function apiHeaders(): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body ?? null), { status, headers: apiHeaders() });
}

function authResponse(result: AuthResult): Response {
  const headers = apiHeaders();
  if (result.setCookie) headers.append("Set-Cookie", result.setCookie);
  return new Response(JSON.stringify(result.body ?? null), { status: result.status, headers });
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, env, params } = context;

  for (const k of CONFIG_KEYS) {
    const v = env[k];
    if (v != null) (process.env as Record<string, string>)[k] = v;
  }

  // /api/league-ify/dashboard -> /api/dashboard ; /api/league-ify/auth/login -> /api/auth/login
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
  const secure = requestIsSecure(request);
  const ua = request.headers.get("user-agent");
  const sessionId = readSessionCookie(request);

  try {
    // --- account endpoints (no session/tenant required) ---
    if (logicalPath === "/api/auth/signup" && method === "POST") {
      return authResponse(await signup(env.DB, body, { ua, secure }));
    }
    if (logicalPath === "/api/auth/login" && method === "POST") {
      return authResponse(await login(env.DB, body, { ua, secure }));
    }
    if (logicalPath === "/api/auth/logout" && method === "POST") {
      return authResponse(await logout(env.DB, sessionId, { ua, secure }));
    }
    if (logicalPath === "/api/auth/me" && method === "GET") {
      const user = await resolveSession(env.DB, sessionId);
      return jsonResponse({ user }, 200);
    }

    // --- everything else is a signed-in, per-user data request ---
    const user = await resolveSession(env.DB, sessionId);
    if (!user) return jsonResponse({ error: "Not signed in." }, 401);

    useD1(env.DB, { tenant: `u/${user.userId}` });
    resetStoreCaches();

    const ctx = profileContextFor(logicalPath, getHeader);
    const keys: DocKey[] = ["meta", "profile", "live", "demo"];
    if (!ctx.isSelf && ctx.key) keys.push(profileDocKey(ctx.key));
    await docs().hydrate(keys);

    const result = await runWithUser(user, () =>
      runWithProfile(ctx, () => dispatch(method, logicalPath, query, body, getHeader))
    );

    await docs().flush();
    return jsonResponse(result.body, result.status);
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 500);
  }
};
