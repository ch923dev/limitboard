import { defineStore } from "pinia";
import type { ProviderAdapter, ProviderId, UsageSnapshot } from "../adapters/types";

/** Snapshot as stored: error polls keep last-good windows (FR-3 degrade rule). */
export interface StoredSnapshot {
  providerId: ProviderId;
  windows: UsageSnapshot["windows"];
  stat?: string;
  /** Timestamp of the last-good data currently shown. */
  fetchedAt: number;
  /** Set ⇒ card degraded; data is stale from fetchedAt. */
  error?: string;
}

/**
 * Pure reducer — merge an incoming snapshot with the previous one.
 * Failed poll (snapshot.error set) keeps the previous windows/stat/fetchedAt
 * so the card degrades to stale-with-age instead of blanking.
 */
export function reduceSnapshot(
  prev: StoredSnapshot | undefined,
  next: UsageSnapshot,
): StoredSnapshot {
  if (next.error) {
    return prev
      ? { ...prev, error: next.error }
      : {
          providerId: next.providerId,
          windows: [],
          fetchedAt: next.fetchedAt,
          error: next.error,
        };
  }
  return {
    providerId: next.providerId,
    windows: next.windows,
    stat: next.stat,
    fetchedAt: next.fetchedAt,
  };
}

/** Error backoff: base 2min doubling per consecutive failure, 15min cap; 429s start at 5min. */
const BACKOFF_BASE_MS = 120_000;
const BACKOFF_RATE_LIMIT_MS = 300_000;
const BACKOFF_CAP_MS = 900_000;
/**
 * A server-sent Retry-After overrides the formula — retrying before the
 * server's penalty expires restarts it (api.anthropic.com sends ~47min).
 * Buffer past the stated time; sanity-cap in case of a bogus header.
 */
const RETRY_AFTER_BUFFER_MS = 60_000;
const RETRY_AFTER_CAP_MS = 7_200_000;

// Cooldowns survive app restarts (dev reloads especially) so a rate-limited
// endpoint isn't re-hit by every fresh launch.
const COOLDOWN_KEY = "limitboard.cooldowns";
// Snapshots + last-attempt shared via localStorage: the main window and any
// widget windows are separate webviews with separate stores, but the same
// origin — sharing stops them double-polling every provider.
const SNAPSHOT_KEY = "limitboard.snapshots";
const ATTEMPT_KEY = "limitboard.lastAttempt";

function loadCooldowns(): Partial<Record<ProviderId, number>> {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<ProviderId, number>>;
    // Drop expired entries.
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, until]) => (until ?? 0) > now),
    ) as Partial<Record<ProviderId, number>>;
  } catch {
    return {};
  }
}

function saveCooldowns(map: Partial<Record<ProviderId, number>>) {
  try {
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — cooldowns stay in-memory only
  }
}

function loadSnapshots(): Partial<Record<ProviderId, StoredSnapshot>> {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "{}") as Partial<
      Record<ProviderId, StoredSnapshot>
    >;
  } catch {
    return {};
  }
}

/** Merge one provider's snapshot into the shared map (never clobber others'). */
function saveSnapshot(snap: StoredSnapshot) {
  try {
    const map = loadSnapshots();
    map[snap.providerId] = snap;
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — snapshots stay in-memory only
  }
}

function loadAttempts(): Partial<Record<ProviderId, number>> {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? "{}") as Partial<
      Record<ProviderId, number>
    >;
  } catch {
    return {};
  }
}

function saveAttempts(map: Partial<Record<ProviderId, number>>) {
  try {
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — no cross-window dedupe
  }
}

export const useUsageStore = defineStore("usage", {
  state: () => ({
    // Seed from the shared store: instant last-known data on launch and in
    // fresh widget windows (degrades as stale rather than blank).
    snapshots: loadSnapshots(),
    polling: false,
    lastPollAt: 0 as number,
    intervalMs: 60_000,
    _timer: undefined as ReturnType<typeof setInterval> | undefined,
    _errorStreak: {} as Partial<Record<ProviderId, number>>,
    _nextAllowedAt: loadCooldowns(),
    _syncAttached: false,
  }),

  getters: {
    /** Seconds since a provider's last-good data; null if never fetched. */
    stalenessSec: (state) => (id: ProviderId) => {
      const s = state.snapshots[id];
      return s ? Math.max(0, Math.floor((Date.now() - s.fetchedAt) / 1000)) : null;
    },
  },

  actions: {
    reduce(next: UsageSnapshot) {
      const stored = reduceSnapshot(this.snapshots[next.providerId], next);
      this.snapshots[next.providerId] = stored;
      saveSnapshot(stored);
      // Backoff bookkeeping: errors push the provider into a cooldown so a
      // rate-limited endpoint (429) isn't hammered every interval.
      if (next.error) {
        const streak = (this._errorStreak[next.providerId] ?? 0) + 1;
        this._errorStreak[next.providerId] = streak;
        const base = /429|rate.?limit/i.test(next.error)
          ? BACKOFF_RATE_LIMIT_MS
          : BACKOFF_BASE_MS;
        const formula = Math.min(BACKOFF_CAP_MS, base * 2 ** (streak - 1));
        const wait =
          next.retryAfterMs != null
            ? Math.min(RETRY_AFTER_CAP_MS, next.retryAfterMs + RETRY_AFTER_BUFFER_MS)
            : formula;
        this._nextAllowedAt[next.providerId] = Date.now() + wait;
      } else {
        this._errorStreak[next.providerId] = 0;
        this._nextAllowedAt[next.providerId] = 0;
      }
      saveCooldowns(this._nextAllowedAt);
    },

    async pollOnce(adapters: ProviderAdapter[]) {
      this.lastPollAt = Date.now();
      const attempts = loadAttempts();
      const due = adapters.filter((a) => {
        if ((this._nextAllowedAt[a.id] ?? 0) > Date.now()) return false;
        // Cross-window dedupe: if another window (main vs widget) polled this
        // provider within the interval, skip — its result arrives via the
        // storage sync instead of a duplicate request.
        return Date.now() - (attempts[a.id] ?? 0) >= this.intervalMs - 5_000;
      });
      due.forEach((a) => (attempts[a.id] = Date.now()));
      if (due.length) saveAttempts(attempts);
      await Promise.all(
        due.map(async (a) => {
          try {
            this.reduce(await a.fetchUsage());
          } catch (e) {
            // Adapters shouldn't throw, but a bug must not kill the loop.
            this.reduce({
              providerId: a.id,
              windows: [],
              fetchedAt: Date.now(),
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }),
      );
    },

    /** Live-sync snapshots/cooldowns written by other windows (storage events
     *  only fire in windows that did NOT do the write). */
    attachCrossWindowSync() {
      if (this._syncAttached || typeof window === "undefined") return;
      this._syncAttached = true;
      window.addEventListener("storage", (e) => {
        if (e.key === SNAPSHOT_KEY) {
          const incoming = loadSnapshots();
          for (const snap of Object.values(incoming)) {
            if (snap) this.snapshots[snap.providerId] = snap;
          }
        } else if (e.key === COOLDOWN_KEY) {
          this._nextAllowedAt = loadCooldowns();
        }
      });
    },

    startPolling(getAdapters: () => ProviderAdapter[], intervalMs?: number) {
      this.stopPolling();
      this.attachCrossWindowSync();
      if (intervalMs) this.intervalMs = intervalMs;
      this.polling = true;
      void this.pollOnce(getAdapters());
      this._timer = setInterval(
        () => void this.pollOnce(getAdapters()),
        this.intervalMs,
      );
    },

    stopPolling() {
      if (this._timer) clearInterval(this._timer);
      this._timer = undefined;
      this.polling = false;
    },
  },
});
