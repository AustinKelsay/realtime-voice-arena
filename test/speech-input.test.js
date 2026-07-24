import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createSpeechInputHandler, synthesizeSpeechInput } from "../speech-input.mjs";

async function withServer(handler, run) {
  const server = http.createServer(async (request, response) => {
    if (await handler(request, response)) return;
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("loopback speech-input endpoint returns ephemeral WAV for bounded pasted text", async () => {
  const synthesized = [];
  const wav = Buffer.from("RIFF-test-wave");
  const handler = createSpeechInputHandler({
    origin: "http://127.0.0.1:5177",
    synthesize: async (text) => {
      synthesized.push(text);
      return wav;
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/speech-input`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:5177",
      },
      body: JSON.stringify({ text: "The quick brown fox." }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav);
  });
  assert.deepEqual(synthesized, ["The quick brown fox."]);
});

test("speech-input endpoint fails closed on cross-origin, malformed, and oversized text", async () => {
  let calls = 0;
  const handler = createSpeechInputHandler({
    origin: "http://127.0.0.1:5177",
    synthesize: async () => {
      calls += 1;
      return Buffer.from("unused");
    },
  });

  await withServer(handler, async (baseUrl) => {
    const wrongOrigin = await fetch(`${baseUrl}/speech-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.invalid" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(wrongOrigin.status, 403);

    const malformedJson = await fetch(`${baseUrl}/speech-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5177" },
      body: "{",
    });
    assert.equal(malformedJson.status, 400);

    const invalidMediaType = await fetch(`${baseUrl}/speech-input`, {
      method: "POST",
      headers: { "Content-Type": "application/jsonp", Origin: "http://127.0.0.1:5177" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(invalidMediaType.status, 403);

    const empty = await fetch(`${baseUrl}/speech-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5177" },
      body: JSON.stringify({ text: "   " }),
    });
    assert.equal(empty.status, 400);

    const oversized = await fetch(`${baseUrl}/speech-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5177" },
      body: JSON.stringify({ text: "x".repeat(801) }),
    });
    assert.equal(oversized.status, 413);

    const sayControl = await fetch(`${baseUrl}/speech-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5177" },
      body: JSON.stringify({ text: "[[rate 1]] hello" }),
    });
    assert.equal(sayControl.status, 400);
  });
  assert.equal(calls, 0);
});

test("local synthesizer rejects macOS say control sequences before launching tools", async () => {
  await assert.rejects(
    synthesizeSpeechInput("[[slnc 600000]] hello"),
    /unsupported control syntax/i,
  );
});
