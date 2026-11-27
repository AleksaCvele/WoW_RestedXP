--[[
  RestedSync
  ----------
  Silently records each character's rested XP so the desktop "WoW Rested Tracker"
  tray widget can show how much rested XP your alts have built up while offline.

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

local frame = CreateFrame("Frame")
local charKey = nil
local loginXP = nil -- UnitXP at login, used to tell whether XP was earned before the re-check

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

local function getCharKey()
  local name = UnitName("player")
  local realm = GetRealmName()
  if not name or name == "" or name == UNKNOWNOBJECT or not realm or realm == "" then
    return nil
  end
  return name .. "-" .. realm, name, realm
end

-- Small, flat copy of the rested-related numbers, used for the login/logout pair
-- the widget uses to auto-detect the Well Rested perk rank.
local function restedPoint(entry)
  if type(entry) ~= "table" then return nil end
  return {
    level = entry.level,
    restedXP = entry.restedXP,
    maxXP = entry.maxXP,
    restedPct = entry.restedPct,
    isResting = entry.isResting,
    timestamp = entry.timestamp,
  }
end

local function buildSnapshot()
  local key, name, realm = getCharKey()
  if not key then return nil end

  local level = UnitLevel("player") or 0
  local maxXP = UnitXPMax("player") or 0
  local restedXP = GetXPExhaustion() or 0
  local maxLevel = getMaxLevel()
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
    isMaxLevel = (maxLevel ~= nil and level >= maxLevel) or false,
    xpDisabled = safeCall(IsXPUserDisabled) and true or false,
    timestamp = time(),                         -- Unix epoch in seconds
    toc = tocVersion,
    schema = SCHEMA_VERSION,
  }
end

local function saveSnapshot()
  if type(RestedSyncDB) ~= "table" then return end
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

-- Called once per real login (not on /reload or zoning). Stores the state saved at the
-- previous logout next to the state right after logging in, so the widget can measure
-- how fast rested XP actually accumulated while offline.
local function captureLogin()
  if type(RestedSyncDB) ~= "table" then return end
  local key, snapshot = buildSnapshot()
  if not key then return end

  local previous = RestedSyncDB[key]
  local prevLogout = restedPoint(previous)
  snapshot.prevLogout = prevLogout
  snapshot.login = restedPoint(snapshot)
  snapshot.login.isResting = nil
  RestedSyncDB[key] = snapshot
  charKey = key
  loginXP = snapshot.xp
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
    if isRealLogin(arg1, arg2) then
      captureLogin()
      if C_Timer and C_Timer.After then
        C_Timer.After(LOGIN_RECHECK_DELAY, recheckLogin)
      end
    else
      saveSnapshot()
    end
    return
  end

  -- PLAYER_XP_UPDATE, PLAYER_UPDATE_RESTING, PLAYER_LEVEL_UP, UPDATE_EXHAUSTION, PLAYER_LOGOUT
  saveSnapshot()
end)

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("PLAYER_XP_UPDATE")
frame:RegisterEvent("PLAYER_UPDATE_RESTING")
frame:RegisterEvent("PLAYER_LEVEL_UP")
frame:RegisterEvent("UPDATE_EXHAUSTION")
frame:RegisterEvent("PLAYER_LOGOUT")
