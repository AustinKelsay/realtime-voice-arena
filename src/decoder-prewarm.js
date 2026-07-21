export function createDecoderPrewarm({ workerFactory, initMessage, warmupPage, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, warmupDelayMs = 100, readyDelayMs = 1_000, onFrame, onRuntimeError } = {}) {
  if (typeof workerFactory !== "function") throw new Error("Decoder worker factory is required.");
  const worker = workerFactory();
  let ready = false;
  let settled = false;
  let warmupTimer;
  let readyTimer;
  let terminated = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    worker.terminate?.();
  };
  const rejectStartup = (error) => {
    if (settled) return;
    settled = true;
    clearTimeoutFn(warmupTimer);
    clearTimeoutFn(readyTimer);
    terminate();
    rejectReady(error);
  };
  const settleReady = () => {
    if (settled) return;
    settled = true;
    ready = true;
    clearTimeoutFn(readyTimer);
    resolveReady();
  };
  worker.onmessage = (event) => onFrame?.(event);
  worker.onerror = (event) => {
    const error = event instanceof Error ? event : new Error("Audio decoder failed.");
    if (ready) onRuntimeError?.(error);
    else rejectStartup(error);
  };
  try { worker.postMessage(initMessage); } catch (error) { rejectStartup(error); }
  if (!settled) {
    warmupTimer = setTimeoutFn(() => {
      if (settled) return;
      try { worker.postMessage({ command: "decode", pages: warmupPage }); } catch (error) { rejectStartup(error); }
    }, warmupDelayMs);
    readyTimer = setTimeoutFn(settleReady, readyDelayMs);
  }
  return {
    worker,
    ready: readyPromise,
    abort() { rejectStartup(new Error("Audio decoder startup stopped.")); },
    terminate,
  };
}
