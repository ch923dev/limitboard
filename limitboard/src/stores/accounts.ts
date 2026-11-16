// Claude accounts (Claude Code + Claude Desktop): the list comes from Rust
// (accounts.rs), switching happens there too. This store adds usage per
// account: the active Claude Code account's numbers are the "claude-code"
// provider snapshot; the others are polled here through the same native
// fetch, scoped by account id (Rust only reads registered accounts' logins).
import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { createClaudeAdapter, type RawUsageResponse } from "../adapters/claude";
import type { UsageWindow } from "../adapters/types";
import type { AccountCandidate } from "../alerts/switch";
import { reduceSnapshot, type StoredSnapshot } from "./usage";

export type AccountKind = "code" | "desktop";

export interface ClaudeAccount {
  id: string;
  kind: AccountKind;
  name: string;
  isDefault: boolean;
  active: boolean;
  folder: string;
  email?: string | null;
  plan?: string | null;
  uuid?: string | null;
  signedIn: boolean;
  loginExpired: boolean;
  detail?: string | null;
  /** Claude Desktop's own usage history (percentages only, no reset times). */
  history: UsageWindow[];
  historyAsOf?: number | null;
}

interface AccountsView {
  accounts: ClaudeAccount[];
  notice?: string | null;
  switching: boolean;
  desktopFolder: string;
}

const SNAPSHOT_KEY = "limitboard.accountSnapshots";
const FIVE_HOURS = 5 * 3600_000;
const BACKOFF_BASE_MS = 120_000;
const BACKOFF_CAP_MS = 900_000;

function loadSnapshots(): Record<string, StoredSnapshot> {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "{}") as Record<string, StoredSnapshot>;
  } catch {
    return {};
  }
}

function saveSnapshots(map: Record<string, StoredSnapshot>) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — in-memory only
  }
}

/** Desktop history has no reset times: a 5-hour reading older than 5h has reset. */
export function historyWindows(a: Pick<ClaudeAccount, "history" | "historyAsOf">, nowMs: number): UsageWindow[] {
  if (!a.history.length) return [];
  const stale = a.historyAsOf != null && nowMs - a.historyAsOf > FIVE_HOURS;
  return a.history.map((w) => (stale && w.label === "Session" ? { ...w, usedPct: 0 } : w));
}

export const useAccountsStore = defineStore("accounts", {
  state: () => ({
    accounts: [] as ClaudeAccount[],
    notice: null as string | null,
    switching: false,
    desktopFolder: "",
    /** Last-good usage per Claude Code account id. */
    snapshots: loadSnapshots(),
    /** Latest status line from Rust (Desktop switch progress, errors). */
    message: null as string | null,
    /** Desktop account waiting for a restart confirmation (tray → window). */
    confirmDesktopId: null as string | null,
    _lastAttempt: {} as Record<string, number>,
    _nextAllowedAt: {} as Record<string, number>,
    _errorStreak: {} as Record<string, number>,
  }),

  getters: {
    code: (s) => s.accounts.filter((a) => a.kind === "code"),
    desktop: (s) => s.accounts.filter((a) => a.kind === "desktop"),
    activeCode: (s) => s.accounts.find((a) => a.kind === "code" && a.active) ?? null,
    byId: (s) => (id: string) => s.accounts.find((a) => a.id === id),
  },

  actions: {
    async refresh() {
      const v = await invoke<AccountsView>("claude_accounts");
      this.accounts = v.accounts;
      this.notice = v.notice ?? null;
      this.switching = v.switching;
      this.desktopFolder = v.desktopFolder;
    },

    /** Usage of any account. Claude Desktop logins borrow the reading of a
     *  Claude Code login of the same Claude account, else Desktop's history. */
    snapshotFor(a: ClaudeAccount, nowMs = Date.now()): StoredSnapshot | undefined {
      if (a.kind === "code") return this.snapshots[a.id];
      const twin = a.uuid ? this.code.find((c) => c.uuid === a.uuid && this.snapshots[c.id]) : undefined;
      if (twin) return this.snapshots[twin.id];
      if (!a.history.length) return undefined;
      return {
        providerId: "claude-code",
        windows: historyWindows(a, nowMs),
        fetchedAt: a.historyAsOf ?? nowMs,
      };
    },

    /** Mirror the provider poll (active account) into the per-account map. */
    recordActive(snap: StoredSnapshot | undefined) {
      const active = this.activeCode;
      if (!active || !snap) return;
      this.snapshots[active.id] = snap;
      saveSnapshots(this.snapshots);
    },

    /** Poll Claude Code accounts that aren't in use (at most once per interval,
     *  with backoff on errors). Expired logins are skipped: Rust would refuse. */
    async pollInactive(intervalMs: number) {
      const now = Date.now();
      const due = this.code.filter(
        (a) =>
          !a.active &&
          a.signedIn &&
          !a.loginExpired &&
          (this._nextAllowedAt[a.id] ?? 0) <= now &&
          now - (this._lastAttempt[a.id] ?? 0) >= intervalMs - 5_000,
      );
      await Promise.all(
        due.map(async (a) => {
          this._lastAttempt[a.id] = Date.now();
          const adapter = createClaudeAdapter({
            fetchUsageRaw: () => invoke<RawUsageResponse>("fetch_claude_usage", { accountId: a.id }),
          });
          const snap = await adapter.fetchUsage();
          this.snapshots[a.id] = reduceSnapshot(this.snapshots[a.id], snap);
          if (snap.error) {
            const streak = (this._errorStreak[a.id] ?? 0) + 1;
            this._errorStreak[a.id] = streak;
            const wait = snap.retryAfterMs ?? Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (streak - 1));
            this._nextAllowedAt[a.id] = Date.now() + wait;
          } else {
            this._errorStreak[a.id] = 0;
            this._nextAllowedAt[a.id] = 0;
          }
        }),
      );
      if (due.length) saveSnapshots(this.snapshots);
    },

    /**
     * Claude Code accounts as the switch alerts see them. An account with no
     * login can't take over, so it is never suggested or auto-switched to.
     */
    candidates(nowMs = Date.now()): AccountCandidate[] {
      return this.code.filter((a) => a.active || a.signedIn).map((a) => ({
        id: a.id,
        name: a.name,
        active: a.active,
        uuid: a.uuid,
        windows: this.snapshotFor(a, nowMs)?.windows,
      }));
    },

    async switchTo(id: string): Promise<string> {
      const msg = await invoke<string>("claude_account_switch", { id });
      this.message = msg;
      await this.refresh();
      return msg;
    },

    async add(kind: AccountKind, name: string, copySetup: boolean) {
      const acc = await invoke<{ id: string; kind: AccountKind; name: string }>("claude_account_add", {
        kind,
        name,
        copySetup,
      });
      await this.refresh();
      return acc;
    },

    async rename(id: string, name: string) {
      await invoke("claude_account_rename", { id, name });
      await this.refresh();
    },

    async remove(id: string) {
      this.message = await invoke<string>("claude_account_remove", { id });
      delete this.snapshots[id];
      saveSnapshots(this.snapshots);
      await this.refresh();
    },

    signIn: (id: string) => invoke("claude_account_sign_in", { id }),
    openTerminal: (id: string) => invoke("claude_account_terminal", { id }),
    openFolder: (id: string) => invoke("claude_account_open_folder", { id }),

    async dismissNotice() {
      await invoke("claude_account_dismiss_notice");
      this.notice = null;
    },
  },
});
