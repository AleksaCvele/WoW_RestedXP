// Thin bridge to the Tauri backend. When the UI is opened in a normal browser
// (`npm run dev`), a demo implementation with sample characters is used instead.

import type { AppState, DetectedFile, FileReadResult, TrayAction } from "./types";

export interface Platform {
  readonly isDesktop: boolean;
  loadState(): Promise<unknown | null>;
  saveState(state: AppState): Promise<void>;
  readFiles(paths: string[]): Promise<FileReadResult[]>;
  setWatchedPaths(paths: string[]): Promise<void>;
  detect(root?: string): Promise<DetectedFile[]>;
  pickSavedVariablesFile(): Promise<string | null>;
  pickWowFolder(): Promise<string | null>;
  pickImage(): Promise<string | null>;
  readImageDataUrl(path: string): Promise<string>;
  setTrayTooltip(text: string): Promise<void>;
  /** Resize the widget and anchor it to the bottom-right corner of the primary monitor. */
  layout(width: number, height: number, pinned: boolean): Promise<void>;
  hideWidget(): Promise<void>;
  /** Called once after the first render; shows the window unless launched with --minimized. */
  ready(): Promise<void>;
  openUrl(url: string): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  ensureNotificationPermission(): Promise<boolean>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
  appVersion(): Promise<string>;
  onFileChanged(cb: (path: string, content: string) => void): Promise<void>;
  onTrayAction(cb: (action: TrayAction) => void): Promise<void>;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function createTauriPlatform(): Promise<Platform> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getVersion } = await import("@tauri-apps/api/app");
  const dialog = await import("@tauri-apps/plugin-dialog");
  const opener = await import("@tauri-apps/plugin-opener");
  const notification = await import("@tauri-apps/plugin-notification");
  const autostart = await import("@tauri-apps/plugin-autostart");

  // Native dialogs steal focus; keep the unpinned widget from hiding behind them.
  async function withDialog<T>(fn: () => Promise<T>): Promise<T> {
    await invoke("set_blur_hide_suppressed", { suppressed: true });
    try {
      return await fn();
    } finally {
      await invoke("set_blur_hide_suppressed", { suppressed: false });
    }
  }

  const single = (v: string | string[] | null): string | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  return {
    isDesktop: true,
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
    readFiles: (paths) => invoke<FileReadResult[]>("read_saved_variables", { paths }),
    setWatchedPaths: (paths) => invoke("set_watched_paths", { paths }),
    detect: (root) => invoke<DetectedFile[]>("detect_saved_variables", { root: root ?? null }),
    pickSavedVariablesFile: () =>
      withDialog(async () =>
        single(
          await dialog.open({
            title: "Select RestedSync.lua",
            multiple: false,
            directory: false,
            filters: [{ name: "RestedSync SavedVariables", extensions: ["lua"] }],
          }),
        ),
      ),
    pickWowFolder: () =>
      withDialog(async () =>
        single(await dialog.open({ title: "Select your World of Warcraft folder", directory: true, multiple: false })),
      ),
    pickImage: () =>
      withDialog(async () =>
        single(
          await dialog.open({
            title: "Choose a portrait image",
            multiple: false,
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
          }),
        ),
      ),
    readImageDataUrl: (path) => invoke<string>("read_image_data_url", { path }),
    setTrayTooltip: (text) => invoke("set_tray_tooltip", { text }),
    layout: (width, height, pinned) => invoke("apply_window_layout", { width, height, pinned }),
    hideWidget: () => invoke("hide_widget"),
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
  return {
    isDesktop: false,
    async loadState() {
      try {
        const text = localStorage.getItem(STORAGE_KEY);
        if (text) return JSON.parse(text);
      } catch {
        /* storage unavailable */
      }
      return { settings: { savedVariablesPaths: [...DEMO_PATHS] } };
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
    async setWatchedPaths() {},
    async detect() {
      return DEMO_PATHS.map((path) => ({
        path,
        flavor: path.includes("_forever_") ? "_forever_" : "_classic_era_",
        account: "DEMO",
        exists: true,
      }));
    },
    async pickSavedVariablesFile() {
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
    async onFileChanged() {},
    async onTrayAction() {},
  };
}

export function createPlatform(): Promise<Platform> {
  return isTauri ? createTauriPlatform() : createBrowserPlatform();
}
