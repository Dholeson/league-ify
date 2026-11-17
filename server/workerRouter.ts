// A tiny router that implements RouteApp for the Cloudflare Worker.
//
// Express does path matching + req/res for the Node server. The Worker has
// neither, so this provides just enough: register routes (collected by
// registerRoutes), then dispatch a method + path to the matching handler,
// giving it a req/res shaped exactly like the slice of Express the handlers use.

import type { Handler, ReqLike, ResLike, RouteApp } from "./http.ts";

type Segment = { literal: string } | { param: string };

interface Route {
  method: string;
  segments: Segment[];
  handler: Handler;
}

function parsePath(path: string): Segment[] {
  return splitPath(path).map((s) =>
    s.startsWith(":") ? { param: s.slice(1) } : { literal: s }
  );
}

function splitPath(path: string): string[] {
  const clean = path.split("?")[0].replace(/^\/+|\/+$/g, "");
  return clean === "" ? [] : clean.split("/");
}

// Match a route's segments against the request's path parts. Returns the
// captured params, or null if it doesn't match. Params are URL-decoded, matching
// Express's behaviour (so handlers that decode again keep behaving identically).
function match(segments: Segment[], parts: string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if ("literal" in seg) {
      if (seg.literal !== parts[i]) return null;
    } else {
      try {
        params[seg.param] = decodeURIComponent(parts[i]);
      } catch {
        params[seg.param] = parts[i];
      }
    }
  }
  return params;
}

export interface DispatchResult {
  status: number;
  body: unknown;
}

export interface Router {
  app: RouteApp;
  dispatch(
    method: string,
    path: string,
    query: Record<string, string | undefined>,
    body: any,
    getHeader: (name: string) => string | undefined
  ): Promise<DispatchResult>;
}

export function createRouter(): Router {
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler) =>
    routes.push({ method, segments: parsePath(path), handler });

  const app: RouteApp = {
    get: (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    put: (p, h) => add("PUT", p, h),
    patch: (p, h) => add("PATCH", p, h),
    delete: (p, h) => add("DELETE", p, h),
  };

  async function dispatch(
    method: string,
    path: string,
    query: Record<string, string | undefined>,
    body: any,
    getHeader: (name: string) => string | undefined
  ): Promise<DispatchResult> {
    const parts = splitPath(path);
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = match(route.segments, parts);
      if (!params) continue;

      let status = 200;
      let jsonBody: unknown = null;
      const res: ResLike = {
        status(code: number) {
          status = code;
          return res;
        },
        json(value: unknown) {
          jsonBody = value;
          return res;
        },
      };
      const req: ReqLike = {
        params,
        query,
        body,
        path,
        header: (name) => getHeader(name.toLowerCase()),
      };

      await route.handler(req, res);
      return { status, body: jsonBody };
    }
    return { status: 404, body: { error: "Not found" } };
  }

  return { app, dispatch };
}
