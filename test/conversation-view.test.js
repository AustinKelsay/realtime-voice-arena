import test from "node:test";
import assert from "node:assert/strict";

import { createConversationView } from "../src/conversation-view.js";
import { DEFAULT_PERSONA_ID, PERSONA_ROSTER } from "../src/persona-roster.js";

class FakeElement {
  constructor() {
    this.className = "";
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get("click")?.();
  }

  change(value) {
    this.value = value;
    this.listeners.get("change")?.({ target: this });
  }
}

class FakeApp {
  constructor() {
    this.elements = new Map([
      ["#status", new FakeElement()],
      ["#orb", new FakeElement()],
      ["#orb-status", new FakeElement()],
      ["#start", new FakeElement()],
      ["#stop", new FakeElement()],
      ["#persona", new FakeElement()],
      ["#persona-summary", new FakeElement()],
      ["#persona-cue", new FakeElement()],
      ["#metrics", new FakeElement()],
      ["#input-metric", new FakeElement()],
      ["#output-metric", new FakeElement()],
      ["#duration-metric", new FakeElement()],
      ["#interruptions-metric", new FakeElement()],
      ["#error", new FakeElement()],
      ["#conversation-tab", new FakeElement()],
      ["#repeat-tab", new FakeElement()],
      ["#conversation-panel", new FakeElement()],
      ["#repeat-panel", new FakeElement()],
      ["#repeat-persona", new FakeElement()],
      ["#repeat-text", new FakeElement()],
      ["#repeat-start", new FakeElement()],
      ["#repeat-stop", new FakeElement()],
      ["#repeat-validation", new FakeElement()],
    ]);
    this.htmlWrites = 0;
  }

  set innerHTML(value) {
    this.htmlWrites += 1;
    this.html = value;
  }

  querySelector(selector) {
    return this.elements.get(selector) ?? null;
  }
}

function snapshot(overrides = {}) {
  return {
    historyMode: false,
    finalizing: false,
    session: {
      status: "live",
      startedAt: 0,
      endedAt: null,
      inputFrames: 1,
      inputBytes: 2,
      outputFrames: 3,
      outputBytes: 4,
      bargeIns: 0,
      error: null,
      ...overrides,
    },
  };
}

test("live counter updates preserve the stop control and its listener", () => {
  const app = new FakeApp();
  let stops = 0;
  const view = createConversationView({
    app,
    onPersonaChange() {},
    onStart() {},
    onRepeat() {},
    onStop() { stops += 1; },
  });
  const stop = app.querySelector("#stop");

  view.render(snapshot({ status: "ready", startedAt: null }));
  assert.equal(app.querySelector("#metrics").hidden, true);
  assert.equal(app.querySelector("#error").hidden, true);
  view.render(snapshot());
  view.render(snapshot({ inputFrames: 200, outputFrames: 100 }));

  assert.equal(app.htmlWrites, 1, "the view must mount once instead of replacing live controls");
  assert.equal(app.querySelector("#stop"), stop);
  assert.equal(stop.disabled, false);
  assert.equal(app.querySelector("#input-metric").textContent, "200 frames · 2 B");
  stop.click();
  assert.equal(stops, 1);
});

test("operator can choose one of twelve default personas before a conversation", () => {
  const app = new FakeApp();
  const selected = [];
  const view = createConversationView({
    app,
    onPersonaChange(personaId) { selected.push(personaId); },
    onStart() {},
    onRepeat() {},
    onStop() {},
  });

  assert.equal(PERSONA_ROSTER.length, 12);
  assert.match(app.html, /Sora Bennett/);
  assert.match(app.html, /Otis Blake/);
  view.render({ ...snapshot({ status: "ready", startedAt: null }), personaId: DEFAULT_PERSONA_ID });
  assert.equal(app.querySelector("#persona").value, DEFAULT_PERSONA_ID);
  assert.equal(app.querySelector("#persona").disabled, false);
  assert.match(app.querySelector("#persona-summary").textContent, /warm and composed/i);
  assert.match(app.querySelector("#persona-cue").textContent, /Introduce yourself/i);

  app.querySelector("#persona").change("mira-vale");
  assert.deepEqual(selected, ["mira-vale"]);
  view.render({ ...snapshot(), personaId: "mira-vale" });
  assert.equal(app.querySelector("#persona").disabled, true);
  assert.match(app.querySelector("#persona-summary").textContent, /clear and curious/i);
});

test("operator can select a voice and submit pasted text from a second tab", () => {
  const app = new FakeApp();
  const selected = [];
  const repeated = [];
  const view = createConversationView({
    app,
    onPersonaChange(personaId) { selected.push(personaId); },
    onStart() {},
    onRepeat(text) { repeated.push(text); },
    onStop() {},
  });

  assert.match(app.html, /Conversation/);
  assert.match(app.html, /Text repeat/);
  assert.match(app.html, /Paste text for the selected voice/i);

  app.querySelector("#repeat-tab").click();
  assert.equal(app.querySelector("#conversation-panel").hidden, true);
  assert.equal(app.querySelector("#repeat-panel").hidden, false);

  app.querySelector("#repeat-persona").change("otis-blake");
  assert.deepEqual(selected, ["otis-blake"]);

  app.querySelector("#repeat-text").value = "  The quick brown fox.  ";
  app.querySelector("#repeat-start").click();
  assert.deepEqual(repeated, ["The quick brown fox."]);

  app.querySelector("#repeat-text").value = "😀".repeat(800);
  app.querySelector("#repeat-start").click();
  assert.equal(repeated.at(-1), "😀".repeat(800));
  app.querySelector("#repeat-text").value = "😀".repeat(801);
  app.querySelector("#repeat-start").click();
  assert.equal(repeated.length, 2);
  assert.match(app.querySelector("#repeat-validation").textContent, /800 characters/);

  view.render({ ...snapshot({ status: "ready", startedAt: null }), personaId: "otis-blake" });
  assert.equal(app.querySelector("#repeat-persona").value, "otis-blake");
  assert.equal(app.querySelector("#repeat-start").disabled, false);
  assert.equal(app.querySelector("#repeat-text").disabled, false);

  view.render({ ...snapshot(), personaId: "otis-blake" });
  assert.equal(app.querySelector("#repeat-text").disabled, true);
});

test("roster presents neutral named voices instead of task-specific characters", () => {
  const taskLanguage = /\b(?:coach|concierge|coordinator|guide|host|master|mentor|planner|producer|storyteller)\b/i;
  const cues = new Set(PERSONA_ROSTER.map((persona) => persona.auditionCue));

  assert.deepEqual([...cues], [
    "Please introduce yourself, then tell me what makes a conversation enjoyable. Take your time and speak naturally.",
  ]);
  for (const persona of PERSONA_ROSTER) {
    assert.doesNotMatch(persona.summary, taskLanguage);
  }
});
