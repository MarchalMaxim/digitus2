/**
 * One page of a batch photographed again (issue 130): on a phone the camera, on a PC a file
 * chooser, for that page alone. The new photo replaces the page and only it is recognised again;
 * the corrections on the other pages are kept (retake.ts).
 */
import { useRef } from 'react';
import { Button } from '../design/Button.js';
import { useT } from '../i18n/i18n.js';
import { CameraEntry } from './camera/CameraEntry.js';

export function RetakePage({
  page,
  touch,
  primary = false,
  disabled = false,
  onFile,
}: {
  /** The page, counted from 1. */
  page: number;
  touch: boolean;
  primary?: boolean;
  disabled?: boolean;
  onFile(file: File): void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  if (touch)
    return (
      <CameraEntry
        label={t.scan.pages.retakeTouch(page)}
        maxPages={1}
        primary={primary}
        disabled={disabled}
        onFiles={(files) => {
          if (files[0]) onFile(files[0]);
        }}
      />
    );
  return (
    <>
      <Button
        primary={primary}
        className={primary ? undefined : 'text-button'}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {t.scan.pages.retake(page)}
      </Button>
      <input
        ref={input}
        hidden
        type="file"
        accept=".png,.jpg,.jpeg,image/jpeg,image/png"
        aria-label={t.scan.pages.retake(page)}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}
