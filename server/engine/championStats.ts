import type {
  EnrichedMatch,
  ChampionStat,
  ChampionPoolEntry,
} from "../../shared/types.ts";
import { championPersonalTier, championForm } from "./insights.ts";
import { buildChampionTrack } from "./championTrack.ts";

// Group a set of enriched games by champion into ChampionStat rows, including
// the per-champion mastery level/rank. Shared by the dashboard, block review,
// and summoner lookup so champion cards look identical everywhere.
export function buildChampionStats(
  enriched: EnrichedMatch[],
  pool: ChampionPoolEntry[]
): ChampionStat[] {
  const poolTier = (champ: string) =>
    pool.find((p) => p.champion.toLowerCase() === champ.toLowerCase())?.tier ?? null;

  const groups = new Map<string, EnrichedMatch[]>();
  for (const m of enriched) {
    const c = m.objective.champion;
    if (!c) continue;
    (groups.get(c) ?? groups.set(c, []).get(c)!).push(m);
  }

  return [...groups.entries()]
    .map(([champion, ms]) => {
      const wins = ms.filter((m) => m.objective.win).length;
      const winRate = Math.round((wins / ms.length) * 100);
      const avgProcess = Math.round(
        ms.reduce((a, m) => a + m.process.score, 0) / ms.length
      );
      const k = ms.reduce((a, m) => a + (m.objective.kills ?? 0), 0);
      const d = ms.reduce((a, m) => a + (m.objective.deaths ?? 0), 0);
      const a = ms.reduce((acc, m) => acc + (m.objective.assists ?? 0), 0);
      const r1 = (n: number) => Math.round(n * 10) / 10;
      const csGames = ms.filter((m) => m.objective.totalCs != null);
      const totalCs = csGames.reduce((acc, m) => acc + (m.objective.totalCs ?? 0), 0);
      const totalMin = csGames.reduce((acc, m) => acc + (m.objective.durationSec ? m.objective.durationSec / 60 : 0), 0);
      const track = buildChampionTrack(champion, ms);
      return {
        champion,
        tier: poolTier(champion),
        games: ms.length,
        wins,
        winRate,
        avgProcess,
        netLp: ms.reduce((acc, m) => acc + (m.objective.lpDelta ?? 0), 0),
        personalTier: championPersonalTier(winRate, avgProcess, ms.length),
        form: championForm(ms.map((m) => m.process.score)),
        kda: Math.round(((k + a) / Math.max(1, d)) * 10) / 10,
        avgKills: r1(k / ms.length),
        avgDeaths: r1(d / ms.length),
        avgAssists: r1(a / ms.length),
        avgCs: csGames.length ? Math.round(totalCs / csGames.length) : 0,
        csPerMin: totalMin ? r1(totalCs / totalMin) : 0,
        masteryLevel: track.level,
        masteryRank: track.rank,
        role: track.role,
      };
    })
    .sort((x, y) => y.games - x.games);
}
