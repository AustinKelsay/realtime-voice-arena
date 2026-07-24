import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { createBrowserPlatform } from "../src/browser-platform.js";
import { MODEL, sessionHistoryMetadata } from "../src/protocol.js";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

test("browser adapter pins PersonaPlex media, codec, worker, and relay construction", () => {
  const constructed = {};
  class AudioContextClass {
    constructor(options) { constructed.context = options; }
  }
  class AudioWorkletNodeClass {
    constructor(context, name, options) { Object.assign(constructed, { worklet: { context, name, options } }); }
  }
  class WorkerClass {
    constructor(url) { constructed.workerUrl = url; }
  }
  class WebSocketClass {
    static OPEN = 1;
    static CLOSING = 2;
    constructor(url) { constructed.socketUrl = url; }
  }
  class RecorderClass {
    constructor(options) { constructed.recorder = options; }
  }
  const mediaDevices = { getUserMedia: async (constraints) => { constructed.constraints = constraints; } };
  const platform = createBrowserPlatform({
    RecorderClass,
    encoderPath: "/encoder.js",
    AudioContextClass,
    AudioWorkletNodeClass,
    WorkerClass,
    WebSocketClass,
    mediaDevices,
    locationHost: "127.0.0.1:5177",
    performanceClock: { now: () => 10 },
    timerHost: { setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {} },
  });

  const context = platform.createPlaybackContext();
  platform.createPlaybackNode(context);
  platform.createDecoderWorker();
  platform.createRecorder({ id: "source" });
  platform.createSocket("mira-vale");

  assert.deepEqual(constructed.context, { sampleRate: 24_000 });
  assert.deepEqual(constructed.worklet, { context, name: "personaplex-playback", options: { outputChannelCount: [1] } });
  assert.equal(constructed.workerUrl, "/assets/decoderWorker.min.js");
  assert.equal(constructed.socketUrl, "ws://127.0.0.1:5177/realtime?persona=mira-vale");
  assert.deepEqual(constructed.recorder, {
    sourceNode: { id: "source" },
    encoderPath: "/encoder.js",
    encoderSampleRate: 24_000,
    encoderFrameSize: 20,
    maxFramesPerPage: 2,
    numberOfChannels: 1,
    streamPages: true,
    monitorGain: 0,
    recordingGain: 1,
  });
});

test("UI exposes only the continuous conversation controls and states", () => {
  const source = `${read("src/main.js")}\n${read("src/conversation-view.js")}`;
  for (const label of ["Start conversation", "Stop conversation"]) assert.match(source, new RegExp(label));
  for (const legacy of ["Start listening", "Send turn", "Cancel response", "WAV fixture", "input_audio_buffer.commit", "response.cancel", "response.create", "\\bSTT\\b", "\\bTTS\\b", "cascade compatibility"]) assert.doesNotMatch(source, new RegExp(legacy, "i"));
});

test("history schema is content-free and model identity is PersonaPlex", () => {
  const manifest = JSON.parse(read("benchlocal.pack.json"));
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.capabilities.multiTurn, true);
  assert.match(JSON.stringify(manifest), /realtime-voice-arena-0\.3\.0/);
  assert.match(JSON.stringify(manifest), /personaplex/i);

  const metadata = sessionHistoryMetadata({
    status: "stopped",
    startedAt: 10,
    endedAt: 20,
    inputBytes: 1,
    outputBytes: 2,
    inputFrames: 3,
    outputFrames: 4,
    bargeIns: 5,
    terminalReason: "user_stop",
  });
  assert.equal(metadata.model, MODEL);
  for (const contentField of ["audio", "prompt", "transcript", "responseText", "caption", "semanticOutput"]) {
    assert.equal(Object.hasOwn(metadata, contentField), false);
  }
});

test("vendored decoder assets match pinned checksums and attribution", () => {
  const assets = [
    ["public/assets/decoderWorker.min.js", 28_541, "55b513929dc52be93042974cd0a20e71a010b7e394afed9dd3ad38fc2db2153c"],
    ["public/assets/decoderWorker.min.wasm", 149_534, "cd1d29c43b3fa05719c3d024ed9b9f1528be92415bd6d39d413b262a61d1891f"],
  ];
  for (const [file, size, checksum] of assets) {
    const path = resolve(root, file);
    assert.equal(statSync(path).size, size);
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), checksum);
  }
  assert.match(read("public/assets/LICENSE.personaplex"), /MIT License/);
  const opusLicensePath = resolve(root, "public/assets/LICENSE.opus-recorder.md");
  const opusLicense = readFileSync(opusLicensePath);
  assert.equal(statSync(opusLicensePath).size, 4_609);
  assert.equal(createHash("sha256").update(opusLicense).digest("hex"), "cbecb5e0feaa6ef30acca654ab98ba6df1c23d31e6d2122254925b10e7f0a428");
  assert.match(opusLicense.toString("utf8"), /Opus Recorder License \(MIT\)/);
  assert.match(opusLicense.toString("utf8"), /Speex License \(BSD\)/);
  assert.match(read("public/assets/README.md"), /github\.com\/NVIDIA\/personaplex/);
  assert.match(read("public/assets/README.md"), /3428dfd95309a7f3c84fd93259ded0f810d1ff91/);
});
