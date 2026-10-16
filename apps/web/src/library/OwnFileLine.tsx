import type { ChangeEvent } from 'react';
import { acceptScoreFiles, SCORE_ACCEPT } from './ownFile.js';

// The plan names this module OwnFile.tsx. On Windows' case-insensitive file system an import of
// './OwnFile.js' resolves to ownFile.ts (TypeScript and Vite try .ts before .tsx), so it is
// named after its main export instead.

export interface OwnFileProps {
  onFile(name: string, bytes: Uint8Array): void;
  onRefuse(message: string): void;
  onScan?(files: File[]): void;
}

/** The end line (spec 3): a text button that opens the file chooser; the page never mentions dropping. */
export function OwnFileLine({ onFile, onRefuse, onScan }: OwnFileProps) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    acceptScoreFiles(Array.from(input.files ?? []), onFile, onRefuse, onScan);
    input.value = ''; // choosing the same file again still fires a change
  };
  return (
    <p className="library-end">
      <label className="text-button own-file">
        Open your own score
        <input
          type="file"
          multiple
          accept={SCORE_ACCEPT}
          className="visually-hidden"
          onChange={onChange}
        />
      </label>
    </p>
  );
}

/**
 * Shown only while files are dragged over the window: the screen's one red element then (spec 9).
 * The page beneath is visibility: hidden (library.css), so the start button is not on screen.
 */
export function DropFrame() {
  return (
    <div className="drop-frame is-red" aria-hidden="true">
      <p className="drop-title">Drop to open this file</p>
      <p className="muted">MusicXML, MIDI, photo or PDF</p>
    </div>
  );
}
