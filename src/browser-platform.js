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
  fetchImpl = globalThis.fetch,
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
    async createTextCapture(text) {
      const response = await fetchImpl("/speech-input", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error("Could not prepare pasted text for PersonaPlex.");
      const context = new AudioContextClass({ sampleRate: AUDIO_RATE });
      try {
        await context.resume();
        const decoded = await context.decodeAudioData(await response.arrayBuffer());
        const source = context.createBufferSource();
        source.buffer = decoded;
        return {
          stream: null,
          context,
          source,
          start: () => source.start(),
        };
      } catch (error) {
        await context.close?.().catch(() => {});
        throw error;
      }
    },
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
    createSocket: (personaId) => {
      const url = new URL(`ws://${locationHost}/realtime`);
      url.searchParams.set("persona", personaId);
      return new WebSocketClass(url.toString());
    },
  });
}
