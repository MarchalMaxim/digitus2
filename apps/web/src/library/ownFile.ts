import { scanMime, validateScan } from '../scan/model.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const NOT_A_SCORE_REFUSAL =
  'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).';

const SCORE_EXTENSIONS = ['.musicxml', '.xml', '.mxl', '.mid', '.midi'];

/** The file chooser's `accept` list. */
export const SCORE_ACCEPT = [...SCORE_EXTENSIONS, '.png', '.jpg', '.jpeg', '.pdf'].join(',');

export function isScoreFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && SCORE_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

/** Hands a MusicXML or MIDI file over as bytes; anything else, or a failed read, ends in the notice. */
export function acceptScoreFile(
  file: File | undefined,
  onFile: (name: string, bytes: Uint8Array) => void,
  onRefuse: (message: string) => void,
  onScan?: (file: File) => void,
): void {
  if (!file) return;
  if (onScan && scanMime(file.name)) {
    void validateScan(file).then(onScan, (error: unknown) =>
      onRefuse(error instanceof Error ? error.message : 'Could not read this file.'),
    );
    return;
  }
  if (!isScoreFileName(file.name)) {
    onRefuse(NOT_A_SCORE_REFUSAL);
    return;
  }
  // A failed read (the file moved, or permission was lost) still ends in a notice, never silence.
  void file.arrayBuffer().then(
    (buffer) => onFile(file.name, new Uint8Array(buffer)),
    () => onRefuse(NOT_A_SCORE_REFUSAL),
  );
}

/** Whether a drag carries files (a text selection or a link dragged in the page does not). */
export function carriesFiles(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files');
}

/**
 * The whole window takes a dropped file while the library is shown (spec 3, 7.6). Returns true
 * while files are dragged over the window: the page then shows the drop frame. Enter and leave
 * are counted, because moving onto a child element fires a leave for its parent.
 *
 * The listeners are added once, for as long as the caller is mounted, and call the latest
 * callbacks: re-adding them when a callback changed would reset the count in the middle of a drag.
 */
export function useWindowFileDrop(
  onFile: (name: string, bytes: Uint8Array) => void,
  onRefuse: (message: string) => void,
  onScan?: (file: File) => void,
): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ onFile, onRefuse, onScan });
  useLayoutEffect(() => {
    latest.current = { onFile, onRefuse, onScan };
  });
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (carriesFiles(e.dataTransfer)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const { onFile, onRefuse, onScan } = latest.current;
      acceptScoreFile(e.dataTransfer?.files?.[0], onFile, onRefuse, onScan);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return dragging;
}
