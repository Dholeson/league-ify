import type { Champion } from "../shared/types.ts";
import { rolesFor } from "./championRoles.ts";

// ---------------------------------------------------------------------------
// DATA DRAGON
//
// Riot's public static data — champion list + square portraits. No API key,
// no rate limit. Cached in memory for the process lifetime (refreshed lazily
// on patch change is overkill for a personal tool; a server restart re-pulls).
// ---------------------------------------------------------------------------

let cache: { version: string; champions: Champion[] } | null = null;
let inflight: Promise<{ version: string; champions: Champion[] }> | null = null;

async function fetchChampions() {
  const versions = (await (
    await fetch("https://ddragon.leagueoflegends.com/api/versions.json")
  ).json()) as string[];
  const version = versions[0];

  const data = (await (
    await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
    )
  ).json()) as {
    data: Record<
      string,
      { id: string; key: string; name: string; title: string; tags: string[] }
    >;
  };

  const champions: Champion[] = Object.values(data.data)
    .map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      title: c.title,
      tags: c.tags,
      roles: rolesFor(c.id),
      imageUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.id}.png`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { version, champions };
}

export async function getChampions(): Promise<{
  version: string;
  champions: Champion[];
}> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetchChampions()
      .then((r) => {
        cache = r;
        return r;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function getVersion(): Promise<string> {
  return (await getChampions()).version;
}

// ---- runes -----------------------------------------------------------------
// runesReforged.json maps every path + rune to an icon path. We build a flat
// id -> full-URL map once so the scoreboard can show keystones and secondary
// paths. Summoner-spell icons are keyed by name, so we hardcode the small,
// stable id -> Data Dragon key table instead.

let runeMeta: Map<number, { icon: string; name: string }> | null = null;
let runeInflight: Promise<Map<number, { icon: string; name: string }>> | null = null;

async function fetchRuneMeta(): Promise<Map<number, { icon: string; name: string }>> {
  const version = await getVersion();
  const data = (await (
    await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`)
  ).json()) as {
    id: number;
    icon: string;
    name: string;
    slots: { runes: { id: number; icon: string; name: string }[] }[];
  }[];
  const map = new Map<number, { icon: string; name: string }>();
  const url = (icon: string) => `https://ddragon.leagueoflegends.com/cdn/img/${icon}`;
  for (const path of data) {
    map.set(path.id, { icon: url(path.icon), name: path.name });
    for (const slot of path.slots) for (const rune of slot.runes) map.set(rune.id, { icon: url(rune.icon), name: rune.name });
  }
  return map;
}

async function runeLookup(id: number): Promise<{ icon: string; name: string } | undefined> {
  if (!runeMeta) {
    if (!runeInflight) runeInflight = fetchRuneMeta().then((m) => (runeMeta = m)).finally(() => (runeInflight = null));
    await runeInflight;
  }
  return runeMeta?.get(id);
}

export async function getRuneIcon(id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await runeLookup(id))?.icon ?? null;
}

export async function getRuneName(id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await runeLookup(id))?.name ?? null;
}

// ---- items -----------------------------------------------------------------
let itemNames: Map<number, string> | null = null;
let itemInflight: Promise<Map<number, string>> | null = null;

async function fetchItemNames(): Promise<Map<number, string>> {
  const version = await getVersion();
  const data = (await (
    await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`)
  ).json()) as { data: Record<string, { name: string }> };
  const map = new Map<number, string>();
  for (const [id, it] of Object.entries(data.data)) map.set(Number(id), it.name);
  return map;
}

export async function getItemName(id: number | null | undefined): Promise<string> {
  if (!id) return "";
  if (!itemNames) {
    if (!itemInflight) itemInflight = fetchItemNames().then((m) => (itemNames = m)).finally(() => (itemInflight = null));
    await itemInflight;
  }
  return itemNames?.get(id) ?? `Item ${id}`;
}

// Numeric summoner-spell id -> Data Dragon spell key (icon is key + ".png").
export const SUMMONER_SPELL_KEY: Record<number, string> = {
  1: "SummonerBoost", 3: "SummonerExhaust", 4: "SummonerFlash", 6: "SummonerHaste",
  7: "SummonerHeal", 11: "SummonerSmite", 12: "SummonerTeleport", 13: "SummonerMana",
  14: "SummonerDot", 21: "SummonerBarrier", 30: "SummonerPoroRecall", 31: "SummonerPoroThrow",
  32: "SummonerSnowball", 39: "SummonerSnowURFSnowball_Mark", 54: "Summoner_UltBookPlaceholder",
};
