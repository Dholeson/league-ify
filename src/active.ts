import type { FavoriteProfile } from "../shared/types.ts";

// The active (viewed) profile, shared across the app. App holds the React state;
// this module is the single writer + a pub/sub so deep components (e.g. a
// scoreboard row) can switch profiles without prop-drilling a setter.

const KEY = "activeProfile";
type Listener = (a: FavoriteProfile | null) => void;
const listeners = new Set<Listener>();

export function loadActive(): FavoriteProfile | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function setActiveProfile(a: FavoriteProfile | null) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(a));
}

export function subscribeActive(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// True when the given riot id is the app owner (env account) — we never want to
// "switch to" yourself as if you were a scouted profile.
export function sameProfile(a: FavoriteProfile | null, b: FavoriteProfile | null) {
  if (!a || !b) return a === b;
  return (
    a.gameName.toLowerCase() === b.gameName.toLowerCase() &&
    a.tagLine.toLowerCase() === b.tagLine.toLowerCase()
  );
}
