//! Read-only, whitelist-scoped credential file access. The webview can only
//! request these two fixed ids — never arbitrary paths. Contents are returned
//! to the adapter for the duration of a poll and are never logged or written.
//! "claude-credentials" is the active Claude Code account's login (see
//! accounts.rs), so the Claude card follows account switches.

fn resolve(id: &str) -> Option<std::path::PathBuf> {
    match id {
        "claude-credentials" => crate::accounts::credentials_path(None).ok(),
        "codex-auth" => Some(crate::accounts::home().join(".codex").join("auth.json")),
        _ => None,
    }
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
