import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeSourcePath,
  effectiveRank,
  flavorLabel,
  isRemoved,
  mergeCharacters,
  parseRestedSyncFile,
  pruneCharactersFromSource,
  removeCharacter,
} from "../src/sync";
import { defaultState } from "../src/types";

const WIN_PATH = String.raw`C:\Program Files (x86)\World of Warcraft\_forever_\WTF\Account\123456789#1\SavedVariables\RestedSync.lua`;
const fixture = readFileSync(new URL("./fixtures/RestedSync.generated.lua", import.meta.url), "utf8");

describe("describeSourcePath", () => {
  it("reads flavor and account from Windows and macOS paths", () => {
    expect(describeSourcePath(WIN_PATH)).toEqual({ flavor: "_forever_", account: "123456789#1" });
    expect(
      describeSourcePath("/Applications/World of Warcraft/_classic_era_/WTF/Account/WOW1/SavedVariables/RestedSync.lua"),
    ).toEqual({ flavor: "_classic_era_", account: "WOW1" });
    expect(describeSourcePath("/tmp/RestedSync.lua").flavor).toBe("_wow_");
  });

  it("labels flavors", () => {
    expect(flavorLabel("_forever_")).toBe("Forever");
    expect(flavorLabel("_classic_era_")).toBe("Classic Era");
    expect(flavorLabel("_something_new_")).toBe("Something New");
  });
});

describe("parseRestedSyncFile (file produced by the real addon)", () => {
  it("extracts the character", () => {
    const { characters, error } = parseRestedSyncFile(fixture, WIN_PATH);
    expect(error).toBeUndefined();
    expect(characters).toHaveLength(1);
    const ch = characters[0];
    expect(ch.key).toBe("_forever_|Thrallina-Nightslayer");
    expect(ch.classToken).toBe("SHAMAN");
    expect(ch.race).toBe("Orc");
    expect(ch.level).toBe(23);
    expect(ch.isResting).toBe(false);
    expect(ch.restedPct).toBeCloseTo((10192 / 15200) * 100, 6);
    expect(ch.prevLogout?.isResting).toBe(true);
    expect(ch.login?.restedXP).toBe(10792);
  });

  it("detects Well Rested rank 3 from the login/logout pair", () => {
    const state = defaultState();
    mergeCharacters(state, parseRestedSyncFile(fixture, WIN_PATH).characters);
    const key = "_forever_|Thrallina-Nightslayer";
    expect(state.prefs[key].detectedRank).toBe(3);
    expect(effectiveRank(state, key)).toBe(3);
    state.prefs[key].wellRestedRank = 5; // explicit choice wins over detection
    expect(effectiveRank(state, key)).toBe(5);
  });

  it("reports parse errors without throwing", () => {
    const out = parseRestedSyncFile("RestedSyncDB = {", WIN_PATH);
    expect(out.characters).toEqual([]);
    expect(out.error).toBeTruthy();
  });

  it("ignores files without RestedSyncDB", () => {
    expect(parseRestedSyncFile("OtherDB = {}", WIN_PATH)).toEqual({ characters: [] });
  });
});

describe("mergeCharacters", () => {
  const base = parseRestedSyncFile(fixture, WIN_PATH).characters[0];

  it("keeps user preferences and ignores older snapshots", () => {
    const state = defaultState();
    mergeCharacters(state, [base]);
    state.prefs[base.key].isTracked = false;
    state.prefs[base.key].portraitUrl = "https://example.com/p.png";

    const older = { ...base, timestamp: base.timestamp - 100, restedPct: 1 };
    expect(mergeCharacters(state, [older]).updated).toEqual([]);
    expect(state.characters[base.key].restedPct).toBe(base.restedPct);

    const newer = { ...base, timestamp: base.timestamp + 100, restedPct: 99, restedXP: 1 };
    expect(mergeCharacters(state, [newer]).updated).toEqual([base.key]);
    expect(state.characters[base.key].restedPct).toBe(99);
    expect(state.prefs[base.key].isTracked).toBe(false);
    expect(state.prefs[base.key].portraitUrl).toBe("https://example.com/p.png");
  });

  it("hides removed characters until they are played again", () => {
    const state = defaultState();
    mergeCharacters(state, [base]);
    removeCharacter(state, base.key);
    expect(isRemoved(state, state.characters[base.key])).toBe(true);
    mergeCharacters(state, [base]); // same snapshot re-read: still removed
    expect(isRemoved(state, state.characters[base.key])).toBe(true);
    mergeCharacters(state, [{ ...base, timestamp: base.timestamp + 60 }]);
    expect(isRemoved(state, state.characters[base.key])).toBe(false);
  });

  it("prunes characters of an unwatched file", () => {
    const state = defaultState();
    mergeCharacters(state, [base]);
    pruneCharactersFromSource(state, WIN_PATH);
    expect(state.characters).toEqual({});
  });
});
