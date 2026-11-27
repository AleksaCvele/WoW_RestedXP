import { describe, expect, it } from "vitest";
import { LuaParseError, parseSavedVariables, type LuaTable } from "../src/luaParser";

describe("parseSavedVariables", () => {
  it("parses the client's SavedVariables layout", () => {
    const src = `
RestedSyncDB = {
\t["Ærwyn-Pyrewood Village"] = {
\t\t["name"] = "Ærwyn",
\t\t["realm"] = "Pyrewood Village",
\t\t["level"] = 12,
\t\t["restedPct"] = 45.25,
\t\t["isResting"] = true,
\t\t["xpDisabled"] = false,
\t\t["nothing"] = nil,
\t},
}
OtherAddonDB = {
\t"first", -- [1]
\t"second", -- [2]
\t{ x = 1, y = -2.5e1 }, -- [3]
}
`;
    const out = parseSavedVariables(src);
    const db = out.RestedSyncDB as LuaTable;
    const ch = db["Ærwyn-Pyrewood Village"] as LuaTable;
    expect(ch.name).toBe("Ærwyn");
    expect(ch.level).toBe(12);
    expect(ch.restedPct).toBe(45.25);
    expect(ch.isResting).toBe(true);
    expect(ch.xpDisabled).toBe(false);
    expect(ch.nothing).toBeNull();
    const other = out.OtherAddonDB as LuaTable;
    expect(other["1"]).toBe("first");
    expect(other["2"]).toBe("second");
    expect(other["3"]).toEqual({ x: 1, y: -25 });
  });

  it("decodes escapes including decimal byte escapes as UTF-8", () => {
    const out = parseSavedVariables(String.raw`A = "q\"uo\\te\n\195\134x\65"`);
    expect(out.A).toBe('q"uo\\te\nÆxA');
  });

  it("handles comments, long strings, hex numbers and semicolons", () => {
    const out = parseSavedVariables(`
--[==[ block
comment ]==]
A = [[
long]]; B = 0x1F -- trailing
C = { [1] = "a"; [2] = "b"; [true] = 3 }
`);
    expect(out.A).toBe("long");
    expect(out.B).toBe(31);
    expect(out.C).toEqual({ "1": "a", "2": "b", true: 3 });
  });

  it("never evaluates code", () => {
    expect(() => parseSavedVariables(`A = os.execute("rm -rf /")`)).toThrow(LuaParseError);
    expect(() => parseSavedVariables(`A = (function() return 1 end)()`)).toThrow(LuaParseError);
    expect(() => parseSavedVariables(`A = { x = y }`)).toThrow(LuaParseError);
  });

  it("does not pollute object prototypes", () => {
    const out = parseSavedVariables(`A = { ["__proto__"] = { polluted = true } }`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((out.A as LuaTable)["__proto__"]).toEqual({ polluted: true });
  });

  it("reports malformed input", () => {
    expect(() => parseSavedVariables(`A = { "x"`)).toThrow(/Unterminated|Expected/);
    expect(() => parseSavedVariables(`A = "open`)).toThrow(/Unterminated string/);
    expect(() => parseSavedVariables(`= 3`)).toThrow(/variable name/);
  });

  it("rejects absurd nesting instead of overflowing the stack", () => {
    const deep = "A = " + "{".repeat(200) + "}".repeat(200);
    expect(() => parseSavedVariables(deep)).toThrow(/nested too deeply/);
  });

  it("returns an empty result for an empty file", () => {
    expect(Object.keys(parseSavedVariables("\n\n"))).toEqual([]);
  });
});
