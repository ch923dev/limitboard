use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Deserialize)]
pub struct ProbeSpec {
    /// Provider id this probe belongs to.
    pub provider: String,
    /// File/dir paths to check; `%VAR%` and `~` are expanded.
    #[serde(default)]
    pub paths: Vec<String>,
    /// Binary names to look up with `where`.
    #[serde(default)]
    pub bins: Vec<String>,
    /// Env var names whose presence counts as detection.
    #[serde(default)]
    pub env_vars: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ProbeResult {
    pub provider: String,
    pub detected: bool,
    /// The path / PATH hit / env var that matched, or why nothing did.
    pub evidence: String,
}

fn expand(path: &str) -> String {
    let mut out = path.to_string();
    if out.starts_with("~") {
        if let Ok(home) = std::env::var("USERPROFILE") {
            out = out.replacen('~', &home, 1);
        }
    }
    // %VAR% expansion
    while let (Some(start), Some(end)) = {
        let s = out.find('%');
        let e = s.and_then(|s| out[s + 1..].find('%').map(|e| s + 1 + e));
        (s, e)
    } {
        let var = &out[start + 1..end];
        let val = std::env::var(var).unwrap_or_default();
        out = format!("{}{}{}", &out[..start], val, &out[end + 1..]);
    }
    out
}

fn where_lookup(bin: &str) -> Option<String> {
    let output = Command::new("where").arg(bin).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|l| l.trim().to_string())
}

pub fn run_probe(spec: &ProbeSpec) -> ProbeResult {
    for raw in &spec.paths {
        let expanded = expand(raw);
        if PathBuf::from(&expanded).exists() {
            return ProbeResult {
                provider: spec.provider.clone(),
                detected: true,
                evidence: expanded,
            };
        }
    }
    for bin in &spec.bins {
        if let Some(hit) = where_lookup(bin) {
            return ProbeResult {
                provider: spec.provider.clone(),
                detected: true,
                evidence: format!("PATH · {hit}"),
            };
        }
    }
    for var in &spec.env_vars {
        if std::env::var(var).map(|v| !v.is_empty()).unwrap_or(false) {
            return ProbeResult {
                provider: spec.provider.clone(),
                detected: true,
                evidence: format!("{var} (env)"),
            };
        }
    }
    let looked_for = spec
        .paths
        .first()
        .cloned()
        .or_else(|| spec.bins.first().map(|b| format!("{b} on PATH")))
        .or_else(|| spec.env_vars.first().map(|v| format!("{v} env var")))
        .unwrap_or_else(|| "nothing to probe".into());
    ProbeResult {
        provider: spec.provider.clone(),
        detected: false,
        evidence: format!("not found · {looked_for}"),
    }
}

/// Read-only detection probes: file existence, `where` lookups, env presence.
/// Never reads file contents — that stays inside adapters at poll time.
#[tauri::command]
pub fn probe_paths(specs: Vec<ProbeSpec>) -> Vec<ProbeResult> {
    specs.iter().map(run_probe).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_userprofile() {
        let home = std::env::var("USERPROFILE").unwrap();
        assert_eq!(expand("%USERPROFILE%\\.claude"), format!("{home}\\.claude"));
        assert_eq!(expand("~/.codex"), format!("{home}/.codex"));
    }

    #[test]
    fn undetected_gives_reason() {
        let r = run_probe(&ProbeSpec {
            provider: "gemini".into(),
            paths: vec!["%USERPROFILE%\\.does-not-exist-xyz".into()],
            bins: vec![],
            env_vars: vec![],
        });
        assert!(!r.detected);
        assert!(r.evidence.starts_with("not found"));
    }
}
