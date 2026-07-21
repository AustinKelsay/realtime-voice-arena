import test from "node:test";
import assert from "node:assert/strict";
import { createBargeInGate } from "../src/barge-in-gate.js";

const speech = () => new Float32Array(240).fill(0.12);
const silence = () => new Float32Array(240);

test("user speech yields assistant playback and playback recovers after speech", () => {
  const playbackMessages = [];
  const gate = createBargeInGate({
    speechThreshold: 0.03,
    attackFrames: 2,
    releaseFrames: 3,
    assistantSilenceFrames: 3,
    onYield: () => playbackMessages.push({ type: "flush" }),
  });

  assert.equal(gate.routeAssistant(speech()), true);
  gate.observeMicrophone(speech());
  assert.equal(gate.routeAssistant(speech()), true);

  gate.observeMicrophone(speech());
  assert.equal(gate.speaking, true);
  assert.deepEqual(playbackMessages, [{ type: "flush" }]);
  assert.equal(gate.routeAssistant(speech()), false);

  gate.observeMicrophone(silence());
  gate.observeMicrophone(silence());
  gate.observeMicrophone(silence());
  assert.equal(gate.speaking, false);
  assert.equal(gate.routeAssistant(silence()), false);
  assert.equal(gate.routeAssistant(silence()), false);
  assert.equal(gate.routeAssistant(silence()), false);
  assert.equal(gate.routeAssistant(speech()), true);
});

test("barge-in stays latched across user pauses until the assistant yields", () => {
  const gate = createBargeInGate({
    speechThreshold: 0.03,
    assistantThreshold: 0.03,
    attackFrames: 2,
    releaseFrames: 3,
    assistantSilenceFrames: 3,
  });

  assert.equal(gate.routeAssistant(speech()), true);
  gate.observeMicrophone(speech());
  gate.observeMicrophone(speech());
  assert.equal(gate.routeAssistant(speech()), false);

  gate.observeMicrophone(silence());
  gate.observeMicrophone(silence());
  gate.observeMicrophone(silence());
  assert.equal(gate.speaking, false);
  assert.equal(gate.routeAssistant(speech()), false);

  assert.equal(gate.routeAssistant(silence()), false);
  assert.equal(gate.routeAssistant(silence()), false);
  assert.equal(gate.routeAssistant(silence()), false);
  assert.equal(gate.routeAssistant(speech()), true);
});
