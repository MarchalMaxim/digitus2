import { useState, type ChangeEvent } from 'react';
import { messageOf } from '../app/errors.js';
import { useAppStore, type HandSize, type PieceSource } from '../app/store.js';
import { downloadText, exportFilename } from '../export/download.js';
import { formatDuration, LEVEL_NAMES, type LibraryPiece } from '../library/manifest.js';
import { services, type ScoreDocument } from './useScoreDocument.js';

const HAND_SIZES: { value: HandSize; label: string }[] = [
  { value: 'large', label: 'Large' },
  { value: 'medium', label: 'Medium' },
  { value: 'small', label: 'Small' },
  { value: 'child', label: 'Child' },
];

export interface SidePanelProps {
  doc: ScoreDocument;
  /** The open piece, for the exported file's name. */
  source: PieceSource;
  /** The library piece, for its facts and its editorial file; null for a dropped file. */
  piece: LibraryPiece | null;
}

/** Piece facts, the hand size, the editor's fingering toggle, timings, export and print. */
export function SidePanel({ doc, source, piece }: SidePanelProps) {
  const handSize = useAppStore((s) => s.settings.handSize);
  const showEditorial = useAppStore((s) => s.settings.showEditorial);
  const setSettings = useAppStore((s) => s.setSettings);
  const setNotice = useAppStore((s) => s.setNotice);
  const [exporting, setExporting] = useState(false);

  // A library piece's editorial file loads only when the toggle is first switched on, so the
  // manifest says whether there is one; a dropped file says so through its own <fingering>s.
  const hasEditorial =
    (piece?.files.fingered ?? null) !== null ||
    (doc.editorial !== null && Object.keys(doc.editorial).length > 0);
  const measures = piece?.measures ?? doc.score?.measures.length ?? null;

  const onHandSize = (e: ChangeEvent<HTMLSelectElement>) =>
    setSettings({ handSize: e.currentTarget.value as HandSize });

  const ready = doc.status === 'ready';
  const { xml, score, assignment } = doc;
  const canExport = ready && !exporting && xml !== null && score !== null && assignment !== null;

  // Exports the fingering on screen (the engine's, or the editor's when that is shown): the
  // engine worker writes it into the source MusicXML, and the browser saves the text.
  const onExport = async () => {
    if (!canExport) return;
    setExporting(true);
    try {
      const fingered = await services.engine.fingeredXml(xml, score, assignment);
      downloadText(exportFilename(source), fingered);
    } catch (e) {
      setNotice(`Could not export the score: ${messageOf(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside className="side-panel stack no-print" aria-label="Piece and fingering">
      <h2 className="visually-hidden">Piece and fingering</h2>
      {(piece || measures !== null) && (
        <dl className="facts">
          {piece && (
            <>
              <div>
                <dt>Level</dt>
                <dd>
                  {piece.level} · {LEVEL_NAMES[piece.level]}
                </dd>
              </div>
              <div>
                <dt>Key</dt>
                <dd>{piece.key}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{piece.timeSignature}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{formatDuration(piece.approxDurationSec)}</dd>
              </div>
            </>
          )}
          {measures !== null && (
            <div>
              <dt>Bars</dt>
              <dd>{measures}</dd>
            </div>
          )}
        </dl>
      )}

      <label className="field">
        Hand size
        <select value={handSize} onChange={onHandSize}>
          {HAND_SIZES.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </label>

      {hasEditorial && (
        <label className="check">
          <input
            type="checkbox"
            checked={showEditorial}
            onChange={(e) => setSettings({ showEditorial: e.currentTarget.checked })}
          />{' '}
          Show the editor's fingering
        </label>
      )}

      {doc.solveMs !== null && doc.renderMs !== null && (
        <p className="muted small">
          Fingered in {Math.round(doc.solveMs)} ms · laid out in {Math.round(doc.renderMs)} ms
        </p>
      )}

      <div className="panel-actions">
        <button type="button" disabled={!canExport} onClick={() => void onExport()}>
          Export MusicXML
        </button>
        <button type="button" disabled={!ready} onClick={() => window.print()}>
          Print
        </button>
      </div>

      {doc.warnings.length > 0 && (
        <ul className="warnings muted small">
          {doc.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
