import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderId } from "../adapters/types";

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  plan: string;
  glyph: string;
  method: string;
}

export interface ProbeSpec {
  provider: ProviderId;
  paths?: string[];
  bins?: string[];
  envVars?: string[];
}

export interface ProbeResult {
  provider: ProviderId;
  detected: boolean;
  evidence: string;
}

export interface ProviderState extends ProviderMeta {
  detected: boolean;
  evidence: string;
  enabled: boolean;
}

export const PROVIDER_META: ProviderMeta[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    plan: "subscription",
    glyph: "◆",
    method: "OAuth · api.anthropic.com/api/oauth/usage",
  },
  {
    id: "codex",
    name: "Codex CLI",
    plan: "ChatGPT",
    glyph: "▲",
    method: "OAuth · /backend-api/codex/usage",
  },
  {
    id: "cursor",
    name: "Cursor",
    plan: "best effort",
    glyph: "●",
    method: "Dashboard API · monthly requests",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    plan: "—",
    glyph: "■",
    method: "GitHub API · premium requests",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    plan: "—",
    glyph: "○",
    method: "via sidecar only",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    plan: "Pay-as-you-go",
    glyph: "◇",
    method: "Documented API · /api/v1/key + /credits",
  },
];

/** Detection probe table (spec FR-1) — order of reliability: files → PATH → env. */
export const PROBE_TABLE: ProbeSpec[] = [
  { provider: "claude-code", paths: ["%USERPROFILE%\\.claude\\.credentials.json"], bins: ["claude"] },
  { provider: "codex", paths: ["%USERPROFILE%\\.codex\\auth.json"], bins: ["codex"] },
  { provider: "cursor", paths: ["%APPDATA%\\Cursor"], bins: [] },
  { provider: "copilot", paths: ["%APPDATA%\\GitHub CLI\\hosts.yml"], bins: ["gh"] },
  { provider: "gemini", paths: ["%USERPROFILE%\\.gemini"], bins: ["gemini"] },
  { provider: "openrouter", envVars: ["OPENROUTER_API_KEY"] },
];

export const useProvidersStore = defineStore("providers", {
  state: () => ({
    providers: PROVIDER_META.map<ProviderState>((m) => ({
      ...m,
      detected: false,
      evidence: "not scanned yet",
      enabled: false,
    })),
    scanning: false,
  }),

  getters: {
    detected: (s) => s.providers.filter((p) => p.detected),
    enabledProviders: (s) => s.providers.filter((p) => p.detected && p.enabled),
    byId: (s) => (id: ProviderId) => s.providers.find((p) => p.id === id),
  },

  actions: {
    /** Run detection probes (launch + tray/Settings "Rescan"). */
    async rescan() {
      this.scanning = true;
      try {
        const specs = PROBE_TABLE.map((p) => ({
          provider: p.provider,
          paths: p.paths ?? [],
          bins: p.bins ?? [],
          env_vars: p.envVars ?? [],
        }));
        const results = await invoke<ProbeResult[]>("probe_paths", { specs });
        for (const r of results) {
          const p = this.byId(r.provider);
          if (!p) continue;
          p.detected = r.detected;
          p.evidence = r.evidence;
          if (!r.detected) p.enabled = false;
        }
        // OpenRouter also counts a stored Credential Manager key as detected.
        const or = this.byId("openrouter");
        if (or && !or.detected) {
          const stored = await invoke<string | null>("get_secret", {
            name: "openrouter",
          });
          if (stored) {
            or.detected = true;
            or.evidence = "API key (Credential Manager)";
          }
        }
      } finally {
        this.scanning = false;
      }
    },

    setEnabled(id: ProviderId, enabled: boolean) {
      const p = this.byId(id);
      if (p && p.detected) p.enabled = enabled;
    },
  },
});
