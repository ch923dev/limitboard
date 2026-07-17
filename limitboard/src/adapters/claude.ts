// Native Claude Code adapter — community-discovered OAuth usage endpoint.
// Reads the token Claude Code maintains in ~/.claude/.credentials.json
// (read-only; Claude Code owns refresh). Endpoint schema may drift — parse
// defensively and degrade to an error snapshot rather than throw.
import { invoke } from "@tauri-apps/api/core";
import { HttpError, httpError } from "./http";
import type {
  DetectResult,
  ProviderAdapter,
  UsageSnapshot,
  UsageWindow,
} from "./types";

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: number;
    subscriptionType?: string;
  };
}

/** One rate-limit window as returned by /api/oauth/usage (shape may drift). */
interface OauthUsageWindow {
  utilization?: number; // 0..100
  resets_at?: string | null;
}

interface OauthUsageResponse {
  five_hour?: OauthUsageWindow;
  seven_day?: OauthUsageWindow;
  seven_day_opus?: OauthUsageWindow;
  seven_day_oauth_apps?: OauthUsageWindow;
}

export interface ClaudeDeps {
  fetchFn?: typeof fetch;
  readCredentials?: () => Promise<string | null>;
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export function mapOauthUsage(res: OauthUsageResponse): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const push = (w: OauthUsageWindow | undefined, label: string, sub: string) => {
    if (!w || typeof w.utilization !== "number") return;
    windows.push({
      label,
      sub,
      usedPct: Math.min(100, Math.max(0, w.utilization)),
      resetsAt: w.resets_at ?? undefined,
    });
  };
  push(res.five_hour, "Session", "5h rolling");
  push(res.seven_day, "Weekly", "all models");
  push(res.seven_day_opus, "Weekly", "Opus only");
  return windows;
}

export function createClaudeAdapter(deps: ClaudeDeps = {}): ProviderAdapter {
  const fetchFn = deps.fetchFn ?? fetch;
  const readCredentials =
    deps.readCredentials ??
    (() =>
      invoke<string | null>("read_credential_file", {
        id: "claude-credentials",
      }));

  const getToken = async (): Promise<string | null> => {
    const raw = await readCredentials();
    if (!raw) return null;
    try {
      const creds = JSON.parse(raw) as ClaudeCredentials;
      return creds.claudeAiOauth?.accessToken ?? null;
    } catch {
      return null;
    }
  };

  return {
    id: "claude-code",
    displayName: "Claude Code",

    async detect(): Promise<DetectResult> {
      const token = await getToken();
      return token
        ? { detected: true, evidence: "%USERPROFILE%\\.claude\\.credentials.json" }
        : { detected: false, evidence: "not found · ~/.claude/.credentials.json" };
    },

    async fetchUsage(): Promise<UsageSnapshot> {
      const fetchedAt = Date.now();
      try {
        const token = await getToken();
        if (!token) throw new Error("no credentials");

        const res = await fetchFn(USAGE_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
          },
        });
        if (!res.ok) throw httpError("oauth/usage", res);
        const body = (await res.json()) as OauthUsageResponse;

        const windows = mapOauthUsage(body);
        if (!windows.length) throw new Error("no usage windows in response (schema drift?)");

        return { providerId: "claude-code", windows, fetchedAt };
      } catch (e) {
        return {
          providerId: "claude-code",
          windows: [],
          fetchedAt,
          error: e instanceof Error ? e.message : String(e),
          retryAfterMs: e instanceof HttpError ? e.retryAfterMs : undefined,
        };
      }
    },
  };
}
