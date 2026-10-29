/**
 * The review's Whistle again goes back to the library, whose line then starts a new recording on
 * arrival (issue 237). The audio context is made in the press itself, which is the reader's
 * consent: Safari lets a context run only when a press made it, and the library line is not
 * mounted yet at that moment.
 */
let pending: AudioContext | null = null;

export const askToWhistleAgain = () => {
  void pending?.close().catch(() => undefined);
  pending = new AudioContext();
};

/** The context the review made, once, when it asked; the library line records with it. */
export const takeWhistleAgain = (): AudioContext | null => {
  const asked = pending;
  pending = null;
  return asked;
};
