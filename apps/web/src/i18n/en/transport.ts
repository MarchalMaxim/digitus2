/** The transport and practice controls in English, the source every other language must match (messages.ts). */
export const transport = {
  playback: 'Playback',
  play: 'Play',
  pause: 'Pause',
  rewind: 'Rewind',
  tempo: 'Tempo',
  /** A tempo as a percentage of the written tempo. */
  tempoPercent: (n: number) => `${n} %`,
  /** Read aloud by the tempo slider: the percentage, then the tempo it makes. */
  tempoSpoken: (percent: string, qpm: number) => `${percent}, ${qpm} quarter notes per minute`,
  hands: 'Hands',
  /** The three hand options sit on one line at 360 px; the group is named by `hands`, so the
   *  options may drop the word (Les deux, Droite, Gauche). */
  handsBoth: 'Both hands',
  handsRight: 'Right hand',
  handsLeft: 'Left hand',
  metronome: 'Metronome',
  /** Clicks counted before the music starts. */
  countIn: 'Count-in',
  loopBars: 'Loop bars',
  loopFromBar: 'Loop from bar',
  loopToBar: 'Loop to bar',
  loopTo: 'to',
  /** The Practice switch that plays and shows the piece with passing and neighbour notes added (docs/app.md). */
  addNotes: 'Add notes between',
  /** The Practice switch shown while a piano is connected: on, the red waits for the reader's piano (issue 191). */
  practiceMode: 'Practice mode',
  /**
   * The Practice switch under which digitus plays the hand the reader left out (issue 231), named
   * for the hand that would sound: with the right hand chosen, `Hear the left hand`. Shown with a
   * piano connected, Practice mode on, a two-handed piece and one hand chosen; off until turned on.
   */
  hearLeft: 'Hear the left hand',
  hearRight: 'Hear the right hand',
  /** One line in the Practice panel: how to move through the piece (T13). With a mouse and keys. */
  seekHelp: 'Click a bar to go there. ← and → move one bar.',
  /** The same where fingers do the pointing (a phone, a tablet). */
  seekHelpTouch: 'Tap a bar to go there.',
  /** Shown when the loop's first bar is after its last. */
  loopReversed: 'The loop needs "from" before "to".',
  samplesFailed: 'The piano sounds could not be loaded. Check the connection and press Play again.',
  playerFailed: 'The player could not be loaded. Check the connection and press Play again.',
};
