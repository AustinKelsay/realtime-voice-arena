function rms(samples) {
  if (!(samples instanceof Float32Array) || samples.length === 0) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / samples.length);
}

export function createBargeInGate({
  speechThreshold = 0.018,
  assistantThreshold = 0.01,
  attackFrames = 3,
  releaseFrames = 12,
  assistantSilenceFrames = 8,
  assistantActiveWindowMs = 750,
  now = () => performance.now(),
  onYield = () => {},
} = {}) {
  if (!(speechThreshold > 0) || !(assistantThreshold > 0)) throw new Error("Barge-in thresholds must be positive.");
  if (!Number.isInteger(attackFrames) || attackFrames < 1) throw new Error("Barge-in attack frames must be positive.");
  if (!Number.isInteger(releaseFrames) || releaseFrames < 1) throw new Error("Barge-in release frames must be positive.");
  if (!Number.isInteger(assistantSilenceFrames) || assistantSilenceFrames < 1) throw new Error("Assistant silence frames must be positive.");
  let speaking = false;
  let yielding = false;
  let attack = 0;
  let release = 0;
  let assistantSilence = 0;
  let lastAssistantAt = Number.NEGATIVE_INFINITY;

  return {
    observeMicrophone(samples) {
      if (rms(samples) >= speechThreshold) {
        attack += 1;
        release = 0;
        if (!speaking && attack >= attackFrames) {
          speaking = true;
          if (now() - lastAssistantAt <= assistantActiveWindowMs) {
            yielding = true;
            assistantSilence = 0;
            onYield();
          }
        }
      } else {
        attack = 0;
        if (speaking) {
          release += 1;
          if (release >= releaseFrames) {
            speaking = false;
            release = 0;
            if (yielding && assistantSilence >= assistantSilenceFrames) yielding = false;
          }
        }
      }
      return speaking;
    },
    routeAssistant(samples) {
      const audible = rms(samples) >= assistantThreshold;
      if (speaking || yielding) {
        assistantSilence = audible ? 0 : assistantSilence + 1;
        if (yielding && !speaking && assistantSilence >= assistantSilenceFrames) yielding = false;
        return false;
      }
      if (audible) lastAssistantAt = now();
      return true;
    },
    reset() {
      speaking = false;
      yielding = false;
      attack = 0;
      release = 0;
      assistantSilence = 0;
      lastAssistantAt = Number.NEGATIVE_INFINITY;
    },
    get speaking() { return speaking; },
    get yielding() { return yielding; },
  };
}
