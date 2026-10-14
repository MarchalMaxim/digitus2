import { LEVEL_NAMES } from './levels.js';
import type { Group, LibraryLayout, Row } from './model.js';

export interface PieceListProps {
  layout: LibraryLayout;
  onOpen(slug: string): void;
}

/** The list (spec 6.2): one level under a hidden heading, or level sections with visible headings. */
export function PieceList({ layout, onOpen }: PieceListProps) {
  if (layout.kind === 'level') {
    return (
      <section aria-labelledby="library-list-heading">
        <h2 id="library-list-heading" className="visually-hidden">
          {LEVEL_NAMES[layout.level]}
        </h2>
        <Groups groups={layout.groups} onOpen={onOpen} />
      </section>
    );
  }
  return (
    <>
      {layout.sections.map((s) => (
        <section key={s.level} className="level-section" aria-labelledby={`level-${s.level}`}>
          <h2 id={`level-${s.level}`}>{LEVEL_NAMES[s.level]}</h2>
          <Groups groups={s.groups} onOpen={onOpen} />
        </section>
      ))}
    </>
  );
}

function Groups({ groups, onOpen }: { groups: Group[]; onOpen(slug: string): void }) {
  return (
    <>
      {groups.map((g) =>
        g.heading === null ? (
          <Rows key={g.key} rows={g.rows} onOpen={onOpen} />
        ) : (
          <div key={g.key} className="collection">
            <h3>{g.heading}</h3>
            <Rows rows={g.rows} onOpen={onOpen} />
          </div>
        ),
      )}
    </>
  );
}

function Rows({ rows, onOpen }: { rows: Row[]; onOpen(slug: string): void }) {
  return (
    <ul className="piece-list">
      {rows.map((r) => (
        <li key={r.slug}>
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
