import type {
  DashboardResponse,
  EnrichedMatch,
  Verdict,
  TrendPoint,
  ChampionStat,
  SplitStat,
  DeathCause,
  DeathCauseStat,
  Season,
} from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll, totalXp } from "./engine/enrich.ts";
import { levelFromXp } from "./engine/xp.ts";
import { getIdentity } from "./engine/identities.ts";
import { evaluateQuests, evaluateWeeklyQuests } from "./engine/quests.ts";
import { evaluateBadges } from "./engine/badges.ts";
import { groupSessions } from "./engine/session.ts";
import { detectBorrowedLp, detectGoodBlock } from "./engine/classify.ts";
import { evaluateGoal } from "./engine/goals.ts";
import { recommend } from "./engine/recommend.ts";
import { buildInsights } from "./engine/insights.ts";
import { buildStatBoard } from "./engine/statboard.ts";
import { buildChampionStats } from "./engine/championStats.ts";
import { matchInBlock } from "./engine/blocks.ts";
import { activeProfile } from "./activeProfile.ts";
import { buildRollingQuests } from "./engine/rollingQuests.ts";
import { riotFromEnv, riotForAccount } from "./riot.ts";
import { getChampions } from "./ddragon.ts";

// Live rank + real champion mastery for the profile header — straight from Riot,
// not derived from the handful of games we've captured. Best-effort: on any
// failure the caller falls back to the game-derived values.
type RankInfo = { tier: string; division: string; leaguePoints: number };
type LiveProfile = {
  tier: string | null; division: string | null; leaguePoints: number | null;
  solo: RankInfo | null; flex: RankInfo | null;
  topChampion: string | null; masteryTitle: string | null;
};
const liveCache = new Map<string, { at: number; data: LiveProfile }>();
const LIVE_TTL = 5 * 60 * 1000; // rank/mastery barely move — don't refetch per nav

async function liveProfile(): Promise<LiveProfile | null> {
  const ap = activeProfile();
  const riot = ap.isSelf ? riotFromEnv() : riotForAccount(ap.gameName!, ap.tagLine!, ap.platform!);
  if (!riot || store.isDemo()) return null;
  const cacheKey = ap.isSelf ? "self" : ap.key ?? "unknown";
  const hit = liveCache.get(cacheKey);
  if (hit && Date.now() - hit.at < LIVE_TTL) return hit.data;
  try {
    const puuid = await riot.getPuuid();
    const [rank, mastery, dd] = await Promise.all([
      riot.getRank(puuid).catch(() => ({} as Awaited<ReturnType<typeof riot.getRank>>)),
      riot.getTopMastery(puuid, 1).catch(() => []),
      getChampions().catch(() => null),
    ]);
    let topChampion: string | null = null;
    let masteryTitle: string | null = null;
    if (mastery[0] && dd) {
      const champ = dd.champions.find((c) => c.key === String(mastery[0].championId));
      if (champ) {
        topChampion = champ.id;
        masteryTitle = `${champ.name} · ${(mastery[0].points / 1000).toFixed(0)}k pts`;
      }
    }
    const data: LiveProfile = {
      tier: rank.tier ?? null, division: rank.division ?? null, leaguePoints: rank.leaguePoints ?? null,
      solo: rank.solo ?? null, flex: rank.flex ?? null,
      topChampion, masteryTitle,
    };
    liveCache.set(cacheKey, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}
import { buildChampionDetail } from "./mastery.ts";
import { buildNextGameBriefing } from "./briefing.ts";

const VERDICTS: Verdict[] = [
  "clean_win",
  "bad_win",
  "good_loss",
  "deserved_loss",
  "standard",
];

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isWithinLastDays(iso: string, days: number, now: Date) {
  const then = new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return then >= start && then <= now;
}

function splitBy(
  matches: EnrichedMatch[],
  keyFn: (m: EnrichedMatch) => string | null | undefined
): SplitStat[] {
  const groups = new Map<string, EnrichedMatch[]>();
  for (const m of matches) {
    const k = keyFn(m);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
  }
  return [...groups.entries()]
    .map(([key, ms]) => statBlock(key, ms))
    .sort((a, b) => b.games - a.games);
}

function statBlock(key: string, ms: EnrichedMatch[]): SplitStat {
  const wins = ms.filter((m) => m.objective.win).length;
  const netLp = ms.reduce((a, m) => a + (m.objective.lpDelta ?? 0), 0);
  const avgProcess = Math.round(
    ms.reduce((a, m) => a + m.process.score, 0) / ms.length
  );
  return {
    key,
    games: ms.length,
    wins,
    winRate: Math.round((wins / ms.length) * 100),
    avgProcess,
    netLp,
  };
}

// Map the global game-type filter to a predicate over the stored queue string.
function queueMatch(m: EnrichedMatch, queue: string | undefined): boolean {
  if (!queue || queue === "all") return true;
  const q = (m.objective.queue ?? "").toUpperCase();
  if (queue === "aram") return q.includes("ARAM");
  if (queue === "ranked_flex" || queue === "flex") return q.includes("FLEX");
  if (queue === "ranked_solo" || queue === "solo") return q.includes("SOLO");
  if (queue === "ranked") return q.includes("RANKED");
  if (queue === "swiftplay") return q.includes("SWIFTPLAY") || q.includes("QUICKPLAY");
  if (queue === "draft") return q.includes("DRAFT") || q.includes("BLIND");
  return true;
}

export async function buildDashboard(queue?: string, role?: string | null): Promise<DashboardResponse> {
  const season = store.activeSeason();
  const seasons = store.seasons();
  const pool = store.activePool();

  // careerAll is the lifetime view (mastery, coach, rank never change with the
  // filter); the tracker sections below use the filtered `enriched`.
  const careerAll = enrichAll(store.matches(), seasons, pool);
  const careerEnriched = careerAll
    .filter((m) => queueMatch(m, queue))
    .filter((m) => !role || m.objective.role === role);
  const enriched = careerEnriched;
  const blockEnriched = season
    ? careerEnriched.filter((m) => matchInBlock(m, season))
    : [];
  const recommendation = recommend(careerAll, pool, store.profile().mainRole);
  const focusChampion = recommendation.plan.roster.find((r) => r.champion)?.champion ?? null;
  const focusDetail = focusChampion ? buildChampionDetail(focusChampion) : null;
  const briefing = await buildNextGameBriefing(
    focusChampion,
    focusDetail,
    pool,
    recommendation,
    store.profile().mainRole
  );

  const identity = season ? getIdentity(season.identityId) : null;
  const level = levelFromXp(totalXp(enriched), enriched);

  const wins = enriched.filter((m) => m.objective.win).length;
  const losses = enriched.filter((m) => m.objective.win === false).length;
  const netLp = enriched.reduce((a, m) => a + (m.objective.lpDelta ?? 0), 0);

  const verdictCounts = Object.fromEntries(
    VERDICTS.map((v) => [v, enriched.filter((m) => m.verdict === v).length])
  ) as Record<Verdict, number>;

  const avgProcess = enriched.length
    ? Math.round(enriched.reduce((a, m) => a + m.process.score, 0) / enriched.length)
    : 0;

  // Trend series: cumulative LP alongside process and its moving average.
  const trend: TrendPoint[] = [];
  let cumLp = 0;
  const WINDOW = 5;
  enriched.forEach((m, i) => {
    cumLp += m.objective.lpDelta ?? 0;
    const from = Math.max(0, i - WINDOW + 1);
    const slice = enriched.slice(from, i + 1);
    const processAvg = Math.round(
      slice.reduce((a, x) => a + x.process.score, 0) / slice.length
    );
    trend.push({
      index: i + 1,
      playedAt: m.playedAt,
      cumulativeLp: cumLp,
      process: m.process.score,
      processAvg,
      win: m.objective.win ?? null,
      verdict: m.verdict,
      champion: m.objective.champion ?? null,
    });
  });

  // Champion breakdown (with per-champion mastery level), queue-scoped.
  const champions: ChampionStat[] = buildChampionStats(enriched, pool);

  const roles = splitBy(enriched, (m) => m.objective.role);
  const sides = splitBy(enriched, (m) => m.objective.side);

  // First-death cause frequency — "what keeps costing me games."
  const causeCounts = new Map<DeathCause, number>();
  for (const m of enriched) {
    const c = m.scorecard.firstDeathCause;
    if (c) causeCounts.set(c, (causeCounts.get(c) ?? 0) + 1);
  }
  const deathCauses: DeathCauseStat[] = [...causeCounts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count);

  // Quests scoped to today.
  const now = new Date();
  const todays = enriched.filter((m) => isSameLocalDay(new Date(m.playedAt), now));
  const quests = evaluateQuests(todays, identity?.focusQuests ?? []);
  const weekly = enriched.filter((m) => isWithinLastDays(m.playedAt, 7, now));
  const weeklyQuests = evaluateWeeklyQuests(weekly, identity?.focusQuests ?? []);

  // Badges over the whole (active season) history.
  const badges = evaluateBadges(enriched);

  const sessions = groupSessions(enriched, store.settings().sessionGapMinutes);
  const currentSession = sessions.length ? sessions[sessions.length - 1] : null;

  const borrowedLp = detectBorrowedLp(enriched);
  const goodBlock = detectGoodBlock(enriched);

  // Goal progress for this block's goals, measured over the block's games.
  const goals = season
    ? store.goalsForSeason(season.id).map((g) => evaluateGoal(g, blockEnriched))
    : [];
  const rollingQuests = season
    ? buildRollingQuests(
        enriched,
        focusChampion,
        store.settings().rollingQuestState ?? {}
      )
    : [];

  const recentMatches = enriched.slice(-12).reverse();

  // Correlation insights read the whole career, not just this block.
  const insights = buildInsights(careerAll);

  // Tracker-style profile header + glance-card board (baseline = vs past self).
  // ARAM swaps to an ARAM-relevant metric set (damage, kills, KP over CS/gold).
  const statBoard = buildStatBoard(careerEnriched, queue === "aram" ? "aram" : "sr");

  // Rank is solo-queue and lifetime — read from the full career, not the filter.
  const latestRank = [...careerAll].reverse().find((m) => m.objective.tier)?.objective;
  const careerWins = careerEnriched.filter((m) => m.objective.win).length;
  const careerLosses = careerEnriched.filter((m) => m.objective.win === false).length;

  // Champion mastery is lifetime; the profile's headline level is the sum of
  // every champion's mastery level, and the title is your most-mastered champ.
  const masteryChamps = buildChampionStats(careerAll, pool);
  const topChamp =
    [...masteryChamps].sort(
      (a, b) => b.masteryLevel - a.masteryLevel || b.games - a.games
    )[0] ?? null;
  const masteryLevel = masteryChamps.reduce((a, c) => a + c.masteryLevel, 0);

  const ap = activeProfile();
  const live = await liveProfile();
  // Rank tracks the selected game mode: Flex when Flex is filtered, otherwise
  // Solo/Duo (the default for All Games). Flex shows Unranked if there's no flex
  // rank — never the solo rank in disguise.
  const wantFlex = queue === "ranked_flex" || queue === "flex";
  const shownRank = wantFlex
    ? live?.flex ?? null
    : live?.solo ?? (live?.tier ? { tier: live.tier, division: live.division ?? "", leaguePoints: live.leaguePoints ?? 0 } : null) ?? (latestRank?.tier ? { tier: latestRank.tier, division: latestRank.division ?? "", leaguePoints: latestRank.leaguePoints ?? 0 } : null);
  const profile = {
    gameName: ap.isSelf ? process.env.RIOT_GAME_NAME ?? null : ap.gameName,
    tagLine: ap.isSelf ? process.env.RIOT_TAG_LINE ?? null : ap.tagLine,
    platform: ap.isSelf ? process.env.RIOT_PLATFORM ?? null : ap.platform,
    tier: shownRank?.tier ?? null,
    division: shownRank?.division ?? null,
    leaguePoints: shownRank?.leaguePoints ?? null,
    rankQueue: wantFlex ? "Flex" : "Solo/Duo",
    masteryLevel,
    masteryTitle: live?.masteryTitle ?? (topChamp ? `${topChamp.champion} · ${topChamp.masteryRank}` : "No games yet"),
    topChampion: live?.topChampion ?? topChamp?.champion ?? null,
    wins: careerWins,
    losses: careerLosses,
    winRate: careerWins + careerLosses ? Math.round((careerWins / (careerWins + careerLosses)) * 100) : 0,
    games: careerEnriched.length,
  };

  return {
    season,
    identity,
    focusChampion: {
      champion: focusChampion,
      rationale: recommendation.plan.roster[0]?.rationale ?? null,
    },
    briefing,
    gamesLogged: blockEnriched.length,
    target: season?.targetGames ?? 0,
    level,
    record: { wins, losses, netLp },
    verdictCounts,
    avgProcess,
    trend,
    champions,
    roles,
    sides,
    deathCauses,
    quests,
    weeklyQuests,
    badges,
    sessions,
    currentSession,
    borrowedLp,
    goodBlock,
    goals,
    rollingQuests,
    recommendation,
    recentMatches,
    insights,
    profile,
    statBoard,
    pullRemaining: store.pullPending().length,
  };
}
