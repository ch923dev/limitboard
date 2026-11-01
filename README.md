# Limitboard

A Windows tray app that shows the usage limits of agentic coding CLIs on one board, and warns you before a limit cuts off a session mid-run.

Claude Code, Codex and OpenRouter each meter usage differently and report it somewhere else. Limitboard finds the tools you're logged into, reads their usage, and turns it into gauges with reset countdowns.

**Stack:** Tauri v2 (Rust) · Vue 3 · TypeScript · Pinia · Vitest

## What it does

- **Detects installed CLIs** on launch (credential files, then `PATH`, then environment variables) and shows the evidence behind each detection.
- **Shows a live board** of gauge cards: session and weekly percentages, spend windows, and countdowns to each reset.
- **Pops a card out** into a floating, always-on-top widget.
- **Warns before a limit binds** with a Windows notification at your threshold, with hysteresis so it doesn't flap. The tray icon takes the colour of the worst gauge.

## Design decisions

- **Credentials are the risk surface.** The Rust core reads the credential files the CLIs already keep, read-only, through a fixed allow-list. The UI cannot ask for an arbitrary path, and tokens stay in the native process. Keys you add yourself go to Windows Credential Manager.
- **Degrade, never blank.** Most of these usage endpoints are undocumented and can change or rate-limit at any time. Adapters return errors as values, the store keeps the last good data, and the card shows how stale it is with a retry countdown.
- **Platform quirks are handled natively.** When one provider rejected browser-origin requests, the fetch moved into the Rust process instead of the webview.
- **Nothing leaves the machine.** No backend, no telemetry.

## Run it

Requires Node.js, Rust and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for Windows.

```powershell
cd limitboard
npm install
npm run tauri dev     # run the app
npm test              # unit tests (adapters, reducer, alerts)
npm run tauri build   # build an MSI installer
```

Pushing a `v*` tag builds the MSI in GitHub Actions and attaches it to a release.

## Status

A personal tool I use every day. Windows only. It reads unofficial usage endpoints, so any provider can break it without notice.
