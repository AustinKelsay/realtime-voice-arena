import { PcmQueue } from "./playback-queue.js";

class PersonaPlexPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new PcmQueue(sampleRate, 150);
    this.port.onmessage = ({ data }) => {
      if (data?.type === "flush") this.queue.flush();
      else if (data?.type === "frame") this.queue.push(data.frame);
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (output) this.queue.pull(output);
    return true;
  }
}

registerProcessor("personaplex-playback", PersonaPlexPlayback);
