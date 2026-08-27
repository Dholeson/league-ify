import type {
  ChampionDetail,
  ChampionPoolEntry,
  EnrichedMatch,
  NextGameBriefing,
  Recommendation,
  Role,
} from "../shared/types.ts";
import { getChampions } from "./ddragon.ts";

const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;

function championRoles(pool: ChampionPoolEntry[], champion: string, mainRole: Role | null) {
  const entry = pool.find((p) => p.champion.toLowerCase() === champion.toLowerCase());
  return entry?.roles?.[0] ?? mainRole ?? null;
}

function signed(n: number | null) {
  if (n == null) return null;
  return `${n >= 0 ? "+" : ""}${n}`;
}

function buildItemNotes(tags: string[], detail: ChampionDetail | null) {
  const earlyDeaths = detail?.avgDeathsBefore15 ?? null;
  const laneGold = detail?.avgGoldDiff15 ?? null;

  if (tags.includes("Tank")) {
    return [
      {
        label: "Lane itemization",
        note:
          earlyDeaths != null && earlyDeaths > 2
            ? "Solve lane damage first. Early resist, health, and boots beat greed when the first 15 minutes are still leaking."
            : "Open with the lane answer first, then stack durability so your engages actually finish.",
      },
      {
        label: "Fight job",
        note:
          "Itemize to start fights and survive first contact. Your value is forcing space for carries, not side-lane vanity damage.",
      },
      {
        label: "Pivot rule",
        note:
          "If one enemy threat is fed or the comp has heavy healing, buy the answer before luxury stats.",
      },
    ];
  }

  if (tags.includes("Marksman") || tags.includes("Mage")) {
    return [
      {
        label: "Core plan",
        note:
          laneGold != null && laneGold > 0
            ? "Keep the gold lead liquid. Finish your main damage spike on time instead of detouring into panic buys."
            : "Tempo and lane stability come first. If the lane is shaky, buy the safety that gets you to your real spike.",
      },
      {
        label: "Defensive pivot",
        note:
          "One defensive purchase is allowed if dive or burst is the reason fights are failing. Dead carries do zero DPS.",
      },
      {
        label: "Fight rule",
        note:
          "Itemize for the fight you can actually take next, not the full six-item fantasy board.",
      },
    ];
  }

  return [
    {
      label: "Core plan",
      note:
        laneGold != null && laneGold > 100
          ? "You are already generating leads here. Keep the first damage spike on time so lane pressure cashes out."
          : "Open with the item that stabilizes your lane, then accelerate into your main threat curve.",
    },
    {
      label: "Defensive pivot",
      note:
        earlyDeaths != null && earlyDeaths > 2
          ? "If early deaths are the leak, take the cheaper defensive breakpoint before greedier damage."
          : "Only pivot defensive when the enemy comp can actually deny you from playing the fight.",
    },
    {
      label: "Snowball rule",
      note:
        "When ahead, turn gold into objective-ready power instead of another ego skirmish purchase.",
    },
  ];
}

function buildObjectives(
  detail: ChampionDetail | null,
  recommendation: Recommendation
) {
  const items: string[] = [];
  const diag = new Map(recommendation.diagnostics.map((d) => [d.key, d]));

  if ((detail?.avgDeathsBefore15 ?? 0) > 2) {
    items.push("Make the first 12 minutes boring: give the wave, base on tempo, and do not donate lane before the map opens.");
  }
  if ((detail?.avgGoldDiff15 ?? 0) < 150) {
    items.push("Use the first three waves and recall timing to aim for a real lane edge by 15 instead of a merely survivable lane.");
  }
  if ((diag.get("objectives")?.status ?? "watch") !== "good" || (diag.get("vision")?.status ?? "watch") !== "good") {
    items.push("Base 45 to 60 seconds before dragon or grubs, arrive first, and spend wards before the fight starts.");
  }
  if ((diag.get("process")?.status ?? "watch") !== "good") {
    items.push("Protect the process floor: one review, one adjustment, and no chat spiral even if the LP swing hurts.");
  }
  if (items.length < 3) {
    items.push("Once you win space, convert it into plates, Herald, dragon setup, or wave crash instead of another random fight.");
  }

  return items.slice(0, 3);
}

function buildBanRecommendation(detail: ChampionDetail | null) {
  if (!detail || detail.matchups.length === 0) {
    return { champion: null, reason: null };
  }

  const worst = [...detail.matchups]
    .sort((a, b) => {
      const wr = a.winRate - b.winRate;
      if (wr !== 0) return wr;
      return (a.avgGoldDiff15 ?? 0) - (b.avgGoldDiff15 ?? 0);
    })[0];

  return {
    champion: worst.opponent,
    reason: `${worst.opponent} is your roughest logged lane into this pick so far (${worst.winRate}% WR${signed(worst.avgGoldDiff15) ? `, ${signed(worst.avgGoldDiff15)} gold@15` : ""}).`,
  };
}

function buildMatchupFocus(detail: ChampionDetail | null) {
  if (!detail || detail.matchups.length === 0) {
    return { champion: null, reason: null };
  }

  const common = [...detail.matchups].sort((a, b) => b.games - a.games)[0];
  return {
    champion: common.opponent,
    reason: `${common.opponent} is the matchup you see the most. Use it as the reference lane for wave, recall, and first-objective discipline.`,
  };
}

export async function buildNextGameBriefing(
  champion: string | null,
  detail: ChampionDetail | null,
  pool: ChampionPoolEntry[],
  recommendation: Recommendation,
  mainRole: Role | null
): Promise<NextGameBriefing | null> {
  if (!champion) return null;

  const data = await getChampions().catch(() => null);
  const tags =
    data?.champions.find((c) => c.name.toLowerCase() === champion.toLowerCase())?.tags ?? [];

  return {
    champion,
    rationale:
      recommendation.plan.roster.find((r) => r.champion?.toLowerCase() === champion.toLowerCase())?.rationale ??
      recommendation.plan.summary,
    role: championRoles(pool, champion, mainRole),
    poolTier: detail?.tier ?? pool.find((p) => p.champion.toLowerCase() === champion.toLowerCase())?.tier ?? null,
    recommendedBan: buildBanRecommendation(detail),
    matchupFocus: buildMatchupFocus(detail),
    mastery: detail
      ? {
          games: detail.games,
          winRate: detail.winRate,
          avgProcess: detail.avgProcess,
          avgCs10: detail.avgCs10,
          avgGoldDiff15: detail.avgGoldDiff15,
          avgDeathsBefore15: detail.avgDeathsBefore15,
          avgFirstDeathSec: detail.avgFirstDeathSec,
          netLp: detail.netLp,
        }
      : null,
    buildNotes: buildItemNotes(tags, detail),
    objectiveChecklist: buildObjectives(detail, recommendation),
  };
}
