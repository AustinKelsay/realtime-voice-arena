import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_REPEAT_TEXT_CHARS, normalizeRepeatText } from "./src/repeat-contract.js";

export { MAX_REPEAT_TEXT_CHARS };
const MAX_REQUEST_BYTES = 4_096;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const SYNTHESIS_TIMEOUT_MS = 20_000;
const INVALID_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SAY_CONTROL_SEQUENCE = /\[\[/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function run(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input == null ? "ignore" : "pipe", "ignore", "ignore"],
      timeout: SYNTHESIS_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Local speech synthesis failed."));
    });
    if (input != null) child.stdin.end(input);
  });
}

function assertSafeSpeechText(value) {
  const text = normalizeRepeatText(value);
  if (INVALID_TEXT.test(text) || SAY_CONTROL_SEQUENCE.test(text)) {
    const error = new Error("Pasted text contains unsupported control syntax.");
    error.status = 400;
    throw error;
  }
  return text;
}

async function assertBoundedAudioFile(path) {
  const details = await stat(path);
  if (details.size > MAX_AUDIO_BYTES) {
    throw new Error("Local speech synthesis exceeded its size bound.");
  }
}

export async function synthesizeSpeechInput(value) {
  const text = assertSafeSpeechText(value);
  const directory = await mkdtemp(join(tmpdir(), "personaplex-repeat-"));
  const aiff = join(directory, "instruction.aiff");
  const wav = join(directory, "instruction.wav");
  const instruction = `Repeat only the text after this instruction, exactly as spoken, without adding anything. ${text}`;
  try {
    await run("/usr/bin/say", ["-o", aiff], { input: instruction });
    await assertBoundedAudioFile(aiff);
    await run("/usr/bin/afconvert", [
      aiff,
      wav,
      "-f",
      "WAVE",
      "-d",
      "LEI16@24000",
      "-c",
      "1",
    ]);
    await assertBoundedAudioFile(wav);
    return await readFile(wav);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function respond(response, status, body = "") {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      const error = new Error("Request is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request is not valid JSON.");
    error.status = 400;
    throw error;
  }
}

export function createSpeechInputHandler({
  origin,
  synthesize = synthesizeSpeechInput,
} = {}) {
  if (typeof origin !== "string" || !origin) throw new Error("Speech-input origin is required.");
  if (typeof synthesize !== "function") throw new Error("Speech-input synthesizer is required.");

  return async function handleSpeechInput(request, response) {
    const url = new URL(request.url, origin);
    if (url.pathname !== "/speech-input" || url.search) return false;
    if (!LOOPBACK.has(request.socket.remoteAddress)) {
      respond(response, 403);
      return true;
    }
    if (request.method !== "POST") {
      respond(response, 405);
      return true;
    }
    if (
      request.headers.origin !== origin
      || String(request.headers["content-type"] || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      respond(response, 403);
      return true;
    }

    try {
      const payload = await readJson(request);
      let text;
      try {
        text = assertSafeSpeechText(payload?.text);
      } catch (error) {
        respond(response, error instanceof RangeError ? 413 : (error.status || 400));
        return true;
      }
      const wav = await synthesize(text);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": wav.byteLength,
        "Content-Type": "audio/wav",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(wav);
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
        ? error.status
        : 503;
      respond(response, status);
    }
    return true;
  };
}
