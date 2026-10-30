import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { PieceSource } from '../app/store.js';
import { cursorScrollDelta, SYSTEM_TOP_MARGIN, type Span } from './useCursor.js';

/**
 * Where the reader's system stands when the Practice panel is open on a phone (issue 244): the
 * phone's panel is capped so the layout's tallest system fits above the dock (`.practice-panel`
 * in base.css, from `--dock-rest` and `--system-room`), and opening it brings the reader's system
 * above the dock when the dock would otherwise cover it.
 */

/**
 * Which system the reader is at when the Practice panel opens: the one the red notes are in
 * (`marked`, its index, or negative for none), otherwise the first that starts at or below the
 * top of the band, otherwise the first that is cut at the top of it; -1 when none is there.
 */
export function readerSystemIndex(
  systems: readonly Span[],
  marked: number,
  bandTop: number,
): number {
  if (marked >= 0) return marked;
  const below = systems.findIndex((s) => s.top >= bandTop);
  if (below >= 0) return below;
  return systems.findIndex((s) => s.bottom > bandTop);
}

/**
 * How far the page scrolls (pixels, down is positive) so that `system` stands wholly in `band`,
 * the part of the window above the dock, or null while it already does. The placement of a page
 * turn: its top `SYSTEM_TOP_MARGIN` below the band's top, less when it only just fits.
 */
export function practiceOpenScroll(system: Span, band: Span): number | null {
  return cursorScrollDelta(system, system, true, band);
}

/**
 * The scroll that opening Practice makes, or null for none. A system that stands above the dock
 * as it is does not move the page, once the panel has all its rows (`final`). While "Add notes
 * between" may still add one, the dock is judged as it could be: the system stays only where it
 * would stand above the dock at its tallest (`room`). One the dock covers is placed within `room`,
 * the most of the window the panel's cap leaves it (`systemRoom`), so a panel that grows later
 * covers no more of it than this placement allowed for.
 */
export function practiceScroll(
  system: Span,
  band: Span,
  room: number | null,
  final: boolean,
): number | null {
  if (final && practiceOpenScroll(system, band) === null) return null;
  const worst = room === null ? band.bottom : Math.min(band.bottom, room);
  return practiceOpenScroll(system, { top: band.top, bottom: worst });
}

/**
 * The room the Practice panel leaves above the dock on a phone (pixels): the tallest system and
 * its top margin, so a whole system always fits above it. Null while no system is built.
 */
export function systemRoom(height: number): number | null {
  return height > 0 ? height + SYSTEM_TOP_MARGIN : null;
}

/** Writes the room for the tallest system on the root (`--system-room`), or takes it off. */
export function publishSystemRoom(height: number): void {
  const room = systemRoom(height);
  const style = document.documentElement.style;
  if (room === null) style.removeProperty('--system-room');
  else style.setProperty('--system-room', `${room}px`);
}

/** The tallest system of a layout (its pages at its width) among those built so far. */
export interface TallestSystem {
  pages: readonly string[];
  width: number;
  height: number;
}

/**
 * Starts the tallest system again for a layout, from the heights of the systems built with it.
 * Only a new layout (new pages, or a new width, which scales the systems) does: the systems
 * already in the DOM are what it is counted from.
 */
export function startTallest(
  tallest: TallestSystem,
  pages: readonly string[],
  width: number,
  heights: readonly number[],
): void {
  tallest.pages = pages;
  tallest.width = width;
  tallest.height = Math.max(0, ...heights);
}

/** Raises the layout's tallest system by the heights of systems built since. */
export function raiseTallest(tallest: TallestSystem, heights: readonly number[]): void {
  tallest.height = Math.max(tallest.height, ...heights);
}

const heightsOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll('g.system'), (s) => s.getBoundingClientRect().height);

/**
 * Brings the reader's system above the dock when the dock covers it: the page scrolls at once,
 * the way a page turn places a system. Read from the pages in the DOM. Returns false while no
 * system is built, so the caller tries again when one is.
 */
function showReaderSystem(host: Element, dock: Element, tallest: number, final: boolean): boolean {
  const systems = Array.from(host.querySelectorAll('g.system'));
  if (systems.length === 0) return false;
  const rects = systems.map((system) => system.getBoundingClientRect());
  const root = document.documentElement;
  const viewport = window.innerHeight || root.clientHeight;
  const band = {
    top: parseFloat(getComputedStyle(root).scrollPaddingTop) || 0,
    bottom: viewport - dock.getBoundingClientRect().height,
  };
  const markedSystem = host.querySelector('.is-red')?.closest('g.system') ?? null;
  const index = readerSystemIndex(
    rects,
    markedSystem ? systems.indexOf(markedSystem) : -1,
    band.top,
  );
  const rect = rects[index];
  const delta = rect ? practiceScroll(rect, band, systemRoom(tallest), final) : null;
  if (delta !== null) {
    const max = Math.max(0, root.scrollHeight - root.clientHeight);
    window.scrollTo({
      top: Math.min(max, Math.max(0, window.scrollY + delta)),
      behavior: 'instant',
    });
  }
  return true;
}

/**
 * Below 480 px (issue 244): the layout's tallest system is measured when the layout is made and
 * once the fonts are in (from the systems then built; a long piece builds its pages as the reader
 * comes to them, and the taller ones among them raise it) and published as `--system-room` then
 * and when the panel opens, never while the reader reads, so the dock keeps its height. Opening
 * the panel, or opening a score with it open, brings the reader's system above the dock if the
 * dock would cover it. `ready` says the score is ready, and `decided` that "Add notes between"
 * is (its row, if offered, makes the dock taller). Returns what to call with each page built
 * later.
 */
export function usePracticePlacement({
  narrow,
  open,
  host,
  dock,
  source,
  pages,
  width,
  ready,
  decided,
}: {
  narrow: boolean;
  open: boolean;
  host: HTMLElement | null;
  dock: HTMLElement | null;
  source: PieceSource;
  pages: readonly string[];
  width: number;
  ready: boolean;
  decided: boolean;
}): (page: Element) => void {
  const tallestRef = useRef<TallestSystem>({ pages, width, height: 0 });
  // A new layout is counted from the systems built with it: the sheet's own layout effect has put
  // them in the DOM, and only pages built later reach `noteBuilt`.
  useLayoutEffect(() => {
    if (!host) return;
    startTallest(tallestRef.current, pages, width, heightsOf(host));
    publishSystemRoom(tallestRef.current.height);
    // The systems grow when the music font arrives (the fingering digits and the notes are drawn
    // in it): they are counted again once, when the fonts are in, never later, so the dock keeps
    // its height while the reader reads.
    let current = true;
    const fonts = 'fonts' in document ? document.fonts : null;
    void fonts?.ready.then(() => {
      if (!current) return;
      raiseTallest(tallestRef.current, heightsOf(host));
      publishSystemRoom(tallestRef.current.height);
    });
    return () => {
      current = false;
    };
  }, [host, pages, width]);
  const noteBuilt = useCallback((page: Element) => {
    raiseTallest(tallestRef.current, heightsOf(page));
  }, []);

  const placedRef = useRef<{ source: PieceSource | null; open: boolean; due: boolean }>({
    source: null,
    open: false,
    due: false,
  });
  useLayoutEffect(() => {
    const placed = placedRef.current;
    const opening = open && !placed.open;
    placed.open = open;
    if (!narrow || !open) return;
    if (opening) {
      // Counted again from the pages in the DOM: the room is what the reader sees as it opens.
      if (host) raiseTallest(tallestRef.current, heightsOf(host));
      publishSystemRoom(tallestRef.current.height);
      placed.due = true;
    }
    if (placed.source !== source) {
      placed.source = source;
      placed.due = true;
    }
    if (!placed.due || !host || !dock || !ready) return;
    // "Add notes between" may still add its row to the panel: until it is decided the system is
    // placed for the dock as tall as it can get, and it is looked at again once the row is decided
    // (the page moves then only if the dock covers the system).
    if (showReaderSystem(host, dock, tallestRef.current.height, decided)) placed.due = !decided;
  }, [narrow, open, host, dock, source, pages, ready, decided]);

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--system-room');
    },
    [],
  );
  return noteBuilt;
}
