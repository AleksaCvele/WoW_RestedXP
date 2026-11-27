// App state persistence, the allow-list of files the widget may read, and the
// native file pickers that are the only way to add files to that list.
//
// Security model: the web UI can only read files that the *backend* has approved:
//   * SavedVariables files the user picked in a native dialog or that auto-detection
//     found (always `.../WTF/Account/<ACCOUNT>/SavedVariables/*.lua`), and
//   * portrait images the user picked in a native dialog.
// The list lives in its own file that the UI cannot write, so even a compromised UI
// could not use the widget to read arbitrary files.

use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::detect::{self, DetectedFile};
use crate::{watcher, widget};

const STATE_FILE: &str = "state.json";
const ALLOWED_FILE: &str = "allowed-files.json";
const MAX_STATE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SAVED_VARIABLES_BYTES: u64 = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Writes a file atomically (temp file + rename) so a crash never leaves it half-written.
fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| allowed.iter().any(|a| a.eq_ignore_ascii_case(ext)))
}

// ---------------------------------------------------------------------------
// Allow-list

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AllowedData {
    saved_variables: BTreeSet<String>,
    images: BTreeSet<String>,
}

#[derive(Default)]
pub struct AllowedFiles {
    data: Mutex<AllowedData>,
    /// Paths returned by auto-detection in this session (eligible to be watched).
    detected: Mutex<HashSet<String>>,
    file: Mutex<Option<PathBuf>>,
}

impl AllowedFiles {
    pub fn load(app: &AppHandle) -> Self {
        let dir = config_dir(app).ok();
        let file = dir.as_ref().map(|d| d.join(ALLOWED_FILE));
        let mut data: AllowedData = file
            .as_ref()
            .and_then(|f| fs::read_to_string(f).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();

        // One-time migration from v1.0.0, which kept the watched files in state.json.
        if file.as_ref().is_some_and(|f| !f.exists()) {
            if let Some(state) = dir
                .as_ref()
                .and_then(|d| fs::read_to_string(d.join(STATE_FILE)).ok())
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            {
                if let Some(paths) = state.pointer("/settings/savedVariablesPaths").and_then(|v| v.as_array()) {
                    for p in paths.iter().filter_map(|v| v.as_str()) {
                        if has_extension(Path::new(p), &["lua"]) {
                            data.saved_variables.insert(p.to_string());
                        }
                    }
                }
            }
        }

        let allowed = Self {
            data: Mutex::new(data),
            detected: Mutex::new(HashSet::new()),
            file: Mutex::new(file),
        };
        allowed.persist();
        allowed
    }

    fn persist(&self) {
        let (Ok(data), Ok(file)) = (self.data.lock(), self.file.lock()) else { return };
        if let (Some(file), Ok(json)) = (file.as_ref(), serde_json::to_vec_pretty(&*data)) {
            let _ = write_atomic(file, &json);
        }
    }

    pub fn saved_variables(&self) -> Vec<String> {
        self.data.lock().map(|d| d.saved_variables.iter().cloned().collect()).unwrap_or_default()
    }

    fn is_saved_variables_allowed(&self, path: &str) -> bool {
        self.data.lock().is_ok_and(|d| d.saved_variables.contains(path))
    }

    fn add_saved_variables(&self, path: String) {
        if let Ok(mut d) = self.data.lock() {
            d.saved_variables.insert(path);
        }
        self.persist();
    }

    fn remove_saved_variables(&self, path: &str) {
        if let Ok(mut d) = self.data.lock() {
            d.saved_variables.remove(path);
        }
        self.persist();
    }

    fn mark_detected(&self, found: &[DetectedFile]) {
        if let Ok(mut set) = self.detected.lock() {
            set.extend(found.iter().map(|f| f.path.clone()));
        }
    }

    fn is_detected(&self, path: &str) -> bool {
        self.detected.lock().is_ok_and(|s| s.contains(path))
    }

    fn add_image(&self, path: String) {
        if let Ok(mut d) = self.data.lock() {
            d.images.insert(path);
        }
        self.persist();
    }

    fn is_image_allowed(&self, path: &str) -> bool {
        self.data.lock().is_ok_and(|d| d.images.contains(path))
    }
}

// ---------------------------------------------------------------------------
// App state (settings + roster), owned by the UI

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = config_dir(&app)?.join(STATE_FILE);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, json: String) -> Result<(), String> {
    if json.len() > MAX_STATE_BYTES {
        return Err("State is too large".into());
    }
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("Invalid state JSON: {e}"))?;
    write_atomic(&config_dir(&app)?.join(STATE_FILE), json.as_bytes())
}

// ---------------------------------------------------------------------------
// SavedVariables files

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub path: String,
    pub content: Option<String>,
    pub error: Option<String>,
    pub missing: bool,
    pub modified_ms: Option<u64>,
}

/// Reads one SavedVariables file. Callers must have checked the allow-list.
pub fn read_saved_variables_file(path: &str) -> FileRead {
    let p = Path::new(path);
    let mut out = FileRead {
        path: path.to_string(),
        content: None,
        error: None,
        missing: false,
        modified_ms: None,
    };
    if !has_extension(p, &["lua"]) {
        out.error = Some("Only .lua SavedVariables files can be read".into());
        return out;
    }
    let meta = match fs::metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => {
            out.missing = true;
            return out;
        }
        Err(e) => {
            out.error = Some(e.to_string());
            return out;
        }
    };
    if meta.len() > MAX_SAVED_VARIABLES_BYTES {
        out.error = Some("File is too large".into());
        return out;
    }
    out.modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    match fs::read(p) {
        // WoW writes UTF-8; be lenient with anything else.
        Ok(bytes) => out.content = Some(String::from_utf8_lossy(&bytes).into_owned()),
        Err(e) => out.error = Some(e.to_string()),
    }
    out
}

#[tauri::command(async)]
pub fn read_saved_variables(allowed: State<'_, AllowedFiles>, paths: Vec<String>) -> Vec<FileRead> {
    paths
        .iter()
        .map(|p| {
            if allowed.is_saved_variables_allowed(p) {
                read_saved_variables_file(p)
            } else {
                FileRead {
                    path: p.clone(),
                    content: None,
                    error: Some("This file was not selected in the widget".into()),
                    missing: false,
                    modified_ms: None,
                }
            }
        })
        .collect()
}

#[tauri::command]
pub fn get_watched_files(allowed: State<'_, AllowedFiles>) -> Vec<String> {
    allowed.saved_variables()
}

/// Starts watching a file found by auto-detection (or one that is already approved).
#[tauri::command]
pub fn watch_saved_variables(app: AppHandle, allowed: State<'_, AllowedFiles>, path: String) -> Result<Vec<String>, String> {
    if !allowed.is_detected(&path) && !allowed.is_saved_variables_allowed(&path) {
        return Err("Only files found by auto-detection or picked with \"Select file\" can be watched".into());
    }
    allowed.add_saved_variables(path);
    watcher::refresh(&app);
    Ok(allowed.saved_variables())
}

#[tauri::command]
pub fn unwatch_saved_variables(app: AppHandle, allowed: State<'_, AllowedFiles>, path: String) -> Vec<String> {
    allowed.remove_saved_variables(&path);
    watcher::refresh(&app);
    allowed.saved_variables()
}

/// Auto-detection over the usual install locations.
#[tauri::command(async)]
pub fn detect_saved_variables(allowed: State<'_, AllowedFiles>) -> Vec<DetectedFile> {
    let found = detect::detect(None);
    allowed.mark_detected(&found);
    found
}

/// Native file picker for RestedSync.lua; the chosen file is watched right away.
#[tauri::command(async)]
pub fn pick_saved_variables_file(app: AppHandle, allowed: State<'_, AllowedFiles>) -> Option<String> {
    let picked = widget::with_blur_hide_suppressed(&app, || {
        app.dialog()
            .file()
            .set_title("Select RestedSync.lua (WTF\\Account\\<ACCOUNT>\\SavedVariables)")
            .add_filter("RestedSync SavedVariables", &["lua"])
            .blocking_pick_file()
    })?;
    let path = picked.into_path().ok()?;
    if !has_extension(&path, &["lua"]) {
        return None;
    }
    let path = path.to_string_lossy().to_string();
    allowed.add_saved_variables(path.clone());
    watcher::refresh(&app);
    Some(path)
}

/// Native folder picker; scans the chosen World of Warcraft (or client/WTF) folder.
#[tauri::command(async)]
pub fn pick_wow_folder(app: AppHandle, allowed: State<'_, AllowedFiles>) -> Option<Vec<DetectedFile>> {
    let picked = widget::with_blur_hide_suppressed(&app, || {
        app.dialog()
            .file()
            .set_title("Select your World of Warcraft folder")
            .blocking_pick_folder()
    })?;
    let root = picked.into_path().ok()?;
    let found = detect::detect(Some(&root));
    allowed.mark_detected(&found);
    Some(found)
}

// ---------------------------------------------------------------------------
// Portrait images

#[tauri::command(async)]
pub fn pick_portrait_image(app: AppHandle, allowed: State<'_, AllowedFiles>) -> Option<String> {
    let picked = widget::with_blur_hide_suppressed(&app, || {
        app.dialog()
            .file()
            .set_title("Choose a portrait image")
            .add_filter("Images", &IMAGE_EXTENSIONS)
            .blocking_pick_file()
    })?;
    let path = picked.into_path().ok()?;
    if !has_extension(&path, &IMAGE_EXTENSIONS) {
        return None;
    }
    let path = path.to_string_lossy().to_string();
    allowed.add_image(path.clone());
    Some(path)
}

/// Loads a picked portrait as a data: URL (no direct filesystem access for the UI).
#[tauri::command(async)]
pub fn read_image_data_url(allowed: State<'_, AllowedFiles>, path: String) -> Result<String, String> {
    if !allowed.is_image_allowed(&path) {
        return Err("Choose the image with the Browse button first".into());
    }
    let p = Path::new(&path);
    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => return Err("Unsupported image type (use png, jpg, webp or gif)".into()),
    };
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err("Image is larger than 5 MB".into());
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
