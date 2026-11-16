//! Windows side effects used by Claude account switching: the per-user
//! CLAUDE_CONFIG_DIR variable, console windows for `claude /login`, and
//! directory junctions. With LIMITBOARD_TEST_HOME set (or off Windows) these
//! touch nothing outside the fake profile.

use crate::accounts::{root, testing};
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

pub fn live() -> bool {
    cfg!(windows) && !testing()
}

/// A command that never flashes a console window.
pub fn hidden(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// Runs a PowerShell script, passed base64-encoded so quoting can't break it.
pub fn powershell(script: &str) -> Result<String, String> {
    if !live() {
        return Ok(String::new());
    }
    use base64::Engine;
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let enc = base64::engine::general_purpose::STANDARD.encode(utf16);
    let out = hidden("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &enc])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Sets (or removes, when `None`) a per-user environment variable in
/// HKCU\Environment and broadcasts WM_SETTINGCHANGE so terminals opened
/// afterwards see it. Limitboard's own process env is updated too.
pub fn set_user_env(name: &str, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(v) => std::env::set_var(name, v),
        None => std::env::remove_var(name),
    }
    if !live() {
        return Ok(());
    }
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
        use winreg::RegKey;
        let env = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .map_err(|e| format!("could not open HKCU\\Environment: {e}"))?;
        match value {
            Some(v) => env
                .set_value(name, &v.to_string())
                .map_err(|e| format!("could not set {name}: {e}"))?,
            None => match env.delete_value(name) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(format!("could not remove {name}: {e}"))
                }
                _ => {}
            },
        }
        broadcast_env_change();
    }
    Ok(())
}

pub fn get_user_env(name: &str) -> Option<String> {
    if !live() {
        return std::env::var(name).ok().filter(|s| !s.is_empty());
    }
    read_user_env(name)
}

#[cfg(windows)]
fn read_user_env(name: &str) -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let env = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment").ok()?;
    env.get_value::<String, _>(name).ok().filter(|s| !s.is_empty())
}

#[cfg(not(windows))]
fn read_user_env(_name: &str) -> Option<String> {
    None
}

#[cfg(windows)]
fn broadcast_env_change() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    let s: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result: usize = 0;
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            s.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            3000,
            &mut result,
        );
    }
}

/// Opens a new console window that sets `env` (None = unset) and runs
/// `commands`. Writes a small .cmd file so paths with spaces survive.
pub fn open_terminal(title: &str, env: &[(&str, Option<String>)], commands: &[String]) -> Result<(), String> {
    let dir = root().join("run");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(86_400);
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if e.metadata().and_then(|m| m.modified()).map(|t| t < cutoff).unwrap_or(false) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let file = dir.join(format!("{stamp}.cmd"));
    let mut lines = vec![
        "@echo off".to_string(),
        "chcp 65001 >nul".to_string(),
        format!("title {}", title.replace(['&', '|', '<', '>', '^', '%'], " ")),
    ];
    for (k, v) in env {
        match v {
            Some(v) => lines.push(format!("set \"{k}={}\"", v.replace('%', "%%"))),
            None => lines.push(format!("set \"{k}=\"")),
        }
    }
    lines.push("cd /d \"%USERPROFILE%\"".into());
    lines.extend(commands.iter().cloned());
    std::fs::write(&file, lines.join("\r\n") + "\r\n").map_err(|e| e.to_string())?;
    if !live() {
        return Ok(());
    }
    #[cfg(windows)]
    {
        Command::new("cmd.exe")
            .raw_arg(format!("/k \"\"{}\"\"", file.display()))
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Escapes text for `echo` in a batch file.
pub fn echo_safe(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '%' => out.push_str("%%"),
            '"' => out.push('\''),
            '^' | '&' | '|' | '<' | '>' | '(' | ')' => {
                out.push('^');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Makes `link` a directory junction to `target` (no admin rights needed).
#[cfg(windows)]
pub fn junction(link: &Path, target: &Path) -> Result<(), String> {
    let out = hidden("cmd.exe")
        .raw_arg(format!("/c mklink /J \"{}\" \"{}\"", link.display(), target.display()))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn junction(_link: &Path, _target: &Path) -> Result<(), String> {
    Err("junctions need Windows".into())
}

pub fn open_folder(p: &Path) {
    if live() {
        let _ = Command::new("explorer.exe").arg(p).spawn();
    }
}
