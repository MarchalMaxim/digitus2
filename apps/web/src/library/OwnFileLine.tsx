import { useState, type ChangeEvent } from 'react';
import type { Phrase } from '../i18n/messages.js';
import { useT } from '../i18n/i18n.js';
import { isTouchOnly, namedCapture } from '../scan/phone.js';
import { acceptScoreFiles, SCORE_ACCEPT } from './ownFile.js';

// The plan names this module OwnFile.tsx. On Windows' case-insensitive file system an import of
// './OwnFile.js' resolves to ownFile.ts (TypeScript and Vite try .ts before .tsx), so it is
// named after its main export instead.

export interface OwnFileProps {
  onFile(name: string, bytes: Uint8Array): void;
  onRefuse(message: string | Phrase): void;
  onScan?(files: File[]): void;
}

/**
 * The end line (spec 3): a text button that opens the file chooser; the page never mentions
 * dropping. On a touch-only device a second one opens the camera, to photograph a printed page.
 */
export function OwnFileLine({ onFile, onRefuse, onScan }: OwnFileProps) {
  const t = useT();
  const [camera] = useState(() => !!onScan && isTouchOnly());
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    acceptScoreFiles(Array.from(input.files ?? []), onFile, onRefuse, onScan);
    input.value = ''; // choosing the same file again still fires a change
  };
  return (
    <p className="library-end">
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
      {camera && (
        <label className="text-button own-file">
          {t.scan.phone.takePhoto}
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => {
              const input = e.currentTarget;
              acceptScoreFiles(Array.from(input.files ?? []).map((file) => namedCapture(file)), onFile, onRefuse, onScan);
              input.value = '';
            }}
          />
        </label>
      )}
    </p>
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
