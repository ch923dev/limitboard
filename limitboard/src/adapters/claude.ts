// Native Claude Code adapter — community-discovered OAuth usage endpoint.
// The fetch itself runs in Rust (fetch_claude_usage): api.anthropic.com
// rejects browser/CORS clients for some orgs, and tauri-plugin-http always
// forwards the webview Origin. Rust reads the token Claude Code maintains in
// ~/.claude/.credentials.json (read-only; Claude Code owns refresh) and the
// token never enters the webview. Endpoint schema may drift — parse
// defensively and degrade to an error snapshot rather than throw.
import { invoke } from "@tauri-apps/api/core";
import type {
  DetectResult,
  ProviderAdapter,
  UsageSnapshot,
  UsageWindow,
} from "./types";

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

/** What fetch_claude_usage returns: raw status + body, auth handled in Rust. */
export interface RawUsageResponse {
  status: number;
  body: string;
  retryAfterSecs?: number | null;
}

export interface ClaudeDeps {
  fetchUsageRaw?: () => Promise<RawUsageResponse>;
  readCredentials?: () => Promise<string | null>;
}

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
  const fetchUsageRaw =
    deps.fetchUsageRaw ??
    (() => invoke<RawUsageResponse>("fetch_claude_usage"));
  const readCredentials =
    deps.readCredentials ??
    (() =>
      invoke<string | null>("read_credential_file", {
        id: "claude-credentials",
      }));

  return {
    id: "claude-code",
    displayName: "Claude Code",

    async detect(): Promise<DetectResult> {
      const raw = await readCredentials();
      return raw
        ? { detected: true, evidence: "%USERPROFILE%\\.claude\\.credentials.json" }
        : { detected: false, evidence: "not found · ~/.claude/.credentials.json" };
    },

    async fetchUsage(): Promise<UsageSnapshot> {
      const fetchedAt = Date.now();
      try {
        const raw = await fetchUsageRaw();

        if (raw.status < 200 || raw.status >= 300) {
          const retryAfterMs =
            raw.retryAfterSecs != null ? raw.retryAfterSecs * 1000 : undefined;
          const hint =
            retryAfterMs != null
              ? ` · retry in ~${Math.ceil(retryAfterMs / 60_000)}m`
              : "";
          return {
            providerId: "claude-code",
            windows: [],
            fetchedAt,
            error: `oauth/usage → HTTP ${raw.status}${hint}`,
            retryAfterMs,
          };
        }

        const body = JSON.parse(raw.body) as OauthUsageResponse;
        const windows = mapOauthUsage(body);
        if (!windows.length) throw new Error("no usage windows in response (schema drift?)");

        return { providerId: "claude-code", windows, fetchedAt };
      } catch (e) {
        return {
          providerId: "claude-code",
          windows: [],
          fetchedAt,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
