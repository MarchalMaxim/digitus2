import { useAppStore, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { DropZone } from './DropZone.js';
import {
  formatDuration,
  LEVEL_NAMES,
  pieces,
  recommendedPiece,
  type LibraryPiece,
  type Level,
} from './manifest.js';

/** Pieces grouped by level, levels ascending, pieces in manifest order within a level. */
const piecesByLevel: [Level, LibraryPiece[]][] = (() => {
  const groups = pieces.reduce((acc, p) => {
    const group = acc.get(p.level);
    if (group) group.push(p);
    else acc.set(p.level, [p]);
    return acc;
  }, new Map<Level, LibraryPiece[]>());
  return [...groups.entries()].sort(([a], [b]) => a - b);
})();

export function LibraryView() {
  const openPiece = useAppStore((s) => s.openPiece);
  const openAbout = useAppStore((s) => s.openAbout);
  const setNotice = useAppStore((s) => s.setNotice);
  const start = recommendedPiece();
  // A refusal still showing would be stale in the score view, so opening anything clears it.
  const open = (source: PieceSource) => {
    setNotice(null);
    openPiece(source);
  };

  return (
    <main className="page stack library">
      <header className="stack welcome">
        <h1>digitus2</h1>
        <p className="muted">
          Finger numbers for piano music. Pick a piece, press play, and follow the red note.
        </p>
      </header>

      <section className="card stack" aria-labelledby="start-here">
        <h2 id="start-here">Start here</h2>
        <p>
          <strong>{start.title}</strong> by {start.composer}
        </p>
        <p className="muted">
          {LEVEL_NAMES[start.level]} · {formatDuration(start.approxDurationSec)}
        </p>
        <Button primary onClick={() => open({ kind: 'library', slug: start.slug })}>
          Start with {start.title}
        </Button>
      </section>

      {piecesByLevel.map(([level, group]) => (
        <section key={level} className="level" aria-labelledby={`level-${level}`}>
          <h2 id={`level-${level}`}>
            Level {level}: {LEVEL_NAMES[level]}
          </h2>
          <ul className="piece-list">
            {group.map((p) => (
              <li key={p.slug}>
                <button
                  type="button"
                  className="piece-row"
                  aria-label={`Open ${p.title} by ${p.composer}`}
                  aria-describedby={
                    p.hasEditorialFingering
                      ? `${p.slug}-duration ${p.slug}-tag`
                      : `${p.slug}-duration`
                  }
                  onClick={() => open({ kind: 'library', slug: p.slug })}
                >
                  <span className="title">
                    {p.title}
                    {p.hasEditorialFingering && (
                      <span id={`${p.slug}-tag`} className="tag">
                        editor's fingering
                      </span>
                    )}
                  </span>
                  <span className="composer muted">{p.composer}</span>
                  <span id={`${p.slug}-duration`} className="duration">
                    {formatDuration(p.approxDurationSec)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <DropZone
        onFile={(name, bytes) => open({ kind: 'file', name, bytes })}
        onRefuse={setNotice}
      />

      <footer className="library-footer">
        <button type="button" className="text-button" onClick={openAbout}>
          About and licences
        </button>
      </footer>
    </main>
  );
}
