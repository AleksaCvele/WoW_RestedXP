--[[
  RestedSync
  ----------
  Silently records each character's rested XP so the desktop "WoW Rested Tracker"
  tray widget can show how much rested XP your characters have built up while offline.

  * No UI, no slash commands, no configuration, no network access.
  * Uses only standard Blizzard API functions.
  * The game client writes RestedSyncDB to
      WTF/Account/<ACCOUNT>/SavedVariables/RestedSync.lua
    whenever you log out, exit the game or /reload.
]]

local ADDON_NAME = ...
local SCHEMA_VERSION = 2

-- Seconds after the initial login during which the login snapshot may be refreshed
-- (the server sometimes delivers the rested bonus a moment after PLAYER_ENTERING_WORLD).
local LOGIN_RECHECK_DELAY = 3
-- UnitLevel() still reports the old level while PLAYER_LEVEL_UP is being handled.
local LEVEL_UP_DELAY = 1
-- Rested XP keeps growing while you stand in an inn, so refresh the snapshot regularly.
local REFRESH_INTERVAL = 60

local frame = CreateFrame("Frame")
local charKey = nil
local loginXP = nil      -- UnitXP at login, used to tell whether XP was earned before the re-check
local pendingLogin = false -- a real login whose snapshot could not be taken yet
local inWorld = false    -- false during loading screens and while logging out
local ticker = nil

local function safeCall(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, result = pcall(fn, ...)
  if ok then return result end
  return nil
end

local function getMaxLevel()
  local level = safeCall(GetMaxLevelForPlayerExpansion)
  if type(level) == "number" and level > 0 then return level end
  level = safeCall(GetMaxPlayerLevel)
  if type(level) == "number" and level > 0 then return level end
  if type(MAX_PLAYER_LEVEL) == "number" and MAX_PLAYER_LEVEL > 0 then return MAX_PLAYER_LEVEL end
  return nil
end

local function nonEmpty(value)
  if type(value) == "string" and value ~= "" then return value end
  return nil
end

-- The realm name, from the first API that reports one. Most clients answer
-- GetRealmName(), but WoW Forever returns "" there and only reports the realm as
-- the second value of UnitName("player") (e.g. "Avendel", "Sunward").
local function getRealm(unitRealm)
  local realm = nonEmpty(safeCall(GetRealmName))
    or nonEmpty(unitRealm)
    or nonEmpty(safeCall(GetNormalizedRealmName))
  if realm then return realm end
  if type(UnitFullName) == "function" then
    local ok, _, fullRealm = pcall(UnitFullName, "player")
    if ok then return nonEmpty(fullRealm) end
  end
  return nil
end

local function getCharKey()
  local name, unitRealm = UnitName("player")
  if not nonEmpty(name) or name == UNKNOWNOBJECT then return nil end
  local realm = getRealm(unitRealm)
  if not realm then return nil end
  return name .. "-" .. realm, name, realm
end

-- Small, flat copy of the rested-related numbers, used for the login/logout pair
-- the widget uses to auto-detect the Well Rested perk rank. Entries written while the
-- client was tearing the character down (older versions did that) are not usable.
local function restedPoint(entry)
  if type(entry) ~= "table" then return nil end
  if type(entry.level) ~= "number" or entry.level <= 0 then return nil end
  if type(entry.maxXP) ~= "number" or entry.maxXP <= 1 then return nil end
  return {
    level = entry.level,
    restedXP = entry.restedXP,
    maxXP = entry.maxXP,
    restedPct = entry.restedPct,
    isResting = entry.isResting,
    timestamp = entry.timestamp,
  }
end

-- Returns nil when the client isn't reporting real character data. While logging out,
-- WoW Forever already answers UnitXPMax() = 0, GetXPExhaustion() = nil,
-- IsResting() = false and the level from the character list.
local function buildSnapshot()
  local key, name, realm = getCharKey()
  if not key then return nil end

  local level = UnitLevel("player") or 0
  local maxXP = UnitXPMax("player") or 0
  local maxLevel = getMaxLevel()
  local isMaxLevel = (maxLevel ~= nil and level >= maxLevel) or false
  if level <= 0 or (maxXP <= 0 and not isMaxLevel) then return nil end

  local restedXP = GetXPExhaustion() or 0
  local _, classToken = UnitClass("player")
  local _, raceToken = UnitRace("player")
  local tocVersion = select(4, GetBuildInfo())

  local restedPct = 0
  if maxXP > 0 then
    restedPct = (restedXP / maxXP) * 100
  end

  return key, {
    name = name,
    realm = realm,
    class = classToken,                         -- e.g. "WARRIOR", "MAGE"
    race = raceToken,                           -- e.g. "Human", "NightElf"
    gender = UnitSex("player"),                 -- 2 = Male, 3 = Female
    faction = UnitFactionGroup("player"),       -- "Alliance" / "Horde"
    level = level,
    xp = UnitXP("player") or 0,
    restedXP = restedXP,
    maxXP = (maxXP > 0) and maxXP or 1,
    restedPct = restedPct,
    isResting = IsResting() and true or false,  -- true in an inn / capital city ("Zzz")
    isMaxLevel = isMaxLevel,
    xpDisabled = safeCall(IsXPUserDisabled) and true or false,
    timestamp = time(),                         -- Unix epoch in seconds
    toc = tocVersion,
    schema = SCHEMA_VERSION,
  }
end

-- Called once per real login (not on /reload or zoning). Stores the state saved at the
-- previous logout next to the state right after logging in, so the widget can measure
-- how fast rested XP actually accumulated while offline.
local function captureLogin()
  if type(RestedSyncDB) ~= "table" then return end
  local key, snapshot = buildSnapshot()
  if not key then
    pendingLogin = true -- try again with the next usable snapshot
    return
  end
  pendingLogin = false

  local previous = RestedSyncDB[key]
  snapshot.prevLogout = restedPoint(previous)
  snapshot.login = restedPoint(snapshot) -- nil at max level (no XP bar)
  if snapshot.login then snapshot.login.isResting = nil end
  RestedSyncDB[key] = snapshot
  charKey = key
  loginXP = snapshot.xp
end

local function saveSnapshot()
  if not inWorld or type(RestedSyncDB) ~= "table" then return end
  if pendingLogin then
    captureLogin()
    return
  end
  local key, snapshot = buildSnapshot()
  if not key then return end
  charKey = key

  -- Keep the login/logout pair recorded at the start of this session.
  local previous = RestedSyncDB[key]
  if type(previous) == "table" then
    snapshot.login = previous.login
    snapshot.prevLogout = previous.prevLogout
  end

  RestedSyncDB[key] = snapshot
end

-- At logout the character data is no longer reliable, so keep the last snapshot taken
-- in the world and only record when the character went offline.
local function markLogout()
  inWorld = false
  if type(RestedSyncDB) ~= "table" or not charKey then return end
  local entry = RestedSyncDB[charKey]
  if type(entry) == "table" then
    entry.timestamp = time()
  end
end

local function recheckLogin()
  if type(RestedSyncDB) ~= "table" or not charKey then return end
  local entry = RestedSyncDB[charKey]
  if type(entry) ~= "table" or type(entry.login) ~= "table" then return end
  -- Only refresh if no XP was earned yet (earning XP consumes rested XP).
  if (UnitXP("player") or 0) ~= loginXP then return end
  local _, snapshot = buildSnapshot()
  if not snapshot then return end
  entry.login.restedXP = snapshot.restedXP
  entry.login.maxXP = snapshot.maxXP
  entry.login.restedPct = snapshot.restedPct
  entry.login.level = snapshot.level
end

local function isRealLogin(isInitialLogin, isReloadingUi)
  if isReloadingUi then return false end
  if isInitialLogin ~= nil then return isInitialLogin and true or false end
  -- Older clients do not pass these arguments: treat it as a login unless the
  -- stored snapshot is only a few minutes old (which means this was a /reload).
  local key = getCharKey()
  local previous = key and RestedSyncDB[key]
  if type(previous) == "table" and type(previous.timestamp) == "number" then
    return (time() - previous.timestamp) > 120
  end
  return true
end

local function after(delay, fn)
  if C_Timer and C_Timer.After then C_Timer.After(delay, fn) end
end

frame:SetScript("OnEvent", function(_, event, arg1, arg2)
  if event == "ADDON_LOADED" then
    if arg1 == ADDON_NAME then
      if type(RestedSyncDB) ~= "table" then
        RestedSyncDB = {}
      end
      frame:UnregisterEvent("ADDON_LOADED")
    end
    return
  end

  if type(RestedSyncDB) ~= "table" then
    RestedSyncDB = {}
  end

  if event == "PLAYER_ENTERING_WORLD" then
    inWorld = true
    if isRealLogin(arg1, arg2) then
      captureLogin()
      after(LOGIN_RECHECK_DELAY, recheckLogin)
    else
      saveSnapshot()
    end
    if not ticker and C_Timer and C_Timer.NewTicker then
      ticker = C_Timer.NewTicker(REFRESH_INTERVAL, saveSnapshot)
    end
    return
  end

  if event == "PLAYER_LEAVING_WORLD" then
    inWorld = false -- loading screen or logout: ignore events until we're back
    return
  end

  if event == "PLAYER_LOGOUT" then
    markLogout()
    return
  end

  if event == "PLAYER_LEVEL_UP" then
    after(LEVEL_UP_DELAY, saveSnapshot)
    return
  end

  -- PLAYER_XP_UPDATE, PLAYER_UPDATE_RESTING, UPDATE_EXHAUSTION
  saveSnapshot()
end)

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("PLAYER_LEAVING_WORLD")
frame:RegisterEvent("PLAYER_XP_UPDATE")
frame:RegisterEvent("PLAYER_UPDATE_RESTING")
frame:RegisterEvent("PLAYER_LEVEL_UP")
frame:RegisterEvent("UPDATE_EXHAUSTION")
frame:RegisterEvent("PLAYER_LOGOUT")
