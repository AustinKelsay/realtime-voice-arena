#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { installLaunchAgent } from "./install-launch-agent.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const packUrl = "http://127.0.0.1:5177/benchlocal.pack.json";

function requireDemoContract() {
  const manifest = JSON.parse(readFileSync(join(root, "benchlocal.pack.json"), "utf8"));
  if (!manifest.web?.permissions?.includes("media:microphone")) {
    throw new Error("Voice Arena manifest is missing media:microphone.");
  }
  if (manifest.entry !== "http://127.0.0.1:5177/") {
    throw new Error("Voice Arena entry must remain on the fixed loopback origin.");
  }
}

async function waitForRelay(attempts = 15) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(packUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // launchd may still be completing the replacement transaction.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("BenchLocal relay did not become ready on 127.0.0.1:5177.");
}

async function proveNamedPersona(persona = "sora-bennett") {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:5177/realtime?persona=${persona}`, {
      headers: { Origin: "http://127.0.0.1:5177" },
      handshakeTimeout: 10_000,
    });
    const timer = setTimeout(() => reject(new Error("PersonaPlex handshake timed out.")), 12_000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      if (data.length !== 1 || data[0] !== 0) {
        socket.terminate();
        reject(new Error("PersonaPlex returned an invalid handshake."));
        return;
      }
      socket.close(1000);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

requireDemoContract();
installLaunchAgent();
await waitForRelay();
await proveNamedPersona();
execFileSync("/usr/bin/open", ["-a", "BenchLocal"], { stdio: "ignore" });
process.stdout.write(`Realtime Voice Arena ready: ${packUrl}\n`);
