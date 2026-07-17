// Native Codex CLI adapter — ChatGPT backend usage endpoint.
// Reads ~/.codex/auth.json (owned by Codex CLI); if the access token is
// expired, refreshes via the OAuth refresh grant IN MEMORY ONLY — auth.json
// is never written back (plan.md hard rule).
import { invoke } from "@tauri-apps/api/core";
import { HttpError, httpError } from "./http";
import type {
  DetectResult,
  ProviderAdapter,
  UsageSnapshot,
  UsageWindow,
} from "./types";

interface CodexAuth {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

interface CodexRateLimitWindow {
  used_percent?: number;
  resets_in_seconds?: number;
  window_minutes?: number;
}

interface CodexUsageResponse {
  rate_limits?: {
    primary?: CodexRateLimitWindow;
    secondary?: CodexRateLimitWindow;
  };
  // some responses put the windows at top level — tolerate both
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
}

export interface CodexDeps {
  fetchFn?: typeof fetch;
  readAuth?: () => Promise<string | null>;
  now?: () => number;
}

const USAGE_URL = "https://chatgpt.com/backend-api/codex/usage";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"; // Codex CLI public client id

const isJwtExpired = (jwt: string, nowMs: number): boolean => {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]!)) as { exp?: number };
    if (!payload.exp) return false;
    return payload.exp * 1000 < nowMs + 60_000; // 1min headroom
  } catch {
    return false; // unparseable ⇒ try it as-is
  }
};

export function mapCodexUsage(res: CodexUsageResponse, nowMs: number): UsageWindow[] {
  const primary = res.rate_limits?.primary ?? res.primary;
  const secondary = res.rate_limits?.secondary ?? res.secondary;
  const windows: UsageWindow[] = [];
  const push = (w: CodexRateLimitWindow | undefined, label: string, sub: string) => {
    if (!w || typeof w.used_percent !== "number") return;
    windows.push({
      label,
      sub,
      usedPct: Math.min(100, Math.max(0, w.used_percent)),
      resetsAt:
        w.resets_in_seconds != null
          ? new Date(nowMs + w.resets_in_seconds * 1000).toISOString()
          : undefined,
    });
  };
  push(primary, "Primary", "5h rolling");
  push(secondary, "Secondary", "7d window");
  return windows;
}

export function createCodexAdapter(deps: CodexDeps = {}): ProviderAdapter {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const readAuth =
    deps.readAuth ??
    (() => invoke<string | null>("read_credential_file", { id: "codex-auth" }));

  // In-memory refreshed token, keyed by the refresh token that produced it.
  let cached: { refreshToken: string; accessToken: string } | null = null;

  const refreshAccessToken = async (refreshToken: string): Promise<string> => {
    if (cached?.refreshToken === refreshToken) return cached.accessToken;
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw httpError("token refresh", res);
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error("token refresh: no access_token");
    cached = { refreshToken, accessToken: body.access_token };
    return body.access_token;
  };

  const getAuth = async (): Promise<{ token: string; accountId?: string } | null> => {
    const raw = await readAuth();
    if (!raw) return null;
    let auth: CodexAuth;
    try {
      auth = JSON.parse(raw) as CodexAuth;
    } catch {
      return null;
    }
    const t = auth.tokens;
    if (!t?.access_token) return null;

    let token = t.access_token;
    if (isJwtExpired(token, now()) && t.refresh_token) {
      token = await refreshAccessToken(t.refresh_token);
    }
    return { token, accountId: t.account_id };
  };

  return {
    id: "codex",
    displayName: "Codex CLI",

    async detect(): Promise<DetectResult> {
      const raw = await readAuth();
      return raw
        ? { detected: true, evidence: "%USERPROFILE%\\.codex\\auth.json" }
        : { detected: false, evidence: "not found · ~/.codex/auth.json" };
    },

    async fetchUsage(): Promise<UsageSnapshot> {
      const fetchedAt = Date.now();
      try {
        const auth = await getAuth();
        if (!auth) throw new Error("no auth tokens");

        const headers: Record<string, string> = {
          Authorization: `Bearer ${auth.token}`,
        };
        if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;

        const res = await fetchFn(USAGE_URL, { headers });
        if (!res.ok) throw httpError("codex/usage", res);
        const body = (await res.json()) as CodexUsageResponse;

        const windows = mapCodexUsage(body, now());
        if (!windows.length) throw new Error("no rate limits in response (schema drift?)");

        return { providerId: "codex", windows, fetchedAt };
      } catch (e) {
        return {
          providerId: "codex",
          windows: [],
          fetchedAt,
          error: e instanceof Error ? e.message : String(e),
          retryAfterMs: e instanceof HttpError ? e.retryAfterMs : undefined,
        };
      }
    },
  };
}
