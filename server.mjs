import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import WebSocket, { WebSocketServer } from "ws";
import { MAX_CLIENT_FRAME_BYTES, MAX_RELAY_PENDING_BYTES, MAX_SERVER_FRAME_BYTES, PROTOCOL, createSession, validateFrame } from "./src/protocol.js";
import { DEFAULT_PERSONA_ID, findPersona } from "./src/persona-roster.js";

export const HOST = "127.0.0.1";
export const PORT = Number(process.env.REALTIME_VOICE_BENCH_PORT || 5177);
export const UPSTREAM = "wss://inference.finite.computer/v1/realtime";
export const MAX_PENDING_BYTES = MAX_RELAY_PENDING_BYTES;
const DEFAULT_KEY_PATH = join(homedir(), ".config", "finite", "benchlocal-realtime.key");
const VALID_CREDENTIAL = (value) => value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

export function loadCredential({ env = process.env, filePath = env.BENCHLOCAL_REALTIME_API_KEY_FILE || DEFAULT_KEY_PATH } = {}) {
  if (env.BENCHLOCAL_REALTIME_API_KEY) {
    const value = env.BENCHLOCAL_REALTIME_API_KEY.trim();
    if (!VALID_CREDENTIAL(value)) throw new Error("Realtime credential was unavailable.");
    return value;
  }
  try {
    const mode = statSync(filePath).mode;
    if ((mode & 0o077) !== 0) throw new Error("Realtime credential file permissions are too broad.");
    const credential = readFileSync(filePath, { encoding: "utf8", flag: "r" }).trim();
    if (!VALID_CREDENTIAL(credential)) throw new Error("Realtime credential was unavailable.");
    return credential;
  } catch (error) {
    if (error instanceof Error && error.message.includes("permissions")) throw error;
    throw new Error("Realtime credential was unavailable.");
  }
}

function isLoopback(address = "") {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function rejectUpgrade(socket) {
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

function closeSocket(socket, code, reason) {
  if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return;
  if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  else socket.close(code, reason);
}

function bytesOf(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function attachRealtimeRelay(server, { credential, upstreamUrl = UPSTREAM, origin = `http://${HOST}:${PORT}`, WebSocketCtor = WebSocket } = {}) {
  if (!credential || credential.length > 256) throw new Error("Realtime credential was unavailable.");
  const localSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME_BYTES });
  const sessions = new Set();
  let closing;
  let checkClose = () => {};

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${HOST}`);
    const keys = [...url.searchParams.keys()];
    const personaValues = url.searchParams.getAll("persona");
    const personaId = personaValues[0] ?? DEFAULT_PERSONA_ID;
    if (
      url.pathname !== "/realtime"
      || keys.some((key) => key !== "persona")
      || personaValues.length > 1
      || !findPersona(personaId)
      || request.headers.origin !== origin
      || !isLoopback(request.socket.remoteAddress)
    ) return rejectUpgrade(socket);
    localSockets.handleUpgrade(request, socket, head, (client) => {
      localSockets.emit("connection", client, request, personaId);
    });
  });

  localSockets.on("connection", (client, _request, personaId) => {
    let upstream;
    try {
      const selectedUpstream = new URL(upstreamUrl);
      selectedUpstream.searchParams.set("persona", personaId);
      upstream = new WebSocketCtor(selectedUpstream, { headers: { Authorization: `Bearer ${credential}` }, handshakeTimeout: 10_000, maxPayload: MAX_SERVER_FRAME_BYTES });
    } catch {
      closeSocket(client, 1011, "Realtime transport failed.");
      return;
    }
    const upstreamSession = createSession();
    let closed = false;
    const session = { client, upstream };
    sessions.add(session);
    const cleanup = () => {
      if (client.readyState === WebSocket.CLOSED && upstream.readyState === WebSocket.CLOSED) {
        sessions.delete(session);
        checkClose();
      }
    };

    const fail = (code = 1011, reason = "Realtime transport failed.") => {
      if (closed) return;
      closed = true;
      closeSocket(client, code, reason);
      closeSocket(upstream, 1000, "Client closed");
      cleanup();
    };

    client.on("message", (data, binary) => {
      if (closed) return;
      if (!binary) return fail(1003, "Binary frames required.");
      const frame = bytesOf(data);
      try { validateFrame(frame, "client", upstreamSession); }
      catch { return fail(1003, "Invalid PersonaPlex frame."); }
      if (upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount + frame.byteLength > MAX_PENDING_BYTES) return fail(1009, "Realtime relay buffer is full.");
      try { upstream.send(frame, { binary: true }); } catch { fail(1011, "Realtime transport failed."); }
    });

    upstream.on("open", () => {
      if (closed) return upstream.close(1000);
    });

    upstream.on("message", (data, binary) => {
      if (closed) return;
      if (!binary) return fail(1003, "Binary frames required.");
      const frame = bytesOf(data);
      try { validateFrame(frame, "server", upstreamSession); }
      catch { return fail(1003, "Invalid PersonaPlex frame."); }
      if (frame[0] === PROTOCOL.handshake) upstreamSession.handshakeSeen = true;
      if (client.readyState !== WebSocket.OPEN || client.bufferedAmount + frame.byteLength > MAX_PENDING_BYTES) return fail(1009, "Realtime relay buffer is full.");
      try { client.send(frame, { binary: true }); } catch { fail(1011, "Realtime transport failed."); }
    });

    upstream.on("unexpected-response", () => fail(1013, "Realtime session admission failed."));
    upstream.on("error", () => fail(1011, "Realtime transport failed."));
    upstream.on("close", () => {
      if (!closed) fail(1011, "Realtime session closed.");
      cleanup();
    });
    client.on("error", () => fail(1001, "Client closed."));
    client.on("close", () => { if (!closed) fail(1000, "Client closed."); cleanup(); });
  });

  return {
    localSockets,
    sessions,
    close() {
      if (closing) return closing;
      closing = new Promise((resolve) => {
      let localClosed = false;
      checkClose = () => { if (localClosed && sessions.size === 0) resolve(); };
      localSockets.close(() => { localClosed = true; checkClose(); });
      for (const session of [...sessions]) {
        closeSocket(session.client, 1001, "Relay stopping");
        closeSocket(session.upstream, 1000, "Relay stopping");
      }
      setTimeout(() => {
        for (const session of sessions) {
          session.client.terminate();
          session.upstream.terminate();
          sessions.delete(session);
        }
        localClosed = true;
        checkClose();
      }, 500);
      });
      return closing;
    },
  };
}

export async function startServer({ credential, port = PORT } = {}) {
  credential ||= await loadCredential();
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  const server = http.createServer((request, response) => vite.middlewares(request, response));
  const relay = attachRealtimeRelay(server, { credential, origin: `http://${HOST}:${port}` });
  await new Promise((resolve) => server.listen(port, HOST, resolve));
  process.stdout.write(`PersonaPlex Realtime Arena ready at http://${HOST}:${port}\n`);
  let closing;
  const shutdown = async () => {
    closing ||= (async () => { await relay.close(); await vite.close(); await new Promise((resolve) => server.close(resolve)); })();
    await closing;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, relay, shutdown };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await startServer();
