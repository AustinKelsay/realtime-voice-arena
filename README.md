# PersonaPlex Realtime Voice Arena

## Fast local demo

```bash
npm run demo
```

This installs or refreshes the durable loopback relay, waits for the pack to
become ready, proves the base PersonaPlex connection, and opens BenchLocal.
Install `http://127.0.0.1:5177/benchlocal.pack.json` once; subsequent demos use
the same pack URL. Conversation mode requires the manifest's declared
`media:microphone` capability and macOS microphone access for BenchLocal.

[![CI](https://github.com/AustinKelsay/realtime-voice-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/AustinKelsay/realtime-voice-arena/actions/workflows/ci.yml)

An independently versioned BenchLocal web pack extracted from the
finitecomputer/spark-cluster monorepo. This repository is the authoritative
source for the pack; the Spark cluster consumes it as a pinned dependency.

This BenchLocal web pack is the trusted evaluation surface for PersonaPlex 7B
v1. It intentionally uses the unnamed base-model voice, without a custom voice
prompt, injected name/persona instruction, or roster. The retired experiment
and lessons are recorded in [Custom voice experiment](docs/custom-voice-experiment.md).

The **Conversation** tab requests the microphone, opens the local binary relay,
waits for the PersonaPlex handshake, and then streams mono Ogg/Opus pages at 24 kHz while
response audio is decoded and played continuously. Stop conversation releases
every browser resource and closes the session. While assistant audio is active,
a local speech-onset gate flushes the playback queue and suppresses response
playback while the user is speaking; the suppression remains latched until
PersonaPlex yields an audible gap. The WebSocket remains open so PersonaPlex
keeps the same conversation context.

The **Text repeat** tab has an 800-character text area. Speak text sends the
pasted value only to a loopback-only, same-origin endpoint. The local macOS `say` and `afconvert`
tools turn it into a short spoken instruction without putting text in a URL or
process argument. The browser decodes that ephemeral WAV, streams it through
the same Ogg/Opus PersonaPlex session, and plays the base voice's response.
The temporary local files are removed before the request completes. The text,
instruction audio, response audio, and semantic output are never written to
BenchLocal history or application logs. Text repeat is an instruction-following
audition, so PersonaPlex can paraphrase or add words; it is not a deterministic
TTS endpoint.

The no-query transport is deliberate: custom voice and persona conditioning
materially regressed voice quality, conversational quality, and the overall
realtime experience.

## Client architecture

The browser client has one deliberately deep lifecycle boundary:

- `src/conversation-runtime.js` owns the complete conversation: startup,
  generation fencing, audio and transport resource ownership, handshake and
  frame routing, interruption playback yield, stop/error cleanup, and
  content-free history finalization. Its caller-facing surface is limited to
  microphone start, pasted-text start, stop, history restore,
  and state snapshots.
- `src/browser-platform.js` is the browser system-boundary adapter. It pins the
  AudioContext, AudioWorklet, Opus recorder, decoder worker, WebSocket,
  loopback speech-input request, and timer construction used by the runtime.
- `src/main.js` is only the BenchLocal host adapter. It wires the mounted view
  to runtime snapshots and forwards Start, Stop, history, and host-stop events.
- `src/conversation-view.js` mounts the interactive controls once and updates
  their properties in place, so high-frequency audio counters cannot replace a
  button while the operator is clicking it.
- `src/protocol.js` remains the content-free session and binary wire contract.
  Audio acquisition, decoder prewarm, and the speech-onset gate stay as focused
  modules because they independently own asynchronous or signal-processing
  behavior.
- `speech-input.mjs` is the loopback HTTP boundary for pasted text. It accepts
  only same-origin JSON on `/speech-input`, bounds the body and text, invokes
  fixed macOS executables without a shell, returns uncached mono WAV, and
  removes its private temporary directory.

`test/conversation-runtime.test.js` exercises the same runtime interface used by
the page with fakes only at browser, transport, time, and BenchLocal boundaries.
It covers the complete live lifecycle, barge-in without socket closure, stale
startup cancellation, late recorder cleanup, terminal persistence failures,
transport recovery, and read-only history. Static source checks are retained
only for literal UI/legacy-policy assertions; codec and lifecycle contracts are
verified through behavior.

The browser connects only to
`ws://127.0.0.1:5177/realtime` with no query parameters. The Loopback
Credential Relay loads the operator trust domain's normal Pi API Key Gateway
caller key from `~/.config/finite/benchlocal-realtime.key` (the compatibility
default filename) or the `BENCHLOCAL_REALTIME_API_KEY_FILE` override, requiring
mode `0600`; `BENCHLOCAL_REALTIME_API_KEY` is an explicit ephemeral override.
The key must grant the `finite-realtime-session-gateway` API definition. It is
not a second BenchLocal authentication system and must never reuse the protected
`finite-specialization` key. The relay authenticates the fixed public endpoint
`wss://inference.finite.computer/v1/realtime` without adding voice or persona
parameters. The relay rejects all query parameters and alternate paths. The
credential never reaches the page, history, or logs. Both directions are binary-only, bounded, and
byte-preserving; optional server semantic frames are validated and ignored.

## Run locally

```bash
npm install
npm run demo
```

`npm run demo` installs or repairs the durable local relay, checks the real
PersonaPlex handshake, refreshes the installed Voice Arena snapshot through
BenchLocal's own installer, and opens BenchLocal. It expects the BenchLocal
checkout at `~/Desktop/Projects/BenchLocal`; set `BENCHLOCAL_REPO` when it is
elsewhere. There is no stale-pack reinstall step.

The pack
requires a caller key authorized for the Finite realtime gateway; publishing
this client does not publish that credential or grant access to the service.
The Text repeat tab additionally requires macOS because its ephemeral input
speech is produced by the built-in `/usr/bin/say` and `/usr/bin/afconvert`.

When the public realtime route is intentionally withdrawn, an operator may run
the loopback relay directly against the fixed Spark PersonaPlex endpoint:

```bash
BENCHLOCAL_PERSONAPLEX_DIRECT=true \
  npm run dev
```

Direct mode remains bound to `127.0.0.1` and explicitly supplies the same
unnamed `NATF2.pt` teacher preset that the public no-query gateway uses. It is a
local recovery path only; it does not publish or admit the public realtime route.
When no explicit credential is supplied, startup reads the fixed upstream token
directly into memory over batch-mode SSH from the pinned Spark path. It does not
write a local token copy.

Install the durable macOS user service with:

```bash
node install-launch-agent.mjs
```

The generated LaunchAgent uses the current Node executable and checkout path,
starts at login, and restarts the loopback relay if it exits. Its plist contains
no credential.

Tagged releases contain a standalone bundle with the built UI, local
credential relay, source, tests, and manifest. After extracting a release, run
`npm install` and `npm run dev`, then install the loopback manifest URL
above. The loopback boundary is intentional: it keeps the gateway credential
out of the browser and BenchLocal history.

## Upstream

The speech-to-speech model and protocol implementation come from
[NVIDIA PersonaPlex](https://github.com/NVIDIA/personaplex), using
[PersonaPlex 7B v1](https://huggingface.co/nvidia/personaplex-7b-v1). This
repository contains the BenchLocal evaluation surface and credential relay,
not model weights or the Spark deployment.

## Contracts

- Server sends one binary `0x00` handshake first.
- Client continuously sends `0x01` followed by Ogg/Opus pages.
- Server sends `0x01` followed by Ogg/Opus pages and may send `0x02` UTF-8
  semantic frames, which are ignored without rendering or storage.
- Each relay outgoing socket has a symmetric 1 MiB pending-byte ceiling, and
  malformed ordering fails closed.
- Capture requests mono audio with echo cancellation, noise suppression, and
  automatic gain control. `opus-recorder@8.0.5` is pinned at 24 kHz, 20 ms,
  two frames per page, one channel, and streaming pages.
- Playback is a shallow 150 ms PCM queue and flushes on stop, disconnect,
  discontinuity, error, or detected user speech during assistant playback.
- Barge-in detection samples the echo-cancelled microphone locally. It requires
  about 60 ms of speech, tolerates about 240 ms of pauses inside the user's
  phrase, then keeps playback yielded until PersonaPlex supplies about 320 ms
  of silence. It never sends a turn-commit or closes the continuous session.
- The base voice is fixed for every session. The browser uses the public
  no-query contract; direct recovery supplies its equivalent fixed `NATF2.pt`
  teacher preset. Neither path accepts a custom voice or persona identity.
- Pasted text is limited to 800 Unicode characters. `/speech-input` accepts
  only loopback, exact-origin `POST application/json` requests, returns
  `Cache-Control: no-store`, and never forwards literal text to the realtime
  URL or BenchLocal history.

History stores only model/session status, timing, byte/frame and interruption
counts, and a terminal reason. Pasted text, instruction audio, response audio,
semantic content, prompts, and credentials are never stored.
