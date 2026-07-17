//! Tray status: worst-gauge color dot + tooltip (spec FR-5).

use tauri::image::Image;
use tauri::AppHandle;

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
