import { AUDIO_RATE } from "./protocol.js";

/**
 * Adapt browser-only media, worker, transport, and timing primitives to the
 * conversation runtime. Keeping construction here prevents browser globals and
 * codec configuration from leaking into session orchestration or its tests.
 */
export function createBrowserPlatform({
  RecorderClass,
  encoderPath,
  AudioContextClass = globalThis.AudioContext,
  AudioWorkletNodeClass = globalThis.AudioWorkletNode,
  WorkerClass = globalThis.Worker,
  WebSocketClass = globalThis.WebSocket,
  mediaDevices = globalThis.navigator?.mediaDevices,
  locationHost = globalThis.location?.host,
  performanceClock = globalThis.performance,
  timerHost = globalThis,
} = {}) {
  if (typeof RecorderClass !== "function") throw new Error("Opus recorder constructor is required.");
  if (typeof encoderPath !== "string" || encoderPath.length === 0) throw new Error("Opus encoder worker path is required.");

  return Object.freeze({
    socketOpen: WebSocketClass.OPEN,
    socketClosing: WebSocketClass.CLOSING,
    now: () => performanceClock.now(),
    setTimeout: (callback, delay) => timerHost.setTimeout(callback, delay),
    clearTimeout: (timer) => timerHost.clearTimeout(timer),
    setInterval: (callback, delay) => timerHost.setInterval(callback, delay),
    clearInterval: (timer) => timerHost.clearInterval(timer),
    createPlaybackContext: () => new AudioContextClass({ sampleRate: AUDIO_RATE }),
    createPlaybackNode: (context) => new AudioWorkletNodeClass(context, "personaplex-playback", { outputChannelCount: [1] }),
    createDecoderWorker: () => new WorkerClass("/assets/decoderWorker.min.js"),
    getUserMedia: (constraints) => mediaDevices.getUserMedia(constraints),
    createCaptureContext: () => new AudioContextClass({ sampleRate: AUDIO_RATE }),
    createRecorder: (sourceNode) => new RecorderClass({
      sourceNode,
      encoderPath,
      encoderSampleRate: AUDIO_RATE,
      encoderFrameSize: 20,
      maxFramesPerPage: 2,
      numberOfChannels: 1,
      streamPages: true,
      monitorGain: 0,
      recordingGain: 1,
    }),
    createSocket: () => new WebSocketClass(`ws://${locationHost}/realtime`),
  });
}
