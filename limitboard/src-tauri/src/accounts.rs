//! Claude accounts: several Claude Code logins and Claude Desktop logins on
//! one PC, and switching between them.
//!
//! * Claude Code: each account is a config folder. "Main" is the folder Claude
//!   Code uses on its own (%USERPROFILE%\.claude); every other account lives in
//!   %USERPROFILE%\.limitboard\accounts\<id> and is made active by pointing the
//!   per-user CLAUDE_CONFIG_DIR variable at it. New terminals use it.
//! * Claude Desktop: each account is a slot folder holding that account's saved
//!   login while another one is signed in (see claude_desktop.rs).
//!
//! The registry is the allow-list for credential reads: fetch_claude_usage can
//! only read the .credentials.json of an account registered here.

use crate::claude_desktop as desk;
use crate::{tray, winenv};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const CODE_ENV: &str = "CLAUDE_CONFIG_DIR";
/// Folders a new Claude Code account shares with Main (junctions).
const SHARED_DIRS: [&str; 5] = ["skills", "agents", "commands", "plugins", "output-styles"];

// ------------------------------------------------------------------ paths

/// LIMITBOARD_TEST_HOME points everything at a fake profile and turns off
/// registry writes and process control (see winenv::live).
pub fn testing() -> bool {
    std::env::var_os("LIMITBOARD_TEST_HOME").is_some()
}

pub fn home() -> PathBuf {
    std::env::var_os("LIMITBOARD_TEST_HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn root() -> PathBuf {
    home().join(".limitboard")
}

pub fn claude_home() -> PathBuf {
    home().join(".claude")
}

pub fn appdata() -> PathBuf {
    match std::env::var_os("APPDATA") {
        Some(p) if !testing() => PathBuf::from(p),
        _ => home().join("AppData").join("Roaming"),
    }
}

pub fn local_appdata() -> PathBuf {
    match std::env::var_os("LOCALAPPDATA") {
        Some(p) if !testing() => PathBuf::from(p),
        _ => home().join("AppData").join("Local"),
    }
}

fn short(p: &Path) -> String {
    match p.strip_prefix(home()) {
        Ok(rest) => format!("%USERPROFILE%\\{}", rest.display()),
        Err(_) => p.display().to_string(),
    }
}

fn read_json(p: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let s: String = out.trim_matches('-').chars().take(40).collect();
    if s.is_empty() {
        "account".into()
    } else {
        s
    }
}

// ------------------------------------------------------------------ model

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Code,
    Desktop,
}

impl Kind {
    fn title(self) -> &'static str {
        match self {
            Kind::Code => "Claude Code",
            Kind::Desktop => "Claude Desktop",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    pub dir: PathBuf,
}

impl Account {
    pub fn config_dir(&self) -> PathBuf {
        if self.kind == Kind::Code && self.is_default {
            claude_home()
        } else {
            self.dir.clone()
        }
    }
    /// .claude.json sits next to the profile for Main, inside the folder otherwise.
    fn claude_json(&self) -> PathBuf {
        if self.is_default {
            home().join(".claude.json")
        } else {
            self.dir.join(".claude.json")
        }
    }
    pub fn credentials(&self) -> PathBuf {
        self.config_dir().join(".credentials.json")
    }
    fn env_value(&self) -> Option<String> {
        (!self.is_default).then(|| self.dir.to_string_lossy().into_owned())
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Registry {
    pub accounts: Vec<Account>,
    pub active_code: String,
    pub active_desktop: String,
    #[serde(skip)]
    pub notice: Option<String>,
    #[serde(skip)]
    pub switching: bool,
}

fn same_path(a: &Path, b: &Path) -> bool {
    let n = |p: &Path| p.to_string_lossy().trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase();
    n(a) == n(b)
}

impl Registry {
    fn path() -> PathBuf {
        root().join("accounts.json")
    }

    fn load() -> Registry {
        let mut r: Registry = read_json(&Self::path())
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        r.ensure_defaults();
        r.adopt_env();
        r.save();
        r
    }

    fn save(&self) {
        let _ = std::fs::create_dir_all(root());
        if let Ok(text) = serde_json::to_string_pretty(self) {
            let tmp = Self::path().with_extension("json.tmp");
            if std::fs::write(&tmp, text).is_ok() {
                let _ = std::fs::rename(tmp, Self::path());
            }
        }
    }

    /// The logins you already have become each app's "Main" account.
    fn ensure_defaults(&mut self) {
        if !self.accounts.iter().any(|a| a.kind == Kind::Code && a.is_default) {
            self.accounts.insert(
                0,
                Account { id: "code-main".into(), kind: Kind::Code, name: "Main".into(), is_default: true, dir: claude_home() },
            );
        }
        if !self.accounts.iter().any(|a| a.kind == Kind::Desktop && a.is_default) {
            self.accounts.push(Account {
                id: "desktop-main".into(),
                kind: Kind::Desktop,
                name: "Main".into(),
                is_default: true,
                dir: root().join("desktop").join("desktop-main"),
            });
        }
        for kind in [Kind::Code, Kind::Desktop] {
            let cur = self.active_id(kind).to_string();
            if !self.accounts.iter().any(|a| a.id == cur && a.kind == kind) {
                let id = self.accounts.iter().find(|a| a.kind == kind && a.is_default).map(|a| a.id.clone()).unwrap_or_default();
                self.set_active(kind, id);
            }
        }
    }

    /// Trust the CLAUDE_CONFIG_DIR Windows actually has, so a change made
    /// outside Limitboard is shown rather than silently overwritten.
    fn adopt_env(&mut self) {
        match winenv::get_user_env(CODE_ENV) {
            None => {
                if let Some(main) = self.accounts.iter().find(|a| a.kind == Kind::Code && a.is_default) {
                    self.active_code = main.id.clone();
                }
            }
            Some(v) => {
                let dir = PathBuf::from(&v);
                match self.accounts.iter().find(|a| a.kind == Kind::Code && same_path(&a.config_dir(), &dir)) {
                    Some(a) => self.active_code = a.id.clone(),
                    None => {
                        self.notice = Some(format!(
                            "CLAUDE_CONFIG_DIR is set to {v}, which isn't one of these accounts. Switching here replaces it."
                        ))
                    }
                }
            }
        }
    }

    pub fn active_id(&self, kind: Kind) -> &str {
        match kind {
            Kind::Code => &self.active_code,
            Kind::Desktop => &self.active_desktop,
        }
    }

    fn set_active(&mut self, kind: Kind, id: String) {
        match kind {
            Kind::Code => self.active_code = id,
            Kind::Desktop => self.active_desktop = id,
        }
    }

    pub fn by_id(&self, id: &str) -> Option<&Account> {
        self.accounts.iter().find(|a| a.id == id)
    }

    pub fn active(&self, kind: Kind) -> Option<&Account> {
        self.by_id(self.active_id(kind))
    }

    pub fn is_active(&self, a: &Account) -> bool {
        self.active_id(a.kind) == a.id
    }

    fn add(&mut self, kind: Kind, name: &str) -> Result<Account, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("give the account a name".into());
        }
        if self.accounts.iter().any(|a| a.kind == kind && a.name.eq_ignore_ascii_case(name)) {
            return Err(format!("there's already a {} account called {name}", kind.title()));
        }
        let prefix = if kind == Kind::Code { "code" } else { "desktop" };
        let base = format!("{prefix}-{}", slug(name));
        let mut id = base.clone();
        let mut n = 2;
        while self.accounts.iter().any(|a| a.id == id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        let dir = match kind {
            Kind::Code => root().join("accounts").join(&id),
            Kind::Desktop => root().join("desktop").join(&id),
        };
        std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        let acc = Account { id, kind, name: name.to_string(), is_default: false, dir };
        self.accounts.push(acc.clone());
        self.save();
        Ok(acc)
    }

    fn switch_code(&mut self, id: &str) -> Result<String, String> {
        let a = self.by_id(id).filter(|a| a.kind == Kind::Code).cloned().ok_or("not a Claude Code account")?;
        winenv::set_user_env(CODE_ENV, a.env_value().as_deref())?;
        self.active_code = a.id.clone();
        self.notice = None;
        self.save();
        Ok(format!("Claude Code → {}. New terminals use it; restart open terminals and editors.", a.name))
    }

    /// Forgets an account; its folder moves to .limitboard\removed (never deleted).
    fn remove(&mut self, id: &str) -> Result<Account, String> {
        let a = self.by_id(id).cloned().ok_or("no such account")?;
        if a.is_default {
            return Err("the Main account can't be removed".into());
        }
        if a.kind == Kind::Desktop && self.is_active(&a) {
            return Err("switch Claude Desktop to another account first".into());
        }
        let was_active_code = a.kind == Kind::Code && self.is_active(&a);
        if was_active_code {
            let main = self.accounts.iter().find(|x| x.kind == Kind::Code && x.is_default).map(|x| x.id.clone()).unwrap_or_default();
            self.switch_code(&main)?;
        }
        if a.dir.exists() {
            let dest = root().join("removed").join(format!("{}-{}", a.id, now_ms()));
            std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::rename(&a.dir, &dest).map_err(|e| format!("could not move the account folder (is a terminal using it?): {e}"))?;
        }
        self.accounts.retain(|x| x.id != id);
        self.save();
        Ok(a)
    }
}

static REG: OnceLock<Mutex<Registry>> = OnceLock::new();

/// The registry. Never hold the guard while calling something that locks it
/// again (tray::rebuild_menu, changed()).
pub fn reg() -> MutexGuard<'static, Registry> {
    REG.get_or_init(|| Mutex::new(Registry::load())).lock().unwrap_or_else(|e| e.into_inner())
}

/// .credentials.json of a registered Claude Code account (None = the active one).
pub fn credentials_path(id: Option<&str>) -> Result<PathBuf, String> {
    let r = reg();
    let a = match id {
        None => r.active(Kind::Code),
        Some(id) => r.by_id(id).filter(|a| a.kind == Kind::Code),
    };
    a.map(Account::credentials).ok_or_else(|| "unknown Claude Code account".into())
}

// ------------------------------------------------------------------ view

struct Identity {
    email: Option<String>,
    uuid: Option<String>,
    plan: Option<String>,
}

fn identity(a: &Account) -> Identity {
    let state = read_json(&a.claude_json());
    let acct = state.as_ref().and_then(|s| s.get("oauthAccount"));
    let s = |k: &str| acct.and_then(|o| o.get(k)).and_then(Value::as_str).map(String::from);
    let sub = read_json(&a.credentials())
        .and_then(|c| c.get("claudeAiOauth")?.get("subscriptionType")?.as_str().map(String::from));
    let plan = s("planDisplayName").or_else(|| {
        sub.map(|p| {
            let mut c = p.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
    });
    Identity { email: s("emailAddress"), uuid: s("accountUuid"), plan }
}

/// (signed in, login expired) from the account's .credentials.json.
fn login_state(a: &Account) -> (bool, bool) {
    let Some(o) = read_json(&a.credentials()).and_then(|c| c.get("claudeAiOauth").cloned()) else {
        return (false, false);
    };
    let has_token = o.get("accessToken").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false);
    let expired = o.get("expiresAt").and_then(Value::as_i64).map(|e| e <= now_ms() + 30_000).unwrap_or(false);
    (has_token, has_token && expired)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowView {
    label: &'static str,
    sub: &'static str,
    used_pct: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    id: String,
    kind: Kind,
    name: String,
    is_default: bool,
    active: bool,
    folder: String,
    email: Option<String>,
    plan: Option<String>,
    /// Claude account id: two app logins with the same uuid share limits.
    uuid: Option<String>,
    signed_in: bool,
    login_expired: bool,
    detail: Option<String>,
    /// Claude Desktop's own usage history (no reset times), when it has one.
    history: Vec<WindowView>,
    history_as_of: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsView {
    accounts: Vec<AccountView>,
    notice: Option<String>,
    switching: bool,
    desktop_folder: String,
}

fn view(r: &Registry) -> AccountsView {
    let data = desk::data_dir();
    let mut emails: Vec<(String, String)> = Vec::new();
    let mut out = Vec::new();
    for a in r.accounts.iter().filter(|a| a.kind == Kind::Code) {
        let id = identity(a);
        let (signed_in, expired) = login_state(a);
        if let (Some(u), Some(e)) = (&id.uuid, &id.email) {
            emails.push((u.clone(), e.clone()));
        }
        out.push(AccountView {
            id: a.id.clone(),
            kind: a.kind,
            name: a.name.clone(),
            is_default: a.is_default,
            active: r.is_active(a),
            folder: short(&a.config_dir()),
            email: id.email,
            plan: id.plan,
            uuid: id.uuid,
            signed_in,
            login_expired: expired,
            detail: None,
            history: Vec::new(),
            history_as_of: None,
        });
    }
    for a in r.accounts.iter().filter(|a| a.kind == Kind::Desktop) {
        let active = r.is_active(a);
        let uuid = if active { desk::live_uuid(&data) } else { desk::slot_uuid(&a.dir) };
        let signed_in = if active { desk::live_has_login(&data) } else { desk::slot_has_login(&a.dir) };
        let detail = match (active, signed_in) {
            (true, true) => "signed in to Claude Desktop now",
            (true, false) => "not signed in",
            (false, true) => "saved login",
            (false, false) => "signs in after you switch",
        };
        let hist = uuid.as_deref().and_then(|u| desk::history_usage(&data, u));
        out.push(AccountView {
            id: a.id.clone(),
            kind: a.kind,
            name: a.name.clone(),
            is_default: a.is_default,
            active,
            folder: short(&a.dir),
            email: uuid.as_ref().and_then(|u| emails.iter().find(|(x, _)| x == u).map(|(_, e)| e.clone())),
            plan: None,
            uuid,
            signed_in,
            login_expired: false,
            detail: Some(detail.into()),
            history: hist
                .map(|(fh, sd, _)| {
                    vec![
                        WindowView { label: "Session", sub: "5h rolling · estimated", used_pct: fh },
                        WindowView { label: "Weekly", sub: "Claude Desktop history", used_pct: sd },
                    ]
                })
                .unwrap_or_default(),
            history_as_of: hist.map(|h| h.2),
        });
    }
    AccountsView { accounts: out, notice: r.notice.clone(), switching: r.switching, desktop_folder: short(&data) }
}

// ------------------------------------------------------------------ actions

/// Tells the tray and every window that accounts changed.
pub fn changed(app: &AppHandle) {
    tray::rebuild_menu(app);
    let _ = app.emit("claude-accounts-changed", ());
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn copy_setup_from_main(acc: &Account) {
    let main = claude_home();
    for f in ["settings.json", "CLAUDE.md"] {
        let src = main.join(f);
        if src.exists() {
            let _ = std::fs::copy(&src, acc.dir.join(f));
        }
    }
    for d in SHARED_DIRS {
        let (src, dst) = (main.join(d), acc.dir.join(d));
        if src.is_dir() && !dst.exists() {
            let _ = winenv::junction(&dst, &src);
        }
    }
    let servers = read_json(&home().join(".claude.json")).and_then(|j| j.get("mcpServers").cloned());
    if let Some(s) = servers.filter(|s| s.as_object().map(|o| !o.is_empty()).unwrap_or(false)) {
        if let Ok(text) = serde_json::to_string_pretty(&json!({ "mcpServers": s })) {
            let _ = std::fs::write(acc.dir.join(".claude.json"), text);
        }
    }
}

fn sign_in_terminal(a: &Account) -> Result<(), String> {
    winenv::open_terminal(
        &format!("Claude Code - {}", a.name),
        &[(CODE_ENV, a.env_value())],
        &[
            format!("echo Signing in to Claude Code as \"{}\". Finish the login, then type /exit.", winenv::echo_safe(&a.name)),
            "echo.".into(),
            "where claude >nul 2>nul || (echo Claude Code isn't installed: https://docs.claude.com/claude-code & goto :eof)".into(),
            "claude /login".into(),
        ],
    )
}

/// Closes Claude Desktop, swaps its login, reopens it. Runs on its own thread.
fn switch_desktop(app: AppHandle, id: String) {
    let (current, target) = {
        let mut r = reg();
        let Some(target) = r.by_id(&id).filter(|a| a.kind == Kind::Desktop).cloned() else { return };
        if r.switching || r.is_active(&target) {
            return;
        }
        r.switching = true;
        (r.active(Kind::Desktop).cloned(), target)
    };
    changed(&app);
    let _ = app.emit("claude-accounts-toast", "Closing Claude Desktop…");

    let last_exe = desk::exe_path();
    let msg = if !desk::quit() {
        "Claude Desktop didn't close. Quit it from its tray icon, then try again.".to_string()
    } else {
        let had_login = desk::slot_has_login(&target.dir);
        let swapped = desk::swap(current.as_ref().map(|a| a.dir.as_path()), &target.dir, &desk::data_dir(), &root());
        let msg = match swapped {
            Ok(()) => {
                let mut r = reg();
                r.active_desktop = target.id.clone();
                r.save();
                if had_login {
                    format!("Claude Desktop → {}", target.name)
                } else {
                    format!("Claude Desktop → {}. Sign in with that account in the window that opens.", target.name)
                }
            }
            Err(e) => format!("Switch failed: {e}. Your original login is backed up in .limitboard\\desktop\\_original-backup."),
        };
        if desk::launch(last_exe.as_deref()) {
            msg
        } else {
            format!("{msg} Claude Desktop wasn't found; open it from the Start menu.")
        }
    };
    finish_desktop(&app, msg);
}

fn finish_desktop(app: &AppHandle, msg: String) {
    reg().switching = false;
    notify(app, "Claude Desktop", &msg);
    let _ = app.emit("claude-accounts-toast", msg);
    changed(app);
}

/// Tray menu click on an account.
pub fn tray_select(app: &AppHandle, id: &str) {
    let kind = reg().by_id(id).map(|a| a.kind);
    match kind {
        Some(Kind::Code) => {
            let r = reg().switch_code(id);
            match r {
                Ok(msg) => notify(app, "Claude Code", &msg),
                Err(e) => notify(app, "Couldn't switch", &e),
            }
            changed(app);
        }
        Some(Kind::Desktop) => {
            let active = reg().active_id(Kind::Desktop) == id;
            if !active {
                // Switching restarts Claude Desktop, so confirm in the window.
                crate::show_main(app);
                let _ = app.emit("confirm-desktop-switch", id);
            }
            tray::rebuild_menu(app);
        }
        None => {}
    }
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn claude_accounts() -> AccountsView {
    view(&reg())
}

#[tauri::command]
pub async fn claude_account_switch(app: AppHandle, id: String) -> Result<String, String> {
    let kind = reg().by_id(&id).map(|a| a.kind).ok_or("no such account")?;
    match kind {
        Kind::Code => {
            let msg = reg().switch_code(&id)?;
            changed(&app);
            Ok(msg)
        }
        Kind::Desktop => {
            std::thread::spawn(move || switch_desktop(app, id));
            Ok("Switching Claude Desktop…".into())
        }
    }
}

#[tauri::command]
pub async fn claude_account_add(app: AppHandle, kind: Kind, name: String, copy_setup: bool) -> Result<Value, String> {
    let acc = reg().add(kind, &name)?;
    if kind == Kind::Code {
        if copy_setup {
            copy_setup_from_main(&acc);
        }
        sign_in_terminal(&acc)?;
    }
    changed(&app);
    Ok(json!({ "id": acc.id, "kind": acc.kind, "name": acc.name }))
}

#[tauri::command]
pub fn claude_account_rename(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("give the account a name".into());
    }
    {
        let mut r = reg();
        let a = r.accounts.iter_mut().find(|a| a.id == id).ok_or("no such account")?;
        a.name = name;
        r.save();
    }
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn claude_account_remove(app: AppHandle, id: String) -> Result<String, String> {
    let a = reg().remove(&id)?;
    changed(&app);
    Ok(format!("Removed {}. Its folder is in .limitboard\\removed.", a.name))
}

#[tauri::command]
pub fn claude_account_sign_in(id: String) -> Result<(), String> {
    let a = reg().by_id(&id).filter(|a| a.kind == Kind::Code).cloned().ok_or("not a Claude Code account")?;
    sign_in_terminal(&a)
}

#[tauri::command]
pub fn claude_account_terminal(id: Option<String>) -> Result<(), String> {
    let a = {
        let r = reg();
        match id {
            Some(id) => r.by_id(&id).cloned(),
            None => r.active(Kind::Code).cloned(),
        }
    }
    .filter(|a| a.kind == Kind::Code)
    .ok_or("not a Claude Code account")?;
    winenv::open_terminal(
        &format!("Claude Code - {}", a.name),
        &[(CODE_ENV, a.env_value())],
        &[format!("echo Claude Code account: {}", winenv::echo_safe(&a.name))],
    )
}

#[tauri::command]
pub fn claude_account_open_folder(id: String) -> Result<(), String> {
    let dir = reg().by_id(&id).map(|a| if a.kind == Kind::Code { a.config_dir() } else { a.dir.clone() }).ok_or("no such account")?;
    winenv::open_folder(&dir);
    Ok(())
}

#[tauri::command]
pub fn claude_account_dismiss_notice(app: AppHandle) {
    reg().notice = None;
    let _ = app.emit("claude-accounts-changed", ());
}
