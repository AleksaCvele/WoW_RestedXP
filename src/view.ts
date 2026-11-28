// HTML builders for the widget. Everything user- or file-provided goes through esc().

import { APP_NAME, SAVED_VARIABLES_FILE } from "./config";
import { esc } from "./html";
import { classIconSvg, icon } from "./icons";
import { computeRested, formatAgo, formatDuration, formatPct, type RestedStatus } from "./math";
import { describeSourcePath, effectiveRank, flavorLabel, isRemoved, prefsFor } from "./sync";
import type { OsName } from "./platform";
import type { AppState, CharacterPrefs, DetectedFile, SyncedCharacter } from "./types";
import { classInfo, genderLabel, raceInfo } from "./wow";

export interface FileStatus {
  state: "ok" | "missing" | "error";
  count: number;
  message?: string;
}

export interface UiState {
  settingsOpen: boolean;
  detecting: boolean;
  detectMessage: string;
  detectResults: DetectedFile[];
  fileStatus: Record<string, FileStatus>;
  version: string;
  isDesktop: boolean;
  /** Data URLs for portraits that point at local files. */
  portraitCache: Map<string, string>;
  syncing: boolean;
  os: OsName;
  update: UpdateStatus;
}

export interface UpdateStatus {
  phase: "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "installing" | "error";
  version?: string;
  /** 0..1 while downloading, null when the size is unknown. */
  progress?: number | null;
  message?: string;
}

export interface CharView {
  ch: SyncedCharacter;
  prefs: CharacterPrefs;
  rank: number;
  status: RestedStatus;
  /** Counts toward "maxed" totals, notifications and sorting. */
  eligible: boolean;
}

export { esc };

export function buildViews(state: AppState, nowSec: number): CharView[] {
  const views: CharView[] = [];
  for (const ch of Object.values(state.characters)) {
    if (isRemoved(state, ch)) continue;
    const prefs = prefsFor(state, ch.key);
    const rank = effectiveRank(state, ch.key);
    const status = computeRested(ch, rank, nowSec);
    views.push({ ch, prefs, rank, status, eligible: prefs.isTracked && !ch.isMaxLevel });
  }
  return views;
}

/** Roster order: tracked leveling characters, then max-level ones, then untracked. */
export function sortViews(views: CharView[], autoSort: boolean): CharView[] {
  const group = (v: CharView) => (!v.prefs.isTracked ? 2 : v.ch.isMaxLevel ? 1 : 0);
  return [...views].sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    if (autoSort && group(a) === 0) {
      const d = b.status.currentPct - a.status.currentPct;
      if (Math.abs(d) > 1e-9) return d;
    }
    return a.ch.name.localeCompare(b.ch.name) || a.ch.realm.localeCompare(b.ch.realm);
  });
}

export function visibleViews(state: AppState, views: CharView[]): CharView[] {
  const { hideUntracked, hideMaxLevel, autoSort } = state.settings.behavior;
  return sortViews(
    views.filter((v) => !(hideUntracked && !v.prefs.isTracked) && !(hideMaxLevel && v.ch.isMaxLevel)),
    autoSort,
  );
}

export function summary(views: CharView[]): { maxed: number; total: number; next?: CharView } {
  const eligible = views.filter((v) => v.eligible);
  const pending = eligible.filter((v) => !v.status.isMaxed).sort((a, b) => a.status.hoursUntilMax - b.status.hoursUntilMax);
  return { maxed: eligible.length - pending.length, total: eligible.length, next: pending[0] };
}

// ---------------------------------------------------------------------------
// Avatars

/** Returns a filesystem path if the portrait "URL" points at a local file. */
export function localPortraitPath(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  if (u.toLowerCase().startsWith("file://")) {
    let p = decodeURIComponent(u.slice(7)); // "/C:/x.png" or "/home/x.png"
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return p;
  }
  if (/^[a-zA-Z]:[\\/]/.test(u) || u.startsWith("/") || u.startsWith("\\\\")) return u;
  return null;
}

function portraitSrc(url: string, ui: UiState): string | null {
  const u = url.trim();
  if (!u) return null;
  if (/^https:\/\//i.test(u)) return u;
  const local = localPortraitPath(u);
  if (local) return ui.portraitCache.get(local) ?? null;
  return null;
}

export function avatarHtml(state: AppState, ui: UiState, ch: SyncedCharacter, prefs: CharacterPrefs, size: "lg" | "sm" | "xs"): string {
  const crest = `<span class="crest">${classIconSvg(ch.classToken)}</span>`;
  if (state.settings.avatarMode === "portrait") {
    const src = portraitSrc(prefs.portraitUrl, ui);
    if (src) {
      return `<span class="avatar avatar-${size} avatar-portrait"><img src="${esc(src)}" alt="" draggable="false" referrerpolicy="no-referrer" data-fallback />${crest}</span>`;
    }
  }
  return `<span class="avatar avatar-${size}">${crest}</span>`;
}

// ---------------------------------------------------------------------------
// Header / roster / footer

export function renderHeader(state: AppState, views: CharView[]): string {
  const { maxed, total } = summary(views);
  const compact = state.settings.viewMode === "compact";
  const pinned = state.settings.pinned;
  const sub = total === 0 ? "No characters yet" : compact ? `${maxed}/${total} maxed` : `${maxed} of ${total} characters fully rested`;
  return `
    <div class="brand">
      ${icon("zzz", "brand-icon")}
      <div class="brand-text">
        <div class="brand-title">Rested</div>
        <div class="brand-sub">${esc(sub)}</div>
      </div>
    </div>
    <div class="hdr-actions">
      <button class="ibtn ${pinned ? "on" : ""}" data-action="toggle-pin" title="${pinned ? "Pinned: stays on top (click to unpin)" : "Unpinned: hides when you click away (click to pin on top)"}" aria-pressed="${pinned}">${icon(pinned ? "pin" : "pinOff")}</button>
      <button class="ibtn" data-action="toggle-view" title="${compact ? "Expanded view" : "Compact mini-bar view"}">${icon(compact ? "expanded" : "compact")}</button>
      <button class="ibtn" data-action="open-settings" title="Settings">${icon("gear")}</button>
      <button class="ibtn" data-action="hide" title="Minimize to tray">${icon("minimize")}</button>
    </div>`;
}

function rankOptions(state: AppState, v: { ch: SyncedCharacter; prefs: CharacterPrefs }): string {
  const detected = typeof v.prefs.detectedRank === "number";
  const autoRank = detected ? v.prefs.detectedRank! : state.settings.defaultWellRestedRank;
  const opts = [`<option value="auto" ${v.prefs.wellRestedRank === "auto" ? "selected" : ""}>Auto (${autoRank}/5)</option>`];
  for (let r = 0; r <= 5; r++) {
    opts.push(`<option value="${r}" ${v.prefs.wellRestedRank === r ? "selected" : ""}>${r}/5</option>`);
  }
  return opts.join("");
}

function rankTitle(state: AppState, prefs: CharacterPrefs): string {
  if (prefs.wellRestedRank !== "auto") return "Well Rested rank set manually";
  if (typeof prefs.detectedRank === "number") return "Well Rested rank detected automatically from your last offline period";
  return `Not detected yet: using the default rank (${state.settings.defaultWellRestedRank}/5). It is detected after you log back in from a long enough break.`;
}

function barHtml(state: AppState, v: CharView, mini: boolean): string {
  const pct = Math.max(0, Math.min(100, v.status.fractionOfCap * 100));
  const classColored = state.settings.display.classColoredBars;
  const cls = ["fill", v.status.isMaxed ? "is-maxed" : "", classColored ? "by-class" : ""].join(" ");
  // One tick per 10% of a level (two XP-bar "bubbles").
  const tick = ((10 / v.status.maxCap) * 100).toFixed(3);
  return `<div class="bar ${mini ? "bar-mini" : ""}" style="--tick:${tick}%" role="progressbar" aria-valuemin="0" aria-valuemax="${v.status.maxCap.toFixed(0)}" aria-valuenow="${v.status.currentPct.toFixed(1)}">
      <div class="${cls}" style="width:${pct.toFixed(2)}%"></div>
    </div>`;
}

function restBadge(ch: SyncedCharacter, compact: boolean): string {
  if (ch.isResting) {
    return `<span class="rest-badge inn" title="Logged out in an inn or capital city: full rested rate">${icon("zzz")}${compact ? "" : "Inn"}</span>`;
  }
  return `<span class="rest-badge world" title="Logged out in the open world: rested XP builds at 1/4 speed">${icon("tree")}${compact ? "" : "World"}</span>`;
}

function countdownText(v: CharView): string {
  return v.status.isMaxed ? "Fully rested" : `${formatDuration(v.status.hoursUntilMax)} to full`;
}

function cardHtml(state: AppState, ui: UiState, v: CharView, nowSec: number, multiFlavor: boolean): string {
  const { ch, prefs, status } = v;
  const info = classInfo(ch.classToken);
  const d = state.settings.display;
  const race = raceInfo(ch.race, ch.faction);
  const who = `${genderLabel(ch.gender)} ${race.name} ${info.name}`.trim();
  const classes = ["card", status.isMaxed && v.eligible ? "maxed" : "", !prefs.isTracked ? "untracked" : "", ch.isMaxLevel ? "maxlevel" : ""].join(" ");
  const meta = [esc(ch.realm), multiFlavor ? esc(flavorLabel(ch.flavor)) : "", esc(formatAgo(nowSec - ch.timestamp))]
    .filter(Boolean)
    .join(" · ");
  const editBtn = `<button class="ibtn ibtn-sm" data-action="edit-char" data-key="${esc(ch.key)}" title="Character settings">${icon("more")}</button>`;

  let countdown = "";
  let body: string;
  if (ch.isMaxLevel) {
    body = `<div class="row maxlevel-note">${icon("crown")}<span>Max level: rested XP not needed</span><span class="spacer"></span>${editBtn}</div>`;
  } else {
    const levels = status.currentPct / 100;
    const xp = Math.round(levels * ch.maxXP);
    if (d.showCountdown) {
      countdown = status.isMaxed
        ? `<span class="countdown is-maxed" title="Rested XP is at the cap: play this character!">${icon("check")}MAXED</span>`
        : `<span class="countdown" title="Time until rested XP reaches the cap">${esc(formatDuration(status.hoursUntilMax))}<small>to full</small></span>`;
    }
    body = `
      ${d.showBar ? barHtml(state, v, false) : ""}
      <div class="row row-stats">
        <span class="pct" title="≈ ${esc(xp.toLocaleString("en-US"))} bonus XP (${levels.toFixed(2)} levels)"><b>${formatPct(status.currentPct)}</b> / ${formatPct(status.maxCap)}</span>
        <span class="spacer"></span>
        ${d.showRankSelector ? `<label class="rank" title="${esc(rankTitle(state, prefs))}"><span>Well Rested</span><select data-action="set-rank" data-key="${esc(ch.key)}" aria-label="Well Rested rank for ${esc(ch.name)}">${rankOptions(state, v)}</select></label>` : ""}
        ${editBtn}
      </div>`;
  }

  return `<article class="${classes}" style="--cc:${info.color}" data-key="${esc(ch.key)}" title="${esc(who)}">
    ${avatarHtml(state, ui, ch, prefs, "lg")}
    <div class="card-body">
      <div class="row row-title">
        <span class="name">${esc(ch.name)}</span>
        ${d.showLevel ? `<span class="lvl" title="Level ${ch.level}">${ch.level}</span>` : ""}
        ${ch.xpDisabled ? `<span class="lvl locked" title="XP gain is turned off for this character">${icon("lock")}</span>` : ""}
        ${!prefs.isTracked ? `<span class="tag">benched</span>` : ""}
        <span class="spacer"></span>
        ${countdown}
      </div>
      <div class="row row-meta">
        <span class="meta" title="Last logout">${meta}</span>
        <span class="spacer"></span>
        ${d.showRestingIcon && !ch.isMaxLevel ? restBadge(ch, false) : ""}
      </div>
      ${body}
    </div>
  </article>`;
}

function compactRowHtml(state: AppState, ui: UiState, v: CharView): string {
  const { ch, prefs, status } = v;
  const info = classInfo(ch.classToken);
  const d = state.settings.display;
  const tip = ch.isMaxLevel
    ? `${ch.name} · Level ${ch.level} (max level)`
    : `${ch.name} · Lv ${ch.level} · ${formatPct(status.currentPct)} / ${formatPct(status.maxCap)} · ${countdownText(v)} · ${ch.isResting ? "Inn" : "World"}`;
  const classes = ["crow", status.isMaxed && v.eligible ? "maxed" : "", !prefs.isTracked ? "untracked" : "", ch.isMaxLevel ? "maxlevel" : ""].join(" ");
  const right = ch.isMaxLevel
    ? `<span class="crow-max">${icon("crown")}${ch.level}</span>`
    : `${d.showBar ? barHtml(state, v, true) : ""}<span class="crow-pct ${status.isMaxed ? "is-maxed" : ""}">${status.isMaxed ? icon("check") : `${Math.floor(status.currentPct)}%`}</span>`;
  return `<div class="${classes}" style="--cc:${info.color}" data-key="${esc(ch.key)}" title="${esc(tip)}">
    ${avatarHtml(state, ui, ch, prefs, "sm")}
    <span class="name">${esc(ch.name)}</span>
    ${right}
  </div>`;
}

function emptyStateHtml(state: AppState, ui: UiState, allHidden: boolean): string {
  if (allHidden) {
    return `<div class="empty"><p>All characters are hidden by your filters.</p><button class="btn" data-action="open-settings">${icon("gear")}Open settings</button></div>`;
  }
  const hasPaths = state.settings.savedVariablesPaths.length > 0;
  if (!hasPaths) {
    return `<div class="empty">
      <div class="empty-icon">${icon("zzz")}</div>
      <h2>Track your characters' rested XP</h2>
      <ol class="steps">
        <li>Install the <b>RestedSync</b> addon (in the <code>addon</code> folder) into <code>_forever_\\Interface\\AddOns</code>.</li>
        <li>Log into each character once and log out (ideally in an inn).</li>
        <li>Point the widget at <code>${SAVED_VARIABLES_FILE}</code>:</li>
      </ol>
      <div class="btn-col">
        <button class="btn primary" data-action="auto-detect" ${ui.detecting ? "disabled" : ""}>${icon("search")}${ui.detecting ? "Searching…" : "Auto-Detect WoW Folder"}</button>
        <button class="btn" data-action="pick-file">${icon("file")}Select ${SAVED_VARIABLES_FILE}…</button>
      </div>
      ${ui.detectMessage ? `<p class="hint">${esc(ui.detectMessage)}</p>` : ""}
    </div>`;
  }
  return `<div class="empty">
    <div class="empty-icon">${icon("zzz")}</div>
    <h2>Waiting for your first logout</h2>
    <p>The game writes <code>${SAVED_VARIABLES_FILE}</code> when you log out, exit or <code>/reload</code>. Log into each character once with the RestedSync addon enabled. Characters appear here automatically.</p>
    <button class="btn" data-action="sync">${icon("refresh")}Check again</button>
  </div>`;
}

function osLabel(os: OsName): string {
  return os === "windows" ? "Windows" : os === "macos" ? "macOS" : "your computer";
}

function updateBanner(state: AppState, ui: UiState): string {
  const u = ui.update;
  const v = u.version ? ` v${esc(u.version)}` : "";
  switch (u.phase) {
    case "available":
      return `<div class="banner">${icon("download")}<span>Update${v} is available.</span><span class="spacer"></span><button class="btn btn-sm primary" data-action="install-update">Update</button></div>`;
    case "downloading":
      return `<div class="banner">${icon("download")}<span>Downloading update${v}… ${u.progress != null ? `${Math.round(u.progress * 100)}%` : ""}</span></div>`;
    case "ready":
      return `<div class="banner">${icon("download")}<span>Update${v} is ready.${state.settings.behavior.autoUpdate ? " It installs when the widget is hidden." : ""}</span><span class="spacer"></span><button class="btn btn-sm primary" data-action="install-update">Restart now</button></div>`;
    case "installing":
      return `<div class="banner">${icon("download")}<span>Installing update${v}…</span></div>`;
    default:
      return "";
  }
}

function startupPrompt(state: AppState, ui: UiState, views: CharView[]): string {
  const b = state.settings.behavior;
  if (!ui.isDesktop || state.settings.startupPromptDone || b.launchOnStartup || views.length === 0) return "";
  return `<div class="banner prompt">
    <div class="prompt-text"><b>Start with ${osLabel(ui.os)}?</b><span>The widget can start quietly in the tray when you sign in, so you get a notification when a character is fully rested.</span></div>
    <div class="prompt-actions">
      <button class="btn btn-sm primary" data-action="enable-startup">Turn on</button>
      <button class="btn btn-sm" data-action="dismiss-startup">No thanks</button>
    </div>
  </div>`;
}

export function renderRoster(state: AppState, ui: UiState, views: CharView[], nowSec: number): string {
  const visible = visibleViews(state, views);
  const banners = updateBanner(state, ui) + startupPrompt(state, ui, views);
  let list: string;
  if (visible.length === 0) {
    list = emptyStateHtml(state, ui, views.length > 0);
  } else if (state.settings.viewMode === "compact") {
    list = `<div class="crows">${visible.map((v) => compactRowHtml(state, ui, v)).join("")}</div>`;
  } else {
    const multiFlavor = new Set(visible.map((v) => v.ch.flavor)).size > 1;
    list = `<div class="cards">${visible.map((v) => cardHtml(state, ui, v, nowSec, multiFlavor)).join("")}</div>`;
  }
  return `<div class="roster-inner">${banners}${list}</div>`;
}

export function renderFooter(state: AppState, ui: UiState, nowSec: number): string {
  const compact = state.settings.viewMode === "compact";
  const errors = Object.values(ui.fileStatus).filter((s) => s.state === "error").length;
  const label = ui.syncing
    ? "Syncing…"
    : errors
      ? `${errors} file${errors > 1 ? "s" : ""} unreadable`
      : state.lastSyncAt
        ? `Synced ${formatAgo(nowSec - state.lastSyncAt)}`
        : "Not synced yet";
  return `
    <button class="sync ${errors ? "has-error" : ""}" data-action="sync" title="Force sync now">${icon(errors ? "warn" : "refresh")}${compact ? "" : `<span>${esc(label)}</span>`}</button>
    <span class="spacer"></span>
    <button class="support" data-action="patreon" title="Support on Patreon">${icon("heart")}${compact ? "" : "<span>Support</span>"}</button>`;
}

// ---------------------------------------------------------------------------
// Settings drawer

function toggle(setting: string, checked: boolean, label: string, hint = ""): string {
  return `<label class="toggle">
    <input type="checkbox" data-setting="${setting}" ${checked ? "checked" : ""} />
    <span class="switch" aria-hidden="true"></span>
    <span class="toggle-text">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</span>
  </label>`;
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]+/);
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = parts.findIndex((p) => /^_[a-z0-9_]+_$/i.test(p));
  if (idx >= 0) return parts.slice(idx).join(sep);
  return parts.length > 4 ? `…${sep}${parts.slice(-4).join(sep)}` : path;
}

function pathItem(path: string, status: FileStatus | undefined): string {
  const { flavor, account } = describeSourcePath(path);
  let statusHtml = `<span class="status">Not read yet</span>`;
  if (status?.state === "ok") {
    statusHtml = `<span class="status ok">${icon("check")}${status.count} character${status.count === 1 ? "" : "s"}</span>`;
  } else if (status?.state === "missing") {
    statusHtml = `<span class="status wait" title="The file is created the first time you log out with the addon enabled">Waiting for first logout</span>`;
  } else if (status?.state === "error") {
    statusHtml = `<span class="status err" title="${esc(status.message ?? "")}">${icon("warn")}Unreadable</span>`;
  }
  return `<li class="path">
    <div class="path-main">
      <span class="chip">${esc(flavorLabel(flavor))}</span>
      ${account ? `<span class="acct" title="WTF account folder">${esc(account)}</span>` : ""}
      <span class="spacer"></span>
      ${statusHtml}
      <button class="ibtn ibtn-sm" data-action="remove-path" data-path="${esc(path)}" title="Stop watching this file">${icon("trash")}</button>
    </div>
    <div class="path-text" title="${esc(path)}">${esc(shortPath(path))}</div>
  </li>`;
}

function detectResultsHtml(state: AppState, ui: UiState): string {
  const pending = ui.detectResults.filter((d) => !state.settings.savedVariablesPaths.includes(d.path));
  if (!pending.length) return ui.detectMessage ? `<p class="hint">${esc(ui.detectMessage)}</p>` : "";
  return `${ui.detectMessage ? `<p class="hint">${esc(ui.detectMessage)}</p>` : ""}
    <ul class="detected">${pending
      .map(
        (d) => `<li>
          <span class="chip">${esc(flavorLabel(d.flavor))}</span>
          <span class="acct">${esc(d.account)}</span>
          <span class="status ${d.exists ? "ok" : "wait"}">${d.exists ? "Has data" : "No data yet"}</span>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-action="add-path" data-path="${esc(d.path)}">Watch</button>
        </li>`,
      )
      .join("")}</ul>`;
}

function characterSettingsHtml(state: AppState, ui: UiState, views: CharView[]): string {
  if (!views.length) return `<p class="hint">Characters show up here after their first logout with the addon.</p>`;
  const showPortrait = state.settings.avatarMode === "portrait";
  return sortViews(views, false)
    .map((v) => {
      const { ch, prefs } = v;
      const info = classInfo(ch.classToken);
      return `<div class="char-cfg" style="--cc:${info.color}" data-cfg-key="${esc(ch.key)}">
        <div class="char-cfg-top">
          ${avatarHtml(state, ui, ch, prefs, "xs")}
          <span class="name">${esc(ch.name)}</span>
          <span class="meta">${ch.level} · ${esc(ch.realm)} · ${esc(flavorLabel(ch.flavor))}</span>
          <span class="spacer"></span>
          <button class="ibtn ibtn-sm" data-action="remove-char" data-key="${esc(ch.key)}" title="Remove from the list (comes back if you play it again)">${icon("trash")}</button>
        </div>
        <div class="char-cfg-controls">
          <label class="toggle toggle-sm">
            <input type="checkbox" data-action="track" data-key="${esc(ch.key)}" ${prefs.isTracked ? "checked" : ""} />
            <span class="switch" aria-hidden="true"></span>
            <span class="toggle-text">Track character</span>
          </label>
          <span class="spacer"></span>
          ${ch.isMaxLevel ? `<span class="meta">Max level</span>` : `<label class="rank" title="${esc(rankTitle(state, prefs))}"><span>Well Rested</span><select data-action="set-rank" data-key="${esc(ch.key)}">${rankOptions(state, v)}</select></label>`}
        </div>
        ${
          showPortrait
            ? `<div class="portrait-row">
                <input type="text" class="text" data-action="portrait" data-key="${esc(ch.key)}" value="${esc(prefs.portraitUrl)}" placeholder="https:// image link, or Browse for a file" spellcheck="false" />
                ${ui.isDesktop ? `<button class="ibtn" data-action="browse-portrait" data-key="${esc(ch.key)}" title="Choose an image file">${icon("folder")}</button>` : ""}
              </div>`
            : ""
        }
      </div>`;
    })
    .join("");
}

function updatesSection(state: AppState, ui: UiState): string {
  const u = ui.update;
  const v = u.version ? `v${esc(u.version)}` : "";
  let status = "";
  let button = `<button class="btn btn-sm" data-action="check-update">${icon("refresh")}Check now</button>`;
  switch (u.phase) {
    case "checking":
      status = "Checking for updates…";
      button = "";
      break;
    case "uptodate":
      status = `${icon("check")}You're on the latest version.`;
      break;
    case "available":
      status = `${v} is available.`;
      button = `<button class="btn btn-sm primary" data-action="install-update">Install ${v}</button>`;
      break;
    case "downloading":
      status = `Downloading ${v}… ${u.progress != null ? `${Math.round(u.progress * 100)}%` : ""}`;
      button = "";
      break;
    case "ready":
      status = `${v} is downloaded.`;
      button = `<button class="btn btn-sm primary" data-action="install-update">Restart &amp; update</button>`;
      break;
    case "installing":
      status = `Installing ${v}…`;
      button = "";
      break;
    case "error":
      status = `<span class="err-text">${esc(u.message ?? "Update check failed.")}</span>`;
      break;
  }
  return `<section class="group">
    <h3>Updates</h3>
    ${toggle("behavior.autoUpdate", state.settings.behavior.autoUpdate, "Install updates automatically", "Checks every 6 hours. Updates are signed and verified before they install.")}
    <div class="update-row">
      <span class="update-status">${ui.version ? `Version ${esc(ui.version)}` : ""}${status ? ` · ${status}` : ""}</span>
      <span class="spacer"></span>
      ${button}
    </div>
  </section>`;
}

export function renderSettings(state: AppState, ui: UiState, views: CharView[]): string {
  const s = state.settings;
  const d = s.display;
  const b = s.behavior;
  const avatar = (mode: string, label: string) =>
    `<label class="seg ${s.avatarMode === mode ? "on" : ""}"><input type="radio" name="avatarMode" data-setting="avatarMode" value="${mode}" ${s.avatarMode === mode ? "checked" : ""} />${label}</label>`;
  const rankSelect = Array.from({ length: 6 }, (_, r) => `<option value="${r}" ${s.defaultWellRestedRank === r ? "selected" : ""}>${r}/5</option>`).join("");

  return `
    <div class="drawer-hdr">
      <button class="ibtn" data-action="close-settings" title="Back">${icon("back")}</button>
      <h2>Settings</h2>
      <span class="spacer"></span>
      <button class="ibtn" data-action="hide" title="Minimize to tray">${icon("minimize")}</button>
    </div>
    <div class="drawer-body">
      <section class="group">
        <h3>Data source</h3>
        <p class="hint">Reads <code>${SAVED_VARIABLES_FILE}</code> from <code>_forever_\\WTF\\Account\\&lt;ACCOUNT&gt;\\SavedVariables</code>. It updates by itself every time you log out.</p>
        ${s.savedVariablesPaths.length ? `<ul class="paths">${s.savedVariablesPaths.map((p) => pathItem(p, ui.fileStatus[p])).join("")}</ul>` : `<p class="hint warn">No file selected yet.</p>`}
        <div class="btn-row">
          <button class="btn primary" data-action="auto-detect" ${ui.detecting ? "disabled" : ""}>${icon("search")}${ui.detecting ? "Searching…" : "Auto-Detect"}</button>
          <button class="btn" data-action="pick-file">${icon("file")}Select file…</button>
          ${ui.isDesktop ? `<button class="btn" data-action="pick-folder" title="Pick your World of Warcraft install folder if it is in an unusual place">${icon("folder")}WoW folder…</button>` : ""}
        </div>
        ${detectResultsHtml(state, ui)}
      </section>

      <section class="group">
        <h3>Display</h3>
        ${toggle("display.showBar", d.showBar, "Rested XP bar", "Current % / max %")}
        ${toggle("display.showCountdown", d.showCountdown, "Countdown timer", "Time until the cap is reached")}
        ${toggle("display.showLevel", d.showLevel, "Character level badge")}
        ${toggle("display.showRestingIcon", d.showRestingIcon, "Inn vs. open world icon", "Zzz = inn / city, tree = open world")}
        ${toggle("display.showRankSelector", d.showRankSelector, "Inline Well Rested rank selector")}
        ${toggle("display.classColoredBars", d.classColoredBars, "Color bars by class", "Off: rested blue, emerald when maxed")}
      </section>

      <section class="group">
        <h3>Avatar style</h3>
        <div class="segmented">
          ${avatar("class", "Class crest")}
          ${avatar("portrait", "Custom portrait")}
        </div>
        ${s.avatarMode === "portrait" ? `<p class="hint">Set a portrait for each character under <b>Characters</b> below: an <code>https://</code> image link, or the folder button to pick an image file. Empty or broken links fall back to the class crest.</p>` : ""}
      </section>

      <section class="group">
        <h3>Behavior &amp; alerts</h3>
        ${toggle("behavior.autoSort", b.autoSort, "Auto-sort by highest rested %")}
        ${toggle("behavior.notifyOnMax", b.notifyOnMax, "Notify me when a character is fully rested", "Desktop notification when a character reaches its cap")}
        ${ui.isDesktop ? toggle("behavior.launchOnStartup", b.launchOnStartup, `Start with ${osLabel(ui.os)}`, "Starts quietly in the tray when you sign in") : ""}
        ${toggle("behavior.hideUntracked", b.hideUntracked, "Hide benched (untracked) characters")}
        ${toggle("behavior.hideMaxLevel", b.hideMaxLevel, "Hide max-level characters")}
        <label class="field">
          <span class="toggle-text">Default Well Rested rank<small>Used by "Auto" until a rank is detected. It is detected automatically after you log back in from a break of roughly 10+ hours.</small></span>
          <select data-setting="defaultWellRestedRank">${rankSelect}</select>
        </label>
      </section>

      <section class="group">
        <h3>Characters</h3>
        ${characterSettingsHtml(state, ui, views)}
      </section>

      ${ui.isDesktop ? updatesSection(state, ui) : ""}

      <section class="group support-group">
        <h3>Support</h3>
        <p class="hint">${esc(APP_NAME)} is free and open source: no ads, no accounts, no locked features. If it saves you some time, you can chip in.</p>
        <button class="btn support-btn" data-action="patreon">${icon("heart")}Support on Patreon</button>
      </section>

      <p class="about">${esc(APP_NAME)}${ui.version ? ` v${esc(ui.version)}` : ""} · Not affiliated with or endorsed by Blizzard Entertainment.</p>
    </div>`;
}
