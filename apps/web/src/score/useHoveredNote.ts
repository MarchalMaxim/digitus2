/**
 * The note under the mouse pointer in the score (issue #96): the keyboard presses its key with
 * its finger number while the pointer rests on it, and lifts it when the pointer leaves. Mouse
 * only (a touch screen has nothing to hover, and a tap already cues a bar and presses its keys),
 * and only while `enabled` (stopped or paused: playing, the keyboard belongs to the cursor).
 *
 * The hit test is the per-page measurement of bars.ts: the pages are located once per layout
 * (`pageBars`), and the notes of a page are measured (`noteBoxes`) the first time the pointer is
 * over that page, never per pointer move. The state changes only when the note changes.
 */
import { useEffect, useRef, useState } from 'react';
import { pageBars, type PageBars } from './bars.js';
import { noteAt, noteBoxes, type NoteBox } from './noteKey.js';
import { pageWindowOf } from './render/pageWindow.js';

/** How far around a note's drawn box the pointer still counts as on it (px). */
const NOTE_PAD = 3;

export interface HoveredNoteOptions {
  /** The score sheet's host, where the pages are drawn. */
  host: HTMLElement | null;
  /** Changes whenever the notes move: new pages, a new width. */
  layoutKey: unknown;
  /** False while playing: nothing is hovered, and a hover under way ends. */
  enabled: boolean;
}

/** The id of the note under the mouse pointer, or null. */
export function useHoveredNote({ host, layoutKey, enabled }: HoveredNoteOptions): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  const layoutRef = useRef<{ pages: PageBars[]; boxes: Map<PageBars, NoteBox[]> } | null>(null);

  // New pages or a new width: the notes are measured again when next needed.
  useEffect(() => {
    layoutRef.current = null;
    setHovered(null);
  }, [host, layoutKey]);

  useEffect(() => {
    if (!host || !enabled) {
      setHovered(null);
      return;
    }
    const noteUnder = (x: number, y: number): string | null => {
      const origin = host.getBoundingClientRect();
      const top = y - origin.top;
      layoutRef.current ??= { pages: pageBars(host), boxes: new Map() };
      const { pages, boxes } = layoutRef.current;
      const page = pages.find((p) => top >= p.top && top < p.bottom);
      if (!page) return null;
      let own = boxes.get(page);
      if (!own) {
        pageWindowOf(host)?.ensurePage(page.index);
        own = noteBoxes(host, page.page, NOTE_PAD);
        boxes.set(page, own);
      }
      return noteAt(own, x - origin.left, top)?.id ?? null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const id = noteUnder(e.clientX, e.clientY);
      setHovered((h) => (h === id ? h : id));
    };
    const onLeave = () => setHovered(null);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      setHovered(null);
    };
  }, [host, enabled]);

  return hovered;
}
