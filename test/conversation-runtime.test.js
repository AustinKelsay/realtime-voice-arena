import test from "node:test";
import assert from "node:assert/strict";

import { createConversationRuntime } from "../src/conversation-runtime.js";

class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.binaryType = null;
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = [];
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener, once: options.once === true });
    this.listeners.set(type, entries);
  }

  emit(type, event = {}) {
    const entries = [...(this.listeners.get(type) ?? [])];
    this.listeners.set(type, entries.filter((entry) => !entry.once));
    for (const entry of entries) entry.listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(frame) {
    this.sent.push(new Uint8Array(frame));
  }

  close(code, reason) {
    this.readyState = 3;
    this.closed.push({ code, reason });
  }
}

class FakeWorker {
  constructor() {
    this.messages = [];
    this.terminated = false;
    this.terminateCalls = 0;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emitFrame(samples) {
    this.onmessage?.({ data: [samples] });
  }

  terminate() {
    this.terminated = true;
    this.terminateCalls += 1;
  }
}

function createHarness({
  resumeCapture = async () => {},
  startRecorder = async () => {},
  failHistoryOperation = null,
  deferDecoderTimers = false,
} = {}) {
  const events = [];
  let microphoneLevel = 0;
  let captureConstraints;
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    disconnected: false,
    getFloatTimeDomainData(samples) { samples.fill(microphoneLevel); },
    disconnect() { this.disconnected = true; },
  };
  const captureSource = {
    disconnected: false,
    connect() {},
    disconnect() { this.disconnected = true; },
  };
  const captureContext = {
    sampleRate: 24_000,
    closed: false,
    async resume() { await resumeCapture(); },
    createMediaStreamSource: () => captureSource,
    createAnalyser: () => analyser,
    async close() { this.closed = true; },
  };
  const playbackMessages = [];
  const playbackNode = {
    connected: false,
    disconnected: false,
    port: { postMessage(message) { playbackMessages.push(message); } },
    connect() { this.connected = true; },
    disconnect() { this.disconnected = true; },
  };
  const playbackContext = {
    sampleRate: 24_000,
    destination: {},
    closed: false,
    audioWorklet: { async addModule() {} },
    async resume() {},
    async close() { this.closed = true; },
  };
  const recorder = {
    started: false,
    stopped: false,
    closed: false,
    closeCalls: 0,
    async start() { await startRecorder(); this.started = true; this.onstart?.(); },
    async stop() { this.stopped = true; },
    close() { this.closed = true; this.closeCalls += 1; },
    emitPage(page) { this.ondataavailable?.(page); },
  };
  const worker = new FakeWorker();
  const intervals = new Map();
  let intervalSequence = 0;
  const timeouts = new Map();
  let timeoutSequence = 0;
  let now = 100;
  const platform = {
    socketOpen: 1,
    socketClosing: 2,
    now: () => now,
    setNow(value) { now = value; },
    setTimeout(callback) {
      const id = ++timeoutSequence;
      if (deferDecoderTimers) timeouts.set(id, callback);
      else queueMicrotask(callback);
      return id;
    },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback) { const id = ++intervalSequence; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    createPlaybackContext: () => playbackContext,
    createPlaybackNode: () => playbackNode,
    createDecoderWorker: () => worker,
    getUserMedia: async (constraints) => { captureConstraints = constraints; return stream; },
    createCaptureContext: () => captureContext,
    createRecorder: () => recorder,
    createSocket: () => {
      platform.socket = new FakeSocket();
      return platform.socket;
    },
  };
  const benchlocal = {
    history: {
      async save(value) {
        events.push(["history.save", value]);
        if (failHistoryOperation === "history.save") throw new Error("history save failed");
      },
    },
    runs: {
      async startState(value) { events.push(["runs.start", value]); },
      async updateProgress(value) {
        events.push(["runs.progress", value]);
        if (failHistoryOperation === "runs.progress") throw new Error("progress failed");
      },
      async stopState(value) {
        events.push(["runs.stop", value]);
        if (failHistoryOperation === "runs.stop") throw new Error("stop failed");
      },
    },
  };
  const snapshots = [];
  const runtime = createConversationRuntime({ benchlocal, platform, onStateChange: (snapshot) => snapshots.push(snapshot) });
  return {
    analyser,
    benchlocal,
    captureContext,
    get captureConstraints() { return captureConstraints; },
    captureSource,
    events,
    intervals,
    platform,
    playbackContext,
    playbackMessages,
    playbackNode,
    recorder,
    runtime,
    setMicrophoneLevel(value) { microphoneLevel = value; },
    snapshots,
    stream,
    timeouts,
    track,
    worker,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

async function startLive(harness) {
  const starting = harness.runtime.start();
  assert.equal(harness.runtime.start(), starting);
  await waitFor(() => harness.platform.socket);
  harness.platform.socket.open();
  await starting;
  harness.platform.socket.emit("message", { data: new Uint8Array([0x00]).buffer });
  await new Promise((resolve) => setImmediate(resolve));
}

test("conversation runtime owns a complete start, handshake, stream, and stop lifecycle", async () => {
  const harness = createHarness();

  await startLive(harness);
  assert.equal(harness.runtime.getState().session.status, "live");
  assert.equal(harness.recorder.started, true);
  assert.deepEqual(harness.captureConstraints, {
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  assert.deepEqual(harness.worker.messages[0], {
    command: "init",
    bufferLength: 960,
    decoderSampleRate: 24_000,
    outputBufferSampleRate: 24_000,
    resampleQuality: 0,
  });

  harness.recorder.emitPage(new Uint8Array([0x11, 0x22]));
  assert.deepEqual([...harness.platform.socket.sent[0]], [0x01, 0x11, 0x22]);
  assert.equal(harness.runtime.getState().session.inputFrames, 1);
  assert.equal(harness.runtime.getState().session.inputBytes, 3);

  harness.platform.socket.emit("message", { data: new Uint8Array([0x01, 0x33]).buffer });
  assert.equal(harness.runtime.getState().session.outputFrames, 1);
  assert.equal(harness.runtime.getState().session.outputBytes, 2);
  assert.deepEqual([...harness.worker.messages.at(-1).pages], [0x33]);

  harness.platform.setNow(1_100);
  await harness.runtime.stop("user_stop");
  const stopped = harness.runtime.getState();
  assert.equal(stopped.session.status, "stopped");
  assert.equal(stopped.session.terminalReason, "user_stop");
  assert.equal(stopped.session.endedAt, 1_100);
  assert.equal(harness.track.stopped, true);
  assert.equal(harness.captureSource.disconnected, true);
  assert.equal(harness.playbackNode.disconnected, true);
  assert.equal(harness.captureContext.closed, true);
  assert.equal(harness.playbackContext.closed, true);
  assert.equal(harness.recorder.stopped, true);
  assert.equal(harness.recorder.closed, true);
  assert.equal(harness.worker.terminated, true);
  assert.deepEqual(harness.events.map(([name]) => name), ["runs.start", "history.save", "runs.progress", "runs.stop"]);
  const history = harness.events.find(([name]) => name === "history.save")[1];
  assert.deepEqual(Object.keys(history.metadata).sort(), ["bargeIns", "durationMs", "inputBytes", "inputFrames", "model", "outputBytes", "outputFrames", "status", "terminalReason"].sort());
});

test("conversation runtime yields assistant playback on user speech without closing the session", async () => {
  const harness = createHarness();
  await startLive(harness);

  harness.worker.emitFrame(new Float32Array(960).fill(0.1));
  assert.equal(harness.playbackMessages.at(-1).type, "frame");

  harness.setMicrophoneLevel(0.1);
  const observeMicrophone = [...harness.intervals.values()][0];
  observeMicrophone();
  observeMicrophone();
  observeMicrophone();

  assert.equal(harness.runtime.getState().session.bargeIns, 1);
  assert.equal(harness.runtime.getState().session.status, "live");
  assert.equal(harness.playbackMessages.at(-1).type, "flush");
  assert.deepEqual(harness.platform.socket.closed, []);

  const messagesBeforeSuppressedFrame = harness.playbackMessages.length;
  harness.worker.emitFrame(new Float32Array(960).fill(0.1));
  assert.equal(harness.playbackMessages.length, messagesBeforeSuppressedFrame);

  await harness.runtime.stop();
});

test("conversation runtime cancels stale startup and finalizes only once", async () => {
  let releaseCapture;
  let captureResumeStarted = false;
  const captureGate = new Promise((resolve) => { releaseCapture = resolve; });
  const harness = createHarness({
    async resumeCapture() {
      captureResumeStarted = true;
      await captureGate;
    },
  });

  const starting = harness.runtime.start();
  assert.equal(harness.runtime.start(), starting);
  await waitFor(() => captureResumeStarted);
  const firstStop = harness.runtime.stop("user_stop");
  const secondStop = harness.runtime.stop("user_stop");
  assert.equal(firstStop, secondStop);
  releaseCapture();

  await Promise.all([starting, firstStop]);
  assert.equal(harness.runtime.getState().session.status, "stopped");
  assert.equal(harness.playbackContext.closed, true);
  assert.equal(harness.platform.socket, undefined);
  assert.equal(harness.events.filter(([name]) => name === "history.save").length, 1);
  assert.equal(harness.events.filter(([name]) => name === "runs.stop").length, 1);
});

test("conversation runtime owns late recorder startup cleanup exactly once", async () => {
  let releaseRecorder;
  let recorderStartEntered = false;
  const recorderGate = new Promise((resolve) => { releaseRecorder = resolve; });
  const harness = createHarness({
    async startRecorder() {
      recorderStartEntered = true;
      await recorderGate;
    },
  });
  await startLive(harness);
  await waitFor(() => recorderStartEntered);

  await harness.runtime.stop();
  assert.equal(harness.recorder.closeCalls, 1);

  releaseRecorder();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.recorder.closeCalls, 1);
});

test("conversation runtime releases a stale decoder prewarm exactly once", async () => {
  const harness = createHarness({ deferDecoderTimers: true });
  const starting = harness.runtime.start();
  await waitFor(() => harness.worker.messages.some((message) => message.command === "init"));

  const stopping = harness.runtime.stop();
  await Promise.all([starting, stopping]);

  assert.equal(harness.runtime.getState().session.status, "stopped");
  assert.equal(harness.worker.terminateCalls, 1);
  assert.equal(harness.timeouts.size, 0);
});

test("conversation runtime attempts every terminal history operation after an earlier failure", async () => {
  const harness = createHarness({ failHistoryOperation: "history.save" });
  await startLive(harness);

  await harness.runtime.stop();

  assert.deepEqual(harness.events.map(([name]) => name), [
    "runs.start",
    "history.save",
    "runs.progress",
    "runs.stop",
  ]);
  assert.equal(harness.runtime.getState().session.status, "stopped");
  assert.equal(harness.runtime.getState().finalizing, false);
});

test("conversation runtime turns transport failure into one recoverable terminal session", async () => {
  const harness = createHarness();
  await startLive(harness);

  harness.platform.socket.emit("error");
  await waitFor(() => harness.runtime.getState().session.status === "error" && !harness.runtime.getState().finalizing);

  const failed = harness.runtime.getState();
  assert.equal(failed.session.error, "Realtime transport failed.");
  assert.equal(failed.session.terminalReason, "transport_error");
  assert.equal(harness.track.stopped, true);
  assert.equal(harness.recorder.closed, true);
  assert.equal(harness.worker.terminated, true);
  assert.equal(harness.events.filter(([name]) => name === "history.save").length, 1);
  assert.equal(harness.events.find(([name]) => name === "history.save")[1].status, "error");

  const restarting = harness.runtime.start();
  await waitFor(() => harness.platform.socket && harness.platform.socket.readyState === 0);
  harness.platform.socket.open();
  await restarting;
  assert.equal(harness.runtime.getState().session.status, "connecting");
  await harness.runtime.stop();
});

test("conversation runtime rejects and finalizes a socket closed before open exactly once", async () => {
  const harness = createHarness();
  const starting = harness.runtime.start();
  await waitFor(() => harness.platform.socket);

  harness.platform.socket.readyState = 3;
  harness.platform.socket.emit("close");

  await assert.rejects(starting, /closed before connecting/);
  await waitFor(() => harness.runtime.getState().session.status === "error" && !harness.runtime.getState().finalizing);
  assert.equal(harness.runtime.getState().session.error, "The realtime session closed before connecting.");
  assert.equal(harness.events.filter(([name]) => name === "history.save").length, 1);
  assert.equal(harness.events.filter(([name]) => name === "runs.stop").length, 1);
  assert.equal(harness.track.stopped, true);
  assert.equal(harness.recorder.closeCalls, 1);
  assert.equal(harness.worker.terminateCalls, 1);
});

test("conversation runtime restores content-free history as an isolated read-only snapshot", async () => {
  const harness = createHarness();
  harness.runtime.restoreHistory({
    status: "stopped",
    durationMs: 900,
    inputBytes: 10,
    outputBytes: 20,
    inputFrames: 1,
    outputFrames: 2,
    bargeIns: 1,
    terminalReason: "user_stop",
    transcript: "must not survive history restoration",
    audio: new Uint8Array([1, 2, 3]),
  });

  const restored = harness.runtime.getState();
  assert.equal(restored.historyMode, true);
  assert.equal(restored.session.endedAt, 900);
  assert.equal(restored.session.outputFrames, 2);
  assert.equal(Object.hasOwn(restored.session, "transcript"), false);
  assert.equal(Object.hasOwn(restored.session, "audio"), false);
  restored.session.status = "live";
  assert.equal(harness.runtime.getState().session.status, "stopped");

  await harness.runtime.start();
  assert.equal(harness.platform.socket, undefined);
  assert.deepEqual(harness.events, []);
});
