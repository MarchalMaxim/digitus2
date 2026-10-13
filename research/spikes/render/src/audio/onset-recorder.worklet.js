// THROWAWAY spike: AudioWorklet that reports sample-accurate note onsets of whatever is connected to it.
// onset = first sample with |x| > threshold after at least `quietFrames` consecutive samples below `quiet`.
class OnsetRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.threshold = o.threshold ?? 0.01;
    this.quiet = o.quiet ?? 0.002;
    this.quietNeeded = o.quietFrames ?? 960;
    this.quietCount = this.quietNeeded;
    this.armed = true;
    this.debugEvery = o.debugEvery ?? 0; // frames; >0 posts {level} messages for debugging
    this.levelMax = 0; this.levelFrames = 0;
  }
  process(inputs) {
    const input = inputs[0];
    // no active upstream sources -> Chrome passes an empty input array: that is silence, re-arm
    if (!input || input.length === 0) { this.quietCount = this.quietNeeded; this.armed = true; return true; }
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let c = 0; c < input.length; c++) a = Math.max(a, Math.abs(input[c][i]));
      if (this.debugEvery) { this.levelMax = Math.max(this.levelMax, a); if (++this.levelFrames >= this.debugEvery) { this.port.postMessage({ level: this.levelMax, time: (currentFrame + i) / sampleRate }); this.levelMax = 0; this.levelFrames = 0; } }
      if (a < this.quiet) { if (this.quietCount < this.quietNeeded) this.quietCount++; } else this.quietCount = 0;
      if (!this.armed && this.quietCount >= this.quietNeeded) this.armed = true;
      if (this.armed && a > this.threshold) {
        this.port.postMessage({ frame: currentFrame + i, time: (currentFrame + i) / sampleRate, amp: a });
        this.armed = false;
      }
    }
    return true;
  }
}
registerProcessor('onset-recorder', OnsetRecorder);
