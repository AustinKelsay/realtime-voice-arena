export class PcmQueue {
  constructor(sampleRate = 24_000, maxMs = 150) {
    this.maxSamples = Math.round(sampleRate * maxMs / 1000);
    this.frames = [];
    this.samples = 0;
  }

  push(frame) {
    if (!(frame instanceof Float32Array) || frame.length === 0 || frame.length > this.maxSamples) return false;
    while (this.samples + frame.length > this.maxSamples && this.frames.length) this.samples -= this.frames.shift().length;
    if (this.samples + frame.length > this.maxSamples) return false;
    const copy = frame.slice();
    this.frames.push(copy);
    this.samples += copy.length;
    return true;
  }

  pull(output) {
    output.fill(0);
    let offset = 0;
    while (offset < output.length && this.frames.length) {
      const frame = this.frames[0];
      const count = Math.min(frame.length, output.length - offset);
      output.set(frame.subarray(0, count), offset);
      offset += count;
      if (count === frame.length) this.frames.shift();
      else this.frames[0] = frame.subarray(count);
      this.samples -= count;
    }
    return offset;
  }

  flush() {
    this.frames = [];
    this.samples = 0;
  }
}
