// Transport-agnostic HTTP surface shared by the Node (Express) server and the
// Cloudflare Pages Function.
//
// WHY THIS EXISTS
//
// The 54 route handlers in routes.ts use only a thin slice of Express: they read
// req.params / req.query / req.body / req.header(), and reply with res.json() or
// res.status(n).json(). Express satisfies this interface directly; the Worker
// supplies its own tiny implementation (workerRouter.ts). So the same
// registerRoutes() runs unchanged on both runtimes, and no handler body had to
// be rewritten for the port.

import type { ActiveProfile } from "./activeProfile.ts";
import { SELF_PROFILE, parseProfileHeader, seasonCutoffMs } from "./activeProfile.ts";

export interface ReqLike {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: any;
  path: string;
  header(name: string): string | undefined;
}

export interface ResLike {
  status(code: number): ResLike;
  json(body: unknown): ResLike | void;
}

// Handlers may `return res.status(n).json(x)` (a common Express idiom), so the
// return type allows ResLike as well as void. The router ignores the value.
export type Handler = (
  req: ReqLike,
  res: ResLike
) => void | ResLike | Promise<void | ResLike>;

export interface RouteApp {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  put(path: string, handler: Handler): void;
  patch(path: string, handler: Handler): void;
  delete(path: string, handler: Handler): void;
}

// Endpoints that are always about the operator themselves, so they ignore the
// x-profile header (identity, favorites, settings, demo). Kept here so the
// Express middleware and the Worker agree on exactly one list.
export const SELF_ONLY = [
  "/api/me",
  "/api/favorites",
  "/api/config",
  "/api/demo",
  "/api/profile",
  "/api/identities",
  "/api/goal-templates",
];

// Build the request-scoped active-profile context from the path and headers —
// the same logic the old Express middleware did inline, now shared with the
// Worker. `getHeader` returns a header value or undefined.
export function profileContextFor(
  path: string,
  getHeader: (name: string) => string | undefined
): ActiveProfile {
  const selfOnly = SELF_ONLY.some((p) => path === p || path.startsWith(p + "/"));
  const base = selfOnly ? SELF_PROFILE : parseProfileHeader(getHeader("x-profile") || undefined);
  // Season view scope: default to the season window; "all" opens full history.
  const span = getHeader("x-span");
  return { ...base, spanCutoff: span === "all" ? null : seasonCutoffMs() };
}
