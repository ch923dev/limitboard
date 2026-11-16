//! Server-side usage fetches. api.anthropic.com rejects browser (CORS)
//! clients for some orgs, and tauri-plugin-http always forwards the webview
//! Origin — so the claude fetch runs here in Rust with reqwest (no Origin,
//! same path as any native client). The OAuth token is read and used in this
//! process only; it never reaches the webview and is never logged.
//!
//! `account_id` picks one registered Claude Code account (accounts.rs);
//! without it, the active account is used. Unregistered paths can't be read.

use serde::Serialize;

use crate::accounts;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawUsageResponse {
    pub status: u16,
    pub body: String,
    pub retry_after_secs: Option<u64>,
}

#[tauri::command]
pub async fn fetch_claude_usage(account_id: Option<String>) -> Result<RawUsageResponse, String> {
    let path = accounts::credentials_path(account_id.as_deref())?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err("no credentials".into()),
        Err(e) => return Err(e.to_string()),
    };
    let creds: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "credentials unparseable".to_string())?;
    let oauth = &creds["claudeAiOauth"];
    let token = oauth["accessToken"]
        .as_str()
        .ok_or_else(|| "no access token".to_string())?
        .to_string();
    // An expired token only earns a 401. Claude Code renews it (and rewrites
    // this file) the next time the account is used; Limitboard never does.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if oauth["expiresAt"].as_i64().is_some_and(|exp| exp <= now) {
        return Err("login expired · use this account in Claude Code once to refresh it".into());
    }

    let res = tauri_plugin_http::reqwest::Client::new()
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = res.status().as_u16();
    let retry_after_secs = res
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok());
    let body = res.text().await.map_err(|e| e.to_string())?;

    Ok(RawUsageResponse {
        status,
        body,
        retry_after_secs,
    })
}
