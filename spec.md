# Limitboard — Specification

Fullscreen Windows desktop app that monitors subscription usage limits across agentic coding tools (Claude Code, Codex CLI, Cursor, GitHub Copilot, Gemini CLI, OpenRouter), auto-detects which are installed, and lets the user select which render as live gauge widgets.

## Problem

Each agentic tool meters usage differently (5h rolling sessions, 7d windows, monthly request pools) and exposes it in a different place (`/usage` in Claude Code, `/status` in Codex, browser dashboards for Cursor/Copilot). Checking means interrupting work. Hitting a limit mid-run means losing a session with no warning. There is no Windows-native equivalent of the macOS menu-bar trackers (CodexBar, SessionWatcher).

## Goals

- Single glanceable board showing all rate-limit windows across enabled agents.
- Auto-detect installed + authenticated agents on launch; zero manual credential entry.
- User selects which detected agents become widgets.
- Warn (Windows toast) before a limit binds, at a configurable threshold.
- System tray presence with worst-gauge indicator; board itself runs fullscreen/borderless.
- Local-first: reads local credential/config files, calls provider endpoints directly. No telemetry, no backend, nothing stored off-machine.

## Non-goals (v0.1)

- macOS/Linux support.
- Historical usage analytics / cost dashboards (ccusage-style JSONL analysis) — later.
- Multi-account per provider.
- Auto-pausing or throttling agents.
- Auth flows: if a tool isn't logged in locally, we show "not detected", we do not log in for the user.

## Users & primary flow

Single developer (me). Launch at startup → board fullscreen or minimized to tray → toast at 80% on any window → glance, decide whether to switch agents or wait for reset.

## Functional requirements

### FR-1 Detection
- On launch (and on manual "Rescan"), probe per provider in order of reliability:
  1. Credential/config file existence: `%USERPROFILE%\.claude\.credentials.json`, `%USERPROFILE%\.codex\auth.json`, `%USERPROFILE%\.gemini\`, Cursor app data, `gh` config.
  2. PATH probe: `where claude`, `where codex`, etc.
  3. Env var probe (OpenRouter): `OPENROUTER_API_KEY` present ⇒ detected; otherwise the Settings row offers a key field (the one permitted exception to zero manual credential entry, since OpenRouter has no local CLI credential file). Pasted keys are stored in Windows Credential Manager, never in the JSON config.
- A provider is **detected** iff its data source is usable (credential file readable), not merely installed.
- Settings screen lists all known providers with detection state + evidence (the path or PATH hit that matched).

### FR-2 Widget selection
- Each detected provider has an enable toggle. Enabled ⇒ card on the board.
- Undetected providers shown grayed with reason ("not found · ~/.gemini missing"), toggle disabled.
- Selection persists across restarts.

### FR-3 Usage polling
- Poll each enabled provider on a configurable interval (default 60s; per-provider override allowed).
- Each poll returns 0..n **windows**: `{ label, sub, usedPct, resetsAt }`.
- Stale data is shown with its age, never hidden; a failed poll marks the card degraded but keeps last values.

### FR-4 Board (fullscreen dashboard)
- Grid of provider cards, auto-fit ≥340px columns.
- Per window: label, tick-scale gauge with needle, percent, live reset countdown.
- Card status pill = worst window: NOMINAL <50%, ELEVATED 50–80%, CRITICAL ≥80% (colors green/amber/red).
- Header: app status LED (worst overall), detected/monitored counts, clock. Footer: threshold legend, next-poll countdown.
- Empty state when nothing enabled points to Settings.

### FR-5 Notifications & tray
- Windows toast when any window crosses the notify threshold (default 80%, configurable). One toast per window per crossing (re-arm after it drops below or resets).
- Tray icon reflects worst gauge color; tray tooltip = worst window summary; tray menu: Show board / Rescan / Quit.
- Close button minimizes to tray; Quit only from tray.

### FR-6 Settings persistence
- JSON config on disk (app data dir): enabled providers, poll interval, notify threshold, launch-at-startup flag.

## Data sources (per provider, v0.1)

| Provider | Detection | Usage source | Notes |
|---|---|---|---|
| Claude Code | `~/.claude/.credentials.json` | `api.anthropic.com/api/oauth/usage` (undocumented) → 5h session, 7d weekly, Opus weekly, ISO reset timestamps | Endpoint is community-discovered; may change. Token maintained by Claude Code itself. |
| Codex CLI | `~/.codex/auth.json` | ChatGPT backend `/backend-api/codex/usage` → primary 5h, secondary 7d | Access token expires ~hourly; refresh via stored refresh token. |
| Cursor | app data / session token | Dashboard API, monthly request pool | Weakest source; acceptable to ship as "best effort" or defer. |
| Copilot | `gh` auth / PATH | GitHub API premium request counters | |
| Gemini CLI | `~/.gemini` | via sidecar only | |
| OpenRouter | `OPENROUTER_API_KEY` env var or key in Settings | **Documented API**: `GET /api/v1/key` → `usage_daily` / `usage_weekly` / `usage_monthly` (spend in credits ≈ USD, UTC boundaries), `limit` / `limit_remaining` / `limit_reset` (optional per-key cap); `GET /api/v1/credits` → account balance | Only officially supported source in the set. **Spend-first card**: shows "$ spent today / this week / this month" as amounts, not percentages. Gauge rendered only where a cap exists: per-key `limit` (countdown from `limit_reset` cadence) or a user-configured soft cap in Settings. Account balance remaining shown as a card footer stat. |

**Primary strategy:** bundle `caut` (coding_agent_usage_tracker, Rust CLI, stable versioned JSON schema `caut.v1`) as a Tauri sidecar and treat it as the universal adapter. Native adapters (direct HTTP) only where caut is insufficient or as Phase-2 hardening for Claude Code + Codex.

## Constraints & risks

- **Windows 10/11 only.** Paths, tray, and toasts assume Windows.
- All provider endpoints are undocumented; schema drift is expected. Mitigation: adapter isolation + sidecar delegation + degrade-gracefully rule (FR-3).
- Credentials are read-only; never written, never logged, never leave the machine except to the provider's own endpoint.
- App must stay usable with zero providers detected (empty state, rescan).

## Acceptance criteria (v0.1 done =)

1. Fresh launch on a machine with Claude Code + Codex logged in detects both and shows both cards with live percentages and ticking reset countdowns.
2. Toggling a provider off removes its card immediately and survives restart.
3. Forcing a window ≥80% (mock or real) fires exactly one toast and turns the tray red.
4. Killing network mid-run degrades cards to stale-with-age, no crash.
5. Installer (MSI/NSIS) ≤ 25MB, cold start ≤ 2s.

## Design reference

Visual direction locked in `lightboard-design.jsx` (instrument-panel: tick gauges, needle, Segoe UI + Cascadia, token object `T` = source of truth for theme).

