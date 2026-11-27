// WoW Rested Tracker: system-tray widget backend.
//
// * tray.rs    – tray icon, tooltip and right-click menu
// * widget.rs  – bottom-right floating window: sizing, pin/always-on-top, hide on blur
// * watcher.rs – watches RestedSync.lua SavedVariables and pushes changes to the UI
// * detect.rs  – finds World of Warcraft SavedVariables folders
// * files.rs   – app state persistence and safe file reads

// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod detect;
mod files;
mod tray;
mod watcher;
mod widget;

use tauri::{RunEvent, WindowEvent};

/// Passed by the OS autostart entry so the app boots silently into the tray.
pub const MINIMIZED_ARG: &str = "--minimized";

fn main() {
    let launched_minimized = std::env::args().any(|a| a == MINIMIZED_ARG);

    tauri::Builder::default()
        // Must be registered first: a second launch just shows the existing widget.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            widget::show(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([MINIMIZED_ARG])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(widget::WidgetState::new(launched_minimized))
        .manage(watcher::WatcherHandle::default())
        .setup(|app| {
            // Tray-only app on macOS: no Dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::create(app.handle())?;
            watcher::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the widget only hides it; the tray icon keeps the app alive.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) => widget::on_blur(window),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            files::load_app_state,
            files::save_app_state,
            files::read_saved_variables,
            files::read_image_data_url,
            detect::detect_saved_variables,
            watcher::set_watched_paths,
            widget::apply_window_layout,
            widget::hide_widget,
            widget::widget_ready,
            widget::set_blur_hide_suppressed,
            tray::set_tray_tooltip,
        ])
        .build(tauri::generate_context!())
        .expect("error while building WoW Rested Tracker")
        .run(|_app, event| {
            // Keep running in the tray when the last window is hidden; only "Quit" exits.
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
