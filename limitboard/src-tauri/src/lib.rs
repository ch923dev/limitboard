mod accounts;
mod claude_desktop;
mod files;
mod probes;
mod secrets;
mod tray;
mod usage;
mod widgets;
mod winenv;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let menu = tray::build_menu(app.handle())?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Limitboard")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "rescan" => {
                        let _ = app.emit("rescan", ());
                    }
                    "quit" => app.exit(0),
                    id => {
                        if let Some(acct) = id.strip_prefix("acct:") {
                            accounts::tray_select(app, acct);
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Main window close hides to tray (quit only via tray menu);
        // widget windows close for real.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            probes::probe_paths,
            secrets::set_secret,
            secrets::get_secret,
            secrets::delete_secret,
            secrets::get_env_var,
            files::read_credential_file,
            usage::fetch_claude_usage,
            accounts::claude_accounts,
            accounts::claude_account_switch,
            accounts::claude_account_add,
            accounts::claude_account_rename,
            accounts::claude_account_remove,
            accounts::claude_account_sign_in,
            accounts::claude_account_terminal,
            accounts::claude_account_open_folder,
            accounts::claude_account_dismiss_notice,
            tray::set_tray_status,
            widgets::open_widget,
            widgets::show_drag_ghost,
            widgets::move_drag_ghost,
            widgets::hide_drag_ghost
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
