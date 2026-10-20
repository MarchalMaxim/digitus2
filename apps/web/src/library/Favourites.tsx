import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/i18n.js';
import { type FavouritesShelf } from './model.js';
import { Rows } from './PieceList.js';

export interface FavouritesProps {
  shelf: FavouritesShelf;
  onOpen(slug: string): void;
  /** `All 12 favourites`: the shelf shows every favourite from now on in this visit. */
  onAll(): void;
}

/**
 * The Favourites shelf above the levels (issue #78): its name and count, the newest five rows
 * and `All {n} favourites`, which shows the rest in place, fades them in and moves the focus to
 * the first of them (the clicked button is gone by then). Its rows' ids are its own, because a
 * favourite may also be one of a shelf's samples below.
 */
export function Favourites({ shelf, onOpen, onAll }: FavouritesProps) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const focusRow = useRef<number | null>(null);
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
  useEffect(() => {
    const index = focusRow.current;
    focusRow.current = null;
    if (index !== null) root.current?.querySelectorAll<HTMLElement>('.piece-row')[index]?.focus();
  });
  const showAll = () => {
    focusRow.current = shelf.rows.length;
    setFreshFrom(shelf.rows.length);
    onAll();
  };
  return (
    <section ref={root} className="shelf favourites" aria-labelledby="favourites-heading">
      <div className="shelf-head">
        <h2 id="favourites-heading">{t.library.favourites.heading}</h2>
        <span className="count muted">{t.library.pieces(shelf.count)}</span>
      </div>
      <Rows
        rows={shelf.rows}
        offset={0}
        freshFrom={freshFrom}
        onOpen={onOpen}
        idPrefix="favourite-"
      />
      {shelf.all !== null && (
        <button type="button" className="text-button" onClick={showAll}>
          {shelf.all}
        </button>
      )}
    </section>
  );
}
