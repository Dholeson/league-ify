import type { Match, SummonerProfile, EnrichedMatch } from "../shared/types.ts";
import { RiotClient, RiotError } from "./riot.ts";
import { enrichMatch } from "./engine/enrich.ts";
import { buildChampionStats } from "./engine/championStats.ts";
import { buildStatBoard } from "./engine/statboard.ts";

// ---------------------------------------------------------------------------
// SUMMONER SEARCH
//
// Read-only lookup of any Riot ID. Reuses the Riot client + the same objective
// enrichment as your own games (no self-report, no block), so a searched player
// renders with the same tags, champions, and mastery cards. Results are cached
// briefly to stay well under the dev-key rate limit.
// ---------------------------------------------------------------------------

const NEUTRAL = {
  grade: "C" as const,
  tiltBefore: 0,
  tiltAfter: 0,
  biggestMistake: "",
  firstDeathCause: null,
  bestDecision: "",
  oneAdjustment: "",
  doomedCollapse: false,
  flamed: false,
  mutedAppropriately: true,
  reviewed: false,
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; profile: SummonerProfile }>();
const uuid = () => globalThis.crypto.randomUUID();

export async function lookupSummoner(
  gameName: string,
  tagLine: string,
  platform: string
): Promise<SummonerProfile> {
  const key = `${gameName}#${tagLine}|${platform}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.profile;

  const apiKey = process.env.RIOT_API_KEY;
  const base: SummonerProfile = {
    gameName,
    tagLine,
    platform,
    found: false,
    level: null,
    profileIconId: null,
    tier: null,
    division: null,
    leaguePoints: null,
    games: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    aramMode: false,
    statBoard: [],
    champions: [],
    recentMatches: [],
    rateLimited: false,
    error: null,
  };
  if (!apiKey) return { ...base, error: "Riot API key not configured on the server." };

  const client = new RiotClient(apiKey, gameName, tagLine, platform);
  let rateLimited = false;

  try {
    const puuid = await client.getPuuid();

    let rank: { tier?: string; division?: string; leaguePoints?: number } = {};
    try {
      rank = await client.getRank(puuid);
    } catch {
      /* best-effort */
    }
    let info: { level: number | null; profileIconId: number | null } = { level: null, profileIconId: null };
    try {
      info = await client.getSummonerInfo(puuid);
    } catch {
      /* best-effort */
    }

    // Cap total match fetches to keep well under the dev-key limit.
    const ids: string[] = [];
    try {
      ids.push(...(await client.getRecentMatchIds(puuid, 6, 420)));
    } catch (e) {
      if (e instanceof RiotError && e.status === 429) rateLimited = true;
    }
    if (!rateLimited) {
      try {
        ids.push(...(await client.getRecentMatchIds(puuid, 4, 450)));
      } catch (e) {
        if (e instanceof RiotError && e.status === 429) rateLimited = true;
      }
    }

    const enriched: EnrichedMatch[] = [];
    for (const id of ids.slice(0, 12)) {
      if (rateLimited) break;
      try {
        const objective = await client.getObjectiveData(id, puuid);
        if (rank.tier && (objective.queue?.includes("RANKED") ?? false)) {
          objective.tier = rank.tier;
          objective.division = rank.division;
          objective.leaguePoints = rank.leaguePoints;
        }
        const match: Match = {
          id: uuid(),
          seasonId: null,
          playedAt: objective.playedAt ?? new Date().toISOString(),
          loggedAt: new Date().toISOString(),
          source: "riot",
          objective,
          scorecard: { ...NEUTRAL },
        };
        enriched.push(enrichMatch(match, null, []));
      } catch (e) {
        if (e instanceof RiotError && e.status === 429) {
          rateLimited = true;
          break;
        }
      }
    }

    enriched.sort((a, b) => +new Date(a.playedAt) - +new Date(b.playedAt));
    const wins = enriched.filter((m) => m.objective.win).length;
    const losses = enriched.filter((m) => m.objective.win === false).length;
    const aramCount = enriched.filter((m) => (m.objective.queue ?? "").toUpperCase().includes("ARAM")).length;
    const aramMode = enriched.length > 0 && aramCount > enriched.length / 2;

    const profile: SummonerProfile = {
      ...base,
      found: true,
      level: info.level,
      profileIconId: info.profileIconId,
      aramMode,
      statBoard: buildStatBoard(enriched, aramMode ? "aram" : "sr"),
      tier: rank.tier ?? null,
      division: rank.division ?? null,
      leaguePoints: rank.leaguePoints ?? null,
      games: enriched.length,
      wins,
      losses,
      winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
      champions: buildChampionStats(enriched, []),
      recentMatches: [...enriched].reverse(),
      rateLimited,
      error: rateLimited && enriched.length === 0 ? "Riot rate limit hit — try again in a moment." : null,
    };
    cache.set(key, { at: Date.now(), profile });
    return profile;
  } catch (e) {
    if (e instanceof RiotError && e.status === 404) {
      return { ...base, error: `No Riot account found for ${gameName}#${tagLine} on ${platform.toUpperCase()}.` };
    }
    return { ...base, error: String((e as Error).message), rateLimited };
  }
}
