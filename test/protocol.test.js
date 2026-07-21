import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_RATE,
  MODEL,
  PROTOCOL,
  createSession,
  transition,
  validateFrame,
  sessionHistoryMetadata,
} from "../src/protocol.js";

test("PersonaPlex uses binary 24 kHz native audio and a content-free model identity", () => {
  assert.equal(MODEL, "personaplex-7b-v1");
  assert.equal(AUDIO_RATE, 24_000);
  assert.deepEqual(PROTOCOL, { handshake: 0x00, audio: 0x01, semantic: 0x02 });
});

test("session state machine admits only the Start/Stop lifecycle", () => {
  let state = createSession(100);
  assert.equal(state.status, "ready");
  state = transition(state, { type: "start" }, 110);
  assert.equal(state.status, "connecting");
  state = transition(state, { type: "handshake" }, 120);
  assert.equal(state.status, "live");
  state = transition(state, { type: "stop" }, 130);
  assert.equal(state.status, "stopping");
  state = transition(state, { type: "closed" }, 140);
  assert.equal(state.status, "stopped");
  assert.equal(transition(state, { type: "stop" }, 150).status, "stopped");
  assert.equal(transition(state, { type: "start" }, 160).status, "connecting");
});

test("error is terminal but a fresh Start can recover after a connecting stop", () => {
  let state = transition(createSession(0), { type: "start" }, 10);
  state = transition(state, { type: "stop" }, 20);
  state = transition(state, { type: "closed" }, 30);
  assert.equal(state.status, "stopped");
  state = transition(state, { type: "start" }, 40);
  state = transition(state, { type: "error" }, 50);
  assert.equal(state.status, "error");
  state = transition(state, { type: "start" }, 60);
  assert.equal(state.status, "connecting");
  assert.equal(state.error, null);
});

test("Persona frames enforce handshake ordering, binary type, and bounded payloads", () => {
  const server = createSession(0);
  assert.deepEqual(validateFrame(new Uint8Array([0x00]), "server", server), { kind: "handshake" });
  assert.throws(() => validateFrame(new Uint8Array([0x01, 0x7f]), "client", server), /handshake/);
  const client = { ...server, handshakeSeen: true };
  assert.deepEqual(validateFrame(new Uint8Array([0x01, 0x7f]), "client", client), { kind: "audio", bytes: 1 });
  assert.throws(() => validateFrame(new Uint8Array([0x02, 0x7f]), "client", client), /audio/);
  assert.deepEqual(validateFrame(new Uint8Array([0x02, 0xe2, 0x82, 0xac]), "server", client), { kind: "semantic", bytes: 3 });
  assert.throws(() => validateFrame(new Uint8Array([0x02]), "server", client), /empty/);
  assert.throws(() => validateFrame(new Uint8Array([0x03]), "server", client), /frame/);
  assert.throws(() => validateFrame(new Uint8Array(65_537), "client", client), /bound/);
});

test("history metadata contains operational fields only", () => {
  const metadata = sessionHistoryMetadata({ status: "stopped", startedAt: 10, endedAt: 30, inputBytes: 4, outputBytes: 8, inputFrames: 2, outputFrames: 3, bargeIns: 1, terminalReason: "user_stop" });
  assert.deepEqual(metadata, { model: MODEL, status: "stopped", durationMs: 20, inputBytes: 4, outputBytes: 8, inputFrames: 2, outputFrames: 3, bargeIns: 1, terminalReason: "user_stop" });
  assert.equal(Object.hasOwn(metadata, "audio"), false);
  assert.equal(Object.hasOwn(metadata, "prompt"), false);
});
