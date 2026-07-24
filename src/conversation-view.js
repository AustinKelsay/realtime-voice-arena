import { PERSONA_ROSTER } from "./persona-roster.js";
import { MAX_REPEAT_TEXT_CHARS, normalizeRepeatText } from "./repeat-contract.js";

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
  onRepeat,
  onStop,
}) {
  if (
    !app
    || typeof onPersonaChange !== "function"
    || typeof onStart !== "function"
    || typeof onRepeat !== "function"
    || typeof onStop !== "function"
  ) {
    throw new Error("Realtime arena view requires an app and conversation controls.");
  }

  const options = PERSONA_ROSTER.map((persona) => (
    `<option value="${escapeHtml(persona.id)}">${escapeHtml(persona.name)}</option>`
  )).join("");
  app.innerHTML = `<section class="shell"><header><div><p class="eyebrow">Spark · Pi Gateway</p><h1>PersonaPlex Realtime Arena</h1><p class="subtitle">Compare voices in conversation or ask one to repeat pasted text.</p></div><span id="status" class="status">ready</span></header><nav class="tabs" role="tablist" aria-label="Voice arena modes"><button id="conversation-tab" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="conversation-panel">Conversation</button><button id="repeat-tab" class="tab" type="button" role="tab" aria-selected="false" aria-controls="repeat-panel">Text repeat</button></nav><section id="conversation-panel" class="tab-panel" role="tabpanel" aria-labelledby="conversation-tab"><section class="persona-card"><label for="persona">Voice roster</label><select id="persona" name="persona">${options}</select><strong id="persona-summary"></strong><p id="persona-cue"></p></section><section class="session-card"><div class="orb-panel"><div id="orb" class="orb"><span id="orb-status">ready</span></div><div class="actions"><button id="start" class="primary">Start conversation</button><button id="stop" class="danger" disabled>Stop conversation</button></div><p class="hint">Microphone and response audio stay ephemeral. Session history records operational status only.</p></div><div id="metrics" class="metrics" hidden><div><small>Input</small><strong id="input-metric"></strong></div><div><small>Output</small><strong id="output-metric"></strong></div><div><small>Duration</small><strong id="duration-metric"></strong></div><div><small>Interruptions</small><strong id="interruptions-metric"></strong></div></div></section></section><section id="repeat-panel" class="tab-panel" role="tabpanel" aria-labelledby="repeat-tab" hidden><section class="repeat-card"><label for="repeat-persona">Voice roster</label><select id="repeat-persona" name="repeat-persona">${options}</select><label for="repeat-text">Paste text for the selected voice</label><textarea id="repeat-text" name="repeat-text" rows="8" placeholder="Type or paste up to ${MAX_REPEAT_TEXT_CHARS} characters…"></textarea><p id="repeat-validation" class="validation" role="alert" hidden></p><div class="actions"><button id="repeat-start" class="primary" type="button">Speak text</button><button id="repeat-stop" class="danger" type="button" disabled>Stop</button></div><p class="hint">PersonaPlex receives an ephemeral locally spoken repeat instruction. It can occasionally paraphrase, and BenchLocal does not save your pasted text.</p></section></section><p id="error" class="error" role="alert" hidden></p><footer><span>PersonaPlex 7B v1</span><span>24 kHz Ogg/Opus</span><span>Binary loopback relay</span></footer></section>`;

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
    conversationTab: required(app, "#conversation-tab"),
    repeatTab: required(app, "#repeat-tab"),
    conversationPanel: required(app, "#conversation-panel"),
    repeatPanel: required(app, "#repeat-panel"),
    repeatPersona: required(app, "#repeat-persona"),
    repeatText: required(app, "#repeat-text"),
    repeatStart: required(app, "#repeat-start"),
    repeatStop: required(app, "#repeat-stop"),
    repeatValidation: required(app, "#repeat-validation"),
  };

  let activeTab = "conversation";
  const selectTab = (tab) => {
    activeTab = tab;
    const repeat = tab === "repeat";
    elements.conversationPanel.hidden = repeat;
    elements.repeatPanel.hidden = !repeat;
    elements.conversationTab.classList?.toggle("active", !repeat);
    elements.repeatTab.classList?.toggle("active", repeat);
    elements.conversationTab.setAttribute?.("aria-selected", String(!repeat));
    elements.repeatTab.setAttribute?.("aria-selected", String(repeat));
  };

  elements.start.addEventListener("click", onStart);
  elements.stop.addEventListener("click", onStop);
  elements.persona.addEventListener("change", (event) => onPersonaChange(event.target.value));
  elements.repeatPersona.addEventListener("change", (event) => onPersonaChange(event.target.value));
  elements.conversationTab.addEventListener("click", () => selectTab("conversation"));
  elements.repeatTab.addEventListener("click", () => selectTab("repeat"));
  elements.repeatStart.addEventListener("click", () => {
    try {
      const text = normalizeRepeatText(elements.repeatText.value);
      elements.repeatValidation.hidden = true;
      onRepeat(text);
    } catch (error) {
      elements.repeatValidation.textContent = error.message;
      elements.repeatValidation.hidden = false;
    }
  });
  elements.repeatStop.addEventListener("click", onStop);

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
      elements.repeatPersona.value = persona.id;
      elements.repeatPersona.disabled = active || historyMode || finalizing;
      elements.personaSummary.textContent = persona.summary;
      elements.personaCue.textContent = `Try saying: “${persona.auditionCue}”`;
      elements.conversationTab.disabled = active || finalizing;
      elements.repeatTab.disabled = active || finalizing;
      elements.repeatStart.disabled = active || historyMode || finalizing;
      elements.repeatStop.disabled = !active || finalizing || session.status === "stopping";
      elements.repeatText.disabled = active || historyMode || finalizing;
      selectTab(activeTab);

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
