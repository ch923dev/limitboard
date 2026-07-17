// Per-provider widget window size, persisted so a resized widget reopens at
// the same size and the drag-out ghost previews the real footprint.
import type { ProviderId } from "../adapters/types";

export interface WidgetSize {
  w: number;
  h: number;
}

export const WIDGET_DEFAULT: WidgetSize = { w: 400, h: 340 };
/** Must match min_inner_size in src-tauri/src/widgets.rs. */
export const WIDGET_MIN: WidgetSize = { w: 320, h: 200 };

const KEY = "limitboard.widgetSizes";

type SizeMap = Partial<Record<ProviderId, WidgetSize>>;

export function loadWidgetSize(id: ProviderId): WidgetSize {
  try {
    const map = JSON.parse(localStorage.getItem(KEY) ?? "{}") as SizeMap;
    const s = map[id];
    if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) {
      return {
        w: Math.max(WIDGET_MIN.w, Math.round(s.w)),
        h: Math.max(WIDGET_MIN.h, Math.round(s.h)),
      };
    }
  } catch {
    // storage unavailable / corrupt — fall through to default
  }
  return { ...WIDGET_DEFAULT };
}

export function saveWidgetSize(id: ProviderId, size: WidgetSize) {
  try {
    const map = JSON.parse(localStorage.getItem(KEY) ?? "{}") as SizeMap;
    map[id] = { w: Math.round(size.w), h: Math.round(size.h) };
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — size just won't persist
  }
}
