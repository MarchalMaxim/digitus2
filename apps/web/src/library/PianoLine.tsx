import { useId, useState } from 'react';
import { useT } from '../i18n/i18n.js';
import {
  askForPiano,
  bluetoothFlag,
  restartBrowser,
  turnOffPiano,
  usePianoHeard,
  usePianoSnapshot,
} from '../midi/piano.js';

/**
 * The piano's name as the reader knows it: Windows names a paired Bluetooth piano's port
 * "GO:PIANO MIDI 1 (Bluetooth MIDI IN)" (issue 182), so a trailing "(MIDI IN)" or "(Bluetooth MIDI
 * IN)", the port's own label, is left out. Any other part of the name stays.
 */
export function pianoName(raw: string): string {
  return raw.replace(/\s*\((?:bluetooth\s+)?midi\s+in(?:put)?\)\s*$/i, '').trim();
}

/**
 * The home line for playing along on the reader's own piano (issue 182), the end line of the
 * page: a once-per-device setup, not a way into a score (a later visit reconnects by itself). One
 * quiet sentence that says where the connection stands, and one text button that is the same
 * element in every state, so the focus survives every change of its label. The press is the
 * reader's consent: the browser is asked only then (a later visit connects silently, see
 * midi/piano.ts). While the browser has granted access but not answered (Windows looking for a
 * Bluetooth piano that is off) the line says it is looking, with Turn off as the way out; the
 * button is busy only while the browser's prompt is open. A listed piano is only found until a
 * note comes from it, and then connected (issue 252): a browser can list a piano whose port never
 * receives, and the line then names the one cure for a Bluetooth piano on Windows. Nothing here
 * is red. Where the browser has no Web MIDI the line is absent. The button is described by the
 * sentence while there is one, so "Turn off" says what it turns off.
 */
export function PianoLine() {
  const t = useT();
  const { status, names } = usePianoSnapshot();
  const heard = usePianoHeard();
  const [flag] = useState(() => bluetoothFlag());
  const sentenceId = useId();
  if (status === 'unsupported') return null;
  const text = t.library.piano;
  const asking = status === 'asking';
  const on = status === 'connected' || status === 'none' || status === 'searching';
  const name = pianoName(names[0] ?? '') || text.yourPiano;
  const browser = restartBrowser(names);
  const found = browser ? `${text.found(name)} ${text.restart(browser)}` : text.found(name);
  const sentence = {
    off: '',
    asking: text.asking,
    searching: text.searching,
    connected: heard ? text.connected(name) : found,
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
