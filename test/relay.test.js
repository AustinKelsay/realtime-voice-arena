import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { attachRealtimeRelay, BASE_TEXT_PROMPT, BASE_VOICE_PROMPT, loadCredential, loadDirectCredential, MAX_PENDING_BYTES } from "../server.mjs";
import { MAX_SERVER_FRAME_BYTES } from "../src/protocol.js";

const active = [];
afterEach(async () => {
  for (const close of active.splice(0)) await close();
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const onEvent = (...args) => { cleanup(); resolve(args); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => { socket.off(event, onEvent); socket.off("error", onError); };
    socket.once(event, onEvent);
    socket.once("error", onError);
  });
}

async function fixture({ rejectUpstream = false, delayHandshake = false, malformed = false, oversized = false, directUpstream = false } = {}) {
  const upstreamHttp = http.createServer((request, response) => {
    if (rejectUpstream) { response.writeHead(503); response.end(); }
  });
  const upstreamPort = await listen(upstreamHttp);
  const upstreamWss = rejectUpstream ? null : new WebSocketServer({ server: upstreamHttp });
  const relayHttp = http.createServer();
  const relayPort = await listen(relayHttp);
  const relay = attachRealtimeRelay(relayHttp, { credential: "test-key", upstreamUrl: `ws://127.0.0.1:${upstreamPort}`, origin: `http://127.0.0.1:${relayPort}`, directUpstream });
  active.push(async () => { await relay.close(); await new Promise((resolve) => relayHttp.close(resolve)); if (upstreamWss) upstreamWss.close(); await new Promise((resolve) => upstreamHttp.close(resolve)); });
  if (upstreamWss && (delayHandshake || malformed || oversized)) upstreamWss.on("connection", (socket) => {
    const sendHandshake = () => socket.send(new Uint8Array([0x00]));
    if (delayHandshake) setTimeout(sendHandshake, 100); else sendHandshake();
    if (malformed) setTimeout(() => socket.send(new Uint8Array([0x03])), 20);
    if (oversized) setTimeout(() => socket.send(new Uint8Array(MAX_SERVER_FRAME_BYTES + 1)), 20);
  });
  return { upstreamWss, relayPort, relay };
}

test("relay authenticates upstream and preserves binary Persona frames", async () => {
  const { upstreamWss, relayPort } = await fixture();
  let authorization;
  let upstreamRequestUrl;
  upstreamWss.on("connection", (socket, request) => {
    authorization = request.headers.authorization;
    upstreamRequestUrl = request.url;
    socket.send(new Uint8Array([0x00]));
    setTimeout(() => socket.send(new Uint8Array([0x02, 0x6f, 0x6b])), 10);
    socket.on("message", (frame, binary) => { assert.equal(binary, true); socket.send(frame, { binary: true }); });
  });
  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
  const [handshake] = await once(client, "message");
  assert.deepEqual([...handshake], [0]);
  const [semantic] = await once(client, "message");
  assert.deepEqual([...semantic], [0x02, 0x6f, 0x6b]);
  const payload = new Uint8Array([0x01, 0x4f, 0x67, 0x67, 0x53]);
  client.send(payload);
  const [echo] = await once(client, "message");
  assert.deepEqual([...echo], [...payload]);
  assert.equal(authorization, "Bearer test-key");
  assert.equal(upstreamRequestUrl, "/");
  client.close();
});

test("loopback-only direct recovery supplies the fixed base-model preset", async () => {
  const { upstreamWss, relayPort } = await fixture({ directUpstream: true });
  let upstreamRequestUrl;
  upstreamWss.on("connection", (socket, request) => {
    upstreamRequestUrl = request.url;
    socket.send(new Uint8Array([0x00]));
  });
  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, {
    headers: { Origin: `http://127.0.0.1:${relayPort}` },
  });
  await once(client, "message");
  const parsed = new URL(upstreamRequestUrl, "ws://upstream.invalid");
  assert.equal(parsed.searchParams.get("voice_prompt"), BASE_VOICE_PROMPT);
  assert.equal(parsed.searchParams.get("text_prompt"), BASE_TEXT_PROMPT);
  assert.equal(parsed.searchParams.has("persona"), false);
  client.close();
});

test("relay rejects text and pre-handshake client frames", async () => {
  const { relayPort } = await fixture({ delayHandshake: true });
  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
  await once(client, "open");
  client.send(new Uint8Array([0x01, 0x7f]));
  const [code] = await once(client, "close");
  assert.equal(code, 1003);
  const second = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
  await once(second, "open");
  second.send("not binary");
  const [textCode] = await once(second, "close");
  assert.equal(textCode, 1003);
});

test("relay fails closed on malformed and oversized upstream frames", async () => {
  for (const option of [{ malformed: true }, { oversized: true }]) {
    const { relayPort } = await fixture(option);
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
    const [code] = await once(client, "close");
    assert.ok([1003, 1011].includes(code));
  }
});

test("relay.close is awaitable, idempotent, and drains sessions", async () => {
  const { relayPort, relay } = await fixture();
  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
  await once(client, "open");
  const session = [...relay.sessions][0];
  const first = relay.close();
  const second = relay.close();
  assert.equal(first, second);
  await first;
  assert.equal(relay.sessions.size, 0);
  assert.equal(session.client.readyState, WebSocket.CLOSED);
  assert.equal(session.upstream.readyState, WebSocket.CLOSED);
});

test("relay rejects non-loopback origins and non-exact paths", async () => {
  const { relayPort } = await fixture();
  const origin = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, { headers: { Origin: "http://evil.invalid" } });
  const [originError] = await once(origin, "unexpected-response").catch((error) => [error]);
  assert.ok(originError);
  const path = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime?x=1`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
  const [pathError] = await once(path, "unexpected-response").catch((error) => [error]);
  assert.ok(pathError);
  for (const query of ["?persona=unknown", "?persona=mira-vale&persona=otis-blake", "?persona=..%2FNATF0.pt"]) {
    const selected = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime${query}`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
    const [selectionError] = await once(selected, "unexpected-response").catch((error) => [error]);
    assert.ok(selectionError);
  }
});

test("relay fails closed on upstream rejection without exposing details", async () => {
  const { relayPort } = await fixture({ rejectUpstream: true });
  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${relayPort}` } });
  const [code, reason] = await once(client, "close");
  assert.equal(code, 1013);
  assert.match(String(reason), /admission failed/);
  assert.doesNotMatch(String(reason), /test-key|503|wss?:/);
});

test("relay enforces symmetric per-outgoing-socket pending-byte ceilings", async () => {
  assert.equal(MAX_PENDING_BYTES, 1024 * 1024);

  const upstreamCase = await fixture();
  upstreamCase.upstreamWss.on("connection", (socket) => socket.send(new Uint8Array([0x00])));
  const upstreamClient = new WebSocket(`ws://127.0.0.1:${upstreamCase.relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${upstreamCase.relayPort}` } });
  await once(upstreamClient, "message");
  const upstreamSession = [...upstreamCase.relay.sessions][0];
  Object.defineProperty(upstreamSession.upstream, "bufferedAmount", { configurable: true, value: MAX_PENDING_BYTES });
  const upstreamClosed = once(upstreamSession.upstream, "close");
  const relayClientClosed = once(upstreamSession.client, "close");
  upstreamClient.send(new Uint8Array([0x01, 0x7f]));
  const [upstreamCode] = await once(upstreamClient, "close");
  await Promise.all([upstreamClosed, relayClientClosed]);
  assert.equal(upstreamCode, 1009);
  assert.equal(upstreamSession.client.readyState, WebSocket.CLOSED);
  assert.equal(upstreamSession.upstream.readyState, WebSocket.CLOSED);

  const downstreamCase = await fixture();
  downstreamCase.upstreamWss.on("connection", (socket) => socket.send(new Uint8Array([0x00])));
  const downstreamClient = new WebSocket(`ws://127.0.0.1:${downstreamCase.relayPort}/realtime`, { headers: { Origin: `http://127.0.0.1:${downstreamCase.relayPort}` } });
  await once(downstreamClient, "message");
  const downstreamSession = [...downstreamCase.relay.sessions][0];
  Object.defineProperty(downstreamSession.client, "bufferedAmount", { configurable: true, value: MAX_PENDING_BYTES });
  const downstreamClosed = once(downstreamSession.upstream, "close");
  const downstreamRelayClientClosed = once(downstreamSession.client, "close");
  downstreamCase.upstreamWss.clients.forEach((socket) => socket.send(new Uint8Array([0x02, 0x6f])));
  const [downstreamCode] = await once(downstreamClient, "close");
  await Promise.all([downstreamClosed, downstreamRelayClientClosed]);
  assert.equal(downstreamCode, 1009);
  assert.equal(downstreamSession.client.readyState, WebSocket.CLOSED);
  assert.equal(downstreamSession.upstream.readyState, WebSocket.CLOSED);
});

test("credential seam prefers explicit env and otherwise requires a private local file", () => {
  assert.equal(loadCredential({ env: { BENCHLOCAL_REALTIME_API_KEY: " env-key " }, filePath: "/missing" }), "env-key");
  assert.throws(() => loadCredential({ env: { BENCHLOCAL_REALTIME_API_KEY: "bad\nkey" }, filePath: "/missing" }), /unavailable/);
  const directory = mkdtempSync(join(tmpdir(), "realtime-credential-"));
  const path = join(directory, "key");
  try {
    writeFileSync(path, "file-key\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    assert.equal(loadCredential({ env: {}, filePath: path }), "file-key");
    chmodSync(path, 0o644);
    assert.throws(() => loadCredential({ env: {}, filePath: path }), /permissions/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("direct recovery credential is read in memory from only the pinned Spark path", () => {
  let invocation;
  const credential = loadDirectCredential({
    execFileSyncImpl(program, args, options) {
      invocation = { program, args, options };
      return " upstream-token \n";
    },
  });
  assert.equal(credential, "upstream-token");
  assert.equal(invocation.program, "/usr/bin/ssh");
  assert.deepEqual(invocation.args, [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "finite@100.69.70.86",
    "cat /home/finite/personaplex-runtime/upstream.token",
  ]);
  assert.equal(invocation.options.encoding, "utf8");
  assert.throws(
    () => loadDirectCredential({ execFileSyncImpl: () => "\n" }),
    /unavailable/,
  );
  assert.throws(
    () => loadDirectCredential({ execFileSyncImpl: () => "bad\u0000token" }),
    /unavailable/,
  );
});
