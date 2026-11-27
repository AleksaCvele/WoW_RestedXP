// The floating widget window: anchored to the bottom-right corner of the primary
// monitor (12px above the taskbar / Dock), optionally always-on-top ("pinned"),
// otherwise hidden as soon as it loses focus, like a tray flyout.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewWindow, Window};

const MAIN_WINDOW: &str = "main";
/// Gap between the widget and the screen edges / taskbar, in logical pixels.
const MARGIN: f64 = 12.0;
/// A tray click right after a blur-hide is treated as "hide", not "show again".
const BLUR_TOGGLE_GRACE: Duration = Duration::from_millis(400);

pub struct WidgetState {
    pinned: AtomicBool,
    blur_hide_suppressed: AtomicBool,
    launched_minimized: bool,
    shown_once: AtomicBool,
    last_blur_hide: Mutex<Option<Instant>>,
    /// Last size set by the UI. Hidden windows may report 0x0 on some platforms.
    last_size: Mutex<Option<PhysicalSize<u32>>>,
}

impl WidgetState {
    pub fn new(launched_minimized: bool) -> Self {
        Self {
            pinned: AtomicBool::new(false),
            blur_hide_suppressed: AtomicBool::new(false),
            launched_minimized,
            shown_once: AtomicBool::new(false),
            last_blur_hide: Mutex::new(None),
            last_size: Mutex::new(None),
        }
    }
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW)
}

/// Work area (screen minus taskbar/Dock) and scale factor of the primary monitor.
fn primary_work_area<R: Runtime>(window: &WebviewWindow<R>) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>, f64)> {
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some((area.position, area.size, monitor.scale_factor()))
}

/// Places a window of `size` (physical pixels) in the bottom-right corner of the work area.
fn anchor<R: Runtime>(window: &WebviewWindow<R>, size: PhysicalSize<u32>) -> tauri::Result<()> {
    let Some((pos, area, scale)) = primary_work_area(window) else {
        return Ok(());
    };
    let margin = (MARGIN * scale).round() as i32;
    let x = pos.x + area.width as i32 - size.width as i32 - margin;
    let y = pos.y + area.height as i32 - size.height as i32 - margin;
    window.set_position(PhysicalPosition::new(x.max(pos.x), y.max(pos.y)))
}

fn anchor_current<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let remembered = window.state::<WidgetState>().last_size.lock().ok().and_then(|s| *s);
    let size = match remembered {
        Some(size) => size,
        None => {
            let outer = window.outer_size()?;
            if outer.width > 0 && outer.height > 0 {
                outer
            } else {
                window.inner_size()?
            }
        }
    };
    anchor(window, size)
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        let _ = anchor_current(&window);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        let _ = window.hide();
    }
}

/// Tray left-click: show if hidden, hide if visible.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main_window(app) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    // Clicking the tray icon first takes focus away from the widget, which hides it;
    // don't immediately bring it back in that case.
    let state = app.state::<WidgetState>();
    let just_hidden = state
        .last_blur_hide
        .lock()
        .ok()
        .and_then(|t| *t)
        .is_some_and(|t| t.elapsed() < BLUR_TOGGLE_GRACE);
    if !just_hidden {
        show(app);
    }
}

/// Tray menu "Show / Hide Widget" (no blur race involved).
pub fn toggle_from_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main_window(app) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show(app);
    }
}

/// Unpinned widgets behave like a tray flyout and hide when you click elsewhere.
pub fn on_blur<R: Runtime>(window: &Window<R>) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    let state = window.state::<WidgetState>();
    if state.pinned.load(Ordering::Relaxed) || state.blur_hide_suppressed.load(Ordering::Relaxed) {
        return;
    }
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        if let Ok(mut last) = state.last_blur_hide.lock() {
            *last = Some(Instant::now());
        }
    }
}

/// Resizes the widget (logical px), applies always-on-top and re-anchors it.
#[tauri::command]
pub fn apply_window_layout(
    window: WebviewWindow,
    state: State<'_, WidgetState>,
    width: f64,
    height: f64,
    pinned: bool,
) -> Result<(), String> {
    state.pinned.store(pinned, Ordering::Relaxed);
    window.set_always_on_top(pinned).map_err(|e| e.to_string())?;

    let (scale, max_height) = match primary_work_area(&window) {
        Some((_, area, scale)) => (scale, (area.height as f64 / scale - 2.0 * MARGIN).max(200.0)),
        None => (window.scale_factor().unwrap_or(1.0), 900.0),
    };
    let w = width.clamp(200.0, 800.0);
    let h = height.clamp(120.0, max_height);
    let size = PhysicalSize::new((w * scale).round() as u32, (h * scale).round() as u32);
    // GTK ignores resize requests for non-resizable windows once they are shown, so on
    // Linux the size is pinned with min/max constraints instead.
    #[cfg(target_os = "linux")]
    {
        let logical = tauri::LogicalSize::new(w, h);
        let _ = window.set_resizable(true);
        let _ = window.set_min_size(Some(logical));
        let _ = window.set_max_size(Some(logical));
    }
    window.set_size(size).map_err(|e| e.to_string())?;
    if let Ok(mut last) = state.last_size.lock() {
        *last = Some(size);
    }
    anchor(&window, size).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_widget(app: AppHandle) {
    hide(&app);
}

/// Called by the UI after its first render. Shows the widget unless the app was
/// started by the OS autostart entry (then it stays in the tray).
#[tauri::command]
pub fn widget_ready(app: AppHandle, state: State<'_, WidgetState>) {
    if state.shown_once.swap(true, Ordering::Relaxed) {
        return;
    }
    if !state.launched_minimized {
        show(&app);
    }
}

/// Native file dialogs take focus; don't let that hide the widget while one is open.
pub fn with_blur_hide_suppressed<R: Runtime, T>(app: &AppHandle<R>, f: impl FnOnce() -> T) -> T {
    let state = app.state::<WidgetState>();
    state.blur_hide_suppressed.store(true, Ordering::Relaxed);
    let result = f();
    state.blur_hide_suppressed.store(false, Ordering::Relaxed);
    result
}
