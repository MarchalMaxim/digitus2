import { useId, useMemo, useState, type ChangeEvent } from 'react';
import { messageOf } from '../app/errors.js';
import { useAppStore, type HandSize, type PieceSource } from '../app/store.js';
import { downloadText, exportFilename } from '../export/download.js';
import { TIER_NAMES, tierOf } from '../library/levels.js';
import { formatDuration, type LibraryPiece } from '../library/manifest.js';
import { FingerLegend } from './FingerLegend.js';
import { MidiImportPanel } from './MidiImportPanel.js';
import { services, type ScoreDocument } from './useScoreDocument.js';

const HAND_SIZES: { value: HandSize; label: string }[] = [
  { value: 'large', label: 'Large' },
  { value: 'medium', label: 'Medium' },
  { value: 'small', label: 'Small' },
  { value: 'child', label: 'Child' },
];

/**
 * What the hand size changes, under its select (polish plan Task 6, review S9: nothing said it,
 * and a beginner may read "Child" as an easier mode).
 */
export const HAND_SIZE_HELP =
  'Hand size changes the stretches the fingering allows. Choose child or small for small hands.';

export interface SidePanelProps {
  doc: ScoreDocument;
  /** The open piece, for the exported file's name. */
  source: PieceSource;
  /** The library piece, for its facts and its editorial file; null for a dropped file. */
  piece: LibraryPiece | null;
  /** Re-imports a MIDI file with a fixed hand split (null: the automatic separation). */
  setSplitMidi(value: number | null): void;
  /**
   * The score header shows the finger legend too (before the reader's first Play, `useLegendAbove`):
   * the panel's copy then shows only from 900 px, beside the score, where the header's is hidden,
   * so the legend shows once on a screen. Default false: the panel's copy shows at every width.
   */
  legendAbove?: boolean;
}

/**
 * What the finger numbers mean, the MIDI import facts and hand split (MIDI files only), piece
 * facts, the hand size with a line on what it changes, the editor's fingering toggle, export and
 * print, and a closed `Details`
 * disclosure with what only a developer can act on: the solve and layout timings and the
 * reader's warnings (polish plan Task 5, review S7).
 */
export function SidePanel({
  doc,
  source,
  piece,
  setSplitMidi,
  legendAbove = false,
}: SidePanelProps) {
  const handSize = useAppStore((s) => s.settings.handSize);
  const showEditorial = useAppStore((s) => s.settings.showEditorial);
  const setSettings = useAppStore((s) => s.setSettings);
  const setNotice = useAppStore((s) => s.setNotice);
  const [exporting, setExporting] = useState(false);
  const handSizeHelpId = useId();

  // A library piece's editorial file loads only when the toggle is first switched on, so the
  // manifest says whether there is one; a dropped file says so through its own <fingering>s.
  const hasEditorial =
    (piece?.files.fingered ?? null) !== null ||
    (doc.editorial !== null && Object.keys(doc.editorial).length > 0);
  const measures = piece?.measures ?? doc.score?.measures.length ?? null;
  const hands = useMemo(() => {
    const notes = doc.score?.notes ?? [];
    return {
      right: notes.filter((n) => n.hand === 'R').length,
      left: notes.filter((n) => n.hand === 'L').length,
    };
  }, [doc.score]);

  const onHandSize = (e: ChangeEvent<HTMLSelectElement>) =>
    setSettings({ handSize: e.currentTarget.value as HandSize });

  const ready = doc.status === 'ready';
  const timings =
    doc.solveMs !== null && doc.renderMs !== null
      ? { solve: Math.round(doc.solveMs), render: Math.round(doc.renderMs) }
      : null;
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
      <FingerLegend className={legendAbove ? 'wide-only' : undefined} />
      {doc.midiInfo && doc.score && (
        <MidiImportPanel
          info={doc.midiInfo}
          right={hands.right}
          left={hands.left}
          splitMidi={doc.splitMidi}
          onSplitChange={setSplitMidi}
        />
      )}
      {(piece || measures !== null) && (
        <dl className="facts">
          {piece && (
            <>
              <div>
                <dt>Level</dt>
                <dd>{TIER_NAMES[tierOf(piece.level)]}</dd>
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

      <div className="hand-size">
        <label className="field">
          Hand size
          <select value={handSize} onChange={onHandSize} aria-describedby={handSizeHelpId}>
            {HAND_SIZES.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <p id={handSizeHelpId} className="field-help muted small">
          {HAND_SIZE_HELP}
        </p>
      </div>

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

      <div className="panel-actions">
        <button type="button" disabled={!canExport} onClick={() => void onExport()}>
          Export MusicXML
        </button>
        <button type="button" disabled={!ready} onClick={() => window.print()}>
          Print
        </button>
      </div>

      {/* A beginner can act on neither the timings nor the reader's warnings (review S7), so
          they wait behind a disclosure, closed by default; it is there once there is either. */}
      {(timings || doc.warnings.length > 0) && (
        <details className="panel-details">
          <summary>Details</summary>
          {timings && (
            <p className="timings muted small">
              Fingered in {timings.solve} ms · laid out in {timings.render} ms
            </p>
          )}
          {doc.warnings.length > 0 && (
            <ul className="warnings muted small">
              {doc.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </aside>
  );
}
