import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { proveBaseVoice, waitForRelay } from "../demo-local.mjs";

class FakeSocket extends EventEmitter {
  static instance;

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    FakeSocket.instance = this;
  }

  close(code) {
    this.closeCode = code;
  }

  terminate() {
    this.terminated = true;
  }
}

test("waitForRelay requests the uncached loopback manifest", async () => {
  const calls = [];
  await waitForRelay(1, async (...args) => {
    calls.push(args);
    return { ok: true };
  });
  assert.deepEqual(calls, [["http://127.0.0.1:5177/benchlocal.pack.json", { cache: "no-store" }]]);
});

test("proveBaseVoice validates and closes a successful handshake", async () => {
  const proof = proveBaseVoice(FakeSocket);
  FakeSocket.instance.emit("message", Buffer.from([0]));
  await proof;
  assert.equal(FakeSocket.instance.url, "ws://127.0.0.1:5177/realtime");
  assert.equal(FakeSocket.instance.options.headers.Origin, "http://127.0.0.1:5177");
  assert.equal(FakeSocket.instance.closeCode, 1000);
  assert.equal(FakeSocket.instance.terminated, undefined);
});

test("proveBaseVoice terminates an invalid handshake", async () => {
  const proof = proveBaseVoice(FakeSocket);
  FakeSocket.instance.emit("message", Buffer.from([1]));
  await assert.rejects(proof, /invalid handshake/);
  assert.equal(FakeSocket.instance.terminated, true);
});
