import type {
  LiveCompanionResponse, LivePlayer, LiveMatchup, LiveBuild, LiveBuildPhase, LiveBuildOption, LiveDraft, LiveBuildItem, Role, EnrichedMatch,
} from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll } from "./engine/enrich.ts";
import { getChampions } from "./ddragon.ts";
import { readLiveState, type RawLiveState } from "./lcu.ts";

// ---------------------------------------------------------------------------
// LIVE COMPANION ENGINE
//
// Turns a champ-select / in-game snapshot into: your matchup history vs the
// enemy laner, a build tuned to the enemy comp, and a draft readout. Rules-based
// (instant, free), and flexible to the game mode being played.
// ---------------------------------------------------------------------------

const QUEUE_MODE: Record<number, { name: string; hasLanes: boolean }> = {
  420: { name: "Ranked Solo/Duo", hasLanes: true },
  440: { name: "Ranked Flex", hasLanes: true },
  400: { name: "Normal Draft", hasLanes: true },
  430: { name: "Normal Blind", hasLanes: true },
  480: { name: "Swiftplay", hasLanes: true },
  490: { name: "Quickplay", hasLanes: true },
  700: { name: "Clash", hasLanes: true },
  450: { name: "ARAM", hasLanes: false },
  1700: { name: "Arena", hasLanes: false },
  1710: { name: "Arena", hasLanes: false },
  900: { name: "ARURF", hasLanes: false },
  1900: { name: "URF", hasLanes: false },
  1300: { name: "Nexus Blitz", hasLanes: false },
};

// The in-game Live Client Data API reports `gameMode` (not a queueId), so we map
// that too — this is what keeps the mode/lanes correct once a game starts.
const GAMEMODE_MODE: Record<string, { name: string; hasLanes: boolean }> = {
  CLASSIC: { name: "Summoner's Rift", hasLanes: true },
  ARAM: { name: "ARAM", hasLanes: false },
  CHERRY: { name: "Arena", hasLanes: false },
  URF: { name: "URF", hasLanes: false },
  ARURF: { name: "ARURF", hasLanes: false },
  NEXUSBLITZ: { name: "Nexus Blitz", hasLanes: false },
  ONEFORALL: { name: "One for All", hasLanes: true },
  ULTBOOK: { name: "Ultimate Spellbook", hasLanes: true },
  PRACTICETOOL: { name: "Practice Tool", hasLanes: true },
  TUTORIAL: { name: "Tutorial", hasLanes: true },
};

// Kit-based sets DDragon doesn't encode. Curated, not exhaustive — enough to
// drive the common situational item calls.
const AP_OVERRIDE = new Set(["Akali", "Ekko", "Fizz", "Katarina", "Diana", "Evelynn", "Kassadin", "Kayle", "Mordekaiser", "Gwen", "Rumble", "Vladimir", "Teemo", "Singed", "Swain", "Cassiopeia", "Elise", "Gragas", "Lillia", "Sylas", "Vex", "Kennen", "Heimerdinger", "Zyra", "Brand", "Velkoz", "Xerath", "Karma", "Nidalee", "Zoe", "Neeko", "Ryze", "Aurora"]);
const HEALERS = new Set(["Soraka", "Yuumi", "Nami", "Sona", "Vladimir", "Aatrox", "DrMundo", "Swain", "Sylas", "Warwick", "Nasus", "FiddleSticks", "Ivern", "Taric", "Senna", "Renekton", "Fiora", "Sett", "Briar", "Ambessa"]);
const HARD_CC = new Set(["Leona", "Nautilus", "Morgana", "Thresh", "Blitzcrank", "Amumu", "Malphite", "Sejuani", "Ashe", "Rell", "Braum", "Alistar", "Maokai", "Lissandra", "Skarner", "Ornn", "JarvanIV", "Zac", "Vi", "Nunu", "Sett", "Sion", "Neeko", "Rakan", "Pyke", "Warwick", "Elise", "Jhin", "Varus", "Poppy", "Bard", "Syndra", "Ahri", "Lux", "Veigar", "TwistedFate", "Galio", "Gnar", "Camille", "KSante", "Renata", "Gragas", "Cassiopeia"]);
const ASSASSINS = new Set(["Zed", "Talon", "Katarina", "Akali", "Fizz", "Diana", "Kassadin", "Qiyana", "Nocturne", "Rengar", "Khazix", "Kayn", "Naafiri", "Shaco", "Evelynn", "Pyke", "Yone"]);
// Bruiser/juggernaut divers that reach the backline — a carry itemizes against
// these the same way it does assassins (a defensive active/revive), even though
// DDragon doesn't tag them "Assassin".
const DIVERS = new Set(["MasterYi", "Tryndamere", "Jax", "Belveth", "XinZhao", "Kled", "Warwick", "Udyr", "Yasuo", "Camille", "Vi", "MonkeyKing", "Olaf", "Skarner", "Kindred", "Viego", "Briar", "Ambessa"]);

type ChampRec = { id: string; name: string; tags: string[] };
type Archetype = "marksman" | "mage" | "assassin" | "fighter" | "tank" | "support" | "unknown";

function classify(c: ChampRec | null): { ad: boolean; ap: boolean; tank: boolean } {
  if (!c) return { ad: false, ap: false, tank: false };
  const tags = c.tags ?? [];
  const tank = tags.includes("Tank");
  // A Marksman deals physical damage even when also tagged Mage (Kog'Maw, Kai'Sa,
  // Varus) — count it as AD unless it's a known AP build.
  const ap = AP_OVERRIDE.has(c.id) || (tags.includes("Mage") && !tags.includes("Marksman"));
  let ad = tags.includes("Marksman") || ((tags.includes("Fighter") || tags.includes("Assassin")) && !ap);
  if (!ad && !ap && !tank) ad = tags.includes("Fighter") || tags.includes("Assassin");
  return { ad, ap, tank };
}

// The player's role class — drives whether we recommend a DPS/carry build or a
// frontline/resist build. Coarse; damage type (AD/AP) comes from classify().
function archetype(c: ChampRec | null): Archetype {
  if (!c) return "unknown";
  const t = c.tags ?? [];
  if (t.includes("Marksman")) return "marksman";
  if (t.includes("Assassin")) return "assassin";
  if (t.includes("Mage")) return t.includes("Support") ? "support" : "mage";
  if (t.includes("Tank")) return "tank";
  if (t.includes("Fighter")) return "fighter";
  if (t.includes("Support")) return "support";
  return "unknown";
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const def = <T>(x: T | null | undefined): x is T => x != null;

// ---- matchup history (the star): your record on this champ vs this opponent --
const isLanelessQueue = (q?: string) => /ARAM|ARENA|CHERRY|URF|NEXUS|ONEFORALL/i.test(q ?? "");

function buildMatchup(myChamp: string | null, enemyChamp: string | null, career: EnrichedMatch[], hasLanes: boolean, nameOf: (id: string) => string): LiveMatchup | null {
  if (!myChamp) return null;
  const allOnChamp = career.filter((m) => m.objective.champion?.toLowerCase() === myChamp.toLowerCase());
  // Use mode-appropriate history: lane metrics (gold@15, cs@10) are meaningless in
  // ARAM/Arena and vice-versa. Prefer same-family games; fall back to all if thin.
  const family = allOnChamp.filter((m) => isLanelessQueue(m.objective.queue) === !hasLanes);
  const onChamp = family.length >= 2 ? family : allOnChamp;
  const champGames = onChamp.length;
  const vs = enemyChamp ? onChamp.filter((m) => (m.objective.opponentChampion ?? "").toLowerCase() === enemyChamp.toLowerCase()) : [];
  const useVs = vs.length >= 2;
  const sample = useVs ? vs : onChamp;

  const wr = (ms: EnrichedMatch[]) => (ms.length ? Math.round((ms.filter((m) => m.objective.win).length / ms.length) * 100) : null);
  const kda = avg(sample.filter((m) => m.objective.deaths != null).map((m) => (m.objective.kills! + m.objective.assists!) / Math.max(1, m.objective.deaths!)));
  const proc = avg(sample.map((m) => m.process.score));

  const stats: LiveMatchup["stats"] = [];
  const strengths: string[] = [];
  const focus: string[] = [];
  const kdaStat = () => { if (kda != null) stats.push({ label: "KDA", value: `${round1(kda)}`, tone: kda >= 3 ? "good" : kda < 1.8 ? "bad" : "neutral" }); };

  if (hasLanes) {
    // Lane phase: the early-game race is the story.
    const gold15 = avg(sample.map((m) => m.objective.goldDiffAt15).filter(def));
    const cs10 = avg(sample.map((m) => m.objective.csAt10).filter(def));
    const d15 = avg(sample.map((m) => m.objective.deathsBefore15).filter(def));
    if (gold15 != null) stats.push({ label: "Gold @ 15", value: `${gold15 >= 0 ? "+" : ""}${Math.round(gold15)}`, tone: gold15 >= 150 ? "good" : gold15 <= -200 ? "bad" : "neutral" });
    if (cs10 != null) stats.push({ label: "CS @ 10", value: `${round1(cs10)}`, tone: cs10 >= 70 ? "good" : cs10 < 58 ? "bad" : "neutral" });
    if (d15 != null) stats.push({ label: "Deaths < 15", value: `${round1(d15)}`, tone: d15 <= 1.5 ? "good" : d15 >= 3 ? "bad" : "neutral" });
    kdaStat();
    if (gold15 != null) { if (gold15 >= 150) strengths.push(`You win the early gold race (+${Math.round(gold15)}@15).`); else if (gold15 <= -200) focus.push(`You fall behind early (${Math.round(gold15)} gold@15) — respect their trades.`); }
    if (cs10 != null) { if (cs10 >= 72) strengths.push(`Clean farm (${round1(cs10)} CS@10) — keep it up.`); else if (cs10 < 58) focus.push(`Farm slips here (${round1(cs10)} CS@10) — prioritize last-hits over trades.`); }
    if (d15 != null) { if (d15 <= 1.5) strengths.push(`Disciplined early (${round1(d15)} deaths<15).`); else if (d15 >= 3) focus.push(`You die early a lot (${round1(d15)}<15) — play safer to your first item.`); }
  } else {
    // Laneless (ARAM/Arena): no lane, shared CS — teamfight metrics are the story.
    const kp = avg(sample.map((m) => m.objective.killParticipation).filter(def)); // 0..1
    const share = avg(sample.map((m) => m.objective.teamDamageShare).filter(def)); // 0..1
    const deaths = avg(sample.map((m) => m.objective.deaths).filter(def));
    kdaStat();
    if (kp != null) stats.push({ label: "Kill part.", value: `${Math.round(kp * 100)}%`, tone: kp >= 0.6 ? "good" : kp < 0.45 ? "bad" : "neutral" });
    if (share != null) stats.push({ label: "Damage share", value: `${Math.round(share * 100)}%`, tone: share >= 0.28 ? "good" : "neutral" });
    if (deaths != null) stats.push({ label: "Deaths / game", value: `${round1(deaths)}`, tone: deaths <= 5 ? "good" : deaths >= 9 ? "bad" : "neutral" });
    if (kp != null) { if (kp >= 0.65) strengths.push(`You're in nearly every fight (${Math.round(kp * 100)}% KP).`); else if (kp < 0.45) focus.push(`You miss fights (${Math.round(kp * 100)}% KP) — stick with the group and poke.`); }
    if (share != null && share >= 0.3) strengths.push(`You carry the damage (${Math.round(share * 100)}% team share).`);
    if (deaths != null) { if (deaths <= 5) strengths.push(`Disciplined positioning (${round1(deaths)} deaths/game).`); else if (deaths >= 9) focus.push(`You die a lot (${round1(deaths)}/game) — respect their poke; don't face-check.`); }
  }

  if (proc != null && proc >= 65) strengths.push(`High performance floor (${Math.round(proc)} avg).`);
  if (proc != null && proc < 50) focus.push(`Raise the floor (${Math.round(proc)} avg performance).`);
  if (strengths.length === 0) strengths.push("Play to your champion's core pattern.");
  if (focus.length === 0) focus.push(hasLanes ? "Nothing glaring — take the trades you know you win." : "Nothing glaring — play your angles and don't over-commit.");

  const meName = nameOf(myChamp);
  const oppName = enemyChamp ? nameOf(enemyChamp) : null;
  const note = oppName
    ? useVs
      ? `${vs.length} game${vs.length === 1 ? "" : "s"} into ${oppName} — ${wr(vs)}% WR.`
      : vs.length === 1
        ? `Only 1 game into ${oppName}; showing your overall ${meName} form (${champGames} games).`
        : `No games into ${oppName} yet; showing your overall ${meName} form (${champGames} games).`
    : `Your overall ${meName} form across ${champGames} game${champGames === 1 ? "" : "s"}.`;

  return {
    champion: myChamp,
    opponent: enemyChamp,
    vsGames: vs.length,
    champGames,
    vsWinRate: vs.length ? wr(vs) : null,
    champWinRate: wr(onChamp),
    stats,
    strengths: strengths.slice(0, 3),
    focus: focus.slice(0, 3),
    note,
  };
}

// ---- build path (full, phased, comp-aware) ---------------------------------
// A champion build STYLE lays out the standard opening + core so the full path
// is accurate without a per-champion DB. FLEX champs expose several styles; we
// score them against BOTH comps (fill your team's damage gap, counter theirs)
// and recommend the best. Each option then overlays comp-specific boots +
// situational picks tuned to that style's damage type.
const ONHIT_ADC = new Set(["KogMaw", "Kaisa", "Varus", "Vayne", "Twitch", "Belveth", "Kindred", "Teemo", "Rengar"]);
const CASTER_ADC = new Set(["Jhin", "Ezreal", "MissFortune", "Corki", "Senna", "Ashe", "Aphelios", "Smolder"]);
const BATTLEMAGE = new Set(["Cassiopeia", "Swain", "Rumble", "Singed", "Ryze", "Vladimir", "Malzahar", "Karthus", "Anivia", "Morgana", "AurelionSol", "Taliyah"]);
const ENCHANTER = new Set(["Nami", "Lulu", "Soraka", "Milio", "Yuumi", "Sona", "Karma", "Renata", "Janna", "Seraphine", "Ivern"]);
// Champions with genuinely viable multiple build paths → their candidate styles.
const FLEX: Record<string, string[]> = {
  Kayle: ["onhit_adc", "burst_mage"], Kaisa: ["onhit_adc", "ap_assassin"], Varus: ["onhit_adc", "burst_mage"],
  Ezreal: ["caster_adc", "burst_mage"], Teemo: ["onhit_adc", "burst_mage"], TwistedFate: ["burst_mage", "ad_assassin"],
  Gnar: ["bruiser", "tank"], Jax: ["bruiser", "onhit_adc"], Nidalee: ["burst_mage", "ad_assassin"],
  Yasuo: ["crit_adc", "bruiser"], Yone: ["crit_adc", "bruiser"], Akshan: ["crit_adc", "ad_assassin"],
  Lillia: ["battlemage", "ap_assassin"], Diana: ["ap_assassin", "ap_bruiser"], Ekko: ["ap_assassin", "ap_bruiser"],
};

const item = (name: string, itemId: number, reason: string): LiveBuildItem => ({ name, itemId, reason });

// Items that don't exist in the ARAM (Howling Abyss) shop → substitutes that do.
// Keeps the original reason; only swaps the item. Extend as needed.
const ARAM_SUB: Record<number, { name: string; itemId: number }> = {
  3026: { name: "Sterak's Gage / Death's Dance", itemId: 3053 }, // Guardian Angel isn't in ARAM
  3865: { name: "Doran's Ring / Blade", itemId: 1056 }, // no support quest item in ARAM
};
const aramSwap = (it: LiveBuildItem): LiveBuildItem => {
  const s = it.itemId != null ? ARAM_SUB[it.itemId] : undefined;
  return s ? { name: s.name, itemId: s.itemId, reason: it.reason } : it;
};

interface Style {
  label: string; blurb: string; dmg: "ad" | "ap" | "none"; carry: boolean;
  boots: "attack" | "sorc" | "ionian" | "comp"; start: LiveBuildItem[]; core: LiveBuildItem[];
}
const STYLES: Record<string, Style> = {
  crit_adc: { label: "Crit DPS", blurb: "Steady auto-attack damage that scales", dmg: "ad", carry: true, boots: "attack",
    start: [item("Doran's Blade", 1055, "Start + Health Potion")],
    core: [item("Kraken Slayer / The Collector", 6672, "First-item damage spike"), item("Infinity Edge", 3031, "Crit spike at ~40% crit"), item("Phantom Dancer / Rapid Firecannon", 3046, "AS + crit; Lord Dominik's vs HP")] },
  onhit_adc: { label: "On-hit DPS", blurb: "Attack-speed shred, great vs tanks", dmg: "ad", carry: true, boots: "attack",
    start: [item("Doran's Blade", 1055, "Start + Health Potion")],
    core: [item("Blade of the Ruined King / Kraken", 3153, "On-hit + %max-HP shred"), item("Guinsoo's Rageblade", 3124, "Doubles on-hit effects"), item("Runaan's Hurricane", 3085, "Spread on-hit across their team")] },
  caster_adc: { label: "Caster / lethality", blurb: "Ability-weighted burst and pick", dmg: "ad", carry: true, boots: "attack",
    start: [item("Doran's Blade", 1055, "Start + Health Potion")],
    core: [item("First item (Eclipse / Manamune / Kraken)", 6692, "Your kit's first spike"), item("The Collector / Infinity Edge", 6676, "Damage + execute"), item("Serylda's / Lord Dominik's", 6694, "Pen vs their frontline")] },
  burst_mage: { label: "AP burst", blurb: "Delete a target in one combo", dmg: "ap", carry: true, boots: "sorc",
    start: [item("Doran's Ring", 1056, "Start + 2 Health Potions")],
    core: [item("Luden's Companion / Malignance", 6655, "Waveclear + first burst"), item("Shadowflame", 4645, "Burst vs low-HP targets"), item("Rabadon's Deathcap", 3089, "AP multiplier")] },
  battlemage: { label: "AP sustained", blurb: "%HP burn and durability in long fights", dmg: "ap", carry: true, boots: "sorc",
    start: [item("Corrupting Potion", 2033, "Sustained mana + poke")],
    core: [item("Liandry's Torment", 6653, "%HP burn"), item("Rylai's / Riftmaker", 3116, "Slow + durability"), item("Rabadon's Deathcap", 3089, "Scale your damage")] },
  ad_assassin: { label: "AD assassin", blurb: "Lethality burst on the backline", dmg: "ad", carry: true, boots: "ionian",
    start: [item("Long Sword", 1036, "Start + Refillable Potion")],
    core: [item("Youmuu's / Profane Hydra", 3142, "Lethality + roam speed"), item("The Collector / Opportunity", 6676, "Execute threshold"), item("Edge of Night / Serylda's", 3814, "Spell shield / pen")] },
  ap_assassin: { label: "AP assassin", blurb: "Magic burst on squishies", dmg: "ap", carry: true, boots: "sorc",
    start: [item("Doran's Ring", 1056, "Start + 2 Health Potions")],
    core: [item("Hextech Rocketbelt / Lich Bane", 3152, "Gap-close / proc burst"), item("Shadowflame", 4645, "Burst vs squishies"), item("Zhonya's Hourglass", 3157, "Survive your own dive")] },
  bruiser: { label: "Bruiser", blurb: "Durable frontline damage", dmg: "ad", carry: false, boots: "comp",
    start: [item("Doran's Blade", 1055, "Start + Health Potion")],
    core: [item("Eclipse / Trinity / Stridebreaker", 6692, "First fighting item"), item("Black Cleaver", 3071, "Armor shred + durability"), item("Sterak's / Death's Dance", 3053, "Survive what you dive into")] },
  ap_bruiser: { label: "AP bruiser", blurb: "Durable magic damage", dmg: "ap", carry: false, boots: "comp",
    start: [item("Doran's Ring", 1056, "Start + 2 Health Potions")],
    core: [item("Riftmaker", 4633, "Omnivamp + durability"), item("Liandry's Torment", 6653, "%HP burn"), item("Zhonya's / Cosmic Drive", 3157, "Survivability / haste")] },
  tank: { label: "Tank", blurb: "Frontline that soaks and engages", dmg: "none", carry: false, boots: "comp",
    start: [item("Doran's Shield", 1054, "Start + Health Potion")],
    core: [item("Sunfire Aegis / Jak'Sho", 3068, "First resist + damage"), item("Second resist by their damage", 6665, "Armor vs AD, MR vs AP"), item("Warmog's / Kaenic Rookern", 3083, "Bulk to hold the front")] },
  enchanter: { label: "Enchanter", blurb: "Shields, heals, buffs for carries", dmg: "ap", carry: false, boots: "comp",
    start: [item("World Atlas", 3865, "Support item — upgrade by ~14 min")],
    core: [item("Moonstone / Imperial Mandate", 6617, "First support spike"), item("Mikael's / Redemption", 3222, "Cleanse / AoE heal"), item("Ardent Censer / Staff of Flowing Water", 3504, "Buff your carries")] },
  engage_support: { label: "Engage support", blurb: "Frontline CC and peel", dmg: "none", carry: false, boots: "comp",
    start: [item("World Atlas", 3865, "Support item — upgrade by ~14 min")],
    core: [item("Locket of the Iron Solari", 3190, "Team shield on engage"), item("Knight's Vow / Zeke's", 3109, "Tether your carry"), item("Second resist by their damage", 3075, "Armor vs AD, MR vs AP")] },
  generic: { label: "Standard", blurb: "Your champion's usual path", dmg: "ad", carry: true, boots: "comp",
    start: [item("Doran's item + Potion", 1055, "Your champion's usual start")],
    core: [item("Your 2–3 core items", 0, "Build your champion's standard core first")] },
};

function styleKey(mine: ChampRec | null, arch: Archetype, meAp: boolean): string {
  const id = mine?.id ?? "";
  switch (arch) {
    case "marksman": return ONHIT_ADC.has(id) ? "onhit_adc" : CASTER_ADC.has(id) ? "caster_adc" : "crit_adc";
    case "mage": return BATTLEMAGE.has(id) ? "battlemage" : "burst_mage";
    case "assassin": return meAp ? "ap_assassin" : "ad_assassin";
    case "fighter": return meAp ? "ap_bruiser" : "bruiser";
    case "tank": return "tank";
    case "support": return ENCHANTER.has(id) ? "enchanter" : "engage_support";
    default: return "generic";
  }
}

interface Comp { ad: number; ap: number; tank: number; cc: number; healing: number; divers: number; enemies: ChampRec[] }

// A champion's damage type AS A CARRY, for reading YOUR team's damage balance.
// Unlike classify() (which flags any threat, so an AP-tagged tank like Malphite —
// tagged Tank+Mage — counts as AP for resist purposes), this ignores tanks and
// supports: they aren't the carry damage your comp might be missing. Reads the
// Tank/Support tags directly because archetype() prioritizes Mage over Tank.
function carryDamage(c: ChampRec): "ad" | "ap" | "none" {
  const t = c.tags ?? [];
  if (t.includes("Tank")) return "none";
  if (t.includes("Support") && !t.includes("Marksman")) return "none";
  const cl = classify(c);
  if (cl.ap && !cl.ad) return "ap";
  if (cl.ad) return "ad";
  return "none";
}

function bootsFor(s: Style, comp: Comp): LiveBuildItem {
  if (s.boots === "attack") return item("Berserker's Greaves", 3006, "Attack speed for your DPS");
  if (s.boots === "sorc") return comp.cc >= 2 ? item("Mercury's Treads", 3111, `${comp.cc} hard-CC — tenacity`) : item("Sorcerer's Shoes", 3020, "Magic penetration");
  if (s.boots === "ionian") return item("Ionian Boots of Lucidity", 3158, "Ability haste");
  if ((comp.ap >= 2 && comp.ap >= comp.ad) || comp.cc >= 2) return item("Mercury's Treads", 3111, comp.cc >= 2 ? `${comp.cc} hard-CC — tenacity + MR` : `${comp.ap} AP threats — magic resist`);
  if (comp.ad >= 2) return item("Plated Steelcaps", 3047, `${comp.ad} AD threats — cut their physical damage`);
  return item("Boots by matchup", 3047, "Defensive boots vs their main damage");
}

// Situational items tuned to THIS style's damage type + whether it's a squishy carry.
function situationalFor(s: Style, comp: Comp): LiveBuildItem[] {
  const { ad, ap, tank, cc, healing, divers, enemies } = comp;
  const meAp = s.dmg === "ap";
  const out: LiveBuildItem[] = [];
  const push = (n: string, id: number, r: string) => out.push(item(n, id, r));
  if (healing >= 1) {
    const h = `their ${healing} healing threat${healing === 1 ? "" : "s"}`;
    if (meAp) push("Morellonomicon", 3165, `Cut ${h} — Grievous Wounds`);
    else if (!s.carry) push("Thornmail", 3075, `Armor + Grievous Wounds vs ${h}`);
    else push("Executioner's → Mortal Reminder", 3123, `Cut ${h} — Grievous Wounds`);
  }
  if (s.carry) {
    if (ap >= 2) {
      if (s.dmg === "ad") push("Wit's End", 3091, `${ap} AP threats — on-hit MR that shreds back`);
      else if (meAp) push("Banshee's Veil", 3102, `${ap} AP threats — a spell shield`);
      else push("Maw of Malmortius", 3156, `${ap} AP threats — a magic lifeline`);
    } else if (ad >= 2) push(meAp ? "Zhonya's Hourglass" : "Guardian Angel", meAp ? 3157 : 3026, `${ad} AD threats — stasis/revive`);
    if (divers >= 1) push(meAp ? "Zhonya's Hourglass" : "Guardian Angel", meAp ? 3157 : 3026, `${divers} diver${divers === 1 ? "" : "s"} (${enemies.find((c) => ASSASSINS.has(c.id) || DIVERS.has(c.id))?.name ?? "assassins"}) hunting you`);
    if (cc >= 2) push("Mercurial Scimitar (QSS)", 3139, `Heavy CC (${cc}) — cleanse the pick`);
  } else {
    if (ad >= 3) push("Randuin's Omen / Thornmail", 3143, `Heavy AD (${ad}) — armor swings fights`);
    else if (ad >= 2 && tank === 0) push("Frozen Heart / Randuin's", 3110, `Multiple AD (${ad}) — armor`);
    if (ap >= 3) push("Spirit Visage / Force of Nature", 3065, `Heavy AP (${ap}) — magic resist`);
    else if (ap >= 2) push("Kaenic Rookern / Spirit Visage", 3065, `Multiple AP (${ap}) — magic resist`);
    if (divers >= 1) push("Guardian Angel", 3026, `${divers} diver${divers === 1 ? "" : "s"} — a second life`);
    if (cc >= 2) push("Mercurial Scimitar / Silvermere", 3139, `Heavy CC (${cc}) — a cleanse`);
  }
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.name) ? false : (seen.add(i.name), true))).slice(0, 3);
}

function optionPhases(s: Style, comp: Comp): LiveBuildPhase[] {
  const phases: LiveBuildPhase[] = [
    { phase: "Opening", when: "Start", items: s.start },
    { phase: "Boots", when: "First or second back", items: [bootsFor(s, comp)] },
    { phase: "Core", when: "First 2–3 items", items: s.core },
  ];
  const sit = situationalFor(s, comp);
  if (sit.length) phases.push({ phase: "Situational", when: "Slot in vs their comp", items: sit });
  return phases;
}

// The full build: labeled options (flex champs get several), scored against BOTH
// comps and sorted best-first.
function buildBuild(mine: ChampRec | null, allies: ChampRec[], enemies: ChampRec[], laneless: boolean): LiveBuild {
  const cls = enemies.map(classify);
  const comp: Comp = {
    ad: cls.filter((c) => c.ad).length,
    ap: cls.filter((c) => c.ap).length,
    tank: cls.filter((c) => c.tank).length,
    cc: enemies.filter((c) => HARD_CC.has(c.id)).length,
    healing: enemies.filter((c) => HEALERS.has(c.id)).length,
    divers: enemies.filter((c) => ASSASSINS.has(c.id) || DIVERS.has(c.id)).length,
    enemies,
  };

  const arch = archetype(mine);
  const meAp = (() => { const c = classify(mine); return c.ap && !c.ad; })();
  const primary = styleKey(mine, arch, meAp);
  const keys = Array.from(new Set([primary, ...(mine ? FLEX[mine.id] ?? [] : [])]));

  // Your team's damage gap — computed over the WHOLE team (you + allies) with
  // carryDamage, the SAME basis as the draft readout, so the two never disagree
  // (e.g. "no AP" here vs "AP-leaning" there). carryDamage ignores tanks/supports
  // so an AP-tagged tank (Malphite = Tank+Mage) doesn't count as an AP carry.
  const teamMembers = [mine, ...allies].filter((c): c is ChampRec => !!c);
  const teamDmg = teamMembers.map(carryDamage);
  const teamAd = teamDmg.filter((t) => t === "ad").length;
  const teamAp = teamDmg.filter((t) => t === "ap").length;
  const teamFront = teamMembers.filter((c) => { const t = c.tags ?? []; return t.includes("Tank") || t.includes("Fighter"); }).length;
  const sized = teamMembers.length >= 3; // enough of the comp known to judge gaps
  const noAp = sized && teamAp === 0, noAd = sized && teamAd === 0;
  const noFront = teamMembers.length >= 4 && teamFront === 0;

  const built = keys.map((k) => ({ key: k, style: STYLES[k] ?? STYLES.generic }));
  // Can THIS champion actually build the missing damage type? If not, don't tell
  // an AD-only champ like Smolder to "go AP" — just describe the gap.
  const canGoAp = built.some((b) => b.style.dmg === "ap");
  const canGoAd = built.some((b) => b.style.dmg === "ad");
  const teamNeeds: string[] = [];
  if (noAp) teamNeeds.push(canGoAp ? "Your team has no AP — the AP option below rounds out your damage." : "Your team's damage is all physical — expect them to stack armor.");
  if (noAd) teamNeeds.push(canGoAd ? "Your team has no AD — the AD option below rounds out your damage." : "Your team's damage is all magic — expect them to stack magic resist.");
  if (noFront) teamNeeds.push("Your team lacks a frontline — a durable build helps you hold space.");

  // Score each candidate style: fill the team's damage gap + counter the enemy.
  const score = (s: Style): number => {
    let n = 0;
    if (noAp && s.dmg === "ap") n += 3; // fill missing AP
    if (noAd && s.dmg === "ad") n += 3; // fill missing AD
    if (noFront && !s.carry) n += 2; // add frontline
    if (comp.tank >= 2 && s.dmg === "ad" && s.boots === "attack") n += 1; // %HP shred vs tanks
    return n;
  };

  let bestScore = -1, bestIdx = 0;
  built.forEach((b, i) => { const sc = score(b.style); if (sc > bestScore) { bestScore = sc; bestIdx = i; } });

  const options: LiveBuildOption[] = built.map((b, i) => {
    const rec = i === bestIdx;
    const fits: string[] = [];
    if (noAp && b.style.dmg === "ap") fits.push("adds the AP your team is missing");
    if (noAd && b.style.dmg === "ad") fits.push("adds the AD your team is missing");
    if (noFront && !b.style.carry) fits.push("gives your team a frontline");
    if (comp.tank >= 2 && b.style.dmg === "ad" && b.style.boots === "attack") fits.push("shreds their tanks");
    const fit = fits.length ? `Best fit — ${fits.join(", ")}.` : rec ? "Your standard, comp-adapted path." : `Alternative — ${b.style.blurb.toLowerCase()}.`;
    // ARAM has a restricted shop — swap out items that don't exist there.
    const phases = optionPhases(b.style, comp).map((ph) => (laneless ? { ...ph, items: ph.items.map(aramSwap) } : ph));
    return { id: b.key, label: b.style.label, blurb: b.style.blurb, recommended: rec, fit, phases };
  }).sort((a, b) => (a.recommended === b.recommended ? 0 : a.recommended ? -1 : 1));

  const compStr = comp.ad + comp.ap + comp.tank === 0 ? null : `${comp.ad} AD · ${comp.ap} AP · ${comp.tank} tank${comp.cc ? ` · ${comp.cc} hard-CC` : ""}${comp.healing ? ` · ${comp.healing} healing` : ""}`;
  const summary = compStr ? `Enemy comp: ${compStr}.` : "Not enough enemy picks to read the comp.";

  return { profile: { ad: comp.ad, ap: comp.ap, tank: comp.tank, cc: comp.cc, healing: comp.healing }, teamNeeds, summary, options };
}

// ---- draft readout ---------------------------------------------------------
function draftReadout(team: ChampRec[], enemies: ChampRec[]): LiveDraft {
  // Use carryDamage (tanks/supports excluded) so the lean reflects real damage
  // dealers — and matches the build's team-gap read, which uses the same basis.
  const dmg = (cs: ChampRec[]) => {
    const t = cs.map(carryDamage);
    const ad = t.filter((x) => x === "ad").length;
    const ap = t.filter((x) => x === "ap").length;
    return ad === 0 && ap === 0 ? "Unknown" : ad >= ap * 2 ? "AD-leaning" : ap >= ad * 2 ? "AP-leaning" : "Mixed";
  };
  const yourDamage = dmg(team);
  const enemyDamage = dmg(enemies);

  const yourNotes: string[] = [];
  const enemyNotes: string[] = [];
  if (enemyDamage === "AD-leaning") yourNotes.push("Enemy is AD-heavy — armor is a free power spike for you.");
  if (enemyDamage === "AP-leaning") yourNotes.push("Enemy is AP-heavy — magic resist scales all game.");
  if (yourDamage !== "Mixed" && yourDamage !== "Unknown") enemyNotes.push(`Your team is ${yourDamage} — they can itemize one resist against you.`);
  const cc = enemies.filter((c) => HARD_CC.has(c.id)).length;
  if (cc >= 2) yourNotes.push(`Enemy has ${cc} hard-CC — respect their engage windows; tenacity matters.`);
  const heal = enemies.filter((c) => HEALERS.has(c.id)).length;
  if (heal >= 1) yourNotes.push(`Enemy healing (${heal}) — rush Grievous Wounds.`);

  // Soft favor: a one-dimensional enemy comp is easy to itemize against.
  const favored: LiveDraft["favored"] =
    enemyDamage !== "Mixed" && enemyDamage !== "Unknown" && (yourDamage === "Mixed")
      ? "you"
      : yourDamage !== "Mixed" && yourDamage !== "Unknown" && enemyDamage === "Mixed"
        ? "enemy"
        : "even";
  const readout =
    favored === "you"
      ? "You can itemize cleanly against a one-sided enemy comp."
      : favored === "enemy"
        ? "Your damage is one-sided — expect them to build the counter resist."
        : "Balanced draft — the lane and mid-game execution decide it.";

  return { yourDamage, enemyDamage, favored, readout, yourNotes: yourNotes.slice(0, 4), enemyNotes: enemyNotes.slice(0, 3) };
}

// A cheap liveness check — just the client phase, no career enrichment / build /
// matchup. Polled while a game is in progress (the readout is static then), so
// we're not rebuilding the whole companion every tick just to notice the end.
export async function liveStatus(): Promise<{ clientDetected: boolean; phase: string; inGame: boolean }> {
  const raw = await readLiveState();
  return { clientDetected: raw.clientDetected, phase: raw.phase, inGame: raw.source != null };
}

// ---- assemble --------------------------------------------------------------
export async function buildLiveCompanion(mock: boolean, opponentId?: string | null): Promise<LiveCompanionResponse> {
  const { champions } = await getChampions().catch(() => ({ champions: [] as any[] }));
  const byKey = new Map<number, ChampRec>();
  const byId = new Map<string, ChampRec>();
  const byName = new Map<string, ChampRec>();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const c of champions) {
    const rec: ChampRec = { id: c.id, name: c.name, tags: c.tags ?? [] };
    byKey.set(Number(c.key), rec);
    byId.set(norm(c.id), rec);
    byName.set(norm(c.name), rec);
  }
  const resolve = (v: string | number | null | undefined): ChampRec | null => {
    if (v == null) return null;
    if (typeof v === "number") return byKey.get(v) ?? null;
    return byId.get(norm(v)) ?? byName.get(norm(v)) ?? null;
  };

  const raw: RawLiveState = mock ? mockRawState() : await readLiveState();
  // Mode resolution: champ select gives a precise queueId (via the LCU); the
  // in-game Live Client Data API does NOT return queueId, only `gameMode` + map,
  // so fall back to that so the mode (and hasLanes) survives into the game.
  const modeInfo =
    (raw.queueId != null && QUEUE_MODE[raw.queueId]) ? QUEUE_MODE[raw.queueId]
    : (raw.gameMode && GAMEMODE_MODE[raw.gameMode.toUpperCase()]) ? GAMEMODE_MODE[raw.gameMode.toUpperCase()]
    : raw.queueId != null || raw.gameMode ? { name: "Other", hasLanes: false }
    : { name: "—", hasLanes: false };

  const base: LiveCompanionResponse = {
    phase: raw.phase,
    clientDetected: raw.clientDetected,
    inGame: raw.source != null,
    source: mock ? "mock" : "live",
    mode: modeInfo.name,
    hasLanes: modeInfo.hasLanes,
    mine: null, allies: [], enemies: [], enemyLaner: null,
    matchup: null, build: null, draft: null,
  };
  if (!raw.source) return base;

  // Resolve champions from either source.
  let mine: ChampRec | null;
  let myRole: Role | null;
  let allyRecs: { rec: ChampRec | null; role: Role | null }[];
  let enemyRecs: { rec: ChampRec | null; role: Role | null }[];
  if (raw.ingame) {
    mine = resolve(raw.ingame.mine?.champion ?? null);
    myRole = raw.ingame.mine?.role ?? null;
    allyRecs = raw.ingame.allies.map((a) => ({ rec: resolve(a.champion), role: a.role }));
    enemyRecs = raw.ingame.enemies.map((e) => ({ rec: resolve(e.champion), role: e.role }));
  } else {
    mine = resolve(raw.mineKey);
    myRole = raw.myRole;
    allyRecs = raw.allies.map((a) => ({ rec: resolve(a.key), role: a.role }));
    enemyRecs = raw.enemies.map((e) => ({ rec: resolve(e.key), role: e.role }));
  }
  const enemies = enemyRecs.map((e) => e.rec).filter(def);
  const team = [mine, ...allyRecs.map((a) => a.rec)].filter(def);
  const toP = (r: ChampRec | null, role: Role | null): LivePlayer | null => (r ? { champion: r.id, role } : null);

  const career = enrichAll(store.matches(), store.seasons(), store.activePool());

  // Who's your matchup opponent? The user can pick ANY enemy (opponentId) — e.g.
  // designate the enemy ADC in an ARAM. Absent that, choose deterministically:
  //   1) an enemy in your role (lane modes), 2) the enemy you've faced most on
  //   this champ, 3) an enemy of your own class, 4) the first enemy.
  let enemyLaner: { rec: ChampRec | null; role: Role | null } | null = null;
  const chosen = opponentId ? enemyRecs.find((e) => e.rec && e.rec.id.toLowerCase() === opponentId.toLowerCase()) : null;
  if (chosen) {
    enemyLaner = chosen;
  } else {
    if (modeInfo.hasLanes && myRole) enemyLaner = enemyRecs.find((e) => e.role && e.role === myRole && e.rec) ?? null;
    if (!enemyLaner && mine) {
      const onChamp = career.filter((m) => m.objective.champion?.toLowerCase() === mine!.id.toLowerCase());
      let best: { rec: ChampRec | null; role: Role | null } | null = null;
      let bestN = 0;
      for (const e of enemyRecs) {
        if (!e.rec) continue;
        const n = onChamp.filter((m) => (m.objective.opponentChampion ?? "").toLowerCase() === e.rec!.id.toLowerCase()).length;
        if (n > bestN) { bestN = n; best = e; }
      }
      enemyLaner = best;
    }
    if (!enemyLaner && mine) {
      const myArch = archetype(mine);
      enemyLaner = enemyRecs.find((e) => e.rec && archetype(e.rec) === myArch) ?? null;
    }
    if (!enemyLaner) enemyLaner = enemyRecs.find((e) => e.rec) ?? null;
  }

  const nameOf = (id: string) => byId.get(norm(id))?.name ?? id;
  const alliesOnly = allyRecs.map((a) => a.rec).filter(def);
  const matchup = buildMatchup(mine?.id ?? null, enemyLaner?.rec?.id ?? null, career, modeInfo.hasLanes, nameOf);
  const build = buildBuild(mine, alliesOnly, enemies, !modeInfo.hasLanes);
  const draft = draftReadout(team, enemies);

  return {
    ...base,
    mine: toP(mine, myRole),
    allies: allyRecs.map((a) => toP(a.rec, a.role)).filter(def),
    enemies: enemyRecs.map((e) => toP(e.rec, e.role)).filter(def),
    enemyLaner: enemyLaner?.rec ? toP(enemyLaner.rec, enemyLaner.role) : null,
    matchup, build, draft,
  };
}

// A synthetic champ-select using champions likely in the player's history, so
// the whole pipeline (incl. matchup lookup) can be exercised without League.
function mockRawState(): RawLiveState {
  return {
    clientDetected: true, phase: "ChampSelect", queueId: 420, gameMode: null, source: "champselect",
    mineKey: null, myRole: "BOT", allies: [], enemies: [],
    ingame: {
      mine: { champion: "Kaisa", role: "BOT" },
      allies: [
        { champion: "Thresh", role: "SUPPORT" }, { champion: "LeeSin", role: "JUNGLE" },
        { champion: "Yasuo", role: "MID" }, { champion: "Malphite", role: "TOP" },
      ],
      enemies: [
        { champion: "Caitlyn", role: "BOT" }, { champion: "Bard", role: "SUPPORT" },
        { champion: "MasterYi", role: "JUNGLE" }, { champion: "Syndra", role: "MID" }, { champion: "Poppy", role: "TOP" },
      ],
    },
  };
}
