import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import WidgetApp from "./WidgetApp.vue";
import type { ProviderId } from "./adapters/types";
import "./styles.css";

// Window label "widget-<providerId>" ⇒ this window is a floating provider
// widget. (Label, not query string — WebviewUrl::App encodes `?` and 404s.)
const label = getCurrentWindow().label;
const widgetId = label.startsWith("widget-")
  ? label.slice("widget-".length)
  : null;

const app = widgetId
  ? createApp(WidgetApp, { providerId: widgetId as ProviderId })
  : createApp(App);

app.use(createPinia()).mount("#app");
