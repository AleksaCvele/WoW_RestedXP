// Static World of Warcraft metadata: class colors, names, races and factions.

export interface ClassInfo {
  name: string;
  color: string;
  /** File name (without extension) in src/assets/classes */
  icon: string;
}

/** Official in-game class colors. */
export const CLASSES: Record<string, ClassInfo> = {
  WARRIOR: { name: "Warrior", color: "#C69B6D", icon: "warrior" },
  PALADIN: { name: "Paladin", color: "#F48CBA", icon: "paladin" },
  HUNTER: { name: "Hunter", color: "#AAD372", icon: "hunter" },
  ROGUE: { name: "Rogue", color: "#FFF468", icon: "rogue" },
  PRIEST: { name: "Priest", color: "#FFFFFF", icon: "priest" },
  DEATHKNIGHT: { name: "Death Knight", color: "#C41E3A", icon: "deathknight" },
  SHAMAN: { name: "Shaman", color: "#0070DD", icon: "shaman" },
  MAGE: { name: "Mage", color: "#3FC7EB", icon: "mage" },
  WARLOCK: { name: "Warlock", color: "#8788EE", icon: "warlock" },
  MONK: { name: "Monk", color: "#00FF98", icon: "monk" },
  DRUID: { name: "Druid", color: "#FF7C0A", icon: "druid" },
  DEMONHUNTER: { name: "Demon Hunter", color: "#A330C9", icon: "demonhunter" },
  EVOKER: { name: "Evoker", color: "#33937F", icon: "evoker" },
};

export function classInfo(token: string): ClassInfo {
  return CLASSES[token?.toUpperCase()] ?? { name: token || "Unknown", color: "#9AA3B5", icon: "warrior" };
}

export type Faction = "Alliance" | "Horde" | "Neutral";

export interface RaceInfo {
  name: string;
  /** Two-letter monogram used on the generated race badge. */
  short: string;
  faction: Faction;
}

/** Keyed by the race token returned by UnitRace (second return value). */
export const RACES: Record<string, RaceInfo> = {
  Human: { name: "Human", short: "Hu", faction: "Alliance" },
  Dwarf: { name: "Dwarf", short: "Dw", faction: "Alliance" },
  NightElf: { name: "Night Elf", short: "NE", faction: "Alliance" },
  Gnome: { name: "Gnome", short: "Gn", faction: "Alliance" },
  Draenei: { name: "Draenei", short: "Dr", faction: "Alliance" },
  Worgen: { name: "Worgen", short: "Wo", faction: "Alliance" },
  VoidElf: { name: "Void Elf", short: "VE", faction: "Alliance" },
  LightforgedDraenei: { name: "Lightforged", short: "LF", faction: "Alliance" },
  DarkIronDwarf: { name: "Dark Iron", short: "DI", faction: "Alliance" },
  KulTiran: { name: "Kul Tiran", short: "KT", faction: "Alliance" },
  Mechagnome: { name: "Mechagnome", short: "MG", faction: "Alliance" },
  Orc: { name: "Orc", short: "Or", faction: "Horde" },
  Scourge: { name: "Undead", short: "Ud", faction: "Horde" },
  Undead: { name: "Undead", short: "Ud", faction: "Horde" },
  Tauren: { name: "Tauren", short: "Ta", faction: "Horde" },
  Troll: { name: "Troll", short: "Tr", faction: "Horde" },
  BloodElf: { name: "Blood Elf", short: "BE", faction: "Horde" },
  Goblin: { name: "Goblin", short: "Go", faction: "Horde" },
  Nightborne: { name: "Nightborne", short: "NB", faction: "Horde" },
  HighmountainTauren: { name: "Highmountain", short: "HM", faction: "Horde" },
  MagharOrc: { name: "Mag'har", short: "MO", faction: "Horde" },
  ZandalariTroll: { name: "Zandalari", short: "ZT", faction: "Horde" },
  Vulpera: { name: "Vulpera", short: "Vu", faction: "Horde" },
  Pandaren: { name: "Pandaren", short: "Pa", faction: "Neutral" },
  Dracthyr: { name: "Dracthyr", short: "Dt", faction: "Neutral" },
  EarthenDwarf: { name: "Earthen", short: "Ea", faction: "Neutral" },
  Haranir: { name: "Haranir", short: "Ha", faction: "Neutral" },
};

export function raceInfo(token: string, factionHint?: string): RaceInfo {
  const known = RACES[token];
  const hinted: Faction | undefined =
    factionHint === "Alliance" || factionHint === "Horde" ? factionHint : undefined;
  if (known) return hinted && known.faction === "Neutral" ? { ...known, faction: hinted } : known;
  const name = (token || "Unknown").replace(/([a-z])([A-Z])/g, "$1 $2");
  return { name, short: name.slice(0, 2), faction: hinted ?? "Neutral" };
}

export function genderLabel(gender: number): string {
  return gender === 3 ? "Female" : gender === 2 ? "Male" : "";
}
