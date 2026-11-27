// Turns RestedSync.lua SavedVariables into roster entries and merges them into app state
// without touching user-owned settings (Well Rested rank, tracking, portraits...).

import { isLuaTable, parseSavedVariables, type LuaTable, type LuaValue } from "./luaParser";
import { inferWellRestedRank } from "./math";
import { DEFAULT_PREFS, type AppState, type CharacterPrefs, type RestedPoint, type SyncedCharacter } from "./types";

export const SAVED_VARIABLE_NAME = "RestedSyncDB";

const FLAVOR_LABELS: Record<string, string> = {
  _forever_: "Forever",
  _classic_era_: "Classic Era",
  _classic_: "Classic",
  _retail_: "Retail",
  _anniversary_: "Anniversary",
  _classic_ptr_: "Classic PTR",
  _classic_era_ptr_: "Era PTR",
  _ptr_: "PTR",
  _xptr_: "PTR",
  _beta_: "Beta",
  _classic_beta_: "Classic Beta",
};

export interface SourceInfo {
  flavor: string;
  account: string;
}

/** Pulls the client flavor folder (`_forever_`) and account name out of a SavedVariables path. */
export function describeSourcePath(path: string): SourceInfo {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  let flavor = "";
  let account = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!flavor && /^_[a-z0-9_]+_$/i.test(p)) flavor = p.toLowerCase();
    if (p.toLowerCase() === "account" && i + 1 < parts.length && parts[i - 1]?.toLowerCase() === "wtf") {
      account = parts[i + 1];
    }
  }
  return { flavor: flavor || "_wow_", account };
}

export function flavorLabel(flavor: string): string {
  if (FLAVOR_LABELS[flavor]) return FLAVOR_LABELS[flavor];
  const cleaned = flavor.replace(/^_+|_+$/g, "").replace(/_/g, " ");
  if (!cleaned || cleaned === "wow") return "WoW";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function characterKey(flavor: string, name: string, realm: string): string {
  return `${flavor}|${name}-${realm}`;
}

function num(value: LuaValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function str(value: LuaValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function bool(value: LuaValue | undefined): boolean {
  return value === true;
}

function toPoint(value: LuaValue | undefined): RestedPoint | undefined {
  if (!isLuaTable(value)) return undefined;
  const timestamp = num(value.timestamp, NaN);
  if (!Number.isFinite(timestamp)) return undefined;
  const maxXP = num(value.maxXP, 1);
  const restedXP = num(value.restedXP);
  return {
    level: num(value.level),
    restedXP,
    maxXP,
    restedPct: num(value.restedPct, maxXP > 0 ? (restedXP / maxXP) * 100 : 0),
    isResting: value.isResting === undefined ? undefined : bool(value.isResting),
    timestamp,
  };
}

function toCharacter(entry: LuaTable, fallbackKey: string, source: SourceInfo, sourcePath: string): SyncedCharacter | null {
  let name = str(entry.name);
  let realm = str(entry.realm);
  if (!name || !realm) {
    // Fall back to the "Name-Realm" table key (realm names may contain dashes).
    const dash = fallbackKey.indexOf("-");
    if (dash <= 0) return null;
    name = name || fallbackKey.slice(0, dash);
    realm = realm || fallbackKey.slice(dash + 1);
  }
  const timestamp = num(entry.timestamp, NaN);
  if (!Number.isFinite(timestamp)) return null;

  const maxXP = Math.max(1, num(entry.maxXP, 1));
  const restedXP = Math.max(0, num(entry.restedXP));
  return {
    key: characterKey(source.flavor, name, realm),
    name,
    realm,
    classToken: str(entry.class, "WARRIOR").toUpperCase(),
    race: str(entry.race, "Human"),
    gender: num(entry.gender, 2),
    faction: str(entry.faction),
    level: num(entry.level, 1),
    xp: num(entry.xp),
    restedXP,
    maxXP,
    restedPct: num(entry.restedPct, (restedXP / maxXP) * 100),
    isResting: bool(entry.isResting),
    isMaxLevel: bool(entry.isMaxLevel),
    xpDisabled: bool(entry.xpDisabled),
    timestamp,
    flavor: source.flavor,
    account: source.account,
    sourcePath,
    prevLogout: toPoint(entry.prevLogout),
    login: toPoint(entry.login),
  };
}

export interface ParseOutcome {
  characters: SyncedCharacter[];
  error?: string;
}

/** Parses the text of a RestedSync.lua SavedVariables file. */
export function parseRestedSyncFile(content: string, sourcePath: string): ParseOutcome {
  let parsed: Record<string, LuaValue>;
  try {
    parsed = parseSavedVariables(content);
  } catch (err) {
    return { characters: [], error: err instanceof Error ? err.message : String(err) };
  }
  const db = parsed[SAVED_VARIABLE_NAME];
  if (db === undefined) return { characters: [] };
  if (!isLuaTable(db)) return { characters: [], error: `${SAVED_VARIABLE_NAME} is not a table` };

  const source = describeSourcePath(sourcePath);
  const characters: SyncedCharacter[] = [];
  for (const [key, entry] of Object.entries(db)) {
    if (!isLuaTable(entry)) continue;
    const ch = toCharacter(entry, key, source, sourcePath);
    if (ch) characters.push(ch);
  }
  return { characters };
}

export function prefsFor(state: AppState, key: string): CharacterPrefs {
  return state.prefs[key] ?? DEFAULT_PREFS;
}

export function ensurePrefs(state: AppState, key: string): CharacterPrefs {
  if (!state.prefs[key]) state.prefs[key] = { ...DEFAULT_PREFS };
  return state.prefs[key];
}

/** The Well Rested rank actually used for a character's math. */
export function effectiveRank(state: AppState, key: string): number {
  const p = prefsFor(state, key);
  if (p.wellRestedRank !== "auto") return p.wellRestedRank;
  if (typeof p.detectedRank === "number") return p.detectedRank;
  return state.settings.defaultWellRestedRank;
}

export interface MergeResult {
  /** Keys whose snapshot was added or replaced by a newer one. */
  updated: string[];
}

/**
 * Merges freshly parsed characters into the roster. Only newer snapshots replace older
 * ones, and user preferences are never overwritten (only created with defaults).
 */
export function mergeCharacters(state: AppState, incoming: SyncedCharacter[]): MergeResult {
  const updated: string[] = [];
  for (const ch of incoming) {
    const existing = state.characters[ch.key];
    if (existing && existing.timestamp > ch.timestamp) continue;
    const changed =
      !existing ||
      existing.timestamp !== ch.timestamp ||
      existing.restedXP !== ch.restedXP ||
      existing.level !== ch.level ||
      existing.isResting !== ch.isResting;
    state.characters[ch.key] = ch;
    const prefs = ensurePrefs(state, ch.key);

    if (prefs.removedAt !== undefined && ch.timestamp > prefs.removedAt) {
      delete prefs.removedAt; // played again after being removed: bring it back
    }

    const inference = inferWellRestedRank(ch.prevLogout, ch.login);
    if (inference && ch.login && (prefs.detectedAt === undefined || ch.login.timestamp >= prefs.detectedAt)) {
      prefs.detectedRank = inference.rank;
      prefs.detectedAt = ch.login.timestamp;
    }
    if (changed) updated.push(ch.key);
  }
  return { updated };
}

/** Drops characters that came from a SavedVariables file the user no longer watches. */
export function pruneCharactersFromSource(state: AppState, sourcePath: string): void {
  for (const [key, ch] of Object.entries(state.characters)) {
    if (ch.sourcePath === sourcePath) delete state.characters[key];
  }
}

export function isRemoved(state: AppState, ch: SyncedCharacter): boolean {
  const removedAt = state.prefs[ch.key]?.removedAt;
  return removedAt !== undefined && ch.timestamp <= removedAt;
}

export function removeCharacter(state: AppState, key: string): void {
  const ch = state.characters[key];
  if (!ch) return;
  ensurePrefs(state, key).removedAt = ch.timestamp;
}
