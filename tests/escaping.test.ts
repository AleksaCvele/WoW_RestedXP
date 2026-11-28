import { describe, expect, it } from "vitest";
import { esc } from "../src/html";
import { parseRestedSyncFile } from "../src/sync";
import { buildViews, renderRoster, type UiState } from "../src/view";
import { defaultState } from "../src/types";
import { mergeCharacters } from "../src/sync";

const ui: UiState = {
  settingsOpen: false,
  detecting: false,
  detectMessage: "",
  detectResults: [],
  fileStatus: {},
  version: "",
  isDesktop: true,
  portraitCache: new Map(),
  syncing: false,
  os: "windows",
  update: { phase: "idle" },
};

describe("HTML escaping of SavedVariables data", () => {
  it("escapes special characters", () => {
    expect(esc(`<img src=x onerror="a">&'`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
  });

  it("never renders markup from a hostile save file", () => {
    const evil = `RestedSyncDB = {
      ["x"] = {
        ["name"] = "<img src=x onerror=alert(1)>",
        ["realm"] = "\\"><script>alert(2)</script>",
        ["class"] = "<svg/onload=alert(3)>",
        ["race"] = "<i",
        ["level"] = 10, ["restedXP"] = 0, ["maxXP"] = 100, ["timestamp"] = 1800000000,
      },
    }`;
    const state = defaultState();
    state.settings.avatarMode = "portrait";
    state.settings.savedVariablesPaths = ["C:/WoW/_forever_/WTF/Account/A/SavedVariables/RestedSync.lua"];
    mergeCharacters(state, parseRestedSyncFile(evil, state.settings.savedVariablesPaths[0]).characters);
    for (const viewMode of ["expanded", "compact"] as const) {
      state.settings.viewMode = viewMode;
      const html = renderRoster(state, ui, buildViews(state, 1800000000), 1800000000);
      expect(html).not.toMatch(/<img src=x|<script|<svg\/onload|<i</);
    }
  });
});
