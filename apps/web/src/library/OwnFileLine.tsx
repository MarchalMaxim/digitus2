import { useState, type ChangeEvent } from 'react';
import { useT } from '../i18n/i18n.js';
import { CameraEntry } from '../scan/camera/CameraEntry.js';
import { isTouchOnly } from '../scan/phone.js';
import { PianoLine } from './PianoLine.js';
import { SCORE_ACCEPT } from './ownFile.js';

// The plan names this module OwnFile.tsx. On Windows' case-insensitive file system an import of
// './OwnFile.js' resolves to ownFile.ts (TypeScript and Vite try .ts before .tsx), so it is
// named after its main export instead.

export interface OwnFileProps {
  onFiles(files: readonly File[]): void;
}

/**
 * The end line (spec 3): a text button that opens the file chooser; the page never mentions
 * dropping. On a touch-only device the camera, to photograph a printed page, has a line of its
 * own under it, with the camera symbol (issue 143): side by side the two read as one link. Last
 * comes the line for playing along on the reader's own piano (issue 182), only where the browser
 * has Web MIDI.
 */
export function OwnFileLine({ onFiles }: OwnFileProps) {
  const t = useT();
  const [camera] = useState(isTouchOnly);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    onFiles(Array.from(input.files ?? []));
    input.value = ''; // choosing the same file again still fires a change
  };
  return (
    <div className="library-end">
      <label className="text-button own-file">
        {t.library.ownFile.open}
        <input
          type="file"
          multiple
          accept={SCORE_ACCEPT}
          className="visually-hidden"
          onChange={onChange}
        />
      </label>
      {camera && <CameraEntry label={t.scan.phone.takePhoto} onFiles={onFiles} />}
      <PianoLine />
    </div>
  );
}

/**
 * Shown only while files are dragged over the window: the screen's one red element then (spec 9).
 * The page beneath is visibility: hidden (library.css), so the start button is not on screen.
 */
export function DropFrame() {
  const t = useT();
  return (
    <div className="drop-frame is-red" aria-hidden="true">
      <p className="drop-title">{t.library.ownFile.dropTitle}</p>
      <p className="muted">{t.library.ownFile.dropHint}</p>
    </div>
  );
}
