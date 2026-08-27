import type { Role } from "../shared/types.ts";

// ---------------------------------------------------------------------------
// CHAMPION LANE ROLES
//
// Data Dragon exposes class tags (Fighter/Mage/…) but not lane positions, so we
// keep a curated map of the common role(s) each champion is played in. Used to
// filter the champion grid by role — including champions you haven't played, so
// clicking "Top" shows every Top champion, not just your own. Not exhaustive of
// off-meta flex picks; the roles you'd actually queue for. Keyed by DDragon id.
// ---------------------------------------------------------------------------

export const CHAMPION_ROLES: Record<string, Role[]> = {
  Aatrox: ["TOP"], Ahri: ["MID"], Akali: ["MID", "TOP"], Akshan: ["MID", "TOP"],
  Alistar: ["SUPPORT"], Ambessa: ["TOP"], Amumu: ["JUNGLE", "SUPPORT"], Anivia: ["MID"],
  Annie: ["MID", "SUPPORT"], Aphelios: ["BOT"], Ashe: ["BOT", "SUPPORT"], AurelionSol: ["MID"],
  Aurora: ["MID", "TOP"], Azir: ["MID"], Bard: ["SUPPORT"], Belveth: ["JUNGLE"],
  Blitzcrank: ["SUPPORT"], Brand: ["SUPPORT", "MID"], Braum: ["SUPPORT"], Briar: ["JUNGLE"],
  Caitlyn: ["BOT"], Camille: ["TOP"], Cassiopeia: ["MID"], Chogath: ["TOP"],
  Corki: ["MID", "BOT"], Darius: ["TOP"], Diana: ["JUNGLE", "MID"], Draven: ["BOT"],
  DrMundo: ["TOP"], Ekko: ["JUNGLE", "MID"], Elise: ["JUNGLE"], Evelynn: ["JUNGLE"],
  Ezreal: ["BOT"], Fiddlesticks: ["JUNGLE"], Fiora: ["TOP"], Fizz: ["MID"],
  Galio: ["MID", "SUPPORT"], Gangplank: ["TOP"], Garen: ["TOP"], Gnar: ["TOP"],
  Gragas: ["JUNGLE", "TOP"], Graves: ["JUNGLE"], Gwen: ["TOP", "JUNGLE"], Hecarim: ["JUNGLE"],
  Heimerdinger: ["MID", "SUPPORT", "TOP"], Hwei: ["MID", "SUPPORT"], Illaoi: ["TOP"],
  Irelia: ["TOP", "MID"], Ivern: ["JUNGLE"], Janna: ["SUPPORT"], JarvanIV: ["JUNGLE"],
  Jax: ["TOP", "JUNGLE"], Jayce: ["TOP", "MID"], Jhin: ["BOT"], Jinx: ["BOT"],
  Kaisa: ["BOT"], Kalista: ["BOT"], Karma: ["SUPPORT", "MID"], Karthus: ["JUNGLE", "MID"],
  Kassadin: ["MID"], Katarina: ["MID"], Kayle: ["TOP"], Kayn: ["JUNGLE"],
  Kennen: ["TOP"], Khazix: ["JUNGLE"], Kindred: ["JUNGLE"], Kled: ["TOP"],
  KogMaw: ["BOT"], KSante: ["TOP"], Leblanc: ["MID"], LeeSin: ["JUNGLE"],
  Leona: ["SUPPORT"], Lillia: ["JUNGLE"], Lissandra: ["MID"], Lucian: ["BOT", "MID"],
  Lulu: ["SUPPORT"], Lux: ["SUPPORT", "MID"], Malphite: ["TOP", "SUPPORT"], Malzahar: ["MID"],
  Maokai: ["SUPPORT", "JUNGLE", "TOP"], MasterYi: ["JUNGLE"], Milio: ["SUPPORT"], MissFortune: ["BOT"],
  MonkeyKing: ["TOP", "JUNGLE"], Mordekaiser: ["TOP"], Morgana: ["SUPPORT", "MID"], Naafiri: ["MID", "JUNGLE"],
  Nami: ["SUPPORT"], Nasus: ["TOP"], Nautilus: ["SUPPORT"], Neeko: ["MID", "SUPPORT"],
  Nidalee: ["JUNGLE"], Nilah: ["BOT"], Nocturne: ["JUNGLE"], Nunu: ["JUNGLE"],
  Olaf: ["TOP", "JUNGLE"], Orianna: ["MID"], Ornn: ["TOP"], Pantheon: ["TOP", "SUPPORT", "MID"],
  Poppy: ["TOP", "JUNGLE", "SUPPORT"], Pyke: ["SUPPORT"], Qiyana: ["MID"], Quinn: ["TOP"],
  Rakan: ["SUPPORT"], Rammus: ["JUNGLE"], RekSai: ["JUNGLE"], Rell: ["SUPPORT"],
  Renata: ["SUPPORT"], Renekton: ["TOP"], Rengar: ["JUNGLE", "TOP"], Riven: ["TOP"],
  Rumble: ["TOP", "MID"], Ryze: ["MID", "TOP"], Samira: ["BOT"], Sejuani: ["JUNGLE"],
  Senna: ["SUPPORT", "BOT"], Seraphine: ["SUPPORT", "MID", "BOT"], Sett: ["TOP", "SUPPORT"], Shaco: ["JUNGLE"],
  Shen: ["TOP"], Shyvana: ["JUNGLE"], Singed: ["TOP"], Sion: ["TOP"],
  Sivir: ["BOT"], Skarner: ["JUNGLE"], Smolder: ["BOT"], Sona: ["SUPPORT"],
  Soraka: ["SUPPORT"], Swain: ["MID", "SUPPORT", "BOT"], Sylas: ["MID", "TOP"], Syndra: ["MID"],
  TahmKench: ["TOP", "SUPPORT"], Taliyah: ["JUNGLE", "MID"], Talon: ["MID", "JUNGLE"], Taric: ["SUPPORT"],
  Teemo: ["TOP"], Thresh: ["SUPPORT"], Tristana: ["BOT", "MID"], Trundle: ["JUNGLE", "TOP"],
  Tryndamere: ["TOP"], TwistedFate: ["MID"], Twitch: ["BOT"], Udyr: ["JUNGLE"],
  Urgot: ["TOP"], Varus: ["BOT"], Vayne: ["BOT", "TOP"], Veigar: ["MID", "SUPPORT"],
  Velkoz: ["SUPPORT", "MID"], Vex: ["MID"], Vi: ["JUNGLE"], Viego: ["JUNGLE"],
  Viktor: ["MID"], Vladimir: ["MID", "TOP"], Volibear: ["JUNGLE", "TOP"], Warwick: ["JUNGLE", "TOP"],
  Xayah: ["BOT"], Xerath: ["MID", "SUPPORT"], XinZhao: ["JUNGLE"], Yasuo: ["MID", "TOP"],
  Yone: ["MID", "TOP"], Yorick: ["TOP"], Yunara: ["BOT"], Yuumi: ["SUPPORT"],
  Zac: ["JUNGLE"], Zed: ["MID"], Zeri: ["BOT"], Ziggs: ["MID", "BOT"],
  Zilean: ["SUPPORT", "MID"], Zoe: ["MID"], Zyra: ["SUPPORT"],
};

export function rolesFor(id: string): Role[] {
  return CHAMPION_ROLES[id] ?? [];
}
