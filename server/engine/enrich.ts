import type {
  Match,
  Season,
  EnrichedMatch,
  ChampionPoolEntry,
} from "../../shared/types.ts";
import { getIdentity } from "./identities.ts";
import { computeProcess } from "./processScore.ts";
import { classify } from "./classify.ts";
import { matchXp, matchFlags } from "./xp.ts";
import { matchTags } from "./tags.ts";

// Turns a raw logged Match into the second-scoreboard view: process score,
// verdict, XP, and per-game nudges — scored through the lens of its season's
// identity, with pool nudges from your (profile-level) champion pool.
export function enrichMatch(
  match: Match,
  season: Season | null,
  pool: ChampionPoolEntry[]
): EnrichedMatch {
  // Career games not tied to a block still get scored, using the default lens.
  const identity = getIdentity(season?.identityId);
  const process = computeProcess(match, identity);
  const verdict = classify(match.objective.win, process.score);
  const xpAwarded = matchXp(match, process, verdict);
  const flags = matchFlags(match, pool);
  const tags = matchTags(match, process.score);
  return { ...match, process, verdict, xpAwarded, flags, tags };
}

export function enrichAll(
  matches: Match[],
  seasons: Season[],
  pool: ChampionPoolEntry[]
): EnrichedMatch[] {
  const byId = new Map(seasons.map((s) => [s.id, s]));
  return matches
    .map((m) => enrichMatch(m, (m.seasonId && byId.get(m.seasonId)) || null, pool))
    .sort((a, b) => +new Date(a.playedAt) - +new Date(b.playedAt));
}

export function totalXp(enriched: EnrichedMatch[]): number {
  return enriched.reduce(
    (acc, m) => acc + m.xpAwarded.reduce((a, x) => a + x.amount, 0),
    0
  );
}
