import { scanType, validateScan, validateScanImages } from '../scan/model.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store.js';
import type { Phrase } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';

/** What a refusal tells the reader: a text, or a Phrase written in the language on screen. */
export type Refusal = string | Phrase;

export const NOT_A_SCORE_REFUSAL: Phrase = (t) => t.library.ownFile.notScore;

/** The refusal for a failed validation: the error's own text, else `fallback`. */
function refusalOf(cause: unknown, fallback: Phrase): Refusal {
  if (cause instanceof PhraseError) return cause.phrase;
  return cause instanceof Error ? cause.message : fallback;
}

const SCORE_EXTENSIONS = ['.musicxml', '.xml', '.mxl', '.mid', '.midi'];

export function acceptScoreFiles(
  files: readonly File[],
  onFile: (name: string, bytes: Uint8Array) => void,
  onRefuse: (message: Refusal) => void,
  onScan?: (files: File[]) => void,
): void {
  if (files.length > 1) {
    if (!onScan) {
      onRefuse((t) => t.library.ownFile.oneAtATime);
      return;
    }
    void validateScanImages(files).then(onScan, (cause: unknown) =>
      onRefuse(refusalOf(cause, (t) => t.library.ownFile.cannotReadFiles)),
    );
    return;
  }
  acceptScoreFile(files[0], onFile, onRefuse, onScan ? (file) => onScan([file]) : undefined);
}

/** One request lifetime for every library input, including camera and window drops. */
export function useScoreFileRequests(
  onFile: (name: string, bytes: Uint8Array) => void,
  onRefuse: (message: Refusal) => void,
  onScan?: (files: File[]) => void,
): (files: readonly File[]) => void {
  const generation = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    generation.current++;
    // Subscribe synchronously: leaving and returning in one React batch must cancel too.
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.view !== previous.view) generation.current++;
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);
  return useCallback(
    (files: readonly File[]) => {
      if (!files.length) return;
      const view = useAppStore.getState().view;
      if (!mounted.current || view.name !== 'library') return;
      const request = ++generation.current;
      const current = () =>
        mounted.current && generation.current === request && useAppStore.getState().view === view;
      acceptScoreFiles(
        files,
        (name, bytes) => {
          if (current()) onFile(name, bytes);
        },
        (message) => {
          if (current()) onRefuse(message);
        },
        onScan
          ? (pages) => {
              if (current()) onScan(pages);
            }
          : undefined,
      );
    },
    [onFile, onRefuse, onScan],
  );
}

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
  onRefuse: (message: Refusal) => void,
  onScan?: (file: File) => void,
): void {
  if (!file) return;
  if (onScan && scanType(file)) {
    void validateScan(file).then(onScan, (error: unknown) =>
      onRefuse(refusalOf(error, (t) => t.library.ownFile.cannotReadFile)),
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
export function useWindowFileDrop(onFiles: (files: readonly File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFiles);
  useLayoutEffect(() => {
    latest.current = onFiles;
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
      latest.current(Array.from(e.dataTransfer?.files ?? []));
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
