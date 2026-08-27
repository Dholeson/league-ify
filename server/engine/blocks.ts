import type { EnrichedMatch, Season, BlockType } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// BLOCK MEMBERSHIP
//
// A block owns the games played during its window AND matching its queue type.
// This is queue-aware and status-independent: a game counts toward EVERY block
// it matches, so a Summoner's Rift block keeps tracking even while a champion
// block is the one pinned active.
// ---------------------------------------------------------------------------

export function queueMatchesBlock(queue: string | undefined, type: BlockType | undefined): boolean {
  if (!type || type === "any") return true;
  const q = (queue ?? "").toUpperCase();
  if (type === "ranked") return q.includes("RANKED");
  if (type === "aram") return q.includes("ARAM");
  if (type === "normal") return q.includes("NORMAL") || q.includes("DRAFT") || q.includes("QUICKPLAY") || q.includes("BLIND");
  return true;
}

export function matchInBlock(m: EnrichedMatch, season: Season): boolean {
  // Constraints apply even to games auto-tagged with this block's id during a
  // sync: a Caitlyn block never counts an Aurora game, and a ranked block never
  // counts an ARAM game — no matter what seasonId got stamped on ingest.
  if (season.focusChampion && m.objective.champion?.toLowerCase() !== season.focusChampion.toLowerCase()) {
    return false;
  }
  if (!queueMatchesBlock(m.objective.queue, season.blockType)) return false;
  // A game logged directly to this block counts once it clears the constraints.
  if (m.seasonId === season.id) return true;
  const t = +new Date(m.playedAt);
  return (
    t >= +new Date(season.startedAt) &&
    (!season.endedAt || t <= +new Date(season.endedAt))
  );
}

export const BLOCK_TYPE_LABEL: Record<BlockType, string> = {
  ranked: "Ranked",
  normal: "Normal",
  aram: "ARAM",
  any: "Any queue",
};
