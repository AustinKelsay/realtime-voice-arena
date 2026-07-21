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
  const view = createConversationView({ app, onStart() {}, onStop() { stops += 1; } });
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
