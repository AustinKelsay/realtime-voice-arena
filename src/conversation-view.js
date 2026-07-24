import { PERSONA_ROSTER } from "./persona-roster.js";

const ACTIVE_STATUSES = new Set(["connecting", "live", "stopping"]);

function required(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Realtime arena view is missing ${selector}.`);
  return element;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Mount the conversation controls once, then update their properties in place.
 * Live audio counters change many times per second; preserving the button nodes
 * ensures a pointer press and release always target the same control.
 */
export function createConversationView({
  app,
  onPersonaChange,
  onStart,
  onStop,
}) {
  if (
    !app
    || typeof onPersonaChange !== "function"
    || typeof onStart !== "function"
    || typeof onStop !== "function"
  ) {
    throw new Error("Realtime arena view requires an app and conversation controls.");
  }

  const options = PERSONA_ROSTER.map((persona) => (
    `<option value="${escapeHtml(persona.id)}">${escapeHtml(persona.name)}</option>`
  )).join("");
  app.innerHTML = `<section class="shell"><header><div><p class="eyebrow">Spark · Pi Gateway</p><h1>PersonaPlex Realtime Arena</h1><p class="subtitle">One continuous conversation with native duplex audio.</p></div><span id="status" class="status">ready</span></header><section class="persona-card"><label for="persona">Voice roster</label><select id="persona" name="persona">${options}</select><strong id="persona-summary"></strong><p id="persona-cue"></p></section><section class="session-card"><div class="orb-panel"><div id="orb" class="orb"><span id="orb-status">ready</span></div><div class="actions"><button id="start" class="primary">Start conversation</button><button id="stop" class="danger" disabled>Stop conversation</button></div><p class="hint">Microphone and response audio stay ephemeral. Session history records operational status only.</p></div><div id="metrics" class="metrics" hidden><div><small>Input</small><strong id="input-metric"></strong></div><div><small>Output</small><strong id="output-metric"></strong></div><div><small>Duration</small><strong id="duration-metric"></strong></div><div><small>Interruptions</small><strong id="interruptions-metric"></strong></div></div></section><p id="error" class="error" role="alert" hidden></p><footer><span>PersonaPlex 7B v1</span><span>24 kHz Ogg/Opus</span><span>Binary loopback relay</span></footer></section>`;

  const elements = {
    status: required(app, "#status"),
    orb: required(app, "#orb"),
    orbStatus: required(app, "#orb-status"),
    start: required(app, "#start"),
    stop: required(app, "#stop"),
    persona: required(app, "#persona"),
    personaSummary: required(app, "#persona-summary"),
    personaCue: required(app, "#persona-cue"),
    metrics: required(app, "#metrics"),
    input: required(app, "#input-metric"),
    output: required(app, "#output-metric"),
    duration: required(app, "#duration-metric"),
    interruptions: required(app, "#interruptions-metric"),
    error: required(app, "#error"),
  };

  elements.start.addEventListener("click", onStart);
  elements.stop.addEventListener("click", onStop);
  elements.persona.addEventListener("change", (event) => onPersonaChange(event.target.value));

  return Object.freeze({
    render(snapshot) {
      const { session, historyMode, finalizing, personaId } = snapshot;
      const active = ACTIVE_STATUSES.has(session.status);
      const persona = PERSONA_ROSTER.find((entry) => entry.id === personaId) ?? PERSONA_ROSTER[0];
      elements.status.className = `status ${session.status}`;
      elements.status.textContent = session.status;
      elements.orb.className = session.status === "live" ? "orb live" : "orb";
      elements.orbStatus.textContent = session.status;
      elements.start.disabled = active || historyMode || finalizing;
      elements.stop.disabled = !active || finalizing || session.status === "stopping";
      elements.persona.value = persona.id;
      elements.persona.disabled = active || historyMode || finalizing;
      elements.personaSummary.textContent = persona.summary;
      elements.personaCue.textContent = `Try saying: “${persona.auditionCue}”`;

      const hasMetrics = session.startedAt != null;
      elements.metrics.hidden = !hasMetrics;
      if (hasMetrics) {
        elements.input.textContent = `${session.inputFrames} frames · ${session.inputBytes} B`;
        elements.output.textContent = `${session.outputFrames} frames · ${session.outputBytes} B`;
        elements.duration.textContent = session.endedAt == null
          ? "live"
          : `${Math.round((session.endedAt - session.startedAt) / 1_000)}s`;
        elements.interruptions.textContent = String(session.bargeIns);
      }

      elements.error.hidden = !session.error;
      elements.error.textContent = session.error || "";
    },
  });
}
