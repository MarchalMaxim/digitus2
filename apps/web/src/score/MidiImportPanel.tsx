import type { MidiInfo } from '@digitus2/engine';
import { handCountLine, importLine, noteName, SPLIT_HELP, SPLIT_KEYS } from './midiCopy.js';

export interface MidiImportPanelProps {
  info: MidiInfo;
  right: number;
  left: number;
  splitMidi: number | null;
  onSplitChange(value: number | null): void;
}

/**
 * What the MIDI import did (grid, moved notes, notes per hand) and the Hand split control, which
 * replaces the automatic hand separation with a fixed split key. Never red.
 */
export function MidiImportPanel({
  info,
  right,
  left,
  splitMidi,
  onSplitChange,
}: MidiImportPanelProps) {
  return (
    <section className="midi-import" aria-label="MIDI import">
      <p className="muted small">{importLine(info)}</p>
      <p className="small">{handCountLine(right, left)}</p>
      <label htmlFor="hand-split">Hand split</label>
      <select
        id="hand-split"
        value={splitMidi === null ? 'auto' : String(splitMidi)}
        onChange={(e) => {
          const value = e.currentTarget.value;
          onSplitChange(value === 'auto' ? null : Number(value));
        }}
      >
        <option value="auto">Automatic</option>
        {SPLIT_KEYS.map((m) => (
          <option key={m} value={String(m)}>
            {noteName(m)}
          </option>
        ))}
      </select>
      <p className="muted small">{SPLIT_HELP}</p>
    </section>
  );
}
