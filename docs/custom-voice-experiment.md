# Custom voice experiment

## Outcome

The twelve-name custom voice roster was retired from the default Voice Arena
experience on 2026-07-28. In hands-on
conversation, selecting NVIDIA voice prompt files and injecting a matching
name/persona instruction materially reduced voice quality, conversational
quality, and the coherence of the overall realtime experience compared with
PersonaPlex's unnamed base-model path.

Voice Arena now treats the no-query base voice as the product default. The
browser sends no persona identifier. The public gateway's no-query contract and
the direct relay's equivalent fixed `NATF2.pt` teacher preset are the control;
neither accepts a custom voice or identity.

## What we learned

- A voice sample is not an adequate acceptance test for a duplex conversational
  model. Timbre can sound attractive in isolation while turn-taking, prosody,
  interruption recovery, responsiveness, and conversational coherence regress.
- Voice conditioning and persona text are behavior-affecting model inputs, not
  cosmetic UI metadata. They must be evaluated as a new inference profile.
- Adding both a voice prompt and an identity prompt confounds diagnosis. Future
  experiments should change one conditioning variable at a time.
- A roster should remain an evaluation-only surface until it clears a fixed
  conversation benchmark against the base voice. It should not become the
  default merely because short generated samples are diverse.
- The base voice must remain available as the control and rollback path in
  every experiment.

## Acceptance bar for another attempt

Any future custom-voice experiment needs a new Promotion Evidence Fingerprint
and an unchanged, side-by-side benchmark covering at least naturalness,
intelligibility, latency, multi-turn coherence, barge-in recovery, instruction
following, and preference versus the base voice. A candidate is not eligible
for the default roster unless it is non-inferior on the whole conversation
experience, not just on a ten-second audition clip.
