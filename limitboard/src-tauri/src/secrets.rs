//! Secret storage via Windows Credential Manager (`keyring` crate).
//! Service name is fixed; the webview never sees where keys live and the
//! JSON config never contains them.

const SERVICE: &str = "limitboard";

fn entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    entry(&name)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_secret(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_secret(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Read an environment variable from the host process (webview has no env access).
#[tauri::command]
pub fn get_env_var(name: String) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}
