// Thin bridge to the Tauri backend. When the UI is opened in a normal browser
// (`npm run dev`), a demo implementation with sample characters is used instead.

import type { AppState, DetectedFile, FileReadResult, TrayAction } from "./types";

/** A downloadable, signature-verified app update. */
export interface AppUpdate {
  version: string;
  notes?: string;
  /** Downloads the update; `onProgress` receives 0..1, or null when the size is unknown. */
  download(onProgress?: (fraction: number | null) => void): Promise<void>;
  /** Installs a downloaded update and restarts the app. */
  install(): Promise<void>;
}

export type OsName = "windows" | "macos" | "linux" | "web";

export interface Platform {
  readonly isDesktop: boolean;
  readonly os: OsName;
  loadState(): Promise<unknown | null>;
  saveState(state: AppState): Promise<void>;
  /** SavedVariables files the backend has approved and is watching. */
  getWatchedFiles(): Promise<string[]>;
  /** Watch a file returned by detection; returns the new watched list. */
  watchFile(path: string): Promise<string[]>;
  unwatchFile(path: string): Promise<string[]>;
  readFiles(paths: string[]): Promise<FileReadResult[]>;
  detect(): Promise<DetectedFile[]>;
  /** Native picker; the chosen file is approved and watched by the backend. */
  pickSavedVariablesFile(): Promise<string | null>;
  /** Native folder picker + scan; null when cancelled. */
  pickWowFolder(): Promise<DetectedFile[] | null>;
  pickImage(): Promise<string | null>;
  readImageDataUrl(path: string): Promise<string>;
  setTrayTooltip(text: string): Promise<void>;
  /** Resize the widget and anchor it to the bottom-right corner of the primary monitor. */
  layout(width: number, height: number, pinned: boolean): Promise<void>;
  hideWidget(): Promise<void>;
  isWidgetVisible(): Promise<boolean>;
  /** Called once after the first render; shows the window unless launched with --minimized. */
  ready(): Promise<void>;
  openUrl(url: string): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  ensureNotificationPermission(): Promise<boolean>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
  appVersion(): Promise<string>;
  checkForUpdate(): Promise<AppUpdate | null>;
  relaunch(): Promise<void>;
  onFileChanged(cb: (path: string, content: string) => void): Promise<void>;
  onTrayAction(cb: (action: TrayAction) => void): Promise<void>;
}

function detectOs(): OsName {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  return "linux";
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function createTauriPlatform(): Promise<Platform> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getVersion } = await import("@tauri-apps/api/app");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const opener = await import("@tauri-apps/plugin-opener");
  const notification = await import("@tauri-apps/plugin-notification");
  const autostart = await import("@tauri-apps/plugin-autostart");
  const updater = await import("@tauri-apps/plugin-updater");
  const processApi = await import("@tauri-apps/plugin-process");

  return {
    isDesktop: true,
    os: detectOs(),
    async loadState() {
      const text = await invoke<string | null>("load_app_state");
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    saveState: (state) => invoke("save_app_state", { json: JSON.stringify(state) }),
    getWatchedFiles: () => invoke<string[]>("get_watched_files"),
    watchFile: (path) => invoke<string[]>("watch_saved_variables", { path }),
    unwatchFile: (path) => invoke<string[]>("unwatch_saved_variables", { path }),
    readFiles: (paths) => invoke<FileReadResult[]>("read_saved_variables", { paths }),
    detect: () => invoke<DetectedFile[]>("detect_saved_variables"),
    pickSavedVariablesFile: () => invoke<string | null>("pick_saved_variables_file"),
    pickWowFolder: () => invoke<DetectedFile[] | null>("pick_wow_folder"),
    pickImage: () => invoke<string | null>("pick_portrait_image"),
    readImageDataUrl: (path) => invoke<string>("read_image_data_url", { path }),
    setTrayTooltip: (text) => invoke("set_tray_tooltip", { text }),
    layout: (width, height, pinned) => invoke("apply_window_layout", { width, height, pinned }),
    hideWidget: () => invoke("hide_widget"),
    isWidgetVisible: () => getCurrentWindow().isVisible(),
    ready: () => invoke("widget_ready"),
    openUrl: (url) => opener.openUrl(url),
    async ensureNotificationPermission() {
      if (await notification.isPermissionGranted()) return true;
      return (await notification.requestPermission()) === "granted";
    },
    async notify(title, body) {
      if (await notification.isPermissionGranted()) notification.sendNotification({ title, body });
    },
    getAutostart: () => autostart.isEnabled(),
    setAutostart: (enabled) => (enabled ? autostart.enable() : autostart.disable()),
    appVersion: () => getVersion(),
    async checkForUpdate() {
      const update = await updater.check({ timeout: 30_000 });
      if (!update) return null;
      return {
        version: update.version,
        notes: update.body,
        async download(onProgress) {
          let total = 0;
          let done = 0;
          await update.download((event) => {
            if (event.event === "Started") total = event.data.contentLength ?? 0;
            if (event.event === "Progress") {
              done += event.data.chunkLength;
              onProgress?.(total > 0 ? Math.min(1, done / total) : null);
            }
          });
        },
        async install() {
          // Windows: the installer closes and reopens the app itself.
          await update.install();
          await processApi.relaunch();
        },
      };
    },
    relaunch: () => processApi.relaunch(),
    async onFileChanged(cb) {
      await listen<{ path: string; content: string }>("savedvariables-changed", (e) => cb(e.payload.path, e.payload.content));
    },
    async onTrayAction(cb) {
      await listen<TrayAction>("tray-action", (e) => cb(e.payload));
    },
  };
}

async function createBrowserPlatform(): Promise<Platform> {
  const { demoFiles, DEMO_PATHS } = await import("./demo");
  const STORAGE_KEY = "rested-tracker-demo-state";
  const files = demoFiles();
  let watched = [...DEMO_PATHS];
  return {
    isDesktop: false,
    os: "web",
    async loadState() {
      try {
        const text = localStorage.getItem(STORAGE_KEY);
        if (text) return JSON.parse(text);
      } catch {
        /* storage unavailable */
      }
      return {};
    },
    async saveState(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* storage unavailable */
      }
    },
    async readFiles(paths) {
      return paths.map((path) =>
        files[path] !== undefined ? { path, content: files[path], modifiedMs: Date.now() } : { path, error: "File not found" },
      );
    },
    async getWatchedFiles() {
      return [...watched];
    },
    async watchFile(path) {
      watched = [...new Set([...watched, path])];
      return [...watched];
    },
    async unwatchFile(path) {
      watched = watched.filter((p) => p !== path);
      return [...watched];
    },
    async detect() {
      return DEMO_PATHS.map((path) => ({
        path,
        flavor: path.includes("_forever_") ? "_forever_" : "_classic_era_",
        account: "DEMO",
        exists: true,
      }));
    },
    async pickSavedVariablesFile() {
      watched = [...new Set([...watched, DEMO_PATHS[0]])];
      return DEMO_PATHS[0];
    },
    async pickWowFolder() {
      return null;
    },
    async pickImage() {
      return null;
    },
    async readImageDataUrl() {
      throw new Error("Not available in the browser preview");
    },
    async setTrayTooltip(text) {
      document.title = text;
    },
    async layout(width) {
      document.documentElement.style.setProperty("--preview-width", `${width}px`);
    },
    async hideWidget() {},
    async isWidgetVisible() {
      return true;
    },
    async ready() {},
    async openUrl(url) {
      window.open(url, "_blank", "noopener");
    },
    async ensureNotificationPermission() {
      return true;
    },
    async notify(title, body) {
      console.info(`[notification] ${title}: ${body}`);
    },
    async getAutostart() {
      return false;
    },
    async setAutostart() {},
    async appVersion() {
      return "dev";
    },
    async checkForUpdate() {
      return null;
    },
    async relaunch() {
      location.reload();
    },
    async onFileChanged() {},
    async onTrayAction() {},
  };
}

export function createPlatform(): Promise<Platform> {
  return isTauri ? createTauriPlatform() : createBrowserPlatform();
}
