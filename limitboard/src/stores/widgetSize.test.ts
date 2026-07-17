import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadWidgetSize,
  saveWidgetSize,
  WIDGET_DEFAULT,
  WIDGET_MIN,
} from "./widgetSize";

// Node test env has no localStorage — provide a minimal in-memory shim.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("widget size persistence", () => {
  it("defaults when nothing saved", () => {
    expect(loadWidgetSize("claude-code")).toEqual(WIDGET_DEFAULT);
  });

  it("round-trips a saved size per provider", () => {
    saveWidgetSize("claude-code", { w: 520, h: 410.6 });
    expect(loadWidgetSize("claude-code")).toEqual({ w: 520, h: 411 });
    expect(loadWidgetSize("codex")).toEqual(WIDGET_DEFAULT);
  });

  it("clamps below-minimum saved sizes", () => {
    saveWidgetSize("codex", { w: 10, h: 10 });
    expect(loadWidgetSize("codex")).toEqual(WIDGET_MIN);
  });

  it("survives corrupt storage", () => {
    store.set("limitboard.widgetSizes", "{not json");
    expect(loadWidgetSize("claude-code")).toEqual(WIDGET_DEFAULT);
  });
});
