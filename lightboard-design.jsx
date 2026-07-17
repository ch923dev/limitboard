import { useState, useEffect, useMemo } from "react";

// ─────────────────────────────────────────────────────────────
// LIMITBOARD — design mockup
// Fullscreen Windows dashboard for agentic subscription limits.
// Instrument-panel direction: every window is a metered gauge
// with tick scales, a needle, and a reset countdown.
// Fonts are Windows-native on purpose: Segoe UI + Cascadia/Consolas.
// ─────────────────────────────────────────────────────────────

const T = {
  bg: "#0E1215",
  panel: "#161C21",
  panelEdge: "#232C33",
  ink: "#E7ECEF",
  muted: "#77858F",
  faint: "#3A464F",
  ok: "#53B87E",
  warn: "#E2A93B",
  crit: "#E05B52",
  mono: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  sans: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
};

const statusColor = (pct) => (pct >= 80 ? T.crit : pct >= 50 ? T.warn : T.ok);
const statusWord = (pct) => (pct >= 80 ? "CRITICAL" : pct >= 50 ? "ELEVATED" : "NOMINAL");

// pct for gauge/threshold purposes: explicit pct, or spend vs cap; null = uncapped spend
const windowPct = (w) =>
  w.pct != null ? w.pct : w.capUsd ? (w.amountUsd / w.capUsd) * 100 : null;

const hoursFromNow = (h) => Date.now() + h * 3600 * 1000;

const INITIAL_PROVIDERS = [
  {
    id: "claude-code",
    name: "Claude Code",
    plan: "Max 5×",
    glyph: "◆",
    detected: true,
    enabled: true,
    source: "%USERPROFILE%\\.claude\\.credentials.json",
    method: "OAuth · api.anthropic.com/api/oauth/usage",
    windows: [
      { label: "Session", sub: "5h rolling", pct: 62, resetsAt: hoursFromNow(2.4) },
      { label: "Weekly", sub: "all models", pct: 41, resetsAt: hoursFromNow(52) },
      { label: "Weekly", sub: "Opus only", pct: 18, resetsAt: hoursFromNow(52) },
    ],
  },
  {
    id: "codex",
    name: "Codex CLI",
    plan: "ChatGPT Pro",
    glyph: "▲",
    detected: true,
    enabled: true,
    source: "%USERPROFILE%\\.codex\\auth.json",
    method: "OAuth · /backend-api/codex/usage",
    windows: [
      { label: "Primary", sub: "5h rolling", pct: 35, resetsAt: hoursFromNow(3.7) },
      { label: "Secondary", sub: "7d window", pct: 58, resetsAt: hoursFromNow(96) },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    plan: "Pro",
    glyph: "●",
    detected: true,
    enabled: true,
    source: "%APPDATA%\\Cursor (session token)",
    method: "Dashboard API · monthly requests",
    windows: [
      { label: "Requests", sub: "monthly pool", pct: 84, resetsAt: hoursFromNow(310) },
    ],
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    plan: "Pro",
    glyph: "■",
    detected: true,
    enabled: false,
    source: "PATH · gh copilot",
    method: "GitHub API · premium requests",
    windows: [
      { label: "Premium", sub: "monthly pool", pct: 12, resetsAt: hoursFromNow(310) },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    plan: "Pay-as-you-go",
    glyph: "◇",
    detected: true,
    enabled: true,
    source: "OPENROUTER_API_KEY (env)",
    method: "Documented API · /api/v1/key + /credits",
    stat: "balance $21.25",
    windows: [
      { label: "Today", sub: "UTC day", amountUsd: 1.84, resetsAt: hoursFromNow(9) },
      { label: "This week", sub: "resets Mon UTC", amountUsd: 12.4, resetsAt: hoursFromNow(81) },
      { label: "This month", sub: "vs soft cap", amountUsd: 38.75, capUsd: 60, resetsAt: hoursFromNow(310) },
    ],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    plan: "—",
    glyph: "○",
    detected: false,
    enabled: false,
    source: "not found · ~/.gemini missing",
    method: "—",
    windows: [],
  },
];

// ── small pieces ─────────────────────────────────────────────

function Countdown({ target }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((target - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const txt =
    d > 0
      ? `${d}d ${String(h).padStart(2, "0")}h`
      : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return <span style={{ fontFamily: T.mono }}>{txt}</span>;
}

function Gauge({ pct }) {
  const ticks = 40;
  const c = statusColor(pct);
  return (
    <div style={{ position: "relative", height: 26, marginTop: 6 }}>
      {/* tick scale */}
      <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 14 }}>
        {Array.from({ length: ticks }).map((_, i) => {
          const tickPct = (i / (ticks - 1)) * 100;
          const lit = tickPct <= pct;
          const major = i % 10 === 0 || i === ticks - 1;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: major ? 14 : 9,
                background: lit ? c : T.faint,
                opacity: lit ? 1 : 0.55,
                borderRadius: 1,
                transition: "background 600ms, opacity 600ms",
              }}
            />
          );
        })}
      </div>
      {/* needle */}
      <div
        style={{
          position: "absolute",
          top: -4,
          left: `calc(${pct}% - 4px)`,
          width: 0,
          height: 0,
          borderLeft: "4px solid transparent",
          borderRight: "4px solid transparent",
          borderTop: `6px solid ${T.ink}`,
          transition: "left 800ms cubic-bezier(.4,0,.2,1)",
        }}
      />
      {/* scale labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: T.mono,
          fontSize: 9,
          color: T.faint,
          marginTop: 4,
          letterSpacing: "0.08em",
        }}
      >
        <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
      </div>
    </div>
  );
}

function WindowMeter({ w }) {
  const pct = windowPct(w);
  const c = pct != null ? statusColor(pct) : T.ink;
  return (
    <div style={{ padding: "14px 0", borderTop: `1px solid ${T.panelEdge}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span
            style={{
              fontFamily: T.mono, fontSize: 10, letterSpacing: "0.14em",
              color: T.muted, textTransform: "uppercase",
            }}
          >
            {w.label}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, marginLeft: 8 }}>
            {w.sub}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
            {w.resetsAt ? <>↻ <Countdown target={w.resetsAt} /></> : "no reset"}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 600, color: c }}>
            {w.amountUsd != null ? (
              <>
                <span style={{ fontSize: 11, color: T.muted }}>$</span>
                {w.amountUsd.toFixed(2)}
                {w.capUsd != null && (
                  <span style={{ fontSize: 11, color: T.muted }}> / ${w.capUsd.toFixed(0)}</span>
                )}
              </>
            ) : (
              <>
                {Math.round(w.pct)}
                <span style={{ fontSize: 11, color: T.muted }}>%</span>
              </>
            )}
          </span>
        </div>
      </div>
      {pct != null && <Gauge pct={pct} />}
    </div>
  );
}

function ProviderCard({ p, lastSync }) {
  const pcts = p.windows.map(windowPct).filter((v) => v != null);
  const worst = pcts.length ? Math.max(...pcts) : 0;
  const c = statusColor(worst);
  return (
    <div
      style={{
        background: T.panel,
        border: `1px solid ${T.panelEdge}`,
        borderRadius: 8,
        padding: "18px 20px 8px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: c, fontSize: 14 }}>{p.glyph}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.01em" }}>{p.name}</div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, marginTop: 1 }}>{p.plan}</div>
          </div>
        </div>
        <span
          style={{
            fontFamily: T.mono, fontSize: 9, letterSpacing: "0.16em",
            color: c, border: `1px solid ${c}44`, background: `${c}14`,
            padding: "3px 8px", borderRadius: 3,
          }}
        >
          {statusWord(worst)}
        </span>
      </div>

      {p.windows.map((w, i) => (
        <WindowMeter key={i} w={w} />
      ))}

      <div
        style={{
          borderTop: `1px solid ${T.panelEdge}`, marginTop: "auto",
          padding: "10px 0", display: "flex", justifyContent: "space-between",
          fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: "0.04em",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
          {p.method}
        </span>
        <span>{p.stat ? `${p.stat} · ` : ""}sync {lastSync}s ago</span>
      </div>
    </div>
  );
}

function Toggle({ on, disabled, onClick }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        width: 40, height: 20, borderRadius: 10, border: `1px solid ${on ? T.ok : T.faint}`,
        background: on ? `${T.ok}33` : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        position: "relative", padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, left: on ? 21 : 2,
          width: 14, height: 14, borderRadius: "50%",
          background: on ? T.ok : T.muted, transition: "left 200ms",
        }}
      />
    </button>
  );
}

function SettingsView({ providers, onToggle }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 6, fontFamily: T.mono, fontSize: 10, letterSpacing: "0.18em", color: T.muted }}>
        DETECTED AGENTS — SELECT WIDGETS
      </div>
      <div style={{ fontSize: 13, color: T.muted, marginBottom: 20 }}>
        Limitboard scans config directories and PATH on launch. Enabled agents render as gauges on the board.
      </div>
      {providers.map((p) => (
        <div
          key={p.id}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 8,
            padding: "14px 18px", marginBottom: 10,
            opacity: p.detected ? 1 : 0.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ color: p.detected ? T.ok : T.faint, fontSize: 13 }}>{p.glyph}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {p.name}
                {!p.detected && (
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, marginLeft: 10, letterSpacing: "0.14em" }}>
                    NOT DETECTED
                  </span>
                )}
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, marginTop: 3 }}>{p.source}</div>
            </div>
          </div>
          <Toggle on={p.enabled} disabled={!p.detected} onClick={() => onToggle(p.id)} />
        </div>
      ))}
      <div
        style={{
          marginTop: 24, display: "flex", gap: 28, fontFamily: T.mono, fontSize: 10,
          color: T.muted, letterSpacing: "0.06em",
        }}
      >
        <span>POLL INTERVAL · 60s</span>
        <span>NOTIFY AT · <span style={{ color: T.warn }}>80%</span></span>
        <span>TRAY · WORST GAUGE</span>
      </div>
    </div>
  );
}

// ── app ──────────────────────────────────────────────────────

export default function Limitboard() {
  const [view, setView] = useState("board");
  const [providers, setProviders] = useState(INITIAL_PROVIDERS);
  const [lastSync, setLastSync] = useState(4);
  const [clock, setClock] = useState(new Date());

  // clock + sync counter
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date());
      setLastSync((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // simulated poll: drift gauges / spend slightly every 12s
  useEffect(() => {
    const t = setInterval(() => {
      setProviders((ps) =>
        ps.map((p) => ({
          ...p,
          windows: p.windows.map((w) =>
            w.amountUsd != null
              ? { ...w, amountUsd: w.amountUsd + Math.random() * 0.15 }
              : { ...w, pct: Math.min(99, Math.max(1, w.pct + (Math.random() * 4 - 1.2))) }
          ),
        }))
      );
      setLastSync(0);
    }, 12000);
    return () => clearInterval(t);
  }, []);

  const onToggle = (id) =>
    setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)));

  const active = providers.filter((p) => p.detected && p.enabled);
  const worstOverall = useMemo(
    () =>
      Math.max(
        0,
        ...active.flatMap((p) => p.windows.map(windowPct).filter((v) => v != null))
      ),
    [active]
  );

  return (
    <div
      style={{
        minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.sans,
        display: "flex", flexDirection: "column",
      }}
    >
      {/* header */}
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 28px", borderBottom: `1px solid ${T.panelEdge}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 8, height: 8, borderRadius: "50%",
              background: statusColor(worstOverall),
              boxShadow: `0 0 10px ${statusColor(worstOverall)}88`,
            }}
          />
          <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700, letterSpacing: "0.22em" }}>
            LIMITBOARD
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, letterSpacing: "0.1em" }}>
            v0.1 · windows
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, letterSpacing: "0.08em" }}>
            {providers.filter((p) => p.detected).length} DETECTED · {active.length} MONITORED
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>
            {clock.toLocaleTimeString([], { hour12: false })}
          </span>
          <nav style={{ display: "flex", gap: 4 }}>
            {["board", "settings"].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  fontFamily: T.mono, fontSize: 10, letterSpacing: "0.14em",
                  textTransform: "uppercase", padding: "6px 14px", borderRadius: 4,
                  border: `1px solid ${view === v ? T.muted : "transparent"}`,
                  background: view === v ? T.panel : "transparent",
                  color: view === v ? T.ink : T.muted, cursor: "pointer",
                }}
              >
                {v}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* body */}
      <main style={{ flex: 1, padding: "28px", overflowY: "auto" }}>
        {view === "board" ? (
          active.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                gap: 18, maxWidth: 1400, margin: "0 auto",
              }}
            >
              {active.map((p) => (
                <ProviderCard key={p.id} p={p} lastSync={lastSync} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", marginTop: 120, color: T.muted, fontSize: 14 }}>
              No agents monitored. Enable one in Settings to add its gauge.
            </div>
          )
        ) : (
          <SettingsView providers={providers} onToggle={onToggle} />
        )}
      </main>

      {/* footer strip */}
      <footer
        style={{
          display: "flex", justifyContent: "space-between", padding: "10px 28px",
          borderTop: `1px solid ${T.panelEdge}`, fontFamily: T.mono, fontSize: 9,
          color: T.faint, letterSpacing: "0.1em",
        }}
      >
        <span>
          THRESHOLDS · <span style={{ color: T.ok }}>■</span> &lt;50 ·{" "}
          <span style={{ color: T.warn }}>■</span> 50–80 · <span style={{ color: T.crit }}>■</span> ≥80
        </span>
        <span>NEXT POLL {Math.max(0, 12 - (lastSync % 12))}s · SIDE­CAR caut.v1 · LOCAL ONLY</span>
      </footer>
    </div>
  );
}
