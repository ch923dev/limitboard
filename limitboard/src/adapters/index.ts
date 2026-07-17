import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderAdapter, ProviderId } from "./types";
import { createOpenRouterAdapter } from "./openrouter";
import { createClaudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";

// OpenRouter key: Credential Manager entry → OPENROUTER_API_KEY env (plan.md).
async function openRouterKey(): Promise<string | null> {
  const stored = await invoke<string | null>("get_secret", { name: "openrouter" });
  if (stored) return stored;
  return await invoke<string | null>("get_env_var", { name: "OPENROUTER_API_KEY" });
}

export function buildAdapters(
  getSoftCapUsd: () => Promise<number | undefined>,
): Map<ProviderId, ProviderAdapter> {
  const fetchFn = tauriFetch as typeof fetch;
  const adapters: ProviderAdapter[] = [
    createOpenRouterAdapter({ getKey: openRouterKey, getSoftCapUsd, fetchFn }),
    createClaudeAdapter({ fetchFn }),
    createCodexAdapter({ fetchFn }),
  ];
  return new Map(adapters.map((a) => [a.id, a]));
}
