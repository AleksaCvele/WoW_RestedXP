// Data models shared across the widget.

/** A rested-XP reading recorded by the addon at login or at the previous logout. */
export interface RestedPoint {
  level: number;
  restedXP: number;
  maxXP: number;
  restedPct: number;
  isResting?: boolean;
  timestamp: number;
}

/** One character as last written by the RestedSync addon (never edited by the user). */
export interface SyncedCharacter {
  /** Unique roster key: `<flavor>|<name>-<realm>` */
  key: string;
  name: string;
  realm: string;
  /** Class token, e.g. "WARRIOR", "DEATHKNIGHT" */
  classToken: string;
  /** Race token, e.g. "Human", "NightElf", "Scourge" */
  race: string;
  /** 2 = male, 3 = female (UnitSex) */
  gender: number;
  faction: string;
  level: number;
  xp: number;
  restedXP: number;
  maxXP: number;
  restedPct: number;
  isResting: boolean;
  isMaxLevel: boolean;
  xpDisabled: boolean;
  /** Unix epoch seconds of the snapshot (logout / reload time) */
  timestamp: number;
  /** Game client folder the data came from, e.g. "_forever_", "_classic_era_" */
  flavor: string;
  /** WTF account folder name */
  account: string;
  sourcePath: string;
  prevLogout?: RestedPoint;
  login?: RestedPoint;
}

export type WellRestedSetting = "auto" | 0 | 1 | 2 | 3 | 4 | 5;

/** User-owned per-character settings. Never overwritten by a sync. */
export interface CharacterPrefs {
  wellRestedRank: WellRestedSetting;
  /** Rank measured from an offline login/logout pair, if one was conclusive. */
  detectedRank?: number;
  detectedAt?: number;
  isTracked: boolean;
  portraitUrl: string;
  /** Snapshot timestamp at which the user removed the character (hidden until a newer snapshot arrives). */
  removedAt?: number;
  /** Snapshot timestamp we already sent a "fully rested" notification for. */
  notifiedTimestamp?: number;
}

export type AvatarMode = "class" | "portrait";
const AVATAR_MODES: readonly AvatarMode[] = ["class", "portrait"];
export type ViewMode = "expanded" | "compact";

export interface DisplaySettings {
  showBar: boolean;
  showCountdown: boolean;
  showLevel: boolean;
  showRestingIcon: boolean;
  showRankSelector: boolean;
  classColoredBars: boolean;
}

export interface BehaviorSettings {
  autoSort: boolean;
  notifyOnMax: boolean;
  launchOnStartup: boolean;
  hideUntracked: boolean;
  hideMaxLevel: boolean;
  /** Check for, download and install signed updates automatically. */
  autoUpdate: boolean;
}

export interface Settings {
  savedVariablesPaths: string[];
  display: DisplaySettings;
  behavior: BehaviorSettings;
  avatarMode: AvatarMode;
  viewMode: ViewMode;
  pinned: boolean;
  /** Rank used for characters set to "Auto" when no rank could be detected. */
  defaultWellRestedRank: number;
  /** The one-time "start with Windows/macOS?" prompt was answered. */
  startupPromptDone: boolean;
}

export interface AppState {
  version: 1;
  settings: Settings;
  characters: Record<string, SyncedCharacter>;
  prefs: Record<string, CharacterPrefs>;
  lastSyncAt?: number;
}

export interface FileReadResult {
  path: string;
  content?: string | null;
  error?: string | null;
  /** True when the file does not exist yet (created on the first logout with the addon). */
  missing?: boolean | null;
  modifiedMs?: number | null;
}

export interface DetectedFile {
  path: string;
  flavor: string;
  account: string;
  exists: boolean;
}

export type TrayAction = "sync" | "settings" | "patreon";

export const DEFAULT_SETTINGS: Settings = {
  savedVariablesPaths: [],
  display: {
    showBar: true,
    showCountdown: true,
    showLevel: true,
    showRestingIcon: true,
    showRankSelector: true,
    classColoredBars: true,
  },
  behavior: {
    autoSort: true,
    notifyOnMax: true,
    launchOnStartup: false,
    hideUntracked: false,
    hideMaxLevel: false,
    autoUpdate: true,
  },
  avatarMode: "class",
  viewMode: "expanded",
  pinned: false,
  defaultWellRestedRank: 0,
  startupPromptDone: false,
};

export const DEFAULT_PREFS: CharacterPrefs = {
  wellRestedRank: "auto",
  isTracked: true,
  portraitUrl: "",
};

export function defaultState(): AppState {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    characters: {},
    prefs: {},
  };
}

/** Fill in any settings added in newer versions so older state files keep working. */
export function normalizeState(raw: unknown): AppState {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<AppState>;
  const s = (r.settings ?? {}) as Partial<Settings>;
  const settings: Settings = {
    ...base.settings,
    ...s,
    savedVariablesPaths: Array.isArray(s.savedVariablesPaths)
      ? s.savedVariablesPaths.filter((p): p is string => typeof p === "string")
      : [],
    display: { ...base.settings.display, ...(s.display ?? {}) },
    behavior: { ...base.settings.behavior, ...(s.behavior ?? {}) },
    // Unknown styles (e.g. the removed "raceClass" badge) fall back to the class crest.
    avatarMode: AVATAR_MODES.includes(s.avatarMode as AvatarMode) ? (s.avatarMode as AvatarMode) : "class",
  };
  const prefs: Record<string, CharacterPrefs> = {};
  for (const [k, v] of Object.entries(r.prefs ?? {})) {
    prefs[k] = { ...DEFAULT_PREFS, ...(v as Partial<CharacterPrefs>) };
  }
  return {
    version: 1,
    settings,
    characters: (r.characters as Record<string, SyncedCharacter>) ?? {},
    prefs,
    lastSyncAt: typeof r.lastSyncAt === "number" ? r.lastSyncAt : undefined,
  };
}
