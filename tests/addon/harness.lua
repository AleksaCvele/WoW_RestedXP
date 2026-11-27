-- Runs addon/RestedSync/RestedSync.lua against a tiny mock of the WoW API and prints
-- RestedSyncDB in the same format the game client writes SavedVariables files.
--
--   lua5.1 tests/addon/harness.lua > tests/fixtures/RestedSync.generated.lua
--
-- Scenario: a character logs out in an inn, comes back 30 hours later with
-- Well Rested rank 3 (rate x1.12), plays a little and logs out in the open world.

local now = 1798000000 -- fixed "current time" so the output is deterministic
local player = {
  name = "Thrallina", realm = "Nightslayer", level = 23, xp = 4100, maxXP = 15200,
  rested = 7600, resting = true, class = "SHAMAN", race = "Orc", sex = 3, faction = "Horde",
}

-- Mock WoW API --------------------------------------------------------------
UNKNOWNOBJECT = "Unknown"
MAX_PLAYER_LEVEL = 60
function time() return now end
function UnitName() return player.name end
function GetRealmName() return player.realm end
function UnitLevel() return player.level end
function UnitXP() return player.xp end
function UnitXPMax() return player.maxXP end
function GetXPExhaustion() if player.rested > 0 then return player.rested end return nil end
function IsResting() return player.resting end
function UnitClass() return "Shaman", player.class, 7 end
function UnitRace() return "Orc", player.race, 2 end
function UnitSex() return player.sex end
function UnitFactionGroup() return player.faction, player.faction end
function GetBuildInfo() return "1.60.1", "99999", "Nov 1 2026", 16001 end
function GetMaxPlayerLevel() return 60 end
function IsXPUserDisabled() return false end

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

-- SavedVariables serializer (mimics the client's output) ---------------------
local function sortedKeys(t)
  local keys = {}
  for k in pairs(t) do table.insert(keys, k) end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  return keys
end

local function serialize(value, indent)
  local t = type(value)
  if t == "string" then return string.format("%q", value) end
  if t == "number" or t == "boolean" then return tostring(value) end
  if t ~= "table" then return "nil" end
  local lines = { "{" }
  for _, k in ipairs(sortedKeys(value)) do
    local key = type(k) == "string" and string.format("[%q]", k) or ("[" .. tostring(k) .. "]")
    table.insert(lines, indent .. "\t" .. key .. " = " .. serialize(value[k], indent .. "\t") .. ",")
  end
  table.insert(lines, indent .. "}")
  return table.concat(lines, "\n")
end

local function writeSavedVariables()
  return "\nRestedSyncDB = " .. serialize(RestedSyncDB, "") .. "\n"
end

-- Session 1: brand-new install, log in and log out in an inn ---------------
RestedSyncDB = nil
loadAddon()
fire("PLAYER_ENTERING_WORLD", true, false)
runTimers()
fire("PLAYER_LOGOUT")
local afterFirstLogout = writeSavedVariables()

-- Session 2: 30 hours later. Server applied 30h * 0.625%/h * 1.12 = 21% of a level.
local loaded = assert(loadstring(afterFirstLogout))
RestedSyncDB = nil
loaded()
now = now + 30 * 3600
player.rested = player.rested + math.floor(player.maxXP * 0.21 + 0.5)
loadAddon()
fire("PLAYER_ENTERING_WORLD", true, false)
runTimers()
-- Play a bit: earn 1200 XP (consumes 600 rested), then /reload, then log out outdoors.
now = now + 1800
player.xp = player.xp + 1200
player.rested = player.rested - 600
fire("PLAYER_XP_UPDATE", "player")
fire("PLAYER_LOGOUT")
local afterReload = writeSavedVariables()
RestedSyncDB = nil
assert(loadstring(afterReload))()
loadAddon()
fire("PLAYER_ENTERING_WORLD", false, true) -- /reload: must not overwrite the login snapshot
player.resting = false
fire("PLAYER_UPDATE_RESTING")
now = now + 600
fire("PLAYER_LOGOUT")

io.write(writeSavedVariables())
