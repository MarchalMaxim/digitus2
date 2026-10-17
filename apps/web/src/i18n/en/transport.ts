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
  /** Shown when the loop's first bar is after its last. */
  loopReversed: 'The loop needs "from" before "to".',
  samplesFailed: 'The piano sounds could not be loaded. Check the connection and press Play again.',
  playerFailed: 'The player could not be loaded. Check the connection and press Play again.',
};
