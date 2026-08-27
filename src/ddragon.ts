// Data Dragon asset URLs + champion name/id resolution. The square champion
// icon (champion/{id}.png) is a clean face crop — far better for small avatars
// than the tall loading splash. It's version-gated, so we cache the patch and
// refresh in the background.
//
// Champion identity is messy: Riot match data uses DDragon *ids* ("MonkeyKing",
// "KogMaw", "TwistedFate"), while the LLM and humans use display *names*
// ("Wukong", "Kog'Maw", "Twisted Fate"). Icons/routes need the id; text wants
// the name. We fetch the champion list once and resolve either way.

let version = "16.13.1"; // current fallback; DDragon serves old versions forever
const listeners = new Set<() => void>();
try {
  const cached = localStorage.getItem("ddragonVersion");
  if (cached) version = cached;
} catch {
  /* ignore */
}

fetch("https://ddragon.leagueoflegends.com/api/versions.json")
  .then((r) => r.json())
  .then((v: string[]) => {
    if (v[0] && v[0] !== version) {
      version = v[0];
      try { localStorage.setItem("ddragonVersion", v[0]); } catch { /* ignore */ }
      listeners.forEach((l) => l());
    }
  })
  .catch(() => {});

// ---- champion name <-> id maps (built from /api/champions) ----
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const idByKey = new Map<string, string>(); // normalized name OR id -> DDragon id
const nameById = new Map<string, string>(); // DDragon id -> display name

fetch("/api/champions")
  .then((r) => r.json())
  .then((data: { champions?: { id: string; name: string }[] }) => {
    for (const c of data.champions ?? []) {
      idByKey.set(norm(c.id), c.id);
      idByKey.set(norm(c.name), c.id);
      nameById.set(c.id, c.name);
    }
    if (idByKey.size) listeners.forEach((l) => l());
  })
  .catch(() => {});

// Resolve any champion string (id or display name) to its DDragon id, for icon
// URLs and routes. Falls back to a stripped version of the input until the map
// loads (or for anything unrecognized).
export const champId = (c: string): string => idByKey.get(norm(c)) ?? c.replace(/[^A-Za-z0-9]/g, "");
// Resolve to the human display name, for text. Falls back to the input.
export const champName = (c: string): string => nameById.get(champId(c)) ?? nameById.get(c) ?? c;

// Item icon by numeric id (0 = empty slot → no icon).
export const itemIcon = (id: number): string | null =>
  id > 0 ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png` : null;

// Summoner-spell id → DDragon spell key (covers the live summoner spells).
const SPELL_KEY: Record<number, string> = {
  1: "SummonerBoost", 3: "SummonerExhaust", 4: "SummonerFlash", 6: "SummonerHaste",
  7: "SummonerHeal", 11: "SummonerSmite", 12: "SummonerTeleport", 13: "SummonerMana",
  14: "SummonerDot", 21: "SummonerBarrier", 32: "SummonerSnowball", 39: "SummonerSnowball_Mark",
};
export const spellIcon = (id: number): string | null =>
  SPELL_KEY[id] ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${SPELL_KEY[id]}.png` : null;

export const ddragonVersion = () => version;
export const champSquare = (c: string) => `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champId(c)}.png`;
export const champSplash = (c: string) => `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${champId(c)}_0.jpg`;
export const subscribeVersion = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
