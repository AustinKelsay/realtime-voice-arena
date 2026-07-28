#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LAUNCH_AGENT_LABEL = "com.finite.benchlocal-personaplex";

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderLaunchAgent({
  nodePath = process.execPath,
  serverPath = join(dirname(fileURLToPath(import.meta.url)), "server.mjs"),
  logDirectory = join(homedir(), "Library", "Logs"),
} = {}) {
  const workingDirectory = dirname(serverPath);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(serverPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BENCHLOCAL_PERSONAPLEX_DIRECT</key>
    <string>true</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(join(logDirectory, "BenchLocalPersonaPlex.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logDirectory, "BenchLocalPersonaPlex.error.log"))}</string>
</dict>
</plist>
`;
}

export function bootstrapWithRetry({
  execFileSyncImpl = execFileSync,
  sleepImpl = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500),
  domain,
  destination,
  attempts = 5,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      execFileSyncImpl("/bin/launchctl", ["bootstrap", domain, destination], { stdio: "ignore" });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) sleepImpl();
    }
  }
  throw lastError;
}

export function installLaunchAgent({
  execFileSyncImpl = execFileSync,
  userHome = homedir(),
  uid = process.getuid(),
} = {}) {
  const launchAgents = join(userHome, "Library", "LaunchAgents");
  const logs = join(userHome, "Library", "Logs");
  const destination = join(launchAgents, `${LAUNCH_AGENT_LABEL}.plist`);
  const incoming = `${destination}.incoming`;
  mkdirSync(launchAgents, { recursive: true, mode: 0o755 });
  mkdirSync(logs, { recursive: true, mode: 0o755 });
  writeFileSync(incoming, renderLaunchAgent({ logDirectory: logs }), { mode: 0o644 });
  renameSync(incoming, destination);

  const service = `gui/${uid}/${LAUNCH_AGENT_LABEL}`;
  try {
    execFileSyncImpl("/bin/launchctl", ["bootout", service], { stdio: "ignore" });
  } catch {
    // The first install has no loaded service to remove.
  }
  bootstrapWithRetry({
    execFileSyncImpl,
    domain: `gui/${uid}`,
    destination,
  });
  execFileSyncImpl("/bin/launchctl", ["kickstart", "-k", service], { stdio: "inherit" });
  return destination;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const destination = installLaunchAgent();
  process.stdout.write(`BenchLocal PersonaPlex LaunchAgent installed at ${destination}\n`);
}
