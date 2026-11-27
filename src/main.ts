// Widget controller: loads state, syncs SavedVariables, renders, and reacts to tray/file events.

import { APP_NAME, COMPACT_WIDTH, EXPANDED_WIDTH, PATREON_URL, SETTINGS_MIN_HEIGHT, TICK_MS } from "./config";
import { computeRested, formatDuration, formatPct } from "./math";
import { esc } from "./html";
import { createPlatform, type AppUpdate, type Platform } from "./platform";
import { effectiveRank, ensurePrefs, mergeCharacters, parseRestedSyncFile, pruneCharactersFromSource, removeCharacter } from "./sync";
import { normalizeState, type AppState, type DetectedFile, type TrayAction, type WellRestedSetting } from "./types";
import {
  buildViews,
  localPortraitPath,
  renderFooter,
  renderHeader,
  renderRoster,
  renderSettings,
  summary,
  type CharView,
  type UiState,
} from "./view";
import { classInfo, raceInfo } from "./wow";

let platform: Platform;
let state: AppState;
const ui: UiState = {
  settingsOpen: false,
  detecting: false,
  detectMessage: "",
  detectResults: [],
  fileStatus: {},
  version: "",
  isDesktop: false,
  portraitCache: new Map(),
  syncing: false,
  os: "web",
  update: { phase: "idle" },
};

const nowSec = () => Date.now() / 1000;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ---------------------------------------------------------------------------
// Persistence

let saveTimer: number | undefined;
function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    platform.saveState(state).catch((err) => console.error("Failed to save state", err));
  }, 300);
}

// ---------------------------------------------------------------------------
// Rendering

function mountSkeleton(): void {
  $("#app").innerHTML = `
    <div class="widget" id="widget">
      <header class="hdr" id="hdr"></header>
      <main class="roster" id="roster"></main>
      <footer class="ftr" id="ftr"></footer>
      <section class="drawer" id="drawer" aria-label="Settings"></section>
    </div>`;
}

function views(): CharView[] {
  return buildViews(state, nowSec());
}

/** Re-renders header, roster and footer. Skips the roster while one of its controls has focus. */
function renderLive(force = false): void {
  const v = views();
  const now = nowSec();
  $("#hdr").innerHTML = renderHeader(state, v);
  const roster = $("#roster");
  const busy = !force && roster.contains(document.activeElement) && document.activeElement instanceof HTMLSelectElement;
  if (!busy) {
    const scroll = roster.scrollTop;
    roster.innerHTML = renderRoster(state, ui, v, now);
    roster.scrollTop = scroll;
  }
  $("#ftr").innerHTML = renderFooter(state, ui, now);
  const widget = $("#widget");
  widget.classList.toggle("compact", state.settings.viewMode === "compact");
  widget.classList.toggle("settings-open", ui.settingsOpen);
  loadLocalPortraits(v);
  updateLayout();
}

function renderDrawer(): void {
  const drawer = $("#drawer");
  if (!ui.settingsOpen) {
    drawer.classList.remove("open");
    drawer.innerHTML = "";
    return;
  }
  const body = drawer.querySelector(".drawer-body");
  const scroll = body ? body.scrollTop : 0;
  drawer.innerHTML = renderSettings(state, ui, views());
  drawer.classList.add("open");
  const newBody = drawer.querySelector(".drawer-body");
  if (newBody) newBody.scrollTop = scroll;
}

function renderAll(): void {
  renderLive(true);
  renderDrawer();
}

let lastLayoutKey = "";
function updateLayout(): void {
  const compact = state.settings.viewMode === "compact";
  const width = compact ? COMPACT_WIDTH : EXPANDED_WIDTH;
  const widget = $("#widget");
  widget.style.setProperty("--w", `${width}px`);
  const roster = $("#roster");
  // Natural height = header + roster content + footer (+ borders); the backend clamps it to the screen.
  // (The roster itself stretches to fill the window, so measure its content, not the roster.)
  const cs = getComputedStyle(roster);
  const content = (roster.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
  const rosterHeight = content + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  let height = $("#hdr").offsetHeight + rosterHeight + $("#ftr").offsetHeight + 2;
  if (ui.settingsOpen) height = Math.max(height, SETTINGS_MIN_HEIGHT);
  height = Math.ceil(Math.min(Math.max(height, 160), 900));
  const key = `${width}x${height}x${state.settings.pinned}`;
  if (key === lastLayoutKey) return;
  lastLayoutKey = key;
  platform.layout(width, height, state.settings.pinned).catch((err) => console.error("layout failed", err));
}

const portraitLoading = new Set<string>();
function loadLocalPortraits(v: CharView[]): void {
  if (state.settings.avatarMode !== "portrait" || !platform.isDesktop) return;
  for (const { prefs } of v) {
    const path = localPortraitPath(prefs.portraitUrl);
    if (!path || ui.portraitCache.has(path) || portraitLoading.has(path)) continue;
    portraitLoading.add(path);
    platform
      .readImageDataUrl(path)
      .then((url) => {
        ui.portraitCache.set(path, url);
        renderAll();
      })
      .catch(() => ui.portraitCache.set(path, "")); // falls back to the class crest
  }
}

// ---------------------------------------------------------------------------
// Sync

function ingestFile(path: string, content: string | null | undefined, error?: string | null, missing?: boolean): string[] {
  if (missing) {
    ui.fileStatus[path] = { state: "missing", count: 0 };
    return [];
  }
  if (error || content == null) {
    ui.fileStatus[path] = { state: "error", count: 0, message: error ?? "Unreadable" };
    return [];
  }
  const parsed = parseRestedSyncFile(content, path);
  if (parsed.error) {
    // The game may still be writing the file; keep the last good data.
    ui.fileStatus[path] = { state: "error", count: 0, message: parsed.error };
    return [];
  }
  ui.fileStatus[path] = { state: "ok", count: parsed.characters.length };
  const { updated } = mergeCharacters(state, parsed.characters);

  // A snapshot that is already at the cap when it arrives does not deserve a notification.
  for (const key of updated) {
    const ch = state.characters[key];
    if (computeRested(ch, effectiveRank(state, key), nowSec()).isMaxed) {
      ensurePrefs(state, key).notifiedTimestamp = ch.timestamp;
    }
  }
  return updated;
}

async function syncAll(): Promise<void> {
  const paths = state.settings.savedVariablesPaths;
  ui.syncing = true;
  renderLive();
  try {
    const results = await platform.readFiles(paths);
    for (const r of results) ingestFile(r.path, r.content, r.error, r.missing ?? undefined);
    state.lastSyncAt = Math.floor(nowSec());
    save();
  } catch (err) {
    console.error("Sync failed", err);
  } finally {
    ui.syncing = false;
    renderAll();
    tick();
  }
}

function onFileChanged(path: string, content: string): void {
  if (!state.settings.savedVariablesPaths.includes(path)) return;
  ingestFile(path, content);
  state.lastSyncAt = Math.floor(nowSec());
  save();
  renderAll();
  tick();
}

/** Applies the backend's list of watched files, dropping characters from removed files. */
async function applyWatchedFiles(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)];
  for (const old of state.settings.savedVariablesPaths) {
    if (!unique.includes(old)) {
      pruneCharactersFromSource(state, old);
      delete ui.fileStatus[old];
    }
  }
  state.settings.savedVariablesPaths = unique;
  save();
  await syncAll();
}

async function watchFiles(paths: string[]): Promise<void> {
  let watched = state.settings.savedVariablesPaths;
  for (const path of paths) watched = await platform.watchFile(path);
  await applyWatchedFiles(watched);
}

/** Handles results from auto-detection or from scanning a picked WoW folder. */
async function handleDetected(found: DetectedFile[], fromFolder: boolean): Promise<void> {
  ui.detectResults = found;
  const known = new Set(state.settings.savedVariablesPaths);
  const withData = found.filter((f) => f.exists && !known.has(f.path));
  if (!found.length) {
    ui.detectMessage = fromFolder
      ? "No WTF\\Account\\…\\SavedVariables folders found in that folder. Pick the main World of Warcraft folder (the one containing _forever_)."
      : "Couldn't find World of Warcraft automatically. Use \"Select file…\" or \"WoW folder…\".";
  } else if (withData.length) {
    ui.detectMessage = `Found ${found.length} account folder${found.length > 1 ? "s" : ""}; now watching ${withData.length} with RestedSync data.`;
    await watchFiles(withData.map((f) => f.path));
  } else {
    const pending = found.filter((f) => !known.has(f.path));
    ui.detectMessage = pending.length
      ? "Found your WoW account folders, but no RestedSync data yet. Click Watch for the client you play (e.g. Forever); it fills in after your next logout."
      : "Everything found is already being watched.";
  }
}

async function runDetection(pickFolder = false): Promise<void> {
  ui.detecting = true;
  ui.detectMessage = "";
  renderAll();
  try {
    if (pickFolder) {
      const found = await platform.pickWowFolder();
      if (found) await handleDetected(found, true);
    } else {
      await handleDetected(await platform.detect(), false);
    }
  } catch (err) {
    ui.detectMessage = `Detection failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    ui.detecting = false;
    renderAll();
  }
}

// ---------------------------------------------------------------------------
// Periodic work: tray tooltip + notifications

function describeChar(v: CharView): string {
  const race = raceInfo(v.ch.race, v.ch.faction).name;
  return `${race} ${classInfo(v.ch.classToken).name} · Lv ${v.ch.level} · ${formatPct(v.status.currentPct)} rested XP banked`;
}

function tick(): void {
  const v = views();
  const { maxed, total, next } = summary(v);

  let tooltip = total ? `${APP_NAME} — ${maxed}/${total} Alts Maxed` : APP_NAME;
  if (next) tooltip += `\nNext: ${next.ch.name} in ${formatDuration(next.status.hoursUntilMax)}`;
  platform.setTrayTooltip(tooltip.slice(0, 127)).catch(() => {});

  const newlyMaxed: CharView[] = [];
  for (const item of v) {
    if (!item.eligible || !item.status.isMaxed) continue;
    const prefs = ensurePrefs(state, item.ch.key);
    if (prefs.notifiedTimestamp === item.ch.timestamp) continue;
    prefs.notifiedTimestamp = item.ch.timestamp;
    newlyMaxed.push(item);
  }
  if (newlyMaxed.length) {
    save();
    if (state.settings.behavior.notifyOnMax) {
      if (newlyMaxed.length === 1) {
        const one = newlyMaxed[0];
        platform.notify(`${one.ch.name} is fully rested`, describeChar(one)).catch(() => {});
      } else {
        platform
          .notify(`${newlyMaxed.length} alts are fully rested`, newlyMaxed.map((x) => x.ch.name).join(", "))
          .catch(() => {});
      }
    }
  }
  renderLive();
  void autoUpdateTick();
}

// ---------------------------------------------------------------------------
// User actions

function openSettings(focusKey?: string): void {
  ui.settingsOpen = true;
  renderAll();
  if (focusKey) {
    const el = document.querySelector<HTMLElement>(`[data-cfg-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      window.setTimeout(() => el.classList.remove("flash"), 1200);
    }
  }
}

function closeSettings(): void {
  ui.settingsOpen = false;
  renderAll();
}

function setRank(key: string, value: string): void {
  const prefs = ensurePrefs(state, key);
  prefs.wellRestedRank = (value === "auto" ? "auto" : Math.max(0, Math.min(5, Number(value)))) as WellRestedSetting;
  save();
  renderAll();
  tick();
}

async function onAction(action: string, el: HTMLElement): Promise<void> {
  const key = el.dataset.key ?? "";
  switch (action) {
    case "toggle-pin":
      state.settings.pinned = !state.settings.pinned;
      save();
      renderLive();
      break;
    case "toggle-view":
      state.settings.viewMode = state.settings.viewMode === "compact" ? "expanded" : "compact";
      save();
      renderLive(true);
      break;
    case "open-settings":
      openSettings();
      break;
    case "close-settings":
      closeSettings();
      break;
    case "edit-char":
      openSettings(key);
      break;
    case "hide":
      await platform.hideWidget();
      break;
    case "sync":
      await syncAll();
      break;
    case "patreon":
      await platform.openUrl(PATREON_URL);
      break;
    case "auto-detect":
      await runDetection();
      break;
    case "pick-folder":
      await runDetection(true);
      break;
    case "pick-file": {
      const file = await platform.pickSavedVariablesFile();
      if (file) {
        ui.detectMessage = /RestedSync\.lua$/i.test(file) ? "" : "That doesn't look like RestedSync.lua, but it will be watched anyway.";
        await applyWatchedFiles(await platform.getWatchedFiles());
      }
      break;
    }
    case "add-path":
      if (el.dataset.path) await watchFiles([el.dataset.path]);
      break;
    case "remove-path":
      if (el.dataset.path) await applyWatchedFiles(await platform.unwatchFile(el.dataset.path));
      break;
    case "enable-startup":
      state.settings.startupPromptDone = true;
      state.settings.behavior.launchOnStartup = true;
      save();
      await platform.setAutostart(true).catch((err) => console.error("autostart", err));
      renderAll();
      break;
    case "dismiss-startup":
      state.settings.startupPromptDone = true;
      save();
      renderAll();
      break;
    case "check-update":
      await checkForUpdate(true);
      break;
    case "install-update":
      await installUpdate();
      break;
    case "remove-char":
      removeCharacter(state, key);
      save();
      renderAll();
      tick();
      break;
    case "browse-portrait": {
      const file = await platform.pickImage();
      if (file) {
        ensurePrefs(state, key).portraitUrl = file;
        ui.portraitCache.delete(file);
        portraitLoading.delete(file);
        save();
        renderAll();
      }
      break;
    }
  }
}

function setSetting(path: string, value: unknown): void {
  const [group, field] = path.split(".");
  if (field) {
    (state.settings as unknown as Record<string, Record<string, unknown>>)[group][field] = value;
  } else {
    (state.settings as unknown as Record<string, unknown>)[group] = value;
  }
}

async function onSettingChange(input: HTMLInputElement | HTMLSelectElement): Promise<void> {
  const path = input.dataset.setting!;
  let value: unknown;
  if (input instanceof HTMLInputElement && input.type === "checkbox") value = input.checked;
  else if (path === "defaultWellRestedRank") value = Number(input.value);
  else value = input.value;
  setSetting(path, value);
  save();

  if (path === "behavior.launchOnStartup") {
    try {
      await platform.setAutostart(value === true);
    } catch (err) {
      console.error("autostart", err);
    }
  }
  if (path === "behavior.notifyOnMax" && value === true) {
    await platform.ensureNotificationPermission().catch(() => false);
  }
  renderAll();
  tick();
}

function attachEvents(): void {
  const root = $("#app");
  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || el instanceof HTMLSelectElement || el instanceof HTMLInputElement) return;
    e.preventDefault();
    onAction(el.dataset.action!, el).catch((err) => console.error(err));
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.dataset.setting) {
      onSettingChange(t).catch((err) => console.error(err));
      return;
    }
    const key = t.dataset.key ?? "";
    switch (t.dataset.action) {
      case "set-rank":
        setRank(key, t.value);
        break;
      case "track":
        ensurePrefs(state, key).isTracked = (t as HTMLInputElement).checked;
        save();
        renderAll();
        tick();
        break;
      case "portrait":
        ensurePrefs(state, key).portraitUrl = t.value.trim();
        save();
        renderAll();
        break;
    }
  });
  // Broken portrait links fall back to the class crest (error events don't bubble, so capture).
  root.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.hasAttribute("data-fallback")) {
        img.closest(".avatar")?.classList.add("failed");
      }
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (ui.settingsOpen) closeSettings();
      else platform.hideWidget().catch(() => {});
    }
  });
}

function onTrayAction(action: TrayAction): void {
  switch (action) {
    case "sync":
      syncAll();
      break;
    case "settings":
      openSettings();
      break;
    case "patreon":
      platform.openUrl(PATREON_URL).catch(() => {});
      break;
  }
}

// ---------------------------------------------------------------------------
// Auto-update (signed releases from GitHub; signatures are verified before installing)

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_UPDATE_CHECK_DELAY_MS = 20_000;
let pendingUpdate: AppUpdate | null = null;
let lastUpdateCheck = 0;
let updateBusy = false;

function updateErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/valid release JSON|404|Not Found|status code/i.test(text)) {
    return "No published update found (the GitHub repository must be public with a published release).";
  }
  if (/network|connect|dns|timed? ?out|offline/i.test(text)) return "Couldn't reach the update server. Check your connection.";
  return `Update failed: ${text}`;
}

async function downloadUpdate(): Promise<void> {
  if (!pendingUpdate) return;
  const version = pendingUpdate.version;
  ui.update = { phase: "downloading", version, progress: 0 };
  renderAll();
  let lastShown = 0;
  await pendingUpdate.download((fraction) => {
    ui.update = { phase: "downloading", version, progress: fraction };
    if (fraction === null || fraction - lastShown >= 0.05 || fraction === 1) {
      lastShown = fraction ?? 0;
      renderAll();
    }
  });
  ui.update = { phase: "ready", version };
}

async function checkForUpdate(manual: boolean): Promise<void> {
  if (!platform.isDesktop || updateBusy) return;
  if (["downloading", "ready", "installing"].includes(ui.update.phase)) return;
  updateBusy = true;
  lastUpdateCheck = Date.now();
  ui.update = { phase: "checking" };
  if (manual) renderAll();
  try {
    const update = await platform.checkForUpdate();
    if (!update) {
      ui.update = { phase: "uptodate" };
      pendingUpdate = null;
      return;
    }
    pendingUpdate = update;
    ui.update = { phase: "available", version: update.version };
    if (state.settings.behavior.autoUpdate && !manual) await downloadUpdate();
  } catch (err) {
    console.warn("Update check failed", err);
    ui.update = { phase: "error", message: updateErrorText(err) };
  } finally {
    updateBusy = false;
    renderAll();
  }
}

async function installUpdate(): Promise<void> {
  if (!pendingUpdate || updateBusy) return;
  updateBusy = true;
  try {
    if (ui.update.phase !== "ready") await downloadUpdate();
    ui.update = { phase: "installing", version: pendingUpdate.version };
    renderAll();
    await pendingUpdate.install(); // restarts the app
  } catch (err) {
    console.error("Update install failed", err);
    ui.update = { phase: "error", message: updateErrorText(err) };
    renderAll();
  } finally {
    updateBusy = false;
  }
}

/** Automatic mode: installs a downloaded update while the widget is tucked away in the tray. */
async function autoUpdateTick(): Promise<void> {
  if (!platform.isDesktop || !state.settings.behavior.autoUpdate) return;
  if (ui.update.phase === "ready") {
    if (!(await platform.isWidgetVisible().catch(() => true))) await installUpdate();
    return;
  }
  if (Date.now() - lastUpdateCheck > UPDATE_INTERVAL_MS) await checkForUpdate(false);
}

// ---------------------------------------------------------------------------
// Boot

async function boot(): Promise<void> {
  platform = await createPlatform();
  ui.isDesktop = platform.isDesktop;
  ui.os = platform.os;
  document.documentElement.classList.toggle("desktop", platform.isDesktop);
  const saved = await platform.loadState().catch(() => null);
  const firstRun = saved === null;
  state = normalizeState(saved);
  ui.version = await platform.appVersion().catch(() => "");

  // The backend owns the list of files the widget may read.
  const watched = await platform.getWatchedFiles().catch(() => state.settings.savedVariablesPaths);
  for (const old of state.settings.savedVariablesPaths) {
    if (!watched.includes(old)) pruneCharactersFromSource(state, old);
  }
  state.settings.savedVariablesPaths = watched;

  mountSkeleton();
  attachEvents();
  renderAll();
  await platform.ready();

  await platform.onFileChanged(onFileChanged);
  await platform.onTrayAction(onTrayAction);
  await syncAll();

  if (platform.isDesktop) {
    try {
      // Launch on startup is off by default; follow the OS (e.g. Task Manager → Startup apps).
      state.settings.behavior.launchOnStartup = await platform.getAutostart();
    } catch (err) {
      console.error("autostart", err);
    }
  }
  if (firstRun) save();

  // First run with nothing configured: try to find the WoW folder right away.
  if (firstRun && state.settings.savedVariablesPaths.length === 0) {
    await runDetection();
  }

  lastUpdateCheck = Date.now() - UPDATE_INTERVAL_MS + FIRST_UPDATE_CHECK_DELAY_MS;
  window.setInterval(tick, TICK_MS);
  renderAll();
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre class="fatal">Failed to start: ${esc(String(err))}</pre>`;
});
