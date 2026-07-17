# Limitboard — Technical Plan

## Stack

- **Shell:** Tauri v2 (Rust host, WebView2). Rationale: ~10MB installer vs ~150MB Electron, first-class tray/notification/autostart plugins, sidecar support for `caut`. Rust surface stays minimal — commands are thin wrappers.
- **UI:** Vue 3 + TypeScript + Vite + Pinia. Composition API, `<script setup>`.
- **Data layer:** `caut` binary bundled as Tauri sidecar (`externalBin`), invoked with `--json`, parsed against the `caut.v1` schema. Native TS adapters as fallback/hardening for Claude Code and Codex.
- **Persistence:** `@tauri-apps/plugin-store` (JSON in app data dir).
- **Plugins:** `plugin-shell` (sidecar), `plugin-notification` (toasts), `plugin-autostart`, `plugin-fs` (scoped read for detection probes), tray via core API.

## Architecture

```
┌─ Tauri host (Rust, thin) ──────────────────────────────┐
│  commands: run_sidecar(args) · probe_paths(list)       │
│  tray icon/menu · window mgmt (fullscreen, hide-to-tray)│
└──────────────▲─────────────────────────────────────────┘
               │ invoke / events
┌─ Vue 3 app ──┴─────────────────────────────────────────┐
│  stores/                                               │
│    providers.ts   detection state + enabled set        │
│    usage.ts       poll loop, windows, staleness        │
│    settings.ts    interval, threshold, autostart       │
│  adapters/                                             │
│    types.ts       ProviderAdapter, UsageWindow         │
│    caut.ts        universal adapter (sidecar → caut.v1)│
│    claude.ts      native fallback (oauth/usage)        │
│    codex.ts       native fallback (+ token refresh)    │
│    openrouter.ts  native primary (documented API)      │
│  views/  Board.vue · Settings.vue                      │
│  components/ ProviderCard · Gauge · WindowMeter ·      │
│              Countdown · Toggle · StatusPill           │
└────────────────────────────────────────────────────────┘
```

## Core contracts

```ts
// adapters/types.ts
export interface UsageWindow {
  label: string;        // "Session", "Weekly"
  sub?: string;         // "5h rolling", "Opus only"
  usedPct: number;      // 0..100
  resetsAt?: string;    // ISO 8601
}

export interface UsageSnapshot {
  providerId: string;
  windows: UsageWindow[];
  fetchedAt: number;
  error?: string;       // set ⇒ card degraded, keep last-good windows
}

export interface ProviderAdapter {
  id: string;                      // "claude-code" | "codex" | ...
  displayName: string;
  detect(): Promise<{ detected: boolean; evidence: string }>;
  fetchUsage(): Promise<UsageSnapshot>;
}
```

## Key flows

### Detection
1. `providers.ts` → Rust `probe_paths` command with the per-provider probe list (credential paths expanded from `%USERPROFILE%`, then `where <bin>`).
2. Merge results into `{ detected, evidence }` per provider; render Settings rows.
3. Rescan = same flow, user-triggered from Settings and tray menu.

### Poll loop (usage.ts)
1. `setInterval(intervalMs)` → for each enabled provider, adapter router: try `caut` adapter first; on unsupported/error, try native adapter if one exists.
2. Sidecar call: `Command.sidecar('bin/caut', ['fetch', providerId, '--json'])`, 15s timeout, parse → map to `UsageSnapshot`.
3. Reduce into store keyed by providerId. Failed poll: keep previous windows, set `error`, card shows stale age.
4. After each reduce, threshold check: for each window crossing `notifyPct` upward since last snapshot → toast once, set re-arm flag; update tray color to worst overall.

### Codex token refresh (native adapter only)
Read `auth.json`; if access token expired, POST refresh grant, use new token in-memory only — **never write back to auth.json** (Codex CLI owns that file).

### OpenRouter (native adapter, primary — not routed through caut)
Key resolution: Windows Credential Manager entry (`limitboard/openrouter`) → fallback `OPENROUTER_API_KEY` env var. Poll: `GET https://openrouter.ai/api/v1/key` (Bearer auth) → spend windows from `usage_daily` / `usage_weekly` / `usage_monthly` (credits ≈ USD, UTC day / Mon-start week / month); `GET /api/v1/credits` → account balance for the card footer. Mapping: three **spend windows** carrying `amountUsd` (extend `UsageWindow` with optional `amountUsd`/`capUsd`; `usedPct` becomes optional). `usedPct` is derived only where a cap exists — per-key `limit` (reset countdown from `limit_reset`) or the user's soft cap — so threshold alerts fire on capped windows only. Key writes go through a Rust `keyring`-crate command (`set_secret`/`get_secret`); the webview never persists the key.

### Window/tray behavior
- Main window: `decorations: false`, start maximized-fullscreen; Esc toggles windowed.
- `onCloseRequested` → `preventDefault` + hide; tray "Quit" calls `app.exit()`.

## Security

- FS scope limited to the exact probe paths, read-only.
- Tokens live in memory for the duration of a poll; never logged, never persisted by us. Exception: the OpenRouter API key (user-supplied) is persisted — in Windows Credential Manager via the `keyring` crate, never in the JSON config or logs.
- CSP locked; only `api.anthropic.com`, `chatgpt.com` (backend-api), GitHub API, Cursor API, and `openrouter.ai` in the http allowlist. Sidecar does its own egress.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Undocumented endpoints change | caut delegation (they track drift); adapter isolation; degrade-gracefully |
| caut binary trust / supply chain | pin version, verify checksum in CI, vendor the binary in repo releases |
| Cursor source unreliable | ship behind "best effort" badge or defer to v0.2 |
| WebView2 missing on target | Tauri bundler's embedded bootstrapper |
| Toast spam near threshold | hysteresis: re-arm only after window drops below (threshold − 5) or resets |

## Project structure

```
limitboard/
├─ src/                  # Vue app (stores, adapters, views, components)
├─ src-tauri/
│  ├─ src/main.rs        # commands: probe_paths; tray setup
│  ├─ binaries/          # caut sidecar (win x64)
│  └─ tauri.conf.json
├─ spec.md  plan.md  tasks.md
└─ .github/workflows/build.yml   # tauri-action → MSI artifact
```

## Milestones

- **M1 — Skeleton:** Tauri+Vue scaffold, fullscreen borderless window, tray with Show/Quit, theme tokens ported from `limitboard-design.jsx`.
- **M2 — Data:** caut sidecar wired, poll loop, Claude Code + Codex live on the board.
- **M3 — Selection:** detection probes, Settings view, persistence.
- **M4 — Alerts:** thresholds, toasts with hysteresis, tray color, autostart.
- **M5 — Ship:** native fallback adapters, empty/degraded states polish, MSI via GitHub Actions.
