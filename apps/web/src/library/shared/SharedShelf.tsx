import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/i18n.js';
import { listShared, type SharedSummary } from './store.js';
import './shared.css';

export const FIRST_ROWS = 5;
export const NEXT_ROWS = 20;

/**
 * "Shared by readers": the newest shared scores. It draws nothing until at least one exists, and
 * nothing at all when the store cannot be reached. "More shared scores" asks for the next 20 only
 * when a full page came back.
 */
export default function SharedShelf({ onOpen }: { onOpen(id: string): void }) {
  const t = useT().library.shared;
  const [rows, setRows] = useState<SharedSummary[]>([]);
  const [more, setMore] = useState(false);
  const loading = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    let alive = true;
    listShared(FIRST_ROWS).then(
      (found) => {
        if (!alive) return;
        setRows(found);
        setMore(found.length === FIRST_ROWS);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  const showMore = () => {
    const last = rows.at(-1);
    if (loading.current || !last) return;
    loading.current = true;
    const from = rows.length;
    listShared(NEXT_ROWS, last.created)
      .then((found) => {
        setRows((current) => [...current, ...found]);
        setMore(found.length === NEXT_ROWS);
        // The first new row takes the focus: the button it was pressed on may be gone.
        requestAnimationFrame(() =>
          list.current?.querySelectorAll<HTMLElement>('.piece-row')[from]?.focus(),
        );
      })
      .catch(() => setMore(false))
      .finally(() => {
        loading.current = false;
      });
  };
  if (rows.length === 0) return null;
  return (
    <section className="shelf shared-shelf" aria-labelledby="shelf-shared">
      <div className="shelf-head">
        <h2 id="shelf-shared">{t.shelf}</h2>
      </div>
      <ul ref={list} className="piece-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="piece-row"
              aria-label={t.open(row.title)}
              onClick={() => onOpen(row.id)}
            >
              <span className="title">{row.title}</span>
              {row.composer && <span className="composer muted">{row.composer}</span>}
            </button>
          </li>
        ))}
      </ul>
      {more && (
        <button type="button" className="text-button" onClick={showMore}>
          {t.more}
        </button>
      )}
    </section>
  );
}
