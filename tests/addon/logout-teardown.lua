-- Checks that RestedSync keeps the last real snapshot when the client tears the
-- character down during logout, and that it records the new level after a level-up.
--
--   lua5.1 tests/addon/logout-teardown.lua
--
-- WoW Forever answers UnitXPMax() = 0, UnitXP() = 0, GetXPExhaustion() = nil,
-- IsResting() = false and the level from the character list once logout starts.
-- Version 1.0.0 saved those values, so every character showed 0 rested XP,
-- "open world" and the wrong level.

local now = 1798000000
local p -- the player as the client currently reports it

local function inWorld(level, maxXP, rested, resting)
  p = { level = level, xp = 500, maxXP = maxXP, rested = rested, resting = resting }
end
local function tornDown(listLevel)
  p = { level = listLevel, xp = 0, maxXP = 0, rested = nil, resting = false }
end

UNKNOWNOBJECT = "Unknown"
MAX_PLAYER_LEVEL = 60
function time() return now end
function UnitName() return "Avendel", "Sunward" end
function GetRealmName() return "" end
function UnitLevel() return p.level end
function UnitXP() return p.xp end
function UnitXPMax() return p.maxXP end
function GetXPExhaustion() return p.rested end
function IsResting() return p.resting end
function UnitClass() return "Paladin", "PALADIN", 2 end
function UnitRace() return "Human", "Human", 1 end
function UnitSex() return 2 end
function UnitFactionGroup() return "Alliance", "Alliance" end
function GetBuildInfo() return "1.60.1", "71139", "Nov 1 2026", 16001 end
function GetMaxPlayerLevel() return 60 end

local timers = {}
C_Timer = { After = function(_, fn) table.insert(timers, fn) end }
local function runTimers() local t = timers; timers = {}; for _, fn in ipairs(t) do fn() end end

local handler
function CreateFrame()
  return {
    SetScript = function(_, _, fn) handler = fn end,
    RegisterEvent = function() end,
    UnregisterEvent = function() end,
  }
end
local function fire(event, ...) handler(nil, event, ...) end

local function loadAddon()
  local chunk = assert(loadfile("addon/RestedSync/RestedSync.lua"))
  chunk("RestedSync")
  fire("ADDON_LOADED", "RestedSync")
end

local function check(cond, msg)
  if not cond then error(msg, 2) end
end

-- Logs out the way WoW Forever does: leaving the world, teardown events, logout.
local function logOut(listLevel)
  fire("PLAYER_LEAVING_WORLD")
  tornDown(listLevel)
  fire("UPDATE_EXHAUSTION")
  fire("PLAYER_XP_UPDATE", "player")
  fire("PLAYER_UPDATE_RESTING")
  now = now + 5
  fire("PLAYER_LOGOUT")
end

-- Session 1: a level 9 character in an inn with 2000 rested XP levels up to 10.
RestedSyncDB = nil
loadAddon()
inWorld(9, 6600, 2000, true)
fire("PLAYER_ENTERING_WORLD", true, false)
runTimers()
now = now + 600
fire("PLAYER_LEVEL_UP", 10) -- UnitLevel() still says 9 while the event runs
inWorld(10, 7600, 3000, true)
runTimers()
now = now + 60
logOut(9) -- the character list still has the level from login
local entry = RestedSyncDB["Avendel-Sunward"]
check(type(entry) == "table", "no entry saved")
check(entry.level == 10, "level is " .. tostring(entry.level) .. ", expected 10")
check(entry.maxXP == 7600, "maxXP is " .. tostring(entry.maxXP) .. ", expected 7600")
check(entry.restedXP == 3000, "restedXP is " .. tostring(entry.restedXP) .. ", expected 3000")
check(entry.isResting == true, "isResting is " .. tostring(entry.isResting) .. ", expected true")
check(entry.timestamp == now, "timestamp is not the logout time")
print("ok   logout keeps the last in-world snapshot (level 10, 3000 rested, inn)")

-- Session 2: next login; the logout values become prevLogout.
local logoutAt = now
now = now + 10 * 3600
loadAddon()
inWorld(10, 7600, 3500, true)
fire("PLAYER_ENTERING_WORLD", true, false)
runTimers()
entry = RestedSyncDB["Avendel-Sunward"]
check(type(entry.prevLogout) == "table", "prevLogout missing")
check(entry.prevLogout.restedXP == 3000 and entry.prevLogout.isResting == true, "prevLogout has the wrong values")
check(entry.prevLogout.timestamp == logoutAt, "prevLogout timestamp is not the logout time")
check(entry.login.restedXP == 3500, "login restedXP is " .. tostring(entry.login.restedXP))
print("ok   next login pairs the real logout values with the login values")

-- Session 3: an entry broken by version 1.0.0 must not become prevLogout.
RestedSyncDB = {
  ["Avendel-Sunward"] = { name = "Avendel", realm = "Sunward", level = 9, maxXP = 1, xp = 0,
    restedXP = 0, restedPct = 0, isResting = false, timestamp = now },
}
now = now + 3600
loadAddon()
inWorld(10, 7600, 3200, true)
fire("PLAYER_ENTERING_WORLD", true, false)
entry = RestedSyncDB["Avendel-Sunward"]
check(entry.prevLogout == nil, "a broken 1.0.0 entry was used as prevLogout")
check(entry.level == 10 and entry.restedXP == 3200, "login snapshot not saved")
print("ok   broken 1.0.0 entries are not used for Well Rested detection")

-- Session 4: no usable data at login (still loading): the login is captured later.
RestedSyncDB = {}
loadAddon()
tornDown(10)
fire("PLAYER_ENTERING_WORLD", true, false)
check(RestedSyncDB["Avendel-Sunward"] == nil, "saved a snapshot without real data")
inWorld(10, 7600, 3300, true)
fire("PLAYER_XP_UPDATE", "player")
entry = RestedSyncDB["Avendel-Sunward"]
check(type(entry) == "table" and type(entry.login) == "table", "login not captured once data arrived")
check(entry.login.restedXP == 3300, "login restedXP is " .. tostring(entry.login.restedXP))
print("ok   login is captured as soon as real data arrives")

print("all logout checks passed")
