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
  single = false,
  touch,
  primary = false,
  disabled = false,
  onFile,
}: {
  /** The page, counted from 1. */
  page: number;
  /** The only page of the scan: the message does not number it. */
  single?: boolean;
  touch: boolean;
  primary?: boolean;
  disabled?: boolean;
  onFile(file: File): void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const label = single
    ? touch
      ? t.scan.pages.retakeOnlyTouch
      : t.scan.pages.retakeOnly
    : touch
      ? t.scan.pages.retakeTouch(page)
      : t.scan.pages.retake(page);
  if (touch)
    return (
      <CameraEntry
        label={label}
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
        {label}
      </Button>
      <input
        ref={input}
        hidden
        type="file"
        accept=".png,.jpg,.jpeg,image/jpeg,image/png"
        aria-label={label}
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
