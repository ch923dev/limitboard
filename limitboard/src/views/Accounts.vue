<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { formatSuggestion, suggestAccount, worstPct } from "../alerts/switch";
import StatusPill from "../components/StatusPill.vue";
import Toggle from "../components/Toggle.vue";
import WindowMeter from "../components/WindowMeter.vue";
import { useAccountsStore, type AccountKind, type ClaudeAccount } from "../stores/accounts";
import { useProvidersStore } from "../stores/providers";
import { useSettingsStore } from "../stores/settings";
import type { StoredSnapshot } from "../stores/usage";
import { useUsageStore } from "../stores/usage";
import { statusColor } from "../theme";

const accounts = useAccountsStore();
const settings = useSettingsStore();
const providers = useProvidersStore();
const usage = useUsageStore();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
  void accounts.refresh();
});
onUnmounted(() => clearInterval(timer));

const claudeMonitored = computed(() => providers.enabledProviders.some((p) => p.id === "claude-code"));
const notifyPct = computed(() => settings.notifyPctFor("claude-code"));

const SECTIONS: { kind: AccountKind; title: string; hint: string }[] = [
  {
    kind: "code",
    title: "CLAUDE CODE — ACCOUNTS",
    hint: "Switching sets CLAUDE_CONFIG_DIR for your Windows user. New terminals use the account; sessions already open keep theirs.",
  },
  {
    kind: "desktop",
    title: "CLAUDE DESKTOP — ACCOUNTS",
    hint: "Switching closes Claude Desktop, swaps its saved login and opens it again.",
  },
];
const list = (kind: AccountKind) => (kind === "code" ? accounts.code : accounts.desktop);

// ── usage per account ───────────────────────────────────────
function snap(a: ClaudeAccount): StoredSnapshot | undefined {
  // The active Claude Code account is the board's "claude-code" provider.
  if (a.kind === "code" && a.active) return usage.snapshots["claude-code"] ?? accounts.snapshots[a.id];
  return accounts.snapshotFor(a, now.value);
}
const windows = (a: ClaudeAccount) => snap(a)?.windows ?? [];
const worst = (a: ClaudeAccount) => worstPct(windows(a), now.value);

function syncText(a: ClaudeAccount): string {
  const s = snap(a);
  if (!s) return "";
  const sec = Math.max(0, Math.floor((now.value - s.fetchedAt) / 1000));
  const age = sec < 90 ? `${sec}s` : sec < 5400 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`;
  return `sync ${age} ago`;
}

function who(a: ClaudeAccount): string {
  if (a.kind === "desktop") return a.email ?? a.detail ?? "";
  if (!a.signedIn) return "not signed in";
  return [a.email, a.plan].filter(Boolean).join(" · ");
}

function emptyText(a: ClaudeAccount): string {
  if (a.kind === "desktop") {
    return a.signedIn
      ? "no reading yet · shows once this Claude account is also signed in to Claude Code here"
      : "no usage until this account is signed in";
  }
  if (!a.signedIn) return "not signed in · SIGN IN opens a terminal";
  const err = snap(a)?.error;
  if (err) return err;
  if (a.loginExpired && !a.active) return "login expired · use this account in Claude Code once to refresh";
  if (!claudeMonitored.value) return "enable Claude Code in Settings to poll usage";
  return "awaiting first poll…";
}

// ── "time to switch" banner ─────────────────────────────────
const advice = computed(() => {
  const active = accounts.activeCode;
  if (!active || accounts.code.length < 2) return null;
  const w = worst(active);
  if (w == null || w < notifyPct.value) return null;
  const cands = accounts.candidates(now.value).map((c) => (c.active ? { ...c, windows: windows(active) } : c));
  const from = cands.find((c) => c.active)!;
  const suggestion = suggestAccount(cands, from, notifyPct.value, settings.switchPct, now.value);
  return { name: active.name, pct: w, critical: w >= settings.switchPct, suggestion };
});

// ── actions ─────────────────────────────────────────────────
const busy = ref<string | null>(null);
const error = ref<string | null>(null);

async function act(id: string, fn: () => Promise<unknown>) {
  busy.value = id;
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = null;
  }
}

type Confirm = { kind: "desktop" | "remove"; id: string };
const confirm = ref<Confirm | null>(null);
const confirmAccount = computed(() => (confirm.value ? accounts.byId(confirm.value.id) : undefined));

// Tray clicks on a Claude Desktop account land here for confirmation.
watch(
  () => accounts.confirmDesktopId,
  (id) => {
    if (!id) return;
    confirm.value = { kind: "desktop", id };
    accounts.confirmDesktopId = null;
  },
  { immediate: true },
);

function switchTo(a: ClaudeAccount | undefined) {
  if (!a || a.active) return;
  if (a.kind === "desktop") confirm.value = { kind: "desktop", id: a.id };
  else void act(a.id, () => accounts.switchTo(a.id));
}

function confirmYes() {
  const c = confirm.value;
  confirm.value = null;
  if (!c) return;
  if (c.kind === "desktop") void act(c.id, () => accounts.switchTo(c.id));
  else void act(c.id, () => accounts.remove(c.id));
}

const adding = ref<AccountKind | null>(null);
const newName = ref("");
const copySetup = ref(true);

function startAdd(kind: AccountKind) {
  adding.value = kind;
  newName.value = "";
  copySetup.value = true;
  error.value = null;
}

async function submitAdd() {
  const kind = adding.value;
  const name = newName.value.trim();
  if (!kind || !name) return;
  await act("new", async () => {
    const acc = await accounts.add(kind, name, copySetup.value);
    adding.value = null;
    if (kind === "code") accounts.message = `Added ${acc.name}. Finish signing in in the terminal that opened.`;
    else confirm.value = { kind: "desktop", id: acc.id };
  });
}

const renaming = ref<string | null>(null);
const renameValue = ref("");
function startRename(a: ClaudeAccount) {
  renaming.value = a.id;
  renameValue.value = a.name;
}
async function saveRename(a: ClaudeAccount) {
  const name = renameValue.value.trim();
  renaming.value = null;
  if (name && name !== a.name) await act(a.id, () => accounts.rename(a.id, name));
}
</script>

<template>
  <div class="accounts">
    <div v-if="advice" class="banner" :class="advice.critical ? 'crit' : 'warn'" role="alert">
      <span>
        {{ advice.critical ? "TIME TO SWITCH" : "HEADS-UP" }} · {{ advice.name }} AT
        {{ Math.round(advice.pct) }}% — {{ formatSuggestion(advice.suggestion) }}
      </span>
      <button
        v-if="advice.suggestion"
        class="btn primary"
        :disabled="busy !== null"
        @click="switchTo(accounts.byId(advice.suggestion.id))"
      >
        SWITCH TO {{ advice.suggestion.name.toUpperCase() }}
      </button>
    </div>

    <div v-if="accounts.notice" class="banner">
      <span>{{ accounts.notice }}</span>
      <button class="btn" @click="accounts.dismissNotice()">DISMISS</button>
    </div>

    <div v-if="error || accounts.message" class="status-line" :class="{ err: !!error }" role="status">
      {{ error ?? accounts.message }}
    </div>

    <section v-for="s in SECTIONS" :key="s.kind" class="section">
      <div class="head-row">
        <div>
          <div class="kicker">{{ s.title }}</div>
          <div class="hint">{{ s.hint }}</div>
        </div>
        <button class="btn" @click="startAdd(s.kind)">+ ADD ACCOUNT</button>
      </div>

      <form v-if="adding === s.kind" class="add-row" @submit.prevent="submitAdd">
        <input
          v-model="newName"
          class="field name-field"
          maxlength="40"
          placeholder="name — e.g. Work"
          spellcheck="false"
          autofocus
        />
        <label v-if="s.kind === 'code'" class="inline-toggle" title="Copies settings, CLAUDE.md and MCP servers; shares skills, agents, commands and plugins with Main">
          COPY MAIN SETUP
          <Toggle :on="copySetup" @toggle="copySetup = !copySetup" />
        </label>
        <button class="btn primary" type="submit" :disabled="!newName.trim() || busy === 'new'">
          {{ s.kind === "code" ? "ADD + SIGN IN" : "ADD" }}
        </button>
        <button class="btn" type="button" @click="adding = null">CANCEL</button>
      </form>

      <div class="grid">
        <div
          v-for="a in list(s.kind)"
          :key="a.id"
          class="card"
          :class="{ active: a.active, degraded: !!snap(a)?.error }"
        >
          <div class="head">
            <div class="identity">
              <span class="glyph" :style="{ color: worst(a) != null ? statusColor(worst(a)!) : 'var(--lb-faint)' }">◆</span>
              <div class="who">
                <div class="name">
                  <input
                    v-if="renaming === a.id"
                    v-model="renameValue"
                    class="field rename-field"
                    maxlength="40"
                    @keydown.enter="saveRename(a)"
                    @keydown.esc="renaming = null"
                    @blur="saveRename(a)"
                  />
                  <template v-else>{{ a.name }}</template>
                  <span v-if="a.active" class="in-use">IN USE</span>
                </div>
                <div class="plan">{{ who(a) }}</div>
              </div>
            </div>
            <StatusPill v-if="worst(a) != null" :pct="worst(a)!" />
          </div>

          <WindowMeter v-for="(w, i) in windows(a)" :key="i" :w="w" />
          <div v-if="!windows(a).length" class="nodata">{{ emptyText(a) }}</div>

          <div class="foot">
            <span class="method" :title="a.folder">{{ a.folder }}</span>
            <span :class="{ warn: !!snap(a)?.error }" :title="snap(a)?.error">
              {{ snap(a)?.error ? "stale · " : "" }}{{ syncText(a) }}
            </span>
          </div>
          <div class="actions">
            <button
              v-if="!a.active"
              class="btn primary"
              :disabled="busy !== null || (a.kind === 'desktop' && accounts.switching)"
              @click="switchTo(a)"
            >
              {{ a.kind === "desktop" && accounts.switching ? "SWITCHING…" : "SWITCH" }}
            </button>
            <button v-if="a.kind === 'code'" class="btn" @click="act(a.id, () => accounts.signIn(a.id))">
              {{ a.signedIn ? "RE-LOGIN" : "SIGN IN" }}
            </button>
            <button v-if="a.kind === 'code'" class="btn" title="New terminal using this account" @click="act(a.id, () => accounts.openTerminal(a.id))">
              TERMINAL
            </button>
            <button class="btn" @click="startRename(a)">RENAME</button>
            <button class="btn" @click="act(a.id, () => accounts.openFolder(a.id))">FOLDER</button>
            <button v-if="!a.isDefault" class="btn danger" @click="confirm = { kind: 'remove', id: a.id }">REMOVE</button>
          </div>
        </div>
      </div>
    </section>

    <div v-if="confirm && confirmAccount" class="scrim" @click.self="confirm = null">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div id="confirm-title" class="kicker">
          {{ confirm.kind === "desktop" ? `SWITCH CLAUDE DESKTOP TO ${confirmAccount.name.toUpperCase()}` : `REMOVE ${confirmAccount.name.toUpperCase()}` }}
        </div>
        <template v-if="confirm.kind === 'desktop'">
          <p>
            {{
              confirmAccount.signedIn
                ? `Claude Desktop closes and opens again signed in as ${confirmAccount.name}.`
                : `Claude Desktop closes and opens again signed out. Sign in with your ${confirmAccount.name} account.`
            }}
          </p>
          <p>Anything running in Claude Desktop stops, including chats in its Code tab.</p>
        </template>
        <p v-else>
          It's taken off the list and its folder moves to .limitboard\removed. Nothing is deleted.
        </p>
        <div class="dialog-actions">
          <button class="btn" @click="confirm = null">CANCEL</button>
          <button class="btn" :class="confirm.kind === 'remove' ? 'danger' : 'primary'" @click="confirmYes">
            {{ confirm.kind === "desktop" ? "RESTART CLAUDE DESKTOP" : "REMOVE" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.accounts {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.kicker {
  margin-bottom: 6px;
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--lb-muted);
}

.hint {
  font-size: 13px;
  color: var(--lb-muted);
}

.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  border: 1px solid var(--lb-panel-edge);
  background: var(--lb-panel);
  border-radius: 6px;
  font-family: var(--lb-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--lb-muted);
}

.banner.warn {
  border-color: color-mix(in srgb, var(--lb-warn) 40%, transparent);
  background: color-mix(in srgb, var(--lb-warn) 10%, transparent);
  color: var(--lb-warn);
}

.banner.crit {
  border-color: color-mix(in srgb, var(--lb-crit) 45%, transparent);
  background: color-mix(in srgb, var(--lb-crit) 12%, transparent);
  color: var(--lb-crit);
}

.status-line {
  font-family: var(--lb-mono);
  font-size: 11px;
  color: var(--lb-ok);
}

.status-line.err {
  color: var(--lb-crit);
}

.btn {
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid var(--lb-faint);
  background: var(--lb-panel);
  color: var(--lb-ink);
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  border-color: var(--lb-muted);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn.primary {
  border-color: color-mix(in srgb, var(--lb-ok) 55%, transparent);
  color: var(--lb-ok);
}

.btn.danger {
  border-color: color-mix(in srgb, var(--lb-crit) 50%, transparent);
  color: var(--lb-crit);
}

.field {
  font-family: var(--lb-mono);
  font-size: 12px;
  background: var(--lb-bg);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 4px;
  color: var(--lb-ink);
  padding: 6px 10px;
  outline: none;
  user-select: text;
}

.field:focus {
  border-color: var(--lb-muted);
}

.add-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 12px 16px;
}

.name-field {
  flex: 1;
  min-width: 180px;
}

.inline-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--lb-muted);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 18px;
}

.card {
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 18px 20px 12px;
  display: flex;
  flex-direction: column;
}

.card.active {
  border-color: color-mix(in srgb, var(--lb-ok) 45%, var(--lb-panel-edge));
}

.card.degraded {
  border-style: dashed;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.who {
  min-width: 0;
}

.glyph {
  font-size: 14px;
}

.name {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
}

.rename-field {
  width: 160px;
  font-size: 13px;
}

.in-use {
  font-family: var(--lb-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  font-weight: 400;
  color: var(--lb-ok);
  border: 1px solid color-mix(in srgb, var(--lb-ok) 35%, transparent);
  background: color-mix(in srgb, var(--lb-ok) 10%, transparent);
  padding: 2px 7px;
  border-radius: 3px;
}

.plan {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nodata {
  padding: 22px 0;
  border-top: 1px solid var(--lb-panel-edge);
  font-family: var(--lb-mono);
  font-size: 11px;
  color: var(--lb-muted);
  text-align: center;
}

.foot {
  border-top: 1px solid var(--lb-panel-edge);
  margin-top: auto;
  padding: 10px 0 8px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--lb-mono);
  font-size: 9px;
  color: var(--lb-faint);
  letter-spacing: 0.04em;
}

.foot .warn {
  color: var(--lb-warn);
}

.method {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(5, 8, 10, 0.6);
}

.dialog {
  width: min(460px, calc(100vw - 32px));
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 18px 20px;
}

.dialog p {
  font-size: 13px;
  color: var(--lb-muted);
  margin: 8px 0 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
