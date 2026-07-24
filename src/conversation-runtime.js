import { acquireCapture, acquirePlayback } from "./audio-resources.js";
import { createBargeInGate } from "./barge-in-gate.js";
import { createDecoderPrewarm } from "./decoder-prewarm.js";
import { DEFAULT_PERSONA_ID, findPersona } from "./persona-roster.js";
import {
  AUDIO_RATE,
  MAX_CLIENT_FRAME_BYTES,
  MAX_JITTER_MS,
  MAX_RELAY_PENDING_BYTES,
  PROTOCOL,
  createSession,
  sessionHistoryMetadata,
  transition,
  validateFrame,
} from "./protocol.js";

const ACTIVE_STATUSES = new Set(["connecting", "live", "stopping"]);
const CAPTURE_CONSTRAINTS = Object.freeze({
  audio: Object.freeze({
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }),
  video: false,
});

function warmupBosPage() {
  const opusHead = new Uint8Array([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01,
    0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const header = new Uint8Array([
    0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x01, opusHead.length,
  ]);
  const page = new Uint8Array(header.length + opusHead.length);
  page.set(header);
  page.set(opusHead, header.length);
  return page;
}

function binaryAudioFrame(payload) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.byteLength + 1 > MAX_CLIENT_FRAME_BYTES) throw new Error("Audio frame exceeds the relay bound.");
  const frame = new Uint8Array(bytes.byteLength + 1);
  frame[0] = PROTOCOL.audio;
  frame.set(bytes, 1);
  return frame;
}

/**
 * Own one complete PersonaPlex browser conversation.
 *
 * `platform` is the browser system boundary (media, workers, transport, and
 * time). `benchlocal` is the host persistence boundary. Callers interact only
 * through start, stop, restoreHistory, and getState.
 */
export function createConversationRuntime({ benchlocal, platform, onStateChange = () => {} }) {
  if (!benchlocal?.runs || !benchlocal?.history) throw new Error("BenchLocal run and history adapters are required.");
  if (!platform || typeof platform.now !== "function") throw new Error("Browser platform adapter is required.");

  const state = {
    session: createSession(),
    socket: null,
    stream: null,
    captureContext: null,
    captureSource: null,
    captureAnalyser: null,
    microphoneMonitor: null,
    bargeInGate: null,
    recorder: null,
    recorderStarted: false,
    recorderStartAbort: null,
    recorderStartSettled: null,
    closedRecorders: new WeakSet(),
    decoder: null,
    decoderAbort: null,
    decoderTerminate: null,
    playbackContext: null,
    playbackNode: null,
    saving: false,
    finalizing: false,
    runStartPromise: null,
    historyMode: false,
    generation: 0,
    personaId: DEFAULT_PERSONA_ID,
  };

  function getState() {
    return {
      session: { ...state.session },
      historyMode: state.historyMode,
      finalizing: state.finalizing,
      playbackLimitMs: MAX_JITTER_MS,
      personaId: state.personaId,
    };
  }

  function emitState() {
    onStateChange(getState());
  }

  function isCurrent(generation) {
    return generation === state.generation;
  }

  async function setupPlayback(generation) {
    const playback = await acquirePlayback({
      isCurrent: () => isCurrent(generation),
      createContext: platform.createPlaybackContext,
      createNode: platform.createPlaybackNode,
    });
    state.playbackContext = playback.context;
    state.playbackNode = playback.node;
    state.bargeInGate = createBargeInGate({
      now: platform.now,
      onYield: () => {
        if (!isCurrent(generation) || !state.playbackNode) return;
        state.playbackNode.port.postMessage({ type: "flush" });
        state.session.bargeIns += 1;
        emitState();
      },
    });
  }

  async function setupDecoder(generation) {
    const controller = createDecoderPrewarm({
      workerFactory: platform.createDecoderWorker,
      initMessage: {
        command: "init",
        bufferLength: 960 * state.playbackContext.sampleRate / AUDIO_RATE,
        decoderSampleRate: AUDIO_RATE,
        outputBufferSampleRate: state.playbackContext.sampleRate,
        resampleQuality: 0,
      },
      warmupPage: warmupBosPage(),
      setTimeoutFn: platform.setTimeout,
      clearTimeoutFn: platform.clearTimeout,
      onFrame: (event) => {
        if (!isCurrent(generation)) return;
        const decoded = event.data?.[0];
        if (!(decoded instanceof Float32Array) || !state.playbackNode) return;
        if (state.bargeInGate && !state.bargeInGate.routeAssistant(decoded)) return;
        state.playbackNode.port.postMessage({ type: "frame", frame: decoded }, [decoded.buffer]);
      },
      onRuntimeError: (error) => {
        if (isCurrent(generation)) void fail(error);
      },
    });
    state.decoder = controller.worker;
    state.decoderAbort = controller.abort;
    state.decoderTerminate = controller.terminate;
    await controller.ready;
    if (state.decoderAbort === controller.abort) state.decoderAbort = null;
  }

  async function setupCapture(generation) {
    let recorder;
    const capture = await acquireCapture({
      isCurrent: () => isCurrent(generation),
      getUserMedia: platform.getUserMedia,
      createContext: platform.createCaptureContext,
      createRecorder: platform.createRecorder,
      configureRecorder: (value) => {
        recorder = value;
        recorder.ondataavailable = (page) => {
          if (!isCurrent(generation) || state.recorder !== recorder) return;
          try {
            const socket = state.socket;
            if (!socket || socket.readyState !== platform.socketOpen || state.session.status !== "live") return;
            const frame = binaryAudioFrame(page);
            if (socket.bufferedAmount + frame.byteLength > MAX_RELAY_PENDING_BYTES) throw new Error("Realtime relay buffer is full.");
            socket.send(frame);
            state.session.inputBytes += frame.byteLength;
            state.session.inputFrames += 1;
            emitState();
          } catch (error) {
            void fail(error);
          }
        };
        recorder.onstart = () => {
          if (!isCurrent(generation) || state.recorder !== recorder) {
            closeRecorder(recorder);
            return;
          }
          state.recorderStarted = true;
          emitState();
        };
      },
      constraints: CAPTURE_CONSTRAINTS,
    });
    state.stream = capture.stream;
    state.captureContext = capture.context;
    state.captureSource = capture.source;
    state.recorder = capture.recorder;

    const analyser = capture.context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0;
    capture.source.connect(analyser);
    const microphoneSamples = new Float32Array(analyser.fftSize);
    state.captureAnalyser = analyser;
    state.microphoneMonitor = platform.setInterval(() => {
      if (!isCurrent(generation) || state.captureAnalyser !== analyser) return;
      analyser.getFloatTimeDomainData(microphoneSamples);
      state.bargeInGate?.observeMicrophone(microphoneSamples);
    }, 20);
  }

  function closeRecorder(recorder) {
    if (!recorder || state.closedRecorders.has(recorder)) return;
    state.closedRecorders.add(recorder);
    try { recorder.close(); } catch { /* cleanup continues */ }
  }

  function startRecorder() {
    const generation = state.generation;
    const recorder = state.recorder;
    if (!recorder) throw new Error("Audio recorder was unavailable.");
    let active = true;
    let resolveAbort;
    const aborted = new Promise((resolve) => { resolveAbort = resolve; });
    const startResult = Promise.resolve()
      .then(() => recorder.start())
      .then(
        () => ({ ok: true }),
        (error) => {
          if (active && isCurrent(generation) && state.recorder === recorder) void fail(error);
          return { ok: false, error };
        },
      )
      .finally(() => {
        if (!active) closeRecorder(recorder);
      });
    const settled = Promise.race([startResult, aborted]);
    const abort = () => {
      if (!active) return;
      active = false;
      resolveAbort({ aborted: true });
    };
    state.recorderStartAbort = abort;
    state.recorderStartSettled = settled;
    settled.finally(() => {
      if (state.recorderStartSettled !== settled) return;
      state.recorderStartAbort = null;
      state.recorderStartSettled = null;
    });
  }

  function handleServerFrame(socket, value) {
    const frame = new Uint8Array(value);
    const details = validateFrame(frame, "server", state.session);
    if (details.kind === "handshake") {
      state.session = transition(state.session, { type: "handshake" }, platform.now());
      startRecorder();
    } else if (details.kind === "audio") {
      const audio = frame.slice(1);
      state.session.outputBytes += frame.byteLength;
      state.session.outputFrames += 1;
      state.decoder?.postMessage({ command: "decode", pages: audio }, [audio.buffer]);
    }
    emitState();
    if (socket !== state.socket) socket.close(1000);
  }

  function openSocket(generation) {
    return new Promise((resolve, reject) => {
      const socket = platform.createSocket(state.personaId);
      socket.binaryType = "arraybuffer";
      state.socket = socket;
      let opened = false;
      socket.addEventListener("open", () => {
        opened = true;
        if (isCurrent(generation)) resolve(socket);
        else socket.close(1000);
      }, { once: true });
      socket.addEventListener("message", (event) => {
        if (!isCurrent(generation)) return;
        try { handleServerFrame(socket, event.data); } catch (error) { void fail(error); }
      });
      socket.addEventListener("error", () => {
        if (!isCurrent(generation) || state.socket !== socket) return;
        if (!opened) reject(new Error("Could not connect to the local realtime relay."));
        else void fail(new Error("Realtime transport failed."));
      }, { once: true });
      socket.addEventListener("close", () => {
        if (!opened) {
          reject(new Error("The realtime session closed before connecting."));
          return;
        }
        if (!isCurrent(generation) || state.socket !== socket) return;
        state.socket = null;
        if (["connecting", "live"].includes(state.session.status)) void fail(new Error("The realtime session closed unexpectedly."));
      });
    });
  }

  async function startImpl() {
    if (ACTIVE_STATUSES.has(state.session.status) || state.finalizing || state.historyMode) return;
    state.generation += 1;
    const generation = state.generation;
    state.session = transition(createSession(), { type: "start" }, platform.now());
    emitState();
    try {
      await setupPlayback(generation);
      if (!isCurrent(generation)) return;
      state.runStartPromise = benchlocal.runs.startState({
        message: "PersonaPlex session starting.",
        metadata: { model: "personaplex-7b-v1" },
      }).catch(() => {});
      await state.runStartPromise;
      state.runStartPromise = null;
      if (!isCurrent(generation)) return;
      await setupDecoder(generation);
      if (!isCurrent(generation)) return;
      await setupCapture(generation);
      if (!isCurrent(generation)) return;
      await openSocket(generation);
      if (isCurrent(generation)) emitState();
    } catch (error) {
      if (!isCurrent(generation)) return;
      await fail(error);
      throw error;
    }
  }

  async function finishHistory() {
    if (state.saving || state.historyMode || state.session.endedAt == null) return;
    state.saving = true;
    try {
      const metadata = sessionHistoryMetadata(state.session);
      const status = state.session.status === "error" ? "error" : "completed";
      let firstError;
      const operations = [
        () => benchlocal.history.save({ status, metadata }),
        () => benchlocal.runs.updateProgress({ status, progress: 1, message: `PersonaPlex session ${metadata.status}.` }),
        () => benchlocal.runs.stopState({ message: `PersonaPlex session ${metadata.status}.` }),
      ];
      for (const operation of operations) {
        try { await operation(); } catch (error) { firstError ||= error; }
      }
      if (firstError) throw firstError;
    } finally {
      state.saving = false;
    }
  }

  async function teardown() {
    state.recorderStartAbort?.();
    const recorderStartSettled = state.recorderStartSettled;
    state.recorderStartAbort = null;
    state.recorderStartSettled = null;
    state.decoderAbort?.();
    state.decoderAbort = null;

    const resources = {
      recorder: state.recorder,
      recorderStarted: state.recorderStarted,
      stream: state.stream,
      captureSource: state.captureSource,
      captureAnalyser: state.captureAnalyser,
      microphoneMonitor: state.microphoneMonitor,
      captureContext: state.captureContext,
      playbackNode: state.playbackNode,
      playbackContext: state.playbackContext,
      socket: state.socket,
      decoder: state.decoder,
      decoderTerminate: state.decoderTerminate,
    };
    Object.assign(state, {
      recorder: null,
      recorderStarted: false,
      stream: null,
      captureSource: null,
      captureAnalyser: null,
      microphoneMonitor: null,
      captureContext: null,
      playbackNode: null,
      playbackContext: null,
      socket: null,
      decoder: null,
      decoderTerminate: null,
    });

    if (resources.microphoneMonitor != null) platform.clearInterval(resources.microphoneMonitor);
    state.bargeInGate?.reset();
    state.bargeInGate = null;
    try { resources.stream?.getTracks().forEach((track) => track.stop()); } catch { /* cleanup continues */ }
    try { resources.captureAnalyser?.disconnect(); } catch { /* cleanup continues */ }
    try { resources.captureSource?.disconnect(); } catch { /* cleanup continues */ }
    try { resources.playbackNode?.port.postMessage({ type: "flush" }); } catch { /* cleanup continues */ }
    try { resources.playbackNode?.disconnect(); } catch { /* cleanup continues */ }
    try {
      if (resources.socket && resources.socket.readyState < platform.socketClosing) {
        resources.socket.close(1000, "Session stopped");
      }
    } catch { /* cleanup continues */ }
    if (resources.recorderStarted) {
      try { Promise.resolve(resources.recorder?.stop()).catch(() => {}); } catch { /* cleanup continues */ }
    }
    closeRecorder(resources.recorder);
    await recorderStartSettled?.catch(() => {});
    await resources.captureContext?.close().catch(() => {});
    resources.decoderTerminate?.();
    await resources.playbackContext?.close().catch(() => {});
  }

  async function stopImpl(reason = "user_stop") {
    const idle = ["ready", "stopped"].includes(state.session.status)
      && !state.socket && !state.recorder && !state.stream;
    if (state.finalizing || idle) return;
    state.generation += 1;
    state.finalizing = true;
    if (state.session.status !== "error") {
      state.session = { ...state.session, status: "stopping", terminalReason: reason };
    }
    emitState();
    try {
      await teardown();
      if (state.runStartPromise) await state.runStartPromise;
      if (state.session.status !== "error") {
        state.session = transition(
          { ...state.session, status: "stopping", terminalReason: reason },
          { type: "closed" },
          platform.now(),
        );
      }
      emitState();
      await finishHistory().catch(() => {});
    } finally {
      state.finalizing = false;
      emitState();
    }
  }

  async function fail(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.finalizing) return;
    const fullyFailed = state.session.status === "error" && !state.socket && !state.recorder && !state.stream;
    if (fullyFailed) return;
    state.generation += 1;
    state.finalizing = true;
    state.session = {
      ...transition(state.session, { type: "error" }, platform.now()),
      error: message,
    };
    emitState();
    await teardown().catch(() => {});
    if (state.runStartPromise) await state.runStartPromise;
    await finishHistory().catch(() => {});
    state.finalizing = false;
    emitState();
  }

  function restoreHistory(metadata = {}) {
    if (ACTIVE_STATUSES.has(state.session.status) || state.finalizing) {
      throw new Error("Cannot restore history during an active conversation.");
    }
    const restored = createSession(0);
    const counters = ["inputBytes", "outputBytes", "inputFrames", "outputFrames", "bargeIns"];
    for (const name of counters) {
      if (Number.isSafeInteger(metadata[name]) && metadata[name] >= 0) restored[name] = metadata[name];
    }
    restored.status = ["stopped", "error"].includes(metadata.status) ? metadata.status : "stopped";
    restored.endedAt = Number.isFinite(metadata.durationMs) && metadata.durationMs >= 0 ? metadata.durationMs : 0;
    restored.terminalReason = typeof metadata.terminalReason === "string" ? metadata.terminalReason : null;
    state.historyMode = true;
    state.session = restored;
    emitState();
  }

  function selectPersona(personaId) {
    if (!findPersona(personaId)) throw new Error("Unknown PersonaPlex persona.");
    if (ACTIVE_STATUSES.has(state.session.status) || state.finalizing || state.historyMode) {
      throw new Error("Cannot change persona during an active conversation.");
    }
    state.personaId = personaId;
    emitState();
  }

  let starting = null;
  let stopping = null;

  function start() {
    if (stopping) return stopping;
    if (starting) return starting;
    const promise = Promise.resolve().then(startImpl);
    starting = promise;
    promise.then(
      () => { if (starting === promise) starting = null; },
      () => { if (starting === promise) starting = null; },
    );
    return promise;
  }

  function stop(reason = "user_stop") {
    if (stopping) return stopping;
    starting = null;
    const promise = Promise.resolve().then(() => stopImpl(reason));
    stopping = promise;
    promise.then(
      () => { if (stopping === promise) stopping = null; },
      () => { if (stopping === promise) stopping = null; },
    );
    return promise;
  }

  return Object.freeze({
    start,
    stop,
    selectPersona,
    restoreHistory,
    getState,
  });
}
