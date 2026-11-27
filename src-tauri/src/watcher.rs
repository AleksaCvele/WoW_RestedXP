// Watches the RestedSync.lua SavedVariables files and pushes their new contents to
// the UI whenever WoW rewrites them (logout, exit, /reload).
//
// The game replaces the file rather than editing it in place, so the *folder* is
// watched (notify crate) and changes are confirmed by comparing modification time and
// size. A slow poll runs as a fallback for network drives and folders that don't
// exist yet (e.g. before the first login on a new account).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::files::{read_saved_variables_file, AllowedFiles};

/// Wait for the game to finish writing before reading.
const DEBOUNCE: Duration = Duration::from_millis(700);
/// Fallback check interval.
const POLL_INTERVAL: Duration = Duration::from_secs(20);

enum Msg {
    SetPaths(Vec<String>),
    FsEvent,
}

#[derive(Default)]
pub struct WatcherHandle {
    tx: Mutex<Option<Sender<Msg>>>,
}

#[derive(Clone, Serialize)]
struct ChangePayload {
    path: String,
    content: String,
}

type Stamp = Option<(SystemTime, u64)>;

fn stamp(path: &Path) -> Stamp {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

pub fn start(app: AppHandle) {
    let (tx, rx) = channel::<Msg>();
    if let Ok(mut slot) = app.state::<WatcherHandle>().tx.lock() {
        *slot = Some(tx.clone());
    }
    let initial = app.state::<AllowedFiles>().saved_variables();
    let _ = tx.send(Msg::SetPaths(initial));
    std::thread::Builder::new()
        .name("savedvariables-watcher".into())
        .spawn(move || run(app, tx, rx))
        .expect("failed to start the SavedVariables watcher thread");
}

/// Re-reads the allow-list and watches exactly those files.
pub fn refresh(app: &AppHandle) {
    let paths = app.state::<AllowedFiles>().saved_variables();
    if let Ok(guard) = app.state::<WatcherHandle>().tx.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(Msg::SetPaths(paths));
        }
    }
}

fn make_watcher(tx: &Sender<Msg>, paths: &[String]) -> Option<RecommendedWatcher> {
    let names: Vec<String> = paths
        .iter()
        .filter_map(|p| Path::new(p).file_name())
        .map(|n| n.to_string_lossy().to_lowercase())
        .collect();
    let tx = tx.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let relevant = event.paths.iter().any(|p| {
            p.file_name()
                .map(|n| names.contains(&n.to_string_lossy().to_lowercase()))
                .unwrap_or(false)
        });
        if relevant {
            let _ = tx.send(Msg::FsEvent);
        }
    })
    .ok()?;

    let mut dirs: Vec<PathBuf> = paths
        .iter()
        .filter_map(|p| Path::new(p).parent().map(Path::to_path_buf))
        .filter(|d| d.is_dir())
        .collect();
    dirs.sort();
    dirs.dedup();
    let mut watching = false;
    for dir in &dirs {
        if watcher.watch(dir, RecursiveMode::NonRecursive).is_ok() {
            watching = true;
        }
    }
    watching.then_some(watcher)
}

fn check_for_changes(app: &AppHandle, paths: &[String], stamps: &mut HashMap<String, Stamp>) {
    for path in paths {
        let now = stamp(Path::new(path));
        let before = stamps.get(path).copied().flatten();
        if now == before {
            continue;
        }
        stamps.insert(path.clone(), now);
        if now.is_none() {
            continue; // deleted / not created yet
        }
        let read = read_saved_variables_file(path);
        if let Some(content) = read.content {
            let _ = app.emit(
                "savedvariables-changed",
                ChangePayload {
                    path: path.clone(),
                    content,
                },
            );
        }
    }
}

fn run(app: AppHandle, tx: Sender<Msg>, rx: Receiver<Msg>) {
    let mut paths: Vec<String> = Vec::new();
    let mut stamps: HashMap<String, Stamp> = HashMap::new();
    let mut watcher: Option<RecommendedWatcher> = None;
    let mut pending_since: Option<Instant> = None;
    let mut last_poll = Instant::now();

    loop {
        let timeout = match pending_since {
            Some(t) => DEBOUNCE.saturating_sub(t.elapsed()),
            None => POLL_INTERVAL.saturating_sub(last_poll.elapsed()),
        };
        match rx.recv_timeout(timeout) {
            Ok(Msg::SetPaths(new_paths)) => {
                // The UI reads the current contents itself; only report later changes.
                stamps = new_paths.iter().map(|p| (p.clone(), stamp(Path::new(p)))).collect();
                drop(watcher.take()); // stop the old watcher before creating a new one
                watcher = make_watcher(&tx, &new_paths);
                paths = new_paths;
                pending_since = None;
            }
            Ok(Msg::FsEvent) => {
                // Trailing debounce: wait until the game has been quiet for DEBOUNCE.
                pending_since = Some(Instant::now());
            }
            Err(RecvTimeoutError::Timeout) => {
                pending_since = None;
                last_poll = Instant::now();
                check_for_changes(&app, &paths, &mut stamps);
                if watcher.is_none() && !paths.is_empty() {
                    watcher = make_watcher(&tx, &paths);
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(watcher);
}
