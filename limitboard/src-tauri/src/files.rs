//! Read-only, whitelist-scoped credential file access. The webview can only
//! request these two fixed ids — never arbitrary paths. Contents are returned
//! to the adapter for the duration of a poll and are never logged or written.

fn resolve(id: &str) -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE").ok()?;
    let rel = match id {
        "claude-credentials" => ".claude\\.credentials.json",
        "codex-auth" => ".codex\\auth.json",
        _ => return None,
    };
    Some(std::path::Path::new(&home).join(rel))
}

#[tauri::command]
pub fn read_credential_file(id: String) -> Result<Option<String>, String> {
    let Some(path) = resolve(&id) else {
        return Err(format!("unknown credential file id: {id}"));
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
