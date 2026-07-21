import test from "node:test";
import assert from "node:assert/strict";
import { createDecoderPrewarm } from "../src/decoder-prewarm.js";
import { PcmQueue } from "../public/playback-queue.js";
import { acquireCapture, acquirePlayback } from "../src/audio-resources.js";

function clock() {
  let now = 0;
  const timers = new Map();
  return {
    set(fn, delay) { const id = Symbol(); timers.set(id, { at: now + delay, fn }); return id; },
    clear(id) { timers.delete(id); },
    tick(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
  };
}

class FakeWorker {
  constructor() { this.messages = []; this.terminated = false; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  error() { this.onerror?.(new Error("decoder failed")); }
  frame(value) { this.onmessage?.({ data: [value] }); }
}

test("decoder prewarm sends init then delayed BOS and resolves without PCM", async () => {
  const timers = clock();
  const worker = new FakeWorker();
  const controller = createDecoderPrewarm({ workerFactory: () => worker, initMessage: { command: "init" }, warmupPage: new Uint8Array([1]), setTimeoutFn: timers.set, clearTimeoutFn: timers.clear });
  assert.deepEqual(worker.messages, [{ command: "init" }]);
  timers.tick(100);
  assert.deepEqual(worker.messages, [{ command: "init" }, { command: "decode", pages: new Uint8Array([1]) }]);
  let settled = false;
  controller.ready.then(() => { settled = true; });
  timers.tick(99);
  await Promise.resolve();
  assert.equal(settled, false);
  timers.tick(901);
  await controller.ready;
  assert.equal(settled, true);
});

test("decoder prewarm abort and errors settle startup/runtime separately", async () => {
  const timers = clock();
  const worker = new FakeWorker();
  const controller = createDecoderPrewarm({ workerFactory: () => worker, initMessage: {}, warmupPage: new Uint8Array([1]), setTimeoutFn: timers.set, clearTimeoutFn: timers.clear });
  controller.abort();
  await assert.rejects(controller.ready, /startup stopped/);
  assert.equal(worker.terminated, true);

  const runtimeTimers = clock();
  const runtimeWorker = new FakeWorker();
  let runtimeError;
  const runtime = createDecoderPrewarm({ workerFactory: () => runtimeWorker, initMessage: {}, warmupPage: new Uint8Array([1]), setTimeoutFn: runtimeTimers.set, clearTimeoutFn: runtimeTimers.clear, onRuntimeError: (error) => { runtimeError = error; } });
  runtimeWorker.error();
  await assert.rejects(runtime.ready, /decoder failed/);
  runtimeTimers.tick(1_000);
  assert.equal(runtimeError, undefined);

  const readyTimers = clock();
  const readyWorker = new FakeWorker();
  const ready = createDecoderPrewarm({ workerFactory: () => readyWorker, initMessage: {}, warmupPage: new Uint8Array([1]), setTimeoutFn: readyTimers.set, clearTimeoutFn: readyTimers.clear, onRuntimeError: (error) => { runtimeError = error; } });
  readyTimers.tick(1_000);
  await ready.ready;
  readyWorker.error();
  assert.match(runtimeError.message, /decoder failed/);
});

test("decoder prewarm closes over init and delayed warmup post failures", async () => {
  const initWorker = new FakeWorker();
  initWorker.postMessage = () => { throw new Error("init post failed"); };
  const init = createDecoderPrewarm({ workerFactory: () => initWorker, initMessage: {}, warmupPage: new Uint8Array([1]) });
  await assert.rejects(init.ready, /init post failed/);
  assert.equal(initWorker.terminated, true);

  const timers = clock();
  const warmupWorker = new FakeWorker();
  const originalPost = warmupWorker.postMessage.bind(warmupWorker);
  warmupWorker.postMessage = (message) => { if (message.command === "decode") throw new Error("warmup post failed"); originalPost(message); };
  const warmup = createDecoderPrewarm({ workerFactory: () => warmupWorker, initMessage: {}, warmupPage: new Uint8Array([1]), setTimeoutFn: timers.set, clearTimeoutFn: timers.clear });
  timers.tick(100);
  await assert.rejects(warmup.ready, /warmup post failed/);
  assert.equal(warmupWorker.terminated, true);
});

test("audio acquisition releases local resources on resume, worklet, and recorder failures", async () => {
  const track = { stops: 0, stop() { this.stops += 1; } };
  const stream = { getTracks: () => [track] };
  const rejectedContext = { resume: async () => { throw new Error("resume failed"); }, close: async () => {} };
  await assert.rejects(acquireCapture({ isCurrent: () => true, getUserMedia: async () => stream, createContext: () => rejectedContext, createRecorder: () => ({}), configureRecorder: () => {}, constraints: {} }), /resume failed/);
  assert.equal(track.stops, 1);

  const recorderContext = { resume: async () => {}, close: async () => {}, createMediaStreamSource: () => ({ disconnect() {} }) };
  await assert.rejects(acquireCapture({ isCurrent: () => true, getUserMedia: async () => stream, createContext: () => recorderContext, createRecorder: () => { throw new Error("recorder failed"); }, configureRecorder: () => {}, constraints: {} }), /recorder failed/);
  assert.equal(track.stops, 2);

  const playbackContext = { resume: async () => {}, audioWorklet: { addModule: async () => { throw new Error("worklet failed"); } }, close: async () => {} };
  await assert.rejects(acquirePlayback({ isCurrent: () => true, createContext: () => playbackContext, createNode: () => ({}) }), /worklet failed/);
});

test("PCM queue matches the 150 ms worklet policy with drop, partial pull, zero-fill, and flush", () => {
  const queue = new PcmQueue(1_000, 15);
  queue.push(new Float32Array([1, 2, 3, 4, 5]));
  queue.push(new Float32Array([6, 7, 8, 9, 10]));
  queue.push(new Float32Array([11, 12, 13, 14, 15]));
  queue.push(new Float32Array([16, 17, 18, 19, 20]));
  assert.equal(queue.samples, 15);
  const first = new Float32Array(4);
  assert.equal(queue.pull(first), 4);
  assert.deepEqual([...first], [6, 7, 8, 9]);
  const second = new Float32Array(8);
  assert.equal(queue.pull(second), 8);
  assert.deepEqual([...second], [10, 11, 12, 13, 14, 15, 16, 17]);
  const partial = new Float32Array(4).fill(9);
  assert.equal(queue.pull(partial), 3);
  assert.deepEqual([...partial], [18, 19, 20, 0]);
  const empty = new Float32Array(4).fill(9);
  assert.equal(queue.pull(empty), 0);
  assert.deepEqual([...empty], [0, 0, 0, 0]);
  queue.push(new Float32Array([1, 2]));
  queue.flush();
  assert.equal(queue.samples, 0);
});
