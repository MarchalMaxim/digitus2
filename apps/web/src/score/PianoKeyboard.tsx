import type { JSX } from 'react';
import { useHeldPitches } from '../midi/piano.js';
import { Keyboard, type KeyboardProps } from './Keyboard.js';

/**
 * The on-screen keyboard with the keys held on the reader's own piano (issue 182). It reads the
 * held pitches itself, so a MIDI message re-renders this keyboard and nothing else in the score
 * view: the keys are never a prop of the view.
 */
export function PianoKeyboard(props: Omit<KeyboardProps, 'held'>): JSX.Element {
  const held = useHeldPitches();
  return <Keyboard {...props} held={held} />;
}
