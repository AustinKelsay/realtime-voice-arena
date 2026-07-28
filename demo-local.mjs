#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";

import { installLaunchAgent } from "./install-launch-agent.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const packUrl = "http://127.0.0.1:5177/benchlocal.pack.json";

export function requireDemoContract() {
  const manifest = JSON.parse(readFileSync(join(root, "benchlocal.pack.json"), "utf8"));
  if (!manifest.web?.permissions?.includes("media:microphone")) {
    throw new Error("Voice Arena manifest is missing media:microphone.");
  }
  if (manifest.entry !== "http://127.0.0.1:5177/") {
    throw new Error("Voice Arena entry must remain on the fixed loopback origin.");
  }
}

export async function waitForRelay(attempts = 40, fetchImpl = fetch) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(packUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // launchd may still be completing the replacement transaction.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("BenchLocal relay did not become ready on 127.0.0.1:5177.");
}

export async function proveBaseVoice(WebSocketImpl = WebSocket) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocketImpl("ws://127.0.0.1:5177/realtime", {
      headers: { Origin: "http://127.0.0.1:5177" },
      handshakeTimeout: 10_000,
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        socket.terminate();
        reject(error);
      } else {
        socket.close(1000);
        resolve();
      }
    };
    const timer = setTimeout(() => finish(new Error("PersonaPlex handshake timed out.")), 12_000);
    socket.once("message", (data) => {
      if (data.length !== 1 || data[0] !== 0) {
        finish(new Error("PersonaPlex returned an invalid handshake."));
        return;
      }
      finish();
    });
    socket.once("error", finish);
  });
}

export async function refreshInstalledPack() {
  const benchLocalRoot = process.env.BENCHLOCAL_REPO || join(homedir(), "Desktop", "Projects", "BenchLocal");
  const coreEntry = join(benchLocalRoot, "packages", "benchlocal-core", "dist", "index.js");
  const hostEntry = join(benchLocalRoot, "packages", "benchpack-host", "dist", "index.js");
  const appPackage = join(benchLocalRoot, "app", "package.json");
  if (!existsSync(coreEntry) || !existsSync(hostEntry) || !existsSync(appPackage)) {
    throw new Error(`BenchLocal runtime not found at ${benchLocalRoot}. Set BENCHLOCAL_REPO to its checkout.`);
  }

  execFileSync("/usr/bin/osascript", ["-e", 'tell application "BenchLocal" to quit'], { stdio: "ignore" });
  const [{ loadOrCreateConfig }, { installBenchPackFromUrl }] = await Promise.all([
    import(pathToFileURL(coreEntry).href),
    import(pathToFileURL(hostEntry).href),
  ]);
  const { config } = await loadOrCreateConfig();
  const benchLocalVersion = JSON.parse(readFileSync(appPackage, "utf8")).version;
  await installBenchPackFromUrl(config, packUrl, undefined, { benchLocalVersion });
}

export async function runDemo() {
  requireDemoContract();
  installLaunchAgent();
  await waitForRelay();
  await proveBaseVoice();
  await refreshInstalledPack();
  execFileSync("/usr/bin/open", ["-a", "BenchLocal"], { stdio: "ignore" });
  const version = JSON.parse(readFileSync(join(root, "benchlocal.pack.json"), "utf8")).version;
  process.stdout.write(`Realtime Voice Arena ${version} refreshed and ready: ${packUrl}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runDemo();
}
