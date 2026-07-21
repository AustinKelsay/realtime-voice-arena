async function closeContext(context) {
  try { await context?.close(); } catch { /* best-effort local cleanup */ }
}

function stopStream(stream) {
  try { stream?.getTracks().forEach((track) => track.stop()); } catch { /* best-effort local cleanup */ }
}

export async function acquirePlayback({ isCurrent, createContext, createNode, moduleUrl = "/audio-playback-worklet.js" }) {
  let context;
  let node;
  let transferred = false;
  try {
    context = createContext();
    await context.resume();
    if (!isCurrent()) throw new Error("Playback startup stopped.");
    await context.audioWorklet.addModule(moduleUrl);
    if (!isCurrent()) throw new Error("Playback startup stopped.");
    node = createNode(context);
    node.connect(context.destination);
    if (!isCurrent()) throw new Error("Playback startup stopped.");
    transferred = true;
    return { context, node };
  } finally {
    if (!transferred) {
      try { node?.disconnect(); } catch { /* best-effort local cleanup */ }
      await closeContext(context);
    }
  }
}

export async function acquireCapture({ isCurrent, getUserMedia, createContext, createRecorder, configureRecorder, constraints }) {
  let stream;
  let context;
  let source;
  let recorder;
  let transferred = false;
  try {
    stream = await getUserMedia(constraints);
    if (!isCurrent()) throw new Error("Microphone startup stopped.");
    context = createContext();
    await context.resume();
    if (!isCurrent()) throw new Error("Microphone startup stopped.");
    source = context.createMediaStreamSource(stream);
    recorder = createRecorder(source);
    configureRecorder(recorder);
    if (!isCurrent()) throw new Error("Microphone startup stopped.");
    transferred = true;
    return { stream, context, source, recorder };
  } finally {
    if (!transferred) {
      try { recorder?.close(); } catch { /* best-effort local cleanup */ }
      try { source?.disconnect(); } catch { /* best-effort local cleanup */ }
      stopStream(stream);
      await closeContext(context);
    }
  }
}
