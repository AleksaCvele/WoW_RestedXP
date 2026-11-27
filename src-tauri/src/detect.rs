// Finds `WTF/Account/<ACCOUNT>/SavedVariables/RestedSync.lua` for every installed
// game client (_forever_, _classic_era_, _classic_, _retail_, ...).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

pub const SAVED_VARIABLES_FILE: &str = "RestedSync.lua";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedFile {
    pub path: String,
    pub flavor: String,
    pub account: String,
    pub exists: bool,
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn eq_name(path: &Path, name: &str) -> bool {
    name_of(path).eq_ignore_ascii_case(name)
}

fn subdirs(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

/// Lists every account folder under a client folder such as `World of Warcraft/_forever_`.
fn scan_client(client: &Path, out: &mut Vec<DetectedFile>) {
    let accounts = client.join("WTF").join("Account");
    for account in subdirs(&accounts) {
        let saved = account.join("SavedVariables");
        if !saved.is_dir() {
            continue;
        }
        let file = saved.join(SAVED_VARIABLES_FILE);
        out.push(DetectedFile {
            exists: file.is_file(),
            path: file.to_string_lossy().to_string(),
            flavor: name_of(client).to_lowercase(),
            account: name_of(&account),
        });
    }
}

/// Accepts the World of Warcraft folder, a client folder (`_forever_`), its `WTF` or
/// `WTF/Account` folder, or a single account folder.
pub fn scan_root(root: &Path, out: &mut Vec<DetectedFile>) {
    if eq_name(root, "SavedVariables") {
        if let Some(account) = root.parent() {
            return scan_root(account, out);
        }
    }
    // A single account folder: .../WTF/Account/<ACCOUNT>
    if let Some(parent) = root.parent() {
        if eq_name(parent, "Account") && root.join("SavedVariables").is_dir() {
            if let Some(client) = parent.parent().and_then(Path::parent) {
                let file = root.join("SavedVariables").join(SAVED_VARIABLES_FILE);
                out.push(DetectedFile {
                    exists: file.is_file(),
                    path: file.to_string_lossy().to_string(),
                    flavor: name_of(client).to_lowercase(),
                    account: name_of(root),
                });
            }
            return;
        }
    }
    if eq_name(root, "Account") {
        if let Some(client) = root.parent().and_then(Path::parent) {
            return scan_client(client, out);
        }
    }
    if eq_name(root, "WTF") {
        if let Some(client) = root.parent() {
            return scan_client(client, out);
        }
    }
    if root.join("WTF").join("Account").is_dir() {
        scan_client(root, out);
    }
    for child in subdirs(root) {
        if child.join("WTF").join("Account").is_dir() {
            scan_client(&child, out);
        }
    }
}

/// Folders in `base` whose name contains "world of warcraft".
fn wow_folders_in(base: &Path, out: &mut Vec<PathBuf>) {
    for dir in subdirs(base) {
        if name_of(&dir).to_lowercase().contains("world of warcraft") {
            out.push(dir);
        }
    }
}

#[cfg(windows)]
mod windows {
    use std::path::PathBuf;

    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6432KEY};

    const DRIVE_FIXED: u32 = 3;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Local hard drives only (skips empty card readers / optical drives).
    pub fn fixed_drives() -> Vec<PathBuf> {
        let mask = unsafe { GetLogicalDrives() };
        (0..26u32)
            .filter(|i| mask & (1 << i) != 0)
            .map(|i| format!("{}:\\", (b'A' + i as u8) as char))
            .filter(|root| unsafe { GetDriveTypeW(wide(root).as_ptr()) } == DRIVE_FIXED)
            .map(PathBuf::from)
            .collect()
    }

    /// Install location written by the Battle.net launcher.
    pub fn registry_install_paths() -> Vec<PathBuf> {
        let key = wide(r"SOFTWARE\Blizzard Entertainment\World of Warcraft");
        let mut out = Vec::new();
        for value in ["InstallPath", "GamePath"] {
            let name = wide(value);
            let mut buf = vec![0u16; 1024];
            let mut size = (buf.len() * 2) as u32;
            let status = unsafe {
                RegGetValueW(
                    HKEY_LOCAL_MACHINE,
                    key.as_ptr(),
                    name.as_ptr(),
                    RRF_RT_REG_SZ | RRF_SUBKEY_WOW6432KEY,
                    std::ptr::null_mut(),
                    buf.as_mut_ptr().cast(),
                    &mut size,
                )
            };
            if status != ERROR_SUCCESS {
                continue;
            }
            let len = (size as usize / 2).saturating_sub(1).min(buf.len());
            let text = String::from_utf16_lossy(&buf[..len]);
            let text = text.trim_end_matches('\0').trim();
            if text.is_empty() {
                continue;
            }
            // e.g. C:\Program Files (x86)\World of Warcraft\_retail_\  →  the WoW folder
            let mut path = PathBuf::from(text);
            if path.is_file() {
                path.pop();
            }
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with('_') && name.ends_with('_') {
                path.pop();
            }
            out.push(path);
        }
        out
    }
}

/// Likely World of Warcraft install folders on this machine.
pub fn candidate_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        roots.extend(windows::registry_install_paths());
        for drive in windows::fixed_drives() {
            for base in [
                drive.clone(),
                drive.join("Program Files (x86)"),
                drive.join("Program Files"),
                drive.join("Games"),
                drive.join("Blizzard"),
                drive.join("Battle.net"),
            ] {
                wow_folders_in(&base, &mut roots);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        roots.push(PathBuf::from("/Applications/World of Warcraft"));
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            roots.push(home.join("Applications/World of Warcraft"));
            wow_folders_in(&home.join("Games"), &mut roots);
        }
        roots.push(PathBuf::from("/Users/Shared/World of Warcraft"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Wine / Lutris / Bottles installs.
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            for prefix in [
                ".wine/drive_c",
                "Games/battlenet/drive_c",
                "Games/battle-net/drive_c",
                "Games/world-of-warcraft/drive_c",
            ] {
                let drive = home.join(prefix);
                wow_folders_in(&drive.join("Program Files (x86)"), &mut roots);
                wow_folders_in(&drive.join("Program Files"), &mut roots);
            }
        }
    }

    roots.retain(|r| r.is_dir());
    roots.sort();
    roots.dedup();
    roots
}

fn sort_and_dedup(found: &mut Vec<DetectedFile>) {
    found.sort_by(|a, b| {
        let rank = |f: &DetectedFile| (f.flavor != "_forever_", !f.exists);
        rank(a).cmp(&rank(b)).then_with(|| a.path.cmp(&b.path))
    });
    found.dedup_by(|a, b| a.path.eq_ignore_ascii_case(&b.path));
}

/// Without `root`: searches the usual install locations. With `root`: scans that folder.
#[tauri::command(async)]
pub fn detect_saved_variables(root: Option<String>) -> Vec<DetectedFile> {
    let mut found = Vec::new();
    match root {
        Some(root) => scan_root(Path::new(&root), &mut found),
        None => {
            for root in candidate_roots() {
                scan_root(&root, &mut found);
            }
        }
    }
    sort_and_dedup(&mut found);
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_install(base: &Path) {
        for (client, account, with_file) in [
            ("_forever_", "123456#1", true),
            ("_forever_", "WOW2", false),
            ("_classic_era_", "123456#1", false),
        ] {
            let sv = base.join(client).join("WTF").join("Account").join(account).join("SavedVariables");
            fs::create_dir_all(&sv).unwrap();
            if with_file {
                fs::write(sv.join(SAVED_VARIABLES_FILE), "RestedSyncDB = {}").unwrap();
            }
            // Per-character SavedVariables must be ignored.
            fs::create_dir_all(base.join(client).join("WTF/Account").join(account).join("Realm/Char/SavedVariables")).unwrap();
        }
        fs::create_dir_all(base.join("_retail_").join("Interface")).unwrap();
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rested-detect-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_accounts_from_the_wow_folder() {
        let wow = temp_dir("root").join("World of Warcraft");
        make_install(&wow);
        let mut found = Vec::new();
        scan_root(&wow, &mut found);
        sort_and_dedup(&mut found);
        assert_eq!(found.len(), 3);
        assert_eq!(found[0].flavor, "_forever_");
        assert!(found[0].exists);
        assert_eq!(found[0].account, "123456#1");
        assert!(found[0].path.ends_with(SAVED_VARIABLES_FILE));
        assert!(found.iter().any(|f| f.flavor == "_classic_era_" && !f.exists));
    }

    #[test]
    fn accepts_client_wtf_account_and_saved_variables_folders() {
        let wow = temp_dir("nested").join("World of Warcraft");
        make_install(&wow);
        for start in [
            wow.join("_forever_"),
            wow.join("_forever_/WTF"),
            wow.join("_forever_/WTF/Account"),
        ] {
            let mut found = Vec::new();
            scan_root(&start, &mut found);
            assert_eq!(found.len(), 2, "starting at {}", start.display());
            assert!(found.iter().all(|f| f.flavor == "_forever_"));
        }
        let mut single = Vec::new();
        scan_root(&wow.join("_forever_/WTF/Account/123456#1/SavedVariables"), &mut single);
        assert_eq!(single.len(), 1);
        assert!(single[0].exists);
        assert_eq!(single[0].flavor, "_forever_");
    }

    #[test]
    fn finds_wow_folders_by_name() {
        let base = temp_dir("names");
        fs::create_dir_all(base.join("World of Warcraft")).unwrap();
        fs::create_dir_all(base.join("Other Game")).unwrap();
        let mut roots = Vec::new();
        wow_folders_in(&base, &mut roots);
        assert_eq!(roots, vec![base.join("World of Warcraft")]);
    }
}
