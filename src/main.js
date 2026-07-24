import { createBenchLocalClient } from "@benchlocal/web-sdk";
import Recorder from "opus-recorder";
import encoderPath from "opus-recorder/dist/encoderWorker.min.js?url";

import { createBrowserPlatform } from "./browser-platform.js";
import { createConversationRuntime } from "./conversation-runtime.js";
import { createConversationView } from "./conversation-view.js";
import "./styles.css";

const benchlocal = createBenchLocalClient({ requestTimeoutMs: 2_000 });
const app = document.querySelector("#app");
let renderPending = false;
let snapshot;
let view;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

const runtime = createConversationRuntime({
  benchlocal,
  platform: createBrowserPlatform({ RecorderClass: Recorder, encoderPath }),
  onStateChange(next) {
    snapshot = next;
    scheduleRender();
  },
});
snapshot = runtime.getState();

function render() {
  view?.render(snapshot);
}

async function initialize() {
  const environment = await benchlocal.environment.detect({ timeoutMs: 800 });
  if (!environment.isInsideBenchLocal) {
    app.innerHTML = `<section class="standalone"><h1>Open this pack inside BenchLocal</h1><p>Install <code>http://127.0.0.1:5177/benchlocal.pack.json</code> after starting the local relay.</p></section>`;
    return;
  }

  view = createConversationView({
    app,
    onPersonaChange: runtime.selectPersona,
    onStart: () => { void runtime.start().catch(() => {}); },
    onStop: () => { void runtime.stop("user_stop").catch(() => {}); },
  });
  const capabilities = await benchlocal.capabilities();
  if (capabilities.history?.mode === "history") {
    const history = await benchlocal.history.load();
    runtime.restoreHistory(history.payload?.metadata || {});
  }
  benchlocal.runs.onStopRequested(() => runtime.stop("user_stop").catch(() => {}));
  render();
  window.realtimeVoiceArena = Object.freeze({
    start: runtime.start,
    stop: runtime.stop,
    getState: runtime.getState,
  });
}

initialize().catch((error) => {
  app.innerHTML = `<section class="standalone"><h1>Could not open the pack</h1><p>${escapeHtml(error.message)}</p></section>`;
});
