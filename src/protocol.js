export const MODEL = "personaplex-7b-v1";
export const AUDIO_RATE = 24_000;
export const PROTOCOL = Object.freeze({ handshake: 0x00, audio: 0x01, semantic: 0x02 });
export const MAX_CLIENT_FRAME_BYTES = 65_536;
export const MAX_SERVER_FRAME_BYTES = 256 * 1024;
export const MAX_FRAME_BYTES = MAX_CLIENT_FRAME_BYTES;
export const MAX_RELAY_PENDING_BYTES = 1024 * 1024;
export const MAX_JITTER_MS = 150;

const STATUSES = new Set(["ready", "connecting", "live", "stopping", "stopped", "error"]);

export function createSession(startedAt = null) {
  return {
    status: "ready",
    startedAt,
    endedAt: null,
    inputBytes: 0,
    outputBytes: 0,
    inputFrames: 0,
    outputFrames: 0,
    bargeIns: 0,
    terminalReason: null,
    error: null,
    handshakeSeen: false,
  };
}

export function transition(session, event, now = performance.now()) {
  const next = { ...session };
  switch (event?.type) {
    case "start":
      if (["ready", "stopped", "error"].includes(session.status)) {
        next.status = "connecting";
        next.startedAt = now;
        next.endedAt = null;
        next.terminalReason = null;
        next.error = null;
        next.handshakeSeen = false;
      }
      break;
    case "handshake":
      if (session.status === "connecting") {
        next.status = "live";
        next.handshakeSeen = true;
      }
      break;
    case "stop":
      if (["connecting", "live"].includes(session.status)) next.status = "stopping";
      break;
    case "closed":
      if (session.status !== "stopped") {
        next.status = "stopped";
        next.endedAt = now;
        next.terminalReason ||= "user_stop";
      }
      break;
    case "error":
      next.status = "error";
      next.error = "Transport unavailable.";
      next.endedAt = now;
      next.terminalReason = "transport_error";
      break;
    default:
      break;
  }
  if (!STATUSES.has(next.status)) throw new Error("Unknown session state");
  return next;
}

export function validateFrame(value, direction, session = createSession()) {
  if (direction !== "client" && direction !== "server") throw new Error("PersonaPlex frame direction is invalid.");
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : (() => { throw new Error("PersonaPlex frames must be binary."); })();
  const maxBytes = direction === "client" ? MAX_CLIENT_FRAME_BYTES : MAX_SERVER_FRAME_BYTES;
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) throw new Error("PersonaPlex frame exceeds the binary frame bound.");
  const type = bytes[0];
  if (direction === "client" && !session.handshakeSeen) throw new Error("PersonaPlex client audio is not allowed before the handshake.");
  if (direction === "server" && !session.handshakeSeen) {
    if (type !== PROTOCOL.handshake || bytes.byteLength !== 1) throw new Error("PersonaPlex handshake must be the first server frame.");
    return { kind: "handshake" };
  }
  if (type === PROTOCOL.handshake) throw new Error("Unexpected PersonaPlex handshake frame.");
  if (type === PROTOCOL.audio) {
    if (bytes.byteLength < 2) throw new Error("PersonaPlex audio frame is empty.");
    return { kind: "audio", bytes: bytes.byteLength - 1 };
  }
  if (type === PROTOCOL.semantic) {
    if (direction === "client") throw new Error("PersonaPlex clients may send audio frames only.");
    if (bytes.byteLength < 2) throw new Error("PersonaPlex semantic frame is empty.");
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(1)); }
    catch { throw new Error("PersonaPlex semantic frame is not valid UTF-8."); }
    return { kind: "semantic", bytes: bytes.byteLength - 1 };
  }
  throw new Error("Unknown PersonaPlex frame type.");
}

export function sessionHistoryMetadata(session) {
  return {
    model: MODEL,
    status: session.status,
    durationMs: session.startedAt == null || session.endedAt == null ? null : Math.max(0, session.endedAt - session.startedAt),
    inputBytes: session.inputBytes,
    outputBytes: session.outputBytes,
    inputFrames: session.inputFrames,
    outputFrames: session.outputFrames,
    bargeIns: session.bargeIns,
    terminalReason: session.terminalReason,
  };
}
