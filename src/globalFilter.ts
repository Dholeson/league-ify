// The app-wide game-type + role filter. Lives in the topbar and drives the
// dashboard, stats, and (later) the coach + mini-graphs. Same pub/sub shape as
// active.ts so any component can read it or react to changes.

export type GlobalFilter = { queue: string; role: string | null; span?: "season" | "all" };

export const GAME_TYPES: { key: string; label: string; short: string }[] = [
  { key: "all", label: "All Games", short: "All" },
  { key: "ranked_solo", label: "Ranked Solo/Duo", short: "Solo/Duo" },
  { key: "ranked_flex", label: "Ranked Flex", short: "Flex" },
  { key: "swiftplay", label: "Swiftplay", short: "Swiftplay" },
  { key: "draft", label: "Draft Pick", short: "Draft" },
  { key: "aram", label: "ARAM", short: "ARAM" },
  { key: "arena", label: "Arena", short: "Arena" },
];
// Modes with no lane assignments — the role filter is meaningless there.
export const NO_ROLE_QUEUES = new Set(["aram", "arena"]);
export const FILTER_ROLES = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"];
export const roleLabel = (r: string) => r[0] + r.slice(1).toLowerCase();
export const gameTypeLabel = (k: string) => GAME_TYPES.find((g) => g.key === k)?.label ?? "All Games";

const KEY = "globalFilter";
const DEFAULT: GlobalFilter = { queue: "all", role: null, span: "season" };
export const spanOf = (f: GlobalFilter): "season" | "all" => f.span ?? "season";
type Listener = (f: GlobalFilter) => void;
const listeners = new Set<Listener>();

export function loadFilter(): GlobalFilter {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw.queue === "string") return { queue: raw.queue, role: raw.role ?? null, span: raw.span === "all" ? "all" : "season" };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT };
}

export function setFilter(f: GlobalFilter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(f));
}

export function subscribeFilter(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
