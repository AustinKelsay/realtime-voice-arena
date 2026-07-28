import test from "node:test";
import assert from "node:assert/strict";
import { LAUNCH_AGENT_LABEL, bootstrapWithRetry, renderLaunchAgent } from "../install-launch-agent.mjs";

test("launch agent owns the direct relay lifecycle without embedding a credential", () => {
  const plist = renderLaunchAgent({
    nodePath: "/fixed/node",
    serverPath: "/fixed/arena/server.mjs",
    logDirectory: "/fixed/logs",
  });
  assert.match(plist, new RegExp(LAUNCH_AGENT_LABEL));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /BENCHLOCAL_PERSONAPLEX_DIRECT/);
  assert.match(plist, /\/fixed\/node/);
  assert.match(plist, /\/fixed\/arena\/server\.mjs/);
  assert.doesNotMatch(plist, /token|credential|Authorization|100\.69\.70\.86/);
});

test("launch agent reinstall waits for an asynchronous bootout to settle", () => {
  let attempts = 0;
  let waits = 0;
  bootstrapWithRetry({
    execFileSyncImpl() {
      attempts += 1;
      if (attempts < 3) throw new Error("service still unloading");
    },
    sleepImpl() {
      waits += 1;
    },
    domain: "gui/501",
    destination: "/fixed/agent.plist",
  });
  assert.equal(attempts, 3);
  assert.equal(waits, 2);
});
