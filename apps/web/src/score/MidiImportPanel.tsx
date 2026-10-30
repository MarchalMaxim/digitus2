import { useT } from '../i18n/i18n.js';
import { handCountLine, noteName, SPLIT_KEYS } from './midiCopy.js';

export interface MidiImportPanelProps {
  right: number;
  left: number;
  splitMidi: number | null;
  onSplitChange(value: number | null): void;
}

/**
 * What the MIDI import did (the notes per hand) and the Hand split control, which replaces the
 * automatic hand separation with a fixed split key. The grid the notes were rounded to is not
 * shown: a reader cannot act on it. Never red.
 */
export function MidiImportPanel({ right, left, splitMidi, onSplitChange }: MidiImportPanelProps) {
  const t = useT();
  return (
    <section className="midi-import" aria-label={t.score.midi.label}>
      <p className="small">{handCountLine(right, left, t)}</p>
      <label htmlFor="hand-split">{t.score.midi.splitLabel}</label>
      <select
        id="hand-split"
        value={splitMidi === null ? 'auto' : String(splitMidi)}
        onChange={(e) => {
          const value = e.currentTarget.value;
          onSplitChange(value === 'auto' ? null : Number(value));
        }}
      >
        <option value="auto">{t.score.midi.automatic}</option>
        {SPLIT_KEYS.map((m) => (
          <option key={m} value={String(m)}>
            {noteName(m, t)}
          </option>
        ))}
      </select>
      <p className="muted small">{t.score.midi.splitHelp}</p>
    </section>
  );
}
