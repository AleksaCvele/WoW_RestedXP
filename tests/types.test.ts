import { describe, expect, it } from "vitest";
import { normalizeState } from "../src/types";

describe("normalizeState", () => {
  it("falls back to the class crest for the removed race + class avatar style", () => {
    const state = normalizeState({ settings: { avatarMode: "raceClass" } });
    expect(state.settings.avatarMode).toBe("class");
  });

  it("keeps the supported avatar styles", () => {
    expect(normalizeState({ settings: { avatarMode: "portrait" } }).settings.avatarMode).toBe("portrait");
    expect(normalizeState({ settings: { avatarMode: "class" } }).settings.avatarMode).toBe("class");
    expect(normalizeState({}).settings.avatarMode).toBe("class");
  });
});
