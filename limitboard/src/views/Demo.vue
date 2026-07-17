<script setup lang="ts">
// Storybook-style demo: all static components rendered with the mockup's
// sample data (T5 verify — pixel-parity with lightboard-design.jsx).
import { ref } from "vue";
import type { UsageWindow } from "../adapters/types";
import Countdown from "../components/Countdown.vue";
import Gauge from "../components/Gauge.vue";
import ProviderCard from "../components/ProviderCard.vue";
import StatusPill from "../components/StatusPill.vue";
import Toggle from "../components/Toggle.vue";
import WindowMeter from "../components/WindowMeter.vue";

const hoursFromNow = (h: number) =>
  new Date(Date.now() + h * 3600 * 1000).toISOString();

interface DemoProvider {
  id: string;
  name: string;
  plan: string;
  glyph: string;
  method: string;
  stat?: string;
  error?: string;
  windows: UsageWindow[];
}

const providers: DemoProvider[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    plan: "Max 5×",
    glyph: "◆",
    method: "OAuth · api.anthropic.com/api/oauth/usage",
    windows: [
      { label: "Session", sub: "5h rolling", usedPct: 62, resetsAt: hoursFromNow(2.4) },
      { label: "Weekly", sub: "all models", usedPct: 41, resetsAt: hoursFromNow(52) },
      { label: "Weekly", sub: "Opus only", usedPct: 18, resetsAt: hoursFromNow(52) },
    ],
  },
  {
    id: "codex",
    name: "Codex CLI",
    plan: "ChatGPT Pro",
    glyph: "▲",
    method: "OAuth · /backend-api/codex/usage",
    windows: [
      { label: "Primary", sub: "5h rolling", usedPct: 35, resetsAt: hoursFromNow(3.7) },
      { label: "Secondary", sub: "7d window", usedPct: 58, resetsAt: hoursFromNow(96) },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    plan: "Pro",
    glyph: "●",
    method: "Dashboard API · monthly requests",
    windows: [
      { label: "Requests", sub: "monthly pool", usedPct: 84, resetsAt: hoursFromNow(310) },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    plan: "Pay-as-you-go",
    glyph: "◇",
    method: "Documented API · /api/v1/key + /credits",
    stat: "balance $21.25",
    windows: [
      { label: "Today", sub: "UTC day", amountUsd: 1.84, resetsAt: hoursFromNow(9) },
      { label: "This week", sub: "resets Mon UTC", amountUsd: 12.4, resetsAt: hoursFromNow(81) },
      { label: "This month", sub: "vs soft cap", amountUsd: 38.75, capUsd: 60, resetsAt: hoursFromNow(310) },
    ],
  },
  {
    id: "degraded-sample",
    name: "Degraded sample",
    plan: "stale data",
    glyph: "■",
    method: "poll failed · last-good shown",
    error: "network unreachable",
    windows: [
      { label: "Premium", sub: "monthly pool", usedPct: 12, resetsAt: hoursFromNow(310) },
    ],
  },
];

const toggleOn = ref(true);
</script>

<template>
  <div class="demo">
    <section>
      <div class="kicker">PROVIDER CARDS</div>
      <div class="grid">
        <ProviderCard
          v-for="p in providers"
          :key="p.id"
          :name="p.name"
          :plan="p.plan"
          :glyph="p.glyph"
          :method="p.method"
          :windows="p.windows"
          :stat="p.stat"
          :error="p.error"
          :sync-age="4"
        />
      </div>
    </section>

    <section>
      <div class="kicker">PIECES</div>
      <div class="pieces">
        <div class="piece">
          <span class="piece-label">StatusPill</span>
          <StatusPill :pct="20" /> <StatusPill :pct="65" /> <StatusPill :pct="91" />
        </div>
        <div class="piece">
          <span class="piece-label">Toggle</span>
          <Toggle :on="toggleOn" @toggle="toggleOn = !toggleOn" />
          <Toggle :on="false" disabled />
        </div>
        <div class="piece">
          <span class="piece-label">Countdown</span>
          <span class="mono"><Countdown :target="hoursFromNow(1.5)" /></span>
          <span class="mono"><Countdown :target="hoursFromNow(52)" /></span>
        </div>
        <div class="piece stack">
          <span class="piece-label">Gauge 15 / 65 / 92</span>
          <Gauge :pct="15" />
          <Gauge :pct="65" />
          <Gauge :pct="92" />
        </div>
        <div class="piece stack">
          <span class="piece-label">WindowMeter</span>
          <WindowMeter
            :w="{ label: 'Session', sub: '5h rolling', usedPct: 72, resetsAt: hoursFromNow(2) }"
          />
          <WindowMeter :w="{ label: 'Today', sub: 'UTC day', amountUsd: 3.21 }" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.demo {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.kicker {
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--lb-muted);
  margin-bottom: 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 18px;
}

.pieces {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}

.piece {
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.piece.stack {
  flex-direction: column;
  align-items: stretch;
  min-width: 340px;
}

.piece-label {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-faint);
  letter-spacing: 0.1em;
}

.mono {
  font-family: var(--lb-mono);
  font-size: 13px;
  color: var(--lb-ink);
}
</style>
