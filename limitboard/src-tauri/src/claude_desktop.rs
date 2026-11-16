//! Claude Desktop: where its data lives, swapping its saved login between
//! account slots, closing/reopening it, and reading its own usage history.
//!
//! The sign-in lives in its cookie database (Network\Cookies, or Cookies on
//! older builds) plus the `oauth:*` and `lastKnownAccountUuid` keys of
//! config.json. A swap saves those into the current account's slot and puts
//! the chosen account's back. The rest of config.json (theme, window size,
//! extensions) is left alone, and so is "Local State", which holds the key
//! that unlocks the cookie file for this Windows user.

use crate::accounts::{appdata, local_appdata, testing};
use crate::winenv::{live, powershell};
use serde_json::{Map, Value};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

pub const LOGIN_FILES: [&str; 4] = ["Cookies", "Cookies-journal", "Network/Cookies", "Network/Cookies-journal"];
const COOKIE_FILES: [&str; 2] = ["Cookies", "Network/Cookies"];
const AUTH_FILE: &str = "auth.json";

fn join(base: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(base.to_path_buf(), |p, part| p.join(part))
}

fn read_json(p: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn write_json(p: &Path, v: &Value) -> io::Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(io::Error::other)?)?;
    std::fs::rename(tmp, p)
}

fn copy_file(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(d) = to.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::copy(from, to).map(|_| ())
}

fn remove_file(p: &Path) -> io::Result<()> {
    match std::fs::remove_file(p) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

fn mtime_ms(p: &Path) -> u128 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Claude Desktop's data folder: %APPDATA%\Claude for the direct installer and
/// current Store builds, or an older MSIX build's redirected folder. When both
/// exist, the one whose login changed most recently is in use.
pub fn data_dir() -> PathBuf {
    let mut candidates = vec![appdata().join("Claude")];
    let pkgs = local_appdata().join("Packages");
    if let Ok(rd) = std::fs::read_dir(&pkgs) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.starts_with("claude_") || name.starts_with("anthropic.claude_") {
                candidates.push(e.path().join("LocalCache").join("Roaming").join("Claude"));
            }
        }
    }
    let score = |p: &Path| mtime_ms(&p.join("config.json")).max(mtime_ms(&join(p, "Network/Cookies")));
    candidates
        .into_iter()
        .filter(|p| p.is_dir())
        .max_by_key(|p| score(p))
        .unwrap_or_else(|| appdata().join("Claude"))
}

fn is_auth_key(k: &str) -> bool {
    k.starts_with("oauth:") || k == "lastKnownAccountUuid"
}

pub fn slot_has_login(slot: &Path) -> bool {
    COOKIE_FILES.iter().any(|f| join(slot, f).exists()) || slot.join(AUTH_FILE).exists()
}

pub fn live_has_login(data: &Path) -> bool {
    COOKIE_FILES.iter().any(|f| join(data, f).exists()) && live_uuid(data).is_some()
}

pub fn slot_uuid(slot: &Path) -> Option<String> {
    read_json(&slot.join(AUTH_FILE))?.get("lastKnownAccountUuid")?.as_str().map(String::from)
}

pub fn live_uuid(data: &Path) -> Option<String> {
    read_json(&data.join("config.json"))?.get("lastKnownAccountUuid")?.as_str().map(String::from)
}

fn auth_keys(cfg: &Value) -> Map<String, Value> {
    cfg.as_object()
        .map(|o| o.iter().filter(|(k, _)| is_auth_key(k)).map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

/// Saves the live login into `current` (when given) and puts `target`'s in
/// place. A target slot without a saved login signs Claude Desktop out, so you
/// can sign in fresh. Claude Desktop must be closed while this runs.
pub fn swap(current: Option<&Path>, target: &Path, data: &Path, root: &Path) -> io::Result<()> {
    let cfg_path = data.join("config.json");

    // One-time safety copy of the login you had before the first switch.
    let backup = root.join("desktop").join("_original-backup");
    if !backup.exists() {
        std::fs::create_dir_all(&backup)?;
        for f in LOGIN_FILES {
            let src = join(data, f);
            if src.exists() {
                copy_file(&src, &join(&backup, f))?;
            }
        }
        if cfg_path.exists() {
            copy_file(&cfg_path, &backup.join("config.json"))?;
        }
    }

    if let Some(cur) = current {
        std::fs::create_dir_all(cur)?;
        for f in LOGIN_FILES {
            let dst = join(cur, f);
            remove_file(&dst)?;
            let src = join(data, f);
            if src.exists() {
                copy_file(&src, &dst)?;
            }
        }
        let keys = read_json(&cfg_path).map(|v| auth_keys(&v)).unwrap_or_default();
        if keys.is_empty() {
            remove_file(&cur.join(AUTH_FILE))?;
        } else {
            write_json(&cur.join(AUTH_FILE), &Value::Object(keys))?;
        }
    }

    let has_login = slot_has_login(target);
    for f in LOGIN_FILES {
        let dst = join(data, f);
        remove_file(&dst)?;
        let src = join(target, f);
        if has_login && src.exists() {
            copy_file(&src, &dst)?;
        }
    }
    if let Some(mut cfg) = read_json(&cfg_path) {
        if let Some(obj) = cfg.as_object_mut() {
            obj.retain(|k, _| !is_auth_key(k));
            if has_login {
                if let Some(Value::Object(saved)) = read_json(&target.join(AUTH_FILE)) {
                    for (k, v) in saved {
                        obj.insert(k, v);
                    }
                }
            }
        }
        write_json(&cfg_path, &cfg)?;
    } else if has_login {
        if let Some(saved) = read_json(&target.join(AUTH_FILE)) {
            write_json(&cfg_path, &saved)?;
        }
    }
    Ok(())
}

/// Latest reading from Claude Desktop's plan-usage-history.json for one Claude
/// account: (5-hour %, weekly %, taken at ms). No reset times are recorded.
pub fn history_usage(data: &Path, uuid: &str) -> Option<(f64, f64, i64)> {
    let orgs: Vec<String> = std::fs::read_dir(data.join("claude-code-sessions").join(uuid))
        .ok()?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    if orgs.is_empty() {
        return None;
    }
    let j = read_json(&data.join("plan-usage-history.json"))?;
    let (t, u) = j
        .get("samples")?
        .as_array()?
        .iter()
        .filter(|s| s.get("org").and_then(Value::as_str).map(|o| orgs.iter().any(|x| x == o)).unwrap_or(false))
        .filter_map(|s| Some((s.get("t")?.as_i64()?, s.get("u")?)))
        .max_by_key(|(t, _)| *t)?;
    let n = |k: &str| u.get(k).and_then(Value::as_f64).unwrap_or(0.0).clamp(0.0, 100.0);
    Some((n("fh"), n("sd"), t))
}

// ------------------------------------------------------------------ process

// Claude Desktop runs as Claude.exe; Claude Code's CLI is also claude.exe and
// Claude Desktop ships its own copy under %APPDATA%\Claude\claude-code, so
// processes are matched by install folder and those copies are excluded.
const FILTER: &str = r"Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -notlike '*\claude-code\*' -and ($_.Path -like '*\WindowsApps\Claude_*' -or $_.Path -like '*\WindowsApps\Anthropic*' -or $_.Path -like '*\AnthropicClaude\*' -or $_.Path -like '*\Programs\Claude\*' -or $_.Path -like '*\Program Files\Claude\*') }";

fn running() -> bool {
    powershell(&format!("@({FILTER}).Count"))
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0)
        > 0
}

pub fn exe_path() -> Option<String> {
    if !live() {
        return None;
    }
    powershell(&format!("({FILTER} | Select-Object -First 1).Path")).ok().filter(|s| !s.is_empty())
}

/// Closes Claude Desktop: asks its windows to close, then ends it if it's still
/// running (it keeps living in the tray otherwise). True once it's gone.
pub fn quit() -> bool {
    if !live() || testing() || !running() {
        return true;
    }
    let _ = powershell(&format!("{FILTER} | ForEach-Object {{ try {{ [void]$_.CloseMainWindow() }} catch {{}} }}"));
    for _ in 0..8 {
        sleep(Duration::from_millis(500));
        if !running() {
            sleep(Duration::from_millis(800));
            return true;
        }
    }
    let _ = powershell(&format!("{FILTER} | Stop-Process -Force -ErrorAction SilentlyContinue"));
    for _ in 0..40 {
        sleep(Duration::from_millis(500));
        if !running() {
            sleep(Duration::from_millis(1200));
            return true;
        }
    }
    false
}

/// Opens Claude Desktop: the Store app via its Start-menu AppID, or the exe.
pub fn launch(last_exe: Option<&str>) -> bool {
    if !live() {
        return true;
    }
    let open_app_id = |id: String| Command::new("explorer.exe").arg(format!("shell:AppsFolder\\{id}")).spawn().is_ok();
    let store_like = last_exe.map(|p| p.to_lowercase().contains("\\windowsapps\\")).unwrap_or(true);
    if store_like {
        if let Ok(id) = powershell(
            "(Get-StartApps | Where-Object { $_.AppID -like 'Claude_*!*' -or $_.AppID -like 'Anthropic*Claude*!*' } | Select-Object -First 1).AppID",
        ) {
            if !id.is_empty() {
                return open_app_id(id);
            }
        }
    }
    let la = local_appdata();
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let mut candidates = vec![
        la.join("AnthropicClaude").join("claude.exe"),
        la.join("Programs").join("Claude").join("Claude.exe"),
        PathBuf::from(pf).join("Claude").join("Claude.exe"),
    ];
    if let Some(p) = last_exe {
        candidates.push(PathBuf::from(p));
    }
    if let Some(exe) = candidates.into_iter().find(|p| p.exists()) {
        let mut c = Command::new(&exe);
        if let Some(d) = exe.parent() {
            c.current_dir(d);
        }
        return c.spawn().is_ok();
    }
    match powershell("(Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1).AppID") {
        Ok(id) if !id.is_empty() => open_app_id(id),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn swap_round_trip_keeps_settings_and_moves_login() {
        let base = std::env::temp_dir().join(format!("lb-desktop-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let data = base.join("Claude");
        let root = base.join(".limitboard");
        let main = root.join("desktop").join("desktop-main");
        let work = root.join("desktop").join("desktop-work");
        fs::create_dir_all(data.join("Network")).unwrap();
        fs::write(data.join("Network").join("Cookies"), "MAIN").unwrap();
        write_json(
            &data.join("config.json"),
            &json!({"darkMode": "dark", "oauth:tokenCacheV2": "main-token", "lastKnownAccountUuid": "uuid-main"}),
        )
        .unwrap();

        swap(Some(&main), &work, &data, &root).unwrap();
        assert!(!data.join("Network").join("Cookies").exists());
        let cfg = read_json(&data.join("config.json")).unwrap();
        assert_eq!(cfg["darkMode"], "dark");
        assert!(cfg.get("oauth:tokenCacheV2").is_none());
        assert_eq!(slot_uuid(&main).as_deref(), Some("uuid-main"));

        fs::write(data.join("Network").join("Cookies"), "WORK").unwrap();
        let mut cfg = read_json(&data.join("config.json")).unwrap();
        cfg["oauth:tokenCacheV2"] = json!("work-token");
        cfg["lastKnownAccountUuid"] = json!("uuid-work");
        cfg["darkMode"] = json!("light");
        write_json(&data.join("config.json"), &cfg).unwrap();

        swap(Some(&work), &main, &data, &root).unwrap();
        assert_eq!(fs::read_to_string(data.join("Network").join("Cookies")).unwrap(), "MAIN");
        let cfg = read_json(&data.join("config.json")).unwrap();
        assert_eq!(cfg["oauth:tokenCacheV2"], "main-token");
        assert_eq!(cfg["lastKnownAccountUuid"], "uuid-main");
        assert_eq!(cfg["darkMode"], "light");
        assert_eq!(slot_uuid(&work).as_deref(), Some("uuid-work"));
        let _ = fs::remove_dir_all(base);
    }
}
