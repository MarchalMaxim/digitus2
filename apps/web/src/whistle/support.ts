/** Where the browser can record: a microphone stream and an AudioWorklet to read it (issue 237). */
export const whistleSupported = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof AudioWorkletNode !== 'undefined';
