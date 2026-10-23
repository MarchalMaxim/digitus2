import { useId, useState } from 'react';
import { useT } from '../i18n/i18n.js';
import { askForPiano, bluetoothFlag, turnOffPiano, usePianoSnapshot } from '../midi/piano.js';

/**
 * The home line for playing along on the reader's own piano (issue 182), the last row of the end
 * line: one quiet sentence that says where the connection stands, and one text button that is the
 * same element in every state, so the focus survives every change of its label. The press is the
 * reader's consent: the browser is asked only then (a later visit connects silently, see
 * midi/piano.ts). Nothing here is red. Where the browser has no Web MIDI the line is absent. The
 * button is described by the sentence while there is one, so "Turn off" says what it turns off.
 */
export function PianoLine() {
  const t = useT();
  const { status, names } = usePianoSnapshot();
  const [flag] = useState(() => bluetoothFlag());
  const sentenceId = useId();
  if (status === 'unsupported') return null;
  const text = t.library.piano;
  const asking = status === 'asking';
  const on = status === 'connected' || status === 'none';
  const sentence = {
    off: '',
    asking: text.asking,
    connected: text.connected(names[0] || text.yourPiano),
    none: flag === null ? text.none : `${text.none} ${text.bluetoothFlag(flag)}`,
    denied: text.denied,
  }[status];
  const press = () => {
    if (asking) return;
    if (on) turnOffPiano();
    else void askForPiano();
  };
  return (
    <div className="piano-line">
      <p
        id={sentenceId}
        className={sentence === '' ? 'muted small visually-hidden' : 'muted small'}
        role="status"
      >
        {sentence}
      </p>
      <button
        type="button"
        className="text-button"
        aria-describedby={sentence === '' ? undefined : sentenceId}
        aria-disabled={asking || undefined}
        aria-busy={asking || undefined}
        onClick={press}
      >
        {on ? text.turnOff : text.start}
      </button>
    </div>
  );
}
