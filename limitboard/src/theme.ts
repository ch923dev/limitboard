// Design tokens ported from lightboard-design.jsx — the single source of truth
// for the instrument-panel theme. Keep in sync with the CSS vars in styles.css.
export const T = {
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
} as const;

export type StatusWord = "NOMINAL" | "ELEVATED" | "CRITICAL";

export const statusColor = (pct: number): string =>
  pct >= 80 ? T.crit : pct >= 50 ? T.warn : T.ok;

export const statusWord = (pct: number): StatusWord =>
  pct >= 80 ? "CRITICAL" : pct >= 50 ? "ELEVATED" : "NOMINAL";
