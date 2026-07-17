# Limitboard — Tasks

Ordered, each task independently verifiable. `[deps]` = must precede.

## M1 — Skeleton

- [ ] **T1. Scaffold** — `npm create tauri-app` (Vue 3 + TS + Vite). Pin Tauri v2, add Pinia. Verify: `npm run tauri dev` opens window on Win 10/11.
- [ ] **T2. Window chrome** — decorations off, start fullscreen; Esc toggles fullscreen/windowed; close-request hides instead of exits. Verify: app never quits from titlebar/Alt-F4, only via tray. [T1]
- [ ] **T3. Tray** — icon + menu (Show board / Rescan / Quit); left-click restores window. Verify manually. [T2]
- [ ] **T4. Theme port** — port token object `T` from `limitboard-design.jsx` into `src/theme.ts` + CSS vars; global styles (Segoe UI / Cascadia stacks). Verify: blank Board.vue renders bg/ink correctly. [T1]
- [ ] **T5. Static components** — port Gauge, WindowMeter, Countdown, StatusPill, ProviderCard from the mockup to Vue SFCs with typed props; Storybook-style demo route with mock data. Verify: pixel-parity with mockup. [T4]

## M2 — Data

- [ ] **T6. Vendor caut** — download pinned caut release (win x64), checksum note in repo, register as sidecar `externalBin` in tauri.conf. Verify: `Command.sidecar` returns `--version`. [T1]
- [ ] **T7. Adapter contracts** — `adapters/types.ts` (`ProviderAdapter`, `UsageWindow`, `UsageSnapshot`). [T1]
- [ ] **T8. caut adapter** — invoke `caut --json` per provider, 15s timeout, zod-parse `caut.v1`, map → `UsageSnapshot`. Unit tests with captured fixture JSON. [T6, T7]
- [ ] **T8b. OpenRouter adapter (native, primary)** — key from keyring command (T11b) or `OPENROUTER_API_KEY`; `GET /api/v1/key` + `GET /api/v1/credits`; map spend windows (`usage_daily`/`usage_weekly`/`usage_monthly` → `amountUsd`), derive `usedPct` only vs per-key `limit` (countdown from `limit_reset`) or user soft cap; account balance → footer stat. Unit tests with fixture responses incl. `limit: null`, capped-key, and free-tier cases. [T7]
- [ ] **T9. usage store + poll loop** — Pinia store: per-provider snapshots, staleness age, poll interval from settings, failed-poll keeps last-good + error flag. Unit test the reducer with mock adapter. [T7]
- [ ] **T10. Board wiring** — Board.vue renders enabled providers from stores; countdowns tick; degraded card style (stale age badge). Verify: live Claude Code + Codex percentages match `/usage` and `/status`. [T5, T8, T9]

## M3 — Selection

- [ ] **T11. probe_paths command (Rust)** — input: list of paths/bins; expands env vars, checks file existence + `where` lookups; returns evidence strings. Read-only, scoped. [T1]
- [ ] **T11b. secret commands (Rust)** — `set_secret`/`get_secret`/`delete_secret` via `keyring` crate → Windows Credential Manager (`limitboard/openrouter`). Verify: key survives restart, absent from JSON config and logs. [T1]
- [ ] **T12. providers store + detection** — probe table for claude-code / codex / cursor / copilot / gemini / openrouter (env var + keyring probe); `{detected, evidence, enabled}`; Rescan action (also on tray menu). [T11, T11b]
- [ ] **T13. Settings view** — port from mockup: detection rows with evidence, toggles (disabled when undetected), poll interval, notify threshold, autostart checkbox. OpenRouter row gets a masked API-key field + soft-cap input (shown when key has `limit: null`). [T5, T12]
- [ ] **T14. Persistence** — plugin-store: enabled set, interval, threshold, autostart. Verify: toggle → restart → state retained (spec AC-2). [T13]

## M4 — Alerts

- [ ] **T15. Threshold engine** — on each snapshot reduce, detect upward crossings of `notifyPct`; hysteresis re-arm at (threshold − 5) or window reset. Unit tests: crossing, flapping, reset re-arm. [T9]
- [ ] **T16. Toasts** — plugin-notification; message = "Claude Code · Session 82% · resets in 1h 14m". Verify spec AC-3 with mocked snapshot. [T15]
- [ ] **T17. Tray status** — tray icon variant (green/amber/red) + tooltip = worst window. [T3, T15]
- [ ] **T18. Autostart** — plugin-autostart wired to settings flag. [T14]

## M5 — Ship

- [ ] **T19. Native Claude adapter (fallback)** — read `.credentials.json`, GET `api.anthropic.com/api/oauth/usage`, map session/weekly/opus windows. Behind adapter router: used when caut fails for claude-code. [T7]
- [ ] **T20. Native Codex adapter (fallback)** — read `auth.json`, refresh access token in-memory when expired, GET `/backend-api/codex/usage`. Never writes auth.json. [T7]
- [ ] **T21. Empty & error states** — no-providers empty state, all-degraded banner, network-loss behavior (spec AC-4 manual test: disable adapter, confirm stale-with-age, no crash). [T10]
- [ ] **T22. Packaging CI** — GitHub Actions + tauri-action → MSI artifact on tag; embedded WebView2 bootstrapper. Verify: install on clean Win 11 VM, cold start ≤2s, installer ≤25MB (spec AC-5). [all]
- [ ] **T23. Release checklist** — run spec acceptance criteria 1–5 end-to-end; tag v0.1.0.

## Deferred (v0.2+)

- Cursor adapter hardening / Copilot premium counters if caut coverage is weak.
- Historical usage (parse `~/.claude` JSONL + `~/.codex` logs → sparklines, SQLite).
- Multi-monitor placement memory; compact "strip" mode docked to screen edge.
- Per-provider poll interval overrides.
