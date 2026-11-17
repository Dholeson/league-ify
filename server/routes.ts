// All 54 API routes, registered against a transport-agnostic RouteApp.
//
// This is a straight extraction of the route table that used to live inline in
// index.ts. The handler bodies are UNCHANGED — they still read req.params /
// req.query / req.body and reply with res.json() / res.status().json(). Express
// (server/index.ts) and the Cloudflare Worker (server/worker.ts) both call
// registerRoutes(); each supplies a RouteApp whose req/res match the slice of
// Express these handlers use. See http.ts.

import { z } from "zod";
import type {
  Season,
  Match,
  ObjectiveData,
  AppConfig,
  Role,
  ProfileHeader,
} from "../shared/types.ts";
import type { RouteApp } from "./http.ts";
import { store } from "./store.ts";
import { runWithProfile, activeProfile, SELF_PROFILE } from "./activeProfile.ts";
import { IDENTITIES } from "./engine/identities.ts";
import { enrichMatch, enrichAll } from "./engine/enrich.ts";
import { benchFor, rankLabel, matchComparison } from "./engine/benchmarks.ts";
import { buildChampionStats } from "./engine/championStats.ts";
import { buildDashboard } from "./dashboard.ts";
import { buildProgress } from "./progress.ts";
import { buildCoachPlan } from "./coach.ts";
import { syncRiot } from "./ingest.ts";
import { buildChampionDetail } from "./mastery.ts";
import { getChampionMeta } from "./championMeta.ts";
import { buildBlockReview, buildBlockSummaries } from "./blockReview.ts";
import { generateBlockPlan } from "./blockPlan.ts";
import { lookupSummoner } from "./summoner.ts";
import { riotFromEnv, riotForAccount, RiotError } from "./riot.ts";
import { getChampions, getVersion, getRuneIcon, getRuneName, getItemName } from "./ddragon.ts";
import { getMatchAnalysis } from "./matchAnalysis.ts";
import { buildStats } from "./stats.ts";
import { buildAchievements } from "./achievements.ts";
import { getNotifications } from "./notifications.ts";
import { buildLiveCompanion, liveStatus } from "./liveCompanion.ts";
import { buildDeepRead } from "./liveDeep.ts";
import { buildRecap } from "./liveRecap.ts";
import { TEMPLATES, goalFromTemplate } from "./engine/goals.ts";
import { recommend } from "./engine/recommend.ts";
import { evaluateGoal } from "./engine/goals.ts";

const uuid = () => globalThis.crypto.randomUUID();

// The Riot client for whoever's profile is being viewed (self = env account).
function riotForActive() {
  const ap = activeProfile();
  return ap.isSelf ? riotFromEnv() : riotForAccount(ap.gameName!, ap.tagLine!, ap.platform!);
}

// Friendly summoner-spell names for the build analysis prompt.
const SPELL_NAME: Record<number, string> = {
  1: "Cleanse", 3: "Exhaust", 4: "Flash", 6: "Ghost", 7: "Heal", 11: "Smite",
  12: "Teleport", 13: "Clarity", 14: "Ignite", 21: "Barrier", 32: "Mark/Dash", 39: "Mark/Dash",
};

// Region-style Riot ID tags (e.g. "KR1", "EUW") → platform routing value, so a
// search like "Hide on bush#KR1" resolves to Korea without a platform picker.
const TAG_PLATFORM: Record<string, string> = {
  KR: "kr", KR1: "kr", NA: "na1", NA1: "na1", EUW: "euw1", EUW1: "euw1",
  EUNE: "eun1", EUN1: "eun1", BR: "br1", BR1: "br1", JP: "jp1", JP1: "jp1",
  OCE: "oc1", OC1: "oc1", LAN: "la1", LAS: "la2", TR: "tr1", TR1: "tr1", RU: "ru",
};

const goalInputSchema = z.array(
  z.object({
    templateId: z.string(),
    target: z.number().optional(),
    champion: z.string().nullish(),
    baseline: z.number().nullish(),
  })
);

const seasonSchema = z.object({
  name: z.string().min(1),
  theme: z.string().default(""),
  goal: z.string().default(""),
  identityId: z.string(),
  targetGames: z.number().int().min(5).max(200).default(30),
  blockType: z.enum(["ranked", "normal", "aram", "any"]).default("any"),
  focusChampion: z.string().nullish(),
  goals: goalInputSchema.default([]),
});

const retroSchema = z.object({
  whatWorked: z.string().default(""),
  whatBroke: z.string().default(""),
  keepDoing: z.string().default(""),
  stopDoing: z.string().default(""),
  nextBlockFocus: z.string().default(""),
});

const scorecardSchema = z.object({
  grade: z.enum(["A", "B", "C", "D", "F"]),
  tiltBefore: z.number().min(0).max(5),
  tiltAfter: z.number().min(0).max(5),
  biggestMistake: z.string().default(""),
  firstDeathCause: z
    .enum([
      "laning_mistake",
      "greedy_recall",
      "facecheck",
      "objective_setup",
      "overextension",
      "shutdown_donation",
      "teamfight_execution",
      "sidelane_greed",
      "mechanical_misplay",
      "unavoidable_team_collapse",
    ])
    .nullable()
    .default(null),
  bestDecision: z.string().default(""),
  oneAdjustment: z.string().default(""),
  doomedCollapse: z.boolean().default(false),
  flamed: z.boolean().default(false),
  mutedAppropriately: z.boolean().default(true),
  reviewed: z.boolean().default(false),
});

const matchSchema = z.object({
  seasonId: z.string().optional(),
  riotMatchId: z.string().optional(), // specific id, or "latest"
  playedAt: z.string().optional(),
  objective: z.record(z.any()).optional(), // manual fields / overrides
  scorecard: scorecardSchema,
});

const ROLES = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT", "UNKNOWN"] as const;
const ROLE_PREFS = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT", "UNKNOWN", "ANY"] as const;
const profileSchema = z.object({
  mainRole: z.enum(ROLES).nullable().optional(),
  primaryRole: z.enum(ROLE_PREFS).nullable().optional(),
  secondaryRole: z.enum(ROLE_PREFS).nullable().optional(),
  preferredRank: z.string().nullable().optional(),
  championPool: z
    .array(
      z.object({
        champion: z.string().min(1),
        tier: z.enum(["main", "secondary", "lab"]),
        roles: z.array(z.enum(ROLES)).optional(),
      })
    )
    .optional(),
});

const addGoalSchema = z.object({
  templateId: z.string(),
  seasonId: z.string().optional(),
  target: z.number().optional(),
  champion: z.string().nullish(),
  baseline: z.number().nullish(),
});

export function registerRoutes(app: RouteApp): void {
  // ---- config -------------------------------------------------------------

  app.get("/api/config", (_req, res) => {
    const riot = riotFromEnv();
    const cfg: AppConfig = {
      riotConfigured: !!riot,
      gameName: process.env.RIOT_GAME_NAME ?? null,
      tagLine: process.env.RIOT_TAG_LINE ?? null,
      platform: process.env.RIOT_PLATFORM ?? null,
      activeSeasonId: store.settings().activeSeasonId,
      demoMode: store.demoState().enabled,
      sessionGapMinutes: store.settings().sessionGapMinutes,
    };
    res.json(cfg);
  });

  app.get("/api/identities", (_req, res) => res.json(IDENTITIES));

  // ---- current-profile header + favorites (profile switcher) --------------

  app.get("/api/me", async (_req, res) => {
    const pool = store.activePool();
    const career = enrichAll(store.matches(), store.seasons(), pool);
    const champs = buildChampionStats(career, pool);
    const top = [...champs].sort((a, b) => b.masteryLevel - a.masteryLevel || b.games - a.games)[0] ?? null;
    const masteryLevel = champs.reduce((a, c) => a + c.masteryLevel, 0);
    const latest = [...career].reverse().find((m) => m.objective.tier)?.objective;

    let level: number | null = null;
    let profileIconId: number | null = null;
    const riot = riotFromEnv();
    if (riot) {
      try {
        const puuid = await riot.getPuuid();
        const info = await riot.getSummonerInfo(puuid);
        level = info.level;
        profileIconId = info.profileIconId;
      } catch {
        /* best-effort */
      }
    }

    const header: ProfileHeader = {
      gameName: process.env.RIOT_GAME_NAME ?? null,
      tagLine: process.env.RIOT_TAG_LINE ?? null,
      platform: process.env.RIOT_PLATFORM ?? null,
      level,
      profileIconId,
      tier: latest?.tier ?? null,
      division: latest?.division ?? null,
      leaguePoints: latest?.leaguePoints ?? null,
      topChampion: top?.champion ?? null,
      masteryLevel,
      isSelf: true,
    };
    res.json(header);
  });

  app.get("/api/favorites", (_req, res) => res.json(store.favorites()));

  app.post("/api/favorites", (req, res) => {
    const b = z
      .object({ gameName: z.string().min(1), tagLine: z.string().min(1), platform: z.string().optional() })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.flatten() });
    store.addFavorite({ gameName: b.data.gameName, tagLine: b.data.tagLine, platform: b.data.platform || process.env.RIOT_PLATFORM || "na1" });
    res.json(store.favorites());
  });

  app.delete("/api/favorites", (req, res) => {
    const game = typeof req.query.game === "string" ? req.query.game : "";
    const tag = typeof req.query.tag === "string" ? req.query.tag : "";
    store.removeFavorite(game, tag);
    res.json(store.favorites());
  });

  // ---- seasons ------------------------------------------------------------

  app.get("/api/seasons", (_req, res) => res.json(store.seasons()));

  // Draft a block from a pitch (a champion, a focus area, a queue type).
  app.post("/api/blocks/plan", (req, res) => {
    const parsed = z
      .object({
        champion: z.string().nullish(),
        focus: z.string().nullish(),
        blockType: z.enum(["ranked", "normal", "aram", "any"]).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json(generateBlockPlan(parsed.data));
  });

  app.post("/api/seasons", (req, res) => {
    const parsed = seasonSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    const { goals, ...seasonFields } = parsed.data;
    const season: Season = {
      id: uuid(),
      ...seasonFields,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "active",
      retro: null,
    };
    store.addSeason(season);
    // Attach the accepted goals to the new block.
    for (const g of goals) {
      const goal = goalFromTemplate(g.templateId, {
        seasonId: season.id,
        target: g.target,
        champion: g.champion ?? null,
        baseline: g.baseline ?? null,
      });
      if (goal) store.addGoal(goal);
    }
    res.status(201).json(season);
  });

  app.post("/api/seasons/:id/activate", (req, res) => {
    const season = store.getSeason(req.params.id);
    if (!season) return res.status(404).json({ error: "Season not found" });
    store.setActiveSeason(season.id);
    res.json({ ok: true });
  });

  app.post("/api/seasons/:id/complete", (req, res) => {
    const season = store.getSeason(req.params.id);
    if (!season) return res.status(404).json({ error: "Season not found" });
    const parsed = retroSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    const pool = store.activePool();
    const enriched = enrichAll(store.matchesForSeason(season.id), store.seasons(), pool);
    const unmet = store
      .goalsForSeason(season.id)
      .map((g) => evaluateGoal(g, enriched))
      .filter((g) => !g.met);
    if (unmet.length > 0) {
      return res.status(409).json({
        error: `Block objectives still open: ${unmet.map((g) => g.goal.title).join(", ")}`,
      });
    }
    store.updateSeason(season.id, {
      status: "complete",
      endedAt: new Date().toISOString(),
      retro: { writtenAt: new Date().toISOString(), ...parsed.data },
    });
    res.json({ ok: true });
  });

  // ---- riot preview (which recent games aren't logged yet) ----------------

  app.get("/api/riot/recent", async (_req, res) => {
    const riot = riotFromEnv();
    if (!riot) return res.status(400).json({ error: "Riot API not configured" });
    try {
      const puuid = await riot.getPuuid();
      const ids = await riot.getRecentMatchIds(puuid, 10, 420);
      const withStatus = ids.map((id) => ({
        matchId: id,
        alreadyLogged: store.hasRiotMatch(id),
      }));
      res.json({ matches: withStatus });
    } catch (e) {
      res.status(e instanceof RiotError ? 502 : 500).json({ error: String((e as Error).message) });
    }
  });

  // ---- matches ------------------------------------------------------------

  app.get("/api/matches", (_req, res) => {
    const season = store.activeSeason();
    if (!season) return res.json([]);
    const pool = store.activePool();
    const raw = store.matchesForSeason(season.id);
    res.json(raw.map((m) => enrichMatch(m, season, pool)));
  });

  app.post("/api/matches", async (req, res) => {
    const parsed = matchSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const season = parsed.data.seasonId
      ? store.getSeason(parsed.data.seasonId)
      : store.activeSeason();
    if (!season)
      return res
        .status(400)
        .json({ error: "No active season. Start a ranked block first." });

    let objective: ObjectiveData = {};
    let source: Match["source"] = "manual";
    const warnings: string[] = [];

    const riot = riotFromEnv();
    const wantRiot = !!parsed.data.riotMatchId;

    if (wantRiot && riot) {
      try {
        const puuid = await riot.getPuuid();
        let matchId = parsed.data.riotMatchId!;
        if (matchId === "latest") {
          const ids = await riot.getRecentMatchIds(puuid, 10, 420);
          const next = ids.find((id) => !store.hasRiotMatch(id));
          if (!next)
            return res
              .status(409)
              .json({ error: "No new ranked games found — your latest is already logged." });
          matchId = next;
        }
        if (store.hasRiotMatch(matchId))
          return res.status(409).json({ error: "That match is already logged." });

        objective = await riot.getObjectiveData(matchId, puuid);
        source = "riot";

        // LP delta by diffing against the last stored rank snapshot.
        const rank = await riot.getRank(puuid);
        objective.tier = rank.tier;
        objective.division = rank.division;
        objective.leaguePoints = rank.leaguePoints;
        const s = store.settings();
        if (
          rank.leaguePoints != null &&
          s.lastLp != null &&
          s.lastTier === rank.tier &&
          s.lastDivision === rank.division
        ) {
          objective.lpDelta = rank.leaguePoints - s.lastLp;
        } else {
          objective.lpDelta = null; // promo/demo or first game — can't infer cleanly
          if (s.lastLp != null) warnings.push("LP delta unknown across a promotion/demotion — set it manually if you want it in the trend.");
        }
        store.updateSettings({
          lastLp: rank.leaguePoints ?? s.lastLp,
          lastTier: rank.tier ?? s.lastTier,
          lastDivision: rank.division ?? s.lastDivision,
        });
      } catch (e) {
        warnings.push(
          `Riot fetch failed (${(e as Error).message}). Saved as a manual entry — fill objective fields by hand if you like.`
        );
        source = "manual";
      }
    }

    // Manual overrides always win (lets you fix a bad autofill or a null LP).
    if (parsed.data.objective) {
      objective = { ...objective, ...(parsed.data.objective as ObjectiveData) };
      if (source === "riot" && Object.keys(parsed.data.objective).length) source = "hybrid";
    }

    const match: Match = {
      id: uuid(),
      seasonId: season.id,
      playedAt: parsed.data.playedAt ?? new Date().toISOString(),
      loggedAt: new Date().toISOString(),
      source,
      objective,
      scorecard: parsed.data.scorecard,
    };
    store.addMatch(match);

    const enriched = enrichMatch(match, season, store.activePool());
    res.status(201).json({ match: enriched, warnings });
  });

  app.get("/api/matches/:id", (req, res) => {
    const m = store.matches().find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: "Match not found." });
    const season = m.seasonId ? store.getSeason(m.seasonId) ?? null : null;
    const enriched = enrichMatch(m, season, store.activePool());
    // Split this game's stat line into good/needs-work against the rank benchmark.
    const isAram = (m.objective.queue ?? "").toUpperCase().includes("ARAM");
    const { rank, bench } = benchFor(
      activeProfile().isSelf ? store.profile().preferredRank : null,
      m.objective.tier
    );
    enriched.comparison = matchComparison(m.objective, bench, isAram);
    enriched.comparisonRank = isAram ? "ARAM avg" : rankLabel(rank);
    res.json(enriched);
  });

  // Full 10-player scoreboard (only for games that carry a Riot match id),
  // enriched with builds, summoner spells, and rune icons.
  app.get("/api/matches/:id/scoreboard", async (req, res) => {
    const m = store.matches().find((x) => x.id === req.params.id);
    const empty = { found: false, players: [], durationSec: 0, version: "", platform: "", error: null as string | null };
    if (!m) return res.status(404).json({ error: "Match not found." });
    const rid = m.objective.riotMatchId;
    const riot = riotForActive();
    if (!rid || !riot) return res.json({ ...empty, error: "This game isn't linked to Riot match data." });
    try {
      const puuid = await riot.getPuuid();
      const [sb, version] = await Promise.all([riot.getMatchScoreboard(rid, puuid), getVersion()]);
      const players = await Promise.all(
        sb.players.map(async (p: any) => {
          const { _keystone, _secondaryStyle, ...rest } = p;
          return {
            ...rest,
            keystoneIcon: await getRuneIcon(_keystone),
            secondaryStyleIcon: await getRuneIcon(_secondaryStyle),
          };
        })
      );
      res.json({ found: true, players, durationSec: sb.durationSec, version, platform: riot.platformHost, error: null });
    } catch (e) {
      res.json({ ...empty, error: String((e as Error).message) });
    }
  });

  // Per-minute gold / xp / cs series for the match detail over-time graphs.
  app.get("/api/matches/:id/timeline", async (req, res) => {
    const m = store.matches().find((x) => x.id === req.params.id);
    const empty = { found: false, participants: [], frames: [], version: "", error: null as string | null };
    if (!m) return res.status(404).json({ error: "Match not found." });
    const rid = m.objective.riotMatchId;
    const riot = riotForActive();
    if (!rid || !riot) return res.json({ ...empty, error: "This game isn't linked to Riot match data." });
    try {
      const puuid = await riot.getPuuid();
      const [tl, version] = await Promise.all([riot.getMatchTimeline(rid, puuid), getVersion()]);
      res.json({ found: true, participants: tl.participants, frames: tl.frames, version, error: null });
    } catch (e) {
      res.json({ ...empty, error: String((e as Error).message) });
    }
  });

  // LLM build + draft grading for a game — vs standard builds and the enemy comp.
  app.get("/api/matches/:id/analysis", async (req, res) => {
    const m = store.matches().find((x) => x.id === req.params.id);
    const empty = {
      found: false, champion: null, buildScore: 0, buildVerdict: "", buildNotes: [] as string[],
      myTeam: { score: 0, label: "", notes: [] as string[] },
      enemyTeam: { score: 0, label: "", notes: [] as string[] },
      matchup: "", generatedBy: "fallback" as const, error: null as string | null,
    };
    if (!m) return res.status(404).json({ error: "Match not found." });
    const rid = m.objective.riotMatchId;
    const riot = riotForActive();
    if (!rid || !riot) return res.json({ ...empty, error: "This game isn't linked to Riot match data." });
    try {
      const puuid = await riot.getPuuid();
      const [sb, version] = await Promise.all([riot.getMatchScoreboard(rid, puuid), getVersion()]);
      const me = sb.players.find((p: any) => p.isMe);
      if (!me) return res.json({ ...empty, error: "You weren't found in this game." });

      const itemIds: number[] = [...me.items, me.trinket].filter((i: number) => i > 0);
      const items = await Promise.all(itemIds.map((i) => getItemName(i)));
      const keystone = await getRuneName(me._keystone);
      const spells = (me.spells as number[]).map((s) => SPELL_NAME[s]).filter(Boolean);
      const compFor = (mine: boolean) =>
        sb.players.filter((p: any) => (p.team === me.team) === mine).map((p: any) => ({ champion: p.champion, role: p.role }));

      const analysis = await getMatchAnalysis({
        matchId: rid,
        patch: version,
        queue: m.objective.queue ?? "",
        win: !!me.win,
        me: { champion: me.champion, role: me.role, items, keystone, spells },
        myTeam: compFor(true),
        enemyTeam: compFor(false),
      });
      res.json(analysis);
    } catch (e) {
      res.json({ ...empty, error: String((e as Error).message) });
    }
  });

  app.delete("/api/matches/:id", (req, res) => {
    store.deleteMatch(req.params.id);
    res.json({ ok: true });
  });

  // ---- champions (Data Dragon) --------------------------------------------

  // Account-level tiered achievements over the whole career.
  app.get("/api/achievements", (_req, res) => {
    res.json(buildAchievements());
  });

  // Notifications: the read refreshes (diffs career state) and returns the stack.
  app.get("/api/notifications", (_req, res) => {
    res.json(getNotifications());
  });
  app.post("/api/notifications/read", (_req, res) => {
    store.markNotificationsRead();
    res.json({ ok: true });
  });
  app.delete("/api/notifications", (_req, res) => {
    store.clearNotifications();
    res.json({ ok: true });
  });

  // DPM-Lens-style rolled-up stats, sliceable by queue + role.
  app.get("/api/stats", (req, res) => {
    const queue = typeof req.query.queue === "string" ? req.query.queue : "sr";
    const role = typeof req.query.role === "string" && req.query.role ? req.query.role : null;
    res.json(buildStats(queue, role));
  });

  app.get("/api/champions", async (_req, res) => {
    try {
      const data = await getChampions();
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: `Couldn't load champion data: ${(e as Error).message}` });
    }
  });

  // ---- profile (champion pool lives here, stable across blocks) -----------

  app.get("/api/profile", (_req, res) => res.json(store.profile()));

  app.put("/api/profile", (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    const data: Record<string, unknown> = { ...parsed.data };
    // Keep the engine's `mainRole` in sync with the primary role preference
    // ("ANY"/UNKNOWN collapse to null — the recommender wants a concrete role).
    if (parsed.data.primaryRole !== undefined) {
      const pr = parsed.data.primaryRole;
      data.mainRole = pr && pr !== "ANY" && pr !== "UNKNOWN" ? (pr as Role) : null;
    }
    store.updateProfile(data as { mainRole?: Role | null; championPool?: any });
    res.json(store.profile());
  });

  // ---- goals --------------------------------------------------------------

  app.get("/api/goal-templates", (_req, res) => {
    res.json(
      TEMPLATES.map((t) => ({
        id: t.id,
        category: t.category,
        unit: t.unit,
        direction: t.direction,
        defaultTarget: t.defaultTarget,
        needsChampion: !!t.needsChampion,
        title: t.title(),
        description: t.describe(t.defaultTarget),
      }))
    );
  });

  app.post("/api/goals", (req, res) => {
    const parsed = addGoalSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    let seasonId = parsed.data.seasonId ?? store.activeSeason()?.id ?? null;
    let createdBlock: Season | null = null;

    // No active block? Auto-create one seeded with this goal + a couple of
    // recommended goals, so the goal has a home instead of being orphaned (which
    // is why "added" goals were vanishing from the Blocks page).
    if (!seasonId) {
      const champion = parsed.data.champion ?? null;
      const plan = generateBlockPlan({ champion, blockType: "any" });
      const season: Season = {
        id: uuid(),
        name: champion ? `${champion} focus` : plan.name,
        theme: plan.theme,
        goal: plan.goal,
        identityId: plan.identityId,
        targetGames: plan.targetGames,
        blockType: plan.blockType,
        focusChampion: champion,
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: "active",
        retro: null,
      };
      store.addSeason(season);
      seasonId = season.id;
      createdBlock = season;
      for (const g of plan.goals.filter((x) => x.templateId !== parsed.data.templateId).slice(0, 2)) {
        const rec = goalFromTemplate(g.templateId, { seasonId, target: g.target, champion: g.champion ?? null, baseline: g.baseline ?? null });
        if (rec) store.addGoal(rec);
      }
    }

    const goal = goalFromTemplate(parsed.data.templateId, {
      seasonId,
      target: parsed.data.target,
      champion: parsed.data.champion ?? null,
      baseline: parsed.data.baseline ?? null,
    });
    if (!goal) return res.status(400).json({ error: "Unknown goal template" });
    store.addGoal(goal);
    res.status(201).json({ ...goal, createdBlock });
  });

  app.patch("/api/goals/:id", (req, res) => {
    const patch = z
      .object({
        target: z.number().optional(),
        status: z.enum(["active", "achieved", "archived"]).optional(),
      })
      .safeParse(req.body);
    if (!patch.success) return res.status(400).json({ error: patch.error.flatten() });
    store.updateGoal(req.params.id, patch.data);
    res.json({ ok: true });
  });

  app.delete("/api/goals/:id", (req, res) => {
    store.deleteGoal(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/rolling-quests/:familyKey/claim", (req, res) => {
    store.claimRollingQuest(decodeURIComponent(req.params.familyKey));
    res.json({ ok: true });
  });

  // ---- recommendations (the coach) ----------------------------------------

  app.get("/api/recommendations", (_req, res) => {
    const pool = store.activePool();
    const careerEnriched = enrichAll(store.matches(), store.seasons(), pool);
    res.json(recommend(careerEnriched, pool, store.profile().mainRole));
  });

  // ---- dashboard ----------------------------------------------------------

  app.get("/api/dashboard", async (req, res) => {
    const queue = typeof req.query.queue === "string" ? req.query.queue : undefined;
    const role = typeof req.query.role === "string" && req.query.role ? req.query.role : null;
    res.json(await buildDashboard(queue, role));
  });

  app.get("/api/progress", (_req, res) => {
    res.json(buildProgress());
  });

  // Lightweight active-block + goals + level for the floating Objectives panel.
  app.get("/api/objectives", (_req, res) => {
    const ach = buildAchievements();
    const level = { level: ach.level, levelPct: ach.levelPct, xpIntoLevel: ach.xpIntoLevel, xpForNext: ach.xpForNext };
    const season = store.activeSeason();
    if (!season) return res.json({ block: null, gamesLogged: 0, goals: [], level });
    const enriched = enrichAll(store.matchesForSeason(season.id), store.seasons(), store.activePool());
    const goals = store.goalsForSeason(season.id).map((g) => evaluateGoal(g, enriched));
    res.json({
      block: { id: season.id, name: season.name, focusChampion: season.focusChampion ?? null, targetGames: season.targetGames, theme: season.theme },
      gamesLogged: enriched.length,
      goals,
      level,
    });
  });

  // Full match list (newest first) for the Matches browser. Respects the season
  // span like every other data view. (Distinct path — /api/matches is the active
  // season's list.)
  app.get("/api/match-history", (_req, res) => {
    const career = enrichAll(store.matches(), store.seasons(), store.activePool());
    res.json({ matches: [...career].reverse() });
  });

  // Live companion — reads the local League client (champ select) or running game
  // (Live Client Data API) and returns your matchup history vs the enemy laner,
  // a build tuned to the enemy comp, and a draft readout. `?mock=1` exercises the
  // full pipeline without League running (for demos / this dev environment).
  app.get("/api/live", async (req, res) => {
    try {
      const mock = req.query.mock === "1" || req.query.mock === "true";
      const opponent = typeof req.query.opponent === "string" ? req.query.opponent : null;
      // The live companion is always about the person playing (the self account),
      // never a profile you happen to be scouting — force self context.
      res.json(await runWithProfile(SELF_PROFILE, () => buildLiveCompanion(mock, opponent)));
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // The optional LLM deep read — a Claude synthesis layered on the rules output.
  app.get("/api/live/deep", async (req, res) => {
    try {
      const mock = req.query.mock === "1" || req.query.mock === "true";
      const opponent = typeof req.query.opponent === "string" ? req.query.opponent : null;
      const result = await runWithProfile(SELF_PROFILE, async () => {
        const companion = await buildLiveCompanion(mock, opponent);
        return buildDeepRead(companion);
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // Cheap liveness poll — just the client phase.
  app.get("/api/live/status", async (_req, res) => {
    try {
      res.json(await liveStatus());
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // Post-game recap of the last finished game.
  app.get("/api/live/recap", (_req, res) => {
    try {
      // Your last game — always the self account, not a scouted profile.
      res.json(runWithProfile(SELF_PROFILE, () => buildRecap()));
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // ---- the coach ----------------------------------------------------------

  app.get("/api/coach/plan", async (req, res) => {
    try {
      const queue = typeof req.query.queue === "string" ? req.query.queue : "all";
      const plan = await buildCoachPlan({ queue });
      res.json({ plan, mode: store.coachMode() });
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // Toggle the coach engine: Claude synthesis vs deterministic rules ($0).
  app.post("/api/coach/mode", (req, res) => {
    const mode = req.body?.mode === "engine" ? "engine" : "llm";
    store.setCoachMode(mode);
    res.json({ mode });
  });

  app.post("/api/coach/plan/refresh", async (req, res) => {
    try {
      const queue = typeof req.query.queue === "string" ? req.query.queue : "all";
      const plan = await buildCoachPlan({ force: true, queue });
      res.json({ plan });
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // ---- auto-ingestion (Riot sync) -----------------------------------------

  app.post("/api/sync", async (req, res) => {
    const force = req.query.force === "1" || (req.body && req.body.force === true);
    try {
      res.json(await syncRiot({ force }));
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // ---- demo mode ----------------------------------------------------------

  app.get("/api/demo", (_req, res) => {
    res.json(store.demoState());
  });

  app.post("/api/demo/enable", (_req, res) => {
    store.setDemoMode(true);
    res.json(store.demoState());
  });

  app.post("/api/demo/disable", (_req, res) => {
    store.setDemoMode(false);
    res.json(store.demoState());
  });

  app.post("/api/demo/reset", (_req, res) => {
    store.resetDemo();
    res.json(store.demoState());
  });

  app.get("/api/champions/:champion", (req, res) => {
    const role = typeof req.query.role === "string" && req.query.role ? req.query.role : null;
    const detail = buildChampionDetail(req.params.champion, role);
    if (!detail) return res.status(404).json({ error: "Champion not found in your match history yet." });
    res.json(detail);
  });

  // ---- champion context (LLM-generated meta, cached per patch) -------------

  app.get("/api/champion-meta/:champion", async (req, res) => {
    try {
      const role = typeof req.query.role === "string" ? req.query.role : "";
      const refresh = req.query.refresh === "1";
      res.json(await getChampionMeta(req.params.champion, role, { refresh }));
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });

  // ---- block review (stacked games + progression) -------------------------

  app.get("/api/blocks/summaries", (_req, res) => {
    res.json(buildBlockSummaries());
  });

  app.get("/api/seasons/:id/review", (req, res) => {
    const review = buildBlockReview(req.params.id);
    if (!review) return res.status(404).json({ error: "Block not found." });
    res.json(review);
  });

  // ---- summoner search (read-only lookup of any Riot ID) ------------------

  app.get("/api/summoner", async (req, res) => {
    const game = typeof req.query.game === "string" ? req.query.game.trim() : "";
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
    const platform =
      (typeof req.query.platform === "string" && req.query.platform) ||
      TAG_PLATFORM[tag.toUpperCase()] ||
      process.env.RIOT_PLATFORM ||
      "na1";
    if (!game || !tag)
      return res.status(400).json({ error: "Provide a Riot ID as game name and tag (e.g. Dhole#NA1)." });
    try {
      res.json(await lookupSummoner(game, tag, platform));
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message) });
    }
  });
}
