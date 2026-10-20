import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { HeartIcon } from '../design/HeartIcon.js';
import { useT } from '../i18n/i18n.js';
import { type FavouritesShelf } from './model.js';
import { Rows } from './PieceList.js';

/**
 * A press of a row's heart this soon after a removal is not taken: the rows close up, so the next
 * favourite's heart has just moved under the pointer (a double click, two quick taps), and there
 * is no undo.
 */
export const REMOVE_GUARD_MS = 400;

export interface FavouritesProps {
  shelf: FavouritesShelf;
  onOpen(slug: string): void;
  /** `All 12 favourites`: the shelf shows every favourite from now on in this visit. */
  onAll(): void;
  /** A row's filled heart: the piece is no longer a favourite. */
  onRemove(slug: string): void;
}

/**
 * The Favourites shelf above the levels (issue #78): its name and count, its gray line, the
 * newest five rows and `All {n} favourites`, which shows the rest in place, fades them in and
 * moves the focus to the first of them (the clicked button is gone by then). Each row ends with
 * a filled heart that takes the piece off; the focus moves to the next row's heart, or the one
 * before when the last row went (the last favourite gone, the shelf leaves and LibraryView moves
 * the focus on); a second press within REMOVE_GUARD_MS, or a double click, takes nothing. Its
 * rows' ids are its own, because a favourite may also be one of a shelf's samples below.
 */
export function Favourites({ shelf, onOpen, onAll, onRemove }: FavouritesProps) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const focusRow = useRef<number | null>(null);
  const focusHeart = useRef<number | null>(null);
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
  /** When a heart last took a piece off (performance.now), or null. */
  const lastRemoval = useRef<number | null>(null);
  useEffect(() => {
    const row = focusRow.current;
    const heart = focusHeart.current;
    focusRow.current = null;
    focusHeart.current = null;
    if (row !== null) root.current?.querySelectorAll<HTMLElement>('.piece-row')[row]?.focus();
    if (heart !== null) {
      const hearts = root.current?.querySelectorAll<HTMLElement>('.favourite-remove') ?? [];
      hearts[Math.min(heart, hearts.length - 1)]?.focus();
    }
  });
  const showAll = () => {
    focusRow.current = shelf.rows.length;
    setFreshFrom(shelf.rows.length);
    onAll();
  };
  const remove = (index: number, event: MouseEvent) => {
    const now = performance.now();
    if (event.detail > 1) return;
    if (lastRemoval.current !== null && now - lastRemoval.current < REMOVE_GUARD_MS) return;
    lastRemoval.current = now;
    focusHeart.current = index;
    onRemove(shelf.rows[index]!.slug);
  };
  return (
    <section ref={root} className="shelf favourites" aria-labelledby="favourites-heading">
      <div className="shelf-head">
        <h2 id="favourites-heading">{t.library.favourites.heading}</h2>
        <span className="count muted">{t.library.pieces(shelf.count)}</span>
      </div>
      <p className="muted">{t.library.favourites.line}</p>
      <Rows
        rows={shelf.rows}
        offset={0}
        freshFrom={freshFrom}
        onOpen={onOpen}
        idPrefix="favourite-"
        trailing={(i) => (
          <button
            type="button"
            className="heart-button is-filled favourite-remove"
            aria-label={shelf.rows[i]!.removeLabel}
            onClick={(event) => remove(i, event)}
          >
            <HeartIcon />
          </button>
        )}
      />
      {shelf.all !== null && (
        <button type="button" className="text-button" onClick={showAll}>
          {shelf.all}
        </button>
      )}
    </section>
  );
}
