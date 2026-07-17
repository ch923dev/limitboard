//! Floating provider widgets: a provider card dragged out of the board opens
//! as its own small always-on-top window (pin toggleable from the widget UI).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const ALLOWED: [&str; 6] = [
    "claude-code",
    "codex",
    "cursor",
    "copilot",
    "gemini",
    "openrouter",
];

// async: sync commands run on the main thread, and building a webview window
// there blocks the event loop mid-creation (window appears, webview never
// initializes — stuck at about:blank). Async commands run on a worker thread.
#[tauri::command]
pub async fn open_widget(
    app: AppHandle,
    provider_id: String,
    x: f64,
    y: f64,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    if !ALLOWED.contains(&provider_id.as_str()) {
        return Err(format!("unknown provider: {provider_id}"));
    }

    let label = format!("widget-{provider_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }

    // Provider id travels in the window label (not a query string).
    // URL comes from the main window's origin: runtime-built windows don't
    // resolve WebviewUrl::App against the dev server — the webview would sit
    // at about:blank. Main's origin works in dev (http://localhost:1420)
    // and prod (tauri://localhost) alike.
    let page_url = app
        .get_webview_window("main")
        .and_then(|main| main.url().ok())
        .map(|mut u| {
            u.set_path("/");
            u.set_query(None);
            u.set_fragment(None);
            u
        });
    let builder_url = page_url
        .clone()
        .map(WebviewUrl::External)
        .unwrap_or_else(|| WebviewUrl::App("index.html".into()));

    let widget = WebviewWindowBuilder::new(&app, &label, builder_url)
    .title(format!("Limitboard · {provider_id}"))
    // Caller passes the provider's remembered size; clamp to the same minimum
    // as min_inner_size so a corrupt saved value can't spawn a sliver.
    .inner_size(
        width.unwrap_or(400.0).max(320.0),
        height.unwrap_or(340.0).max(200.0),
    )
    .min_inner_size(320.0, 200.0)
    .position(x.max(0.0), y.max(0.0))
    .decorations(false)
    .resizable(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Runtime-built windows start parked at about:blank — the builder's
    // initial URL is not reliably applied. Navigate explicitly.
    if let Some(u) = page_url {
        widget.navigate(u).map_err(|e| e.to_string())?;
    }

    Ok(())
}

const GHOST_LABEL: &str = "drag-ghost";

/// Cursor anchor inside the ghost: horizontally centered, 40px below the top
/// edge (matches where the widget lands on drop).
fn ghost_origin(x: f64, y: f64, width: f64) -> (f64, f64) {
    (x - width / 2.0, y - 40.0)
}

/// Footprint preview that follows the cursor during drag-to-widget. A DOM
/// ghost can't leave the webview, so this is a real window: transparent,
/// click-through, always-on-top, never focused. Hidden (not destroyed) on
/// drag end and reused by the next drag.
#[tauri::command]
pub async fn show_drag_ghost(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let w = width.max(120.0);
    let h = height.max(80.0);
    let (gx, gy) = ghost_origin(x, y, w);

    if let Some(ghost) = app.get_webview_window(GHOST_LABEL) {
        ghost
            .set_size(tauri::LogicalSize::new(w, h))
            .map_err(|e| e.to_string())?;
        ghost
            .set_position(tauri::LogicalPosition::new(gx, gy))
            .map_err(|e| e.to_string())?;
        ghost.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let page_url = app
        .get_webview_window("main")
        .and_then(|main| main.url().ok())
        .map(|mut u| {
            u.set_path("/");
            u.set_query(None);
            u.set_fragment(None);
            u
        });
    let builder_url = page_url
        .clone()
        .map(WebviewUrl::External)
        .unwrap_or_else(|| WebviewUrl::App("index.html".into()));

    let ghost = WebviewWindowBuilder::new(&app, GHOST_LABEL, builder_url)
        .title("Limitboard · drag preview")
        .inner_size(w, h)
        .position(gx, gy)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    // Click-through: pointer events must keep streaming to the main window's
    // captured card, and the drop must not land on the ghost itself.
    ghost
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    if let Some(u) = page_url {
        ghost.navigate(u).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn move_drag_ghost(app: AppHandle, x: f64, y: f64, width: f64) -> Result<(), String> {
    if let Some(ghost) = app.get_webview_window(GHOST_LABEL) {
        let (gx, gy) = ghost_origin(x, y, width.max(120.0));
        ghost
            .set_position(tauri::LogicalPosition::new(gx, gy))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_drag_ghost(app: AppHandle) -> Result<(), String> {
    if let Some(ghost) = app.get_webview_window(GHOST_LABEL) {
        ghost.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
