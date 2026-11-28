// System tray icon: left-click toggles the widget, right-click opens the menu.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

use crate::widget;

const TRAY_ID: &str = "rested-tray";
/// Windows limits tray tooltips to 127 characters.
const MAX_TOOLTIP_CHARS: usize = 127;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / Hide Widget", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Force Sync Now", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let patreon = MenuItem::with_id(app, "patreon", "Support on Patreon", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle, &sync, &settings, &sep1, &patreon, &sep2, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/tray.png"))
        .tooltip("WoW Rested Tracker")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => widget::toggle_from_menu(app),
            "sync" => {
                let _ = app.emit("tray-action", "sync");
            }
            "settings" => {
                widget::show(app);
                let _ = app.emit("tray-action", "settings");
            }
            // The Patreon URL lives in the frontend config (src/config.ts).
            "patreon" => {
                let _ = app.emit("tray-action", "patreon");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                widget::toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// e.g. "WoW Rested Tracker — 3/9 Fully Rested"
#[tauri::command]
pub fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
    let text: String = text.chars().take(MAX_TOOLTIP_CHARS).collect();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(text)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
