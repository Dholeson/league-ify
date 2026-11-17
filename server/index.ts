// The Node (Express) API server — local development and the `npm run dev`
// workflow. It is now a thin adapter: Express provides JSON parsing, the
// per-request active-profile context, and transport; every route lives in
// routes.ts and runs unchanged on the Cloudflare Worker too (see worker.ts).

import "dotenv/config";
import express from "express";
import { registerRoutes } from "./routes.ts";
import type { RouteApp } from "./http.ts";
import { profileContextFor } from "./http.ts";
import { runWithProfile } from "./activeProfile.ts";
import { riotFromEnv } from "./riot.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Every request runs inside the active-profile context (from the x-profile
// header). The store then resolves to that profile's matches/blocks/goals.
app.use((req, _res, next) => {
  const ctx = profileContextFor(req.path, (name) => req.header(name) || undefined);
  runWithProfile(ctx, () => next());
});

// Express's Request/Response structurally provide the slice of req/res that the
// handlers use (params, query, body, header, path; json, status). The cast lets
// the shared, transport-agnostic routes register against the Express app.
registerRoutes(app as unknown as RouteApp);

// Dedicated API port. Intentionally NOT `PORT` — some launchers inject PORT for
// the web port, which would collide with Vite. Vite proxies /api here.
const PORT = Number(process.env.SERVER_PORT ?? 8787);

app.listen(PORT, () => {
  const riot = riotFromEnv();
  console.log(`\n  league-ify API server on http://localhost:${PORT}`);
  console.log(
    riot
      ? `  Riot API: configured (${process.env.RIOT_GAME_NAME}#${process.env.RIOT_TAG_LINE} / ${process.env.RIOT_PLATFORM})`
      : `  Riot API: not configured — copy .env.example to .env to enable auto-enrichment`
  );
  console.log(`  Web app: run "npm run dev" and open http://localhost:5173\n`);
});
