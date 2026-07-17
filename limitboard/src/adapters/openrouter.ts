// OpenRouter native adapter — the only officially documented source in the set.
// GET /api/v1/key    → usage_daily / usage_weekly / usage_monthly (credits ≈ USD),
//                      limit / limit_remaining / limit_reset (optional per-key cap)
// GET /api/v1/credits → account balance (total_credits - total_usage)
// Spend-first card: windows carry amountUsd; usedPct derived only where a cap
// exists (per-key limit, or the user's soft cap on the monthly window).
import { HttpError, httpError } from "./http";
import type {
  DetectResult,
  ProviderAdapter,
  UsageSnapshot,
  UsageWindow,
} from "./types";

export interface OpenRouterKeyData {
  label?: string;
  usage?: number;
  usage_daily?: number;
  usage_weekly?: number;
  usage_monthly?: number;
  is_free_tier?: boolean;
  limit?: number | null;
  limit_remaining?: number | null;
  limit_reset?: string | null;
}

export interface OpenRouterCreditsData {
  total_credits?: number;
  total_usage?: number;
}

export interface OpenRouterDeps {
  /** Resolves the API key: Credential Manager entry → OPENROUTER_API_KEY env. */
  getKey: () => Promise<string | null>;
  /** User-configured monthly soft cap (USD); undefined = no cap. */
  getSoftCapUsd?: () => Promise<number | undefined>;
  /** Injected for tests; defaults to global fetch (plugin-http in-app). */
  fetchFn?: typeof fetch;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

const BASE = "https://openrouter.ai/api/v1";

// UTC boundary helpers — OpenRouter windows reset on UTC day / Mon-start week / month.
export const nextUtcMidnight = (now: Date): string => {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return d.toISOString();
};

export const nextUtcMonday = (now: Date): string => {
  const dow = now.getUTCDay(); // 0=Sun..6=Sat
  const days = dow === 0 ? 1 : 8 - dow;
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
  );
  return d.toISOString();
};

export const nextUtcMonthStart = (now: Date): string => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString();
};

export function mapToWindows(
  key: OpenRouterKeyData,
  softCapUsd: number | undefined,
  now: Date,
): UsageWindow[] {
  const windows: UsageWindow[] = [
    {
      label: "Today",
      sub: "UTC day",
      amountUsd: key.usage_daily ?? 0,
      resetsAt: nextUtcMidnight(now),
    },
    {
      label: "This week",
      sub: "resets Mon UTC",
      amountUsd: key.usage_weekly ?? 0,
      resetsAt: nextUtcMonday(now),
    },
  ];

  const monthly: UsageWindow = {
    label: "This month",
    sub: softCapUsd != null ? "vs soft cap" : "UTC month",
    amountUsd: key.usage_monthly ?? 0,
    resetsAt: nextUtcMonthStart(now),
  };
  if (softCapUsd != null && softCapUsd > 0) {
    monthly.capUsd = softCapUsd;
    monthly.usedPct = Math.min(
      100,
      ((key.usage_monthly ?? 0) / softCapUsd) * 100,
    );
  }
  windows.push(monthly);

  // Per-key credit cap: its own gauge window with the documented reset cadence.
  if (key.limit != null && key.limit > 0) {
    const used = key.limit - (key.limit_remaining ?? key.limit);
    windows.push({
      label: "Key limit",
      sub: key.limit_reset ? `resets ${key.limit_reset}` : "per-key cap",
      amountUsd: used,
      capUsd: key.limit,
      usedPct: Math.min(100, Math.max(0, (used / key.limit) * 100)),
    });
  }

  return windows;
}

export function createOpenRouterAdapter(deps: OpenRouterDeps): ProviderAdapter {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());

  const get = async (path: string, key: string) => {
    const res = await fetchFn(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw httpError(`openrouter ${path}`, res);
    return (await res.json()) as { data: unknown };
  };

  return {
    id: "openrouter",
    displayName: "OpenRouter",

    async detect(): Promise<DetectResult> {
      const key = await deps.getKey();
      return key
        ? { detected: true, evidence: "API key (Credential Manager / env)" }
        : { detected: false, evidence: "no key · set OPENROUTER_API_KEY or paste in Settings" };
    },

    async fetchUsage(): Promise<UsageSnapshot> {
      const fetchedAt = Date.now();
      try {
        const key = await deps.getKey();
        if (!key) throw new Error("no API key");

        const [keyRes, creditsRes] = await Promise.all([
          get("/key", key),
          get("/credits", key),
        ]);
        const keyData = keyRes.data as OpenRouterKeyData;
        const credits = creditsRes.data as OpenRouterCreditsData;
        const softCap = await deps.getSoftCapUsd?.();

        const balance =
          (credits.total_credits ?? 0) - (credits.total_usage ?? 0);

        return {
          providerId: "openrouter",
          windows: mapToWindows(keyData, softCap, now()),
          stat: `balance $${balance.toFixed(2)}`,
          fetchedAt,
        };
      } catch (e) {
        return {
          providerId: "openrouter",
          windows: [],
          fetchedAt,
          error: e instanceof Error ? e.message : String(e),
          retryAfterMs: e instanceof HttpError ? e.retryAfterMs : undefined,
        };
      }
    },
  };
}
