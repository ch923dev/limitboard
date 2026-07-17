//! Server-side usage fetches. api.anthropic.com rejects browser (CORS)
//! clients for some orgs, and tauri-plugin-http always forwards the webview
//! Origin — so the claude fetch runs here in Rust with reqwest (no Origin,
//! same path as any native client). The OAuth token is read and used in this
//! process only; it never reaches the webview and is never logged.

use serde::Serialize;

use crate::files;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawUsageResponse {
    pub status: u16,
    pub body: String,
    pub retry_after_secs: Option<u64>,
}

#[tauri::command]
pub async fn fetch_claude_usage() -> Result<RawUsageResponse, String> {
    let raw = files::read_credential_file("claude-credentials".into())?
        .ok_or_else(|| "no credentials".to_string())?;
    let creds: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "credentials unparseable".to_string())?;
    let token = creds["claudeAiOauth"]["accessToken"]
        .as_str()
        .ok_or_else(|| "no access token".to_string())?
        .to_string();

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
