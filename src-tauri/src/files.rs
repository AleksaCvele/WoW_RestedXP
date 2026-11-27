// App state persistence and guarded file reads used by the UI.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "state.json";
const MAX_STATE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SAVED_VARIABLES_BYTES: u64 = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(STATE_FILE))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

/// Writes the settings/roster JSON atomically (temp file + rename).
#[tauri::command]
pub fn save_app_state(app: AppHandle, json: String) -> Result<(), String> {
    if json.len() > MAX_STATE_BYTES {
        return Err("State is too large".into());
    }
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("Invalid state JSON: {e}"))?;
    let path = state_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| allowed.iter().any(|a| a.eq_ignore_ascii_case(ext)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub path: String,
    pub content: Option<String>,
    pub error: Option<String>,
    pub missing: bool,
    pub modified_ms: Option<u64>,
}

/// Reads one SavedVariables file. Only `.lua` files are allowed.
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
pub fn read_saved_variables(paths: Vec<String>) -> Vec<FileRead> {
    paths.iter().map(|p| read_saved_variables_file(p)).collect()
}

/// Loads a local portrait image as a data: URL (so no filesystem access is exposed to the webview).
#[tauri::command(async)]
pub fn read_image_data_url(path: String) -> Result<String, String> {
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
