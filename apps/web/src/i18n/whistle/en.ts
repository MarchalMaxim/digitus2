/**
 * Whistle a tune (issue 237): the library line, the recording in place of it, and the review of a
 * recording. A group of its own in every language, loaded with the whistle code and not with the
 * page, so the library's first load does not grow with them (scripts/check-bundle-size.mjs).
 */
export const whistle = {
  /** The library line that starts a recording; the press is the reader's consent to the microphone. */
  start: 'Whistle a tune',
  /** The one line under the recording's trace. */
  hint: 'Whistle or hum, then press Stop.',
  stop: 'Stop',
  /** The recording's name while it is made, and the heading of its player in the review. */
  recording: 'Recording',
  /** After Stop, while the notes are written. */
  writing: 'Writing the notes…',
  /** The review's button that goes back to the library line to record again. */
  again: 'Whistle again',
  denied: 'The browser blocked the microphone. Allow it in the site settings, then press again.',
  noMicrophone: 'No microphone was found.',
  failed: 'The microphone could not be started.',
  noNotes: 'No notes were heard. Whistle a little louder or closer to the microphone.',
};
