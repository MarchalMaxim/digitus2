import { useSyncExternalStore, type JSX } from 'react';
import { useHeldPitches } from '../midi/piano.js';
import { Keyboard, type KeyboardProps } from './Keyboard.js';
import { NO_GLASS, NO_LEVELS, type LevelStore } from './keyLevels.js';

/** The store of a keyboard that was given none: it never has a level, and never changes. */
const NO_STORE: Pick<LevelStore, 'subscribe' | 'get' | 'glass'> = {
  subscribe: () => () => undefined,
  get: () => NO_LEVELS,
  glass: () => NO_GLASS,
};

/**
 * The on-screen keyboard with the keys held on the reader's own piano (issue 182). It reads the
 * held pitches itself, so a MIDI message re-renders this keyboard and nothing else in the score
 * view: the keys are never a prop of the view. The levels of those keys (issue 185) are read the
 * same way, from the store `usePlayAlong` writes: a level starting or going re-renders this
 * keyboard alone, and one rising re-renders nothing (the keyboard moves it itself). So is the
 * glass (issue 200), the keys let go too soon.
 */
export function PianoKeyboard({
  levels: given,
  ...props
}: Omit<KeyboardProps, 'held' | 'levels' | 'glass'> & { levels?: LevelStore }): JSX.Element {
  const held = useHeldPitches();
  const store = given ?? NO_STORE;
  const levels = useSyncExternalStore(store.subscribe, store.get, store.get);
  const glass = useSyncExternalStore(store.subscribe, store.glass, store.glass);
  return <Keyboard {...props} held={held} levels={levels} glass={glass} />;
}
