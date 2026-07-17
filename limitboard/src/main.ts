import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import WidgetApp from "./WidgetApp.vue";
import GhostApp from "./GhostApp.vue";
import type { ProviderId } from "./adapters/types";
import "./styles.css";

// Window label "widget-<providerId>" ⇒ this window is a floating provider
// widget. (Label, not query string — WebviewUrl::App encodes `?` and 404s.)
// "drag-ghost" ⇒ the transparent footprint preview that follows a drag.
const label = getCurrentWindow().label;
const widgetId = label.startsWith("widget-")
  ? label.slice("widget-".length)
  : null;

const app =
  label === "drag-ghost"
    ? createApp(GhostApp)
    : widgetId
      ? createApp(WidgetApp, { providerId: widgetId as ProviderId })
      : createApp(App);

app.use(createPinia()).mount("#app");
