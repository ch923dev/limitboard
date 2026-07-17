// Core adapter contracts — see plan.md "Core contracts".

export type ProviderId =
  | "claude-code"
  | "codex"
  | "cursor"
  | "copilot"
  | "gemini"
  | "openrouter";

export interface UsageWindow {
  label: string; // "Session", "Weekly", "Today"
  sub?: string; // "5h rolling", "Opus only", "UTC day"
  /**
   * 0..100. Optional: spend-first windows (OpenRouter) carry amountUsd and
   * only derive a pct when a cap exists. Threshold alerts fire on windows
   * with a pct only.
   */
  usedPct?: number;
  amountUsd?: number; // spend in credits ≈ USD
  capUsd?: number; // per-key limit or user soft cap
  resetsAt?: string; // ISO 8601
}

export interface UsageSnapshot {
  providerId: ProviderId;
  windows: UsageWindow[];
  /** Extra card footer stat, e.g. "balance $21.25" (OpenRouter). */
  stat?: string;
  fetchedAt: number; // epoch ms
  error?: string; // set ⇒ card degraded, keep last-good windows
  /** Server-mandated wait (Retry-After) — overrides formula backoff. */
  retryAfterMs?: number;
}

export interface DetectResult {
  detected: boolean;
  evidence: string; // matched path / PATH hit / "not found · ~/.gemini missing"
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  detect(): Promise<DetectResult>;
  fetchUsage(): Promise<UsageSnapshot>;
}

/** pct used for gauges/thresholds: explicit pct, else spend vs cap, else null (uncapped spend). */
export const windowPct = (w: UsageWindow): number | null =>
  w.usedPct != null
    ? w.usedPct
    : w.capUsd && w.amountUsd != null
      ? (w.amountUsd / w.capUsd) * 100
      : null;
