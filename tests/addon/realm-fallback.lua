-- Checks how RestedSync finds the realm name on different clients.
--
--   lua5.1 tests/addon/realm-fallback.lua
--
-- WoW Forever returns "" from GetRealmName() and reports the realm only as the second
-- value of UnitName("player"). Before the fallback existed, the addon skipped every
-- save there and RestedSync.lua stayed empty.

UNKNOWNOBJECT = "Unknown"
MAX_PLAYER_LEVEL = 60
function time() return 1798000000 end
function UnitLevel() return 12 end
function UnitXP() return 100 end
function UnitXPMax() return 5000 end
function GetXPExhaustion() return 2500 end
function IsResting() return true end
function UnitClass() return "Paladin", "PALADIN", 2 end
function UnitRace() return "Human", "Human", 1 end
function UnitSex() return 2 end
function UnitFactionGroup() return "Alliance", "Alliance" end
function GetBuildInfo() return "1.60.1", "71139", "Nov 1 2026", 16001 end
function GetMaxPlayerLevel() return 60 end
C_Timer = { After = function() end }

local handler
function CreateFrame()
  return {
    SetScript = function(_, _, fn) handler = fn end,
    RegisterEvent = function() end,
    UnregisterEvent = function() end,
  }
end

-- Loads the addon fresh, logs in and out, and returns RestedSyncDB.
local function session()
  RestedSyncDB = nil
  local chunk = assert(loadfile("addon/RestedSync/RestedSync.lua"))
  chunk("RestedSync")
  handler(nil, "ADDON_LOADED", "RestedSync")
  handler(nil, "PLAYER_ENTERING_WORLD", true, false)
  handler(nil, "PLAYER_LOGOUT")
  return RestedSyncDB
end

local function count(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n
end

local function expectOne(db, key, name, realm, label)
  assert(count(db) == 1, label .. ": expected 1 character, got " .. count(db))
  local entry = db[key]
  assert(type(entry) == "table", label .. ": missing entry " .. key)
  assert(entry.name == name, label .. ": name is " .. tostring(entry.name))
  assert(entry.realm == realm, label .. ": realm is " .. tostring(entry.realm))
  assert(entry.restedXP == 2500, label .. ": restedXP is " .. tostring(entry.restedXP))
  print("ok   " .. label .. " -> " .. key)
end

-- 1. Usual clients: GetRealmName() works, UnitName() returns only the name.
function UnitName() return "Thrallina" end
function GetRealmName() return "Pyrewood Village" end
GetNormalizedRealmName = nil
UnitFullName = nil
expectOne(session(), "Thrallina-Pyrewood Village", "Thrallina", "Pyrewood Village", "GetRealmName")

-- 2. WoW Forever: GetRealmName() is empty, the realm comes from UnitName().
function UnitName() return "Avendel", "Sunward" end
function GetRealmName() return "" end
expectOne(session(), "Avendel-Sunward", "Avendel", "Sunward", "UnitName realm (WoW Forever)")

-- 3. Only GetNormalizedRealmName() knows the realm.
function UnitName() return "Brumdor" end
function GetRealmName() return "" end
function GetNormalizedRealmName() return "Thunderbeard" end
expectOne(session(), "Brumdor-Thunderbeard", "Brumdor", "Thunderbeard", "GetNormalizedRealmName")

-- 4. Only UnitFullName() knows the realm.
GetNormalizedRealmName = nil
function UnitFullName() return "Kro", "Vek" end
expectOne(session(), "Kro-Vek", "Kro", "Vek", "UnitFullName")

-- 5. No realm anywhere: save nothing rather than guess (avoids duplicate entries).
function UnitFullName() return "Nixie", nil end
function UnitName() return "Nixie" end
local db = session()
assert(count(db) == 0, "no realm: expected nothing saved, got " .. count(db))
print("ok   no realm -> nothing saved")

print("all realm checks passed")
