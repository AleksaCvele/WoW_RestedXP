// Sample SavedVariables used when the UI runs in a plain browser (npm run dev).
// The data is serialized to real Lua and parsed back, so the preview exercises the parser too.

export const DEMO_PATHS = [
  "C:\\Program Files (x86)\\World of Warcraft\\_forever_\\WTF\\Account\\DEMO\\SavedVariables\\RestedSync.lua",
];

interface DemoChar {
  name: string;
  realm: string;
  class: string;
  race: string;
  gender: number;
  faction: string;
  level: number;
  maxXP: number;
  restedPct: number;
  isResting: boolean;
  hoursAgo: number;
  isMaxLevel?: boolean;
  /** Simulate an earlier 30h inn break at this Well Rested rank so auto-detection kicks in. */
  rank?: number;
}

const CHARS: DemoChar[] = [
  { name: "Brannoc", realm: "Stormwhisper", class: "WARRIOR", race: "Dwarf", gender: 2, faction: "Alliance", level: 34, maxXP: 52400, restedPct: 38, isResting: true, hoursAgo: 61, rank: 3 },
  { name: "Lunarae", realm: "Stormwhisper", class: "DRUID", race: "NightElf", gender: 3, faction: "Alliance", level: 27, maxXP: 34700, restedPct: 150, isResting: true, hoursAgo: 52, rank: 5 },
  { name: "Fizzlecog", realm: "Stormwhisper", class: "MAGE", race: "Gnome", gender: 2, faction: "Alliance", level: 19, maxXP: 17300, restedPct: 4, isResting: false, hoursAgo: 30 },
  { name: "Seraphine", realm: "Stormwhisper", class: "PALADIN", race: "Human", gender: 3, faction: "Alliance", level: 41, maxXP: 71500, restedPct: 141, isResting: true, hoursAgo: 70, rank: 2 },
  { name: "Grashk", realm: "Emberfall", class: "SHAMAN", race: "Orc", gender: 2, faction: "Horde", level: 22, maxXP: 23900, restedPct: 66, isResting: true, hoursAgo: 8 },
  { name: "Mortivex", realm: "Emberfall", class: "WARLOCK", race: "Scourge", gender: 2, faction: "Horde", level: 15, maxXP: 11400, restedPct: 0, isResting: true, hoursAgo: 2 },
  { name: "Zul'kesh", realm: "Emberfall", class: "HUNTER", race: "Troll", gender: 3, faction: "Horde", level: 12, maxXP: 8800, restedPct: 18, isResting: false, hoursAgo: 96 },
  { name: "Velisse", realm: "Emberfall", class: "ROGUE", race: "Scourge", gender: 3, faction: "Horde", level: 9, maxXP: 6200, restedPct: 2, isResting: true, hoursAgo: 0.4 },
  { name: "Aurelan", realm: "Stormwhisper", class: "PRIEST", race: "Human", gender: 2, faction: "Alliance", level: 60, maxXP: 1, restedPct: 0, isResting: true, hoursAgo: 20, isMaxLevel: true },
];

function luaString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function toLua(value: unknown, indent: string): string {
  if (typeof value === "string") return luaString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const inner = indent + "\t";
    const lines = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${inner}[${luaString(k)}] = ${toLua(v, inner)},`,
    );
    return `{\n${lines.join("\n")}\n${indent}}`;
  }
  return "nil";
}

export function demoFiles(nowSec = Math.floor(Date.now() / 1000)): Record<string, string> {
  const db: Record<string, unknown> = {};
  for (const c of CHARS) {
    const timestamp = Math.round(nowSec - c.hoursAgo * 3600);
    db[`${c.name}-${c.realm}`] = {
      name: c.name,
      realm: c.realm,
      class: c.class,
      race: c.race,
      gender: c.gender,
      faction: c.faction,
      level: c.level,
      xp: Math.round(c.maxXP * 0.3),
      restedXP: Math.round((c.restedPct / 100) * c.maxXP),
      maxXP: c.maxXP,
      restedPct: c.restedPct,
      isResting: c.isResting,
      isMaxLevel: c.isMaxLevel ?? false,
      xpDisabled: false,
      timestamp,
      toc: 16001,
      schema: 2,
    };
    if (c.rank !== undefined) {
      const loginAt = timestamp - 2 * 3600;
      const before = 10;
      const after = before + 30 * 0.625 * (1 + 0.04 * c.rank);
      const entry = db[`${c.name}-${c.realm}`] as Record<string, unknown>;
      entry.prevLogout = { level: c.level, maxXP: c.maxXP, restedXP: Math.round((before / 100) * c.maxXP), restedPct: before, isResting: true, timestamp: loginAt - 30 * 3600 };
      entry.login = { level: c.level, maxXP: c.maxXP, restedXP: Math.round((after / 100) * c.maxXP), restedPct: after, timestamp: loginAt };
    }
  }
  return { [DEMO_PATHS[0]]: `\nRestedSyncDB = ${toLua(db, "")}\n` };
}
