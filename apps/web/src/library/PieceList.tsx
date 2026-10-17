import { Fragment } from 'react';
import { useT } from '../i18n/i18n.js';
import { LengthPills } from './LevelPills.js';
import { type LengthId, type ShelfId } from './levels.js';
import { type Group, type LibraryLayout, type Row, type Section } from './model.js';

export interface PieceListActions {
  onOpen(slug: string): void;
  onOpenShelf(shelf: ShelfId): void;
  /** `All styles`, or Escape: back from an opened shelf to the shelves. */
  onBack(): void;
  /** `Show 40 more` under an opened shelf. */
  onMore(): void;
  /** `All 312 in Medium` or `Show 40 more` under a search section. */
  onSection(section: Section): void;
  onLength(length: LengthId): void;
}

export interface PieceListProps extends PieceListActions {
  layout: LibraryLayout;
  /**
   * The row (counted through the groups of the opened list) the page just appended starts at:
   * rows from there fade in, the ones above stay still. Null when no page was appended.
   */
  freshFrom: number | null;
}

/**
 * The list (shelves spec 4, 5): the shelves with their sample rows, one opened shelf, search
 * sections, or the small library's tiers. The layout says what to draw; this only draws it.
 */
export function PieceList({ layout, freshFrom, ...actions }: PieceListProps) {
  const { onOpen } = actions;
  const t = useT();
  switch (layout.kind) {
    case 'shelves':
      return (
        <>
          {layout.shelves.map((s) => (
            <section key={s.id} className="shelf" aria-labelledby={`shelf-${s.id}`}>
              <div className="shelf-head">
                <h2 id={`shelf-${s.id}`}>{s.name}</h2>
                <span className="count muted">{t.library.pieces(s.count)}</span>
              </div>
              <p className="muted">{s.line}</p>
              <Rows rows={s.rows} offset={0} freshFrom={null} onOpen={onOpen} />
              {s.all !== null && (
                <button
                  type="button"
                  className="text-button"
                  data-shelf-all={s.id}
                  onClick={() => actions.onOpenShelf(s.id)}
                >
                  {s.all}
                </button>
              )}
            </section>
          ))}
        </>
      );
    case 'shelf':
      return (
        <section className="shelf" aria-labelledby="shelf-open">
          <button type="button" className="text-button back" onClick={actions.onBack}>
            {t.library.list.allStyles}
          </button>
          <div className="shelf-head">
            <h2 id="shelf-open" tabIndex={-1}>
              {layout.name}
            </h2>
            <span className="count muted">{t.library.pieces(layout.count)}</span>
          </div>
          {layout.lengths && (
            <LengthPills
              lengths={layout.lengths}
              length={layout.length}
              onChange={actions.onLength}
            />
          )}
          <Groups groups={layout.groups} freshFrom={freshFrom} onOpen={onOpen} />
          {layout.more !== null && (
            <button type="button" className="text-button" onClick={actions.onMore}>
              {layout.more}
            </button>
          )}
        </section>
      );
    case 'search':
      return (
        <>
          {layout.lengths && (
            <LengthPills
              lengths={layout.lengths}
              length={layout.length}
              onChange={actions.onLength}
            />
          )}
          {layout.sections.map((s) => (
            <section
              key={s.tier}
              className="level-section"
              aria-labelledby={`level-${s.tier}`}
              data-section={s.tier}
            >
              <div className="shelf-head">
                <h2 id={`level-${s.tier}`}>{t.library.tiers[s.tier]}</h2>
                <span className="count muted">{t.library.pieces(s.count)}</span>
              </div>
              <Groups groups={s.groups} freshFrom={s.open ? freshFrom : null} onOpen={onOpen} />
              {s.action !== null && (
                <button type="button" className="text-button" onClick={() => actions.onSection(s)}>
                  {s.action.label}
                </button>
              )}
            </section>
          ))}
        </>
      );
    case 'all':
      return (
        <>
          {layout.sections.map((s) => (
            <section key={s.tier} className="level-section" aria-labelledby={`level-${s.tier}`}>
              <h2 id={`level-${s.tier}`}>{t.library.tiers[s.tier]}</h2>
              <Groups groups={s.groups} freshFrom={null} onOpen={onOpen} />
            </section>
          ))}
        </>
      );
  }
}

interface GroupsProps {
  groups: Group[];
  freshFrom: number | null;
  onOpen(slug: string): void;
}

function Groups({ groups, freshFrom, onOpen }: GroupsProps) {
  let offset = 0;
  return (
    <>
      {groups.map((g) => {
        const rows = <Rows rows={g.rows} offset={offset} freshFrom={freshFrom} onOpen={onOpen} />;
        offset += g.rows.length;
        return g.heading === null ? (
          <Fragment key={g.key}>{rows}</Fragment>
        ) : (
          <div key={g.key} className="collection">
            <h3>{g.heading}</h3>
            {rows}
          </div>
        );
      })}
    </>
  );
}

interface RowsProps {
  rows: Row[];
  /** How many rows of the list come before these. */
  offset: number;
  freshFrom: number | null;
  onOpen(slug: string): void;
}

function Rows({ rows, offset, freshFrom, onOpen }: RowsProps) {
  return (
    <ul className="piece-list">
      {rows.map((r, i) => (
        <li
          key={r.slug}
          className={freshFrom !== null && offset + i >= freshFrom ? 'is-new' : undefined}
        >
          <button
            type="button"
            className="piece-row"
            aria-label={r.label}
            aria-describedby={`${r.slug}-duration`}
            onClick={() => onOpen(r.slug)}
          >
            <span className="title">{r.title}</span>
            <span id={`${r.slug}-duration`} className="duration">
              {r.duration}
            </span>
            {r.composerLine !== null && <span className="composer muted">{r.composerLine}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
