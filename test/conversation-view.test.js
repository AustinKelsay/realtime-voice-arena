import test from "node:test";
import assert from "node:assert/strict";

import { createConversationView } from "../src/conversation-view.js";

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

test("operator gets the base model voice without a persona selector", () => {
  const app = new FakeApp();
  const view = createConversationView({
    app,
    onStart() {},
    onRepeat() {},
    onStop() {},
  });

  assert.match(app.html, /base-model voice/i);
  assert.doesNotMatch(app.html, /Voice roster|Sora Bennett|Otis Blake/);
  view.render(snapshot({ status: "ready", startedAt: null }));
});

test("operator can submit pasted text to the base voice from a second tab", () => {
  const app = new FakeApp();
  const repeated = [];
  const view = createConversationView({
    app,
    onStart() {},
    onRepeat(text) { repeated.push(text); },
    onStop() {},
  });

  assert.match(app.html, /Conversation/);
  assert.match(app.html, /Text repeat/);
  assert.match(app.html, /Paste text for the base voice/i);

  app.querySelector("#repeat-tab").click();
  assert.equal(app.querySelector("#conversation-panel").hidden, true);
  assert.equal(app.querySelector("#repeat-panel").hidden, false);

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

  view.render(snapshot({ status: "ready", startedAt: null }));
  assert.equal(app.querySelector("#repeat-start").disabled, false);
  assert.equal(app.querySelector("#repeat-text").disabled, false);

  view.render(snapshot());
  assert.equal(app.querySelector("#repeat-text").disabled, true);
});
