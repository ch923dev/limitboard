//! Tray status: worst-gauge color dot + tooltip (spec FR-5), and the tray
//! menu, which lists Claude accounts for one-click switching once there is
//! more than one.

use crate::accounts::{self, Kind};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Wry};

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let (code, desktop, switching) = {
        let r = accounts::reg();
        let list = |k: Kind| -> Vec<(String, String, bool)> {
            r.accounts
                .iter()
                .filter(|a| a.kind == k)
                .map(|a| (a.id.clone(), a.name.clone(), r.is_active(a)))
                .collect()
        };
        (list(Kind::Code), list(Kind::Desktop), r.switching)
    };
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> =
        vec![Box::new(MenuItem::with_id(app, "show", "Show board", true, None::<&str>)?)];
    let sections = [
        ("Claude Code account", code, true),
        ("Claude Desktop account (restarts it)", desktop, !switching),
    ];
    for (title, list, enabled) in sections {
        if list.len() < 2 {
            continue;
        }
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(MenuItem::with_id(app, format!("hdr:{title}"), title, false, None::<&str>)?));
        for (id, name, active) in list {
            items.push(Box::new(CheckMenuItem::with_id(app, format!("acct:{id}"), name, enabled, active, None::<&str>)?));
        }
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(app, "rescan", "Rescan", true, None::<&str>)?));
    items.push(Box::new(MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?));
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// Rebuilds the tray menu after accounts change (also resets check marks
/// the OS toggled on click).
pub fn rebuild_menu(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

// Theme status colors (theme.ts): ok / warn / crit.
fn color_rgba(level: &str) -> [u8; 4] {
    match level {
        "crit" => [0xE0, 0x5B, 0x52, 0xFF],
        "warn" => [0xE2, 0xA9, 0x3B, 0xFF],
        _ => [0x53, 0xB8, 0x7E, 0xFF],
    }
}

/// 32×32 filled circle on transparent background.
fn dot_icon(level: &str) -> Image<'static> {
    const SIZE: i32 = 32;
    let [r, g, b, a] = color_rgba(level);
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let c = (SIZE - 1) as f32 / 2.0;
    let radius = SIZE as f32 * 0.42;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - c;
            let dy = y as f32 - c;
            if (dx * dx + dy * dy).sqrt() <= radius {
                let i = ((y * SIZE + x) * 4) as usize;
                rgba[i] = r;
                rgba[i + 1] = g;
                rgba[i + 2] = b;
                rgba[i + 3] = a;
            }
        }
    }
    Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

#[tauri::command]
pub fn set_tray_status(app: AppHandle, level: String, tooltip: String) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("tray not found")?;
    tray.set_icon(Some(dot_icon(&level))).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    Ok(())
}
