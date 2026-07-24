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
