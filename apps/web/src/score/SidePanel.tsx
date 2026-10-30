import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { messageOf } from '../app/errors.js';
import { useAppStore, type HandSize, type PieceSource } from '../app/store.js';
import { downloadText, exportFilename } from '../export/download.js';
import { installPrintPages, printPages } from '../export/print.js';
import { useT } from '../i18n/i18n.js';
import { tierOf } from '../library/levels.js';
import { attribution, formatDuration, type LibraryPiece } from '../library/manifest.js';
import { FingerLegend } from './FingerLegend.js';
import { MidiImportPanel } from './MidiImportPanel.js';
import { keyName } from './keyName.js';
import { services, type ScoreDocument } from './useScoreDocument.js';
import { injectNoteIds } from './render/injectIds.js';
import { createRenderer, type ScoreRenderer } from './render/renderer.js';

const HAND_SIZES: readonly HandSize[] = ['large', 'medium', 'small', 'child'];

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
  const t = useT();
  const handSize = useAppStore((s) => s.settings.handSize);
  const showEditorial = useAppStore((s) => s.settings.showEditorial);
  const setSettings = useAppStore((s) => s.setSettings);
  const setNotice = useAppStore((s) => s.setNotice);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const paper = useRef<string[] | null>(null);
  const printRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    paper.current = null;
    return () => {
      printRequest.current?.abort();
      paper.current = null;
    };
  }, [doc.printXml, doc.xml, doc.score, doc.assignment, doc.status]);
  const handSizeHelpId = useId();

  // A library piece's editorial file loads only when the toggle is first switched on, so the
  // manifest says whether there is one; a dropped file says so through its own <fingering>s.
  const hasEditorial =
    (piece?.files.fingered ?? null) !== null ||
    (doc.editorial !== null && Object.keys(doc.editorial).length > 0);
  // "Add notes between" (issue #67): the facts, the MIDI hand counts and the export are the plain
  // score's, whichever version is on screen. `plain` is null until the first ready and during a
  // MIDI reopen; the plain version is then the one on screen (useScoreDocument.ts).
  const shownPlain = doc.shownVersion === 'plain';
  const plainScore = doc.plain?.score ?? (shownPlain ? doc.score : null);
  const plainAssignment = doc.plain ? doc.plain.assignment : shownPlain ? doc.assignment : null;
  const measures = piece?.measures ?? plainScore?.measures.length ?? null;
  const hands = useMemo(() => {
    const notes = plainScore?.notes ?? [];
    return {
      right: notes.filter((n) => n.hand === 'R').length,
      left: notes.filter((n) => n.hand === 'L').length,
    };
  }, [plainScore]);

  const onHandSize = (e: ChangeEvent<HTMLSelectElement>) =>
    setSettings({ handSize: e.currentTarget.value as HandSize });

  const ready = doc.status === 'ready';
  const timings =
    doc.solveMs !== null && doc.renderMs !== null
      ? { solve: Math.round(doc.solveMs), render: Math.round(doc.renderMs) }
      : null;
  const { xml } = doc;
  const canExport =
    ready && !exporting && xml !== null && plainScore !== null && plainAssignment !== null;

  // Exports the plain score with the fingering its pages show (the engine's, or the editor's when
  // that is shown), never the added notes: the engine worker writes it into the source MusicXML,
  // and the browser saves the text.
  const onExport = async () => {
    if (!canExport) return;
    setExporting(true);
    try {
      const fingered = await services.engine.fingeredXml(xml, plainScore, plainAssignment);
      downloadText(exportFilename(source), fingered);
    } catch (e) {
      setNotice((t) => t.score.side.exportFailed(messageOf(e, t)));
    } finally {
      setExporting(false);
    }
  };

  const preparePaper = useCallback(
    async (signal: AbortSignal) => {
      const xml = doc.printXml ?? doc.xml;
      if (!xml || !doc.score || !doc.assignment) return null;
      // An independent renderer means a resize cannot supersede print, or print replace the
      // screen's layout. Both hands get their full, current (including editorial) fingering,
      // the engine's with the repeats of a chord bare, as on screen.
      let renderer: ScoreRenderer | undefined;
      try {
        renderer = createRenderer();
        signal.addEventListener('abort', () => renderer?.dispose(), { once: true });
        const fingered = await services.engine.fingeredXml(
          xml,
          doc.score,
          doc.assignment,
          doc.assignment !== doc.editorial,
        );
        if (signal.aborted) return null;
        const { pages } = await renderer.render({
          xml: injectNoteIds(fingered, doc.score),
          widthPx: 760,
          layout: 'print',
          notes: doc.score.notes.length,
        });
        return signal.aborted ? null : pages;
      } finally {
        renderer?.dispose();
      }
    },
    [doc.printXml, doc.xml, doc.score, doc.assignment, doc.editorial],
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const after = () => {
      cleanup?.();
      cleanup = undefined;
    };
    const before = () => {
      if (document.body.classList.contains('printing-score')) return;
      // A native snapshot owns printing now. A pending asynchronous app request must not
      // install another document or open a second dialog when its worker finishes.
      printRequest.current?.abort();
      try {
        cleanup = installPrintPages(
          paper.current ?? [''],
          paper.current ? doc.title : t.score.side.printPrepareFirst,
          paper.current ? doc.composer : '',
          paper.current && piece ? attribution(piece, t) : null,
          paper.current && legendAbove ? t.score.fingerLegend : undefined,
        );
      } catch (e) {
        const failure = t.score.side.printFailed(messageOf(e, t));
        setNotice(() => failure);
        // The native dialog cannot be cancelled from beforeprint. Keep the screen engraving
        // out of its fallback output and explain the refusal on one temporary paper sheet.
        cleanup = installPrintPages([''], failure, '');
      }
    };
    const media = window.matchMedia('print');
    const mediaEnd = () => {
      if (!media.matches) after();
    };
    media.addEventListener('change', mediaEnd);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      media.removeEventListener('change', mediaEnd);
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, [doc.title, doc.composer, piece, t, legendAbove, setNotice]);

  const onPrint = useCallback(async () => {
    if (!ready || printRequest.current || document.body.classList.contains('printing-score'))
      return;
    const request = new AbortController();
    printRequest.current = request;
    setPrinting(true);
    try {
      const pages = paper.current ?? (await preparePaper(request.signal));
      if (!request.signal.aborted) paper.current = pages;
      if (!request.signal.aborted && pages)
        await printPages(
          pages,
          doc.title,
          doc.composer,
          request.signal,
          piece ? attribution(piece, t) : null,
          legendAbove ? t.score.fingerLegend : undefined,
        );
    } catch (e) {
      if (!request.signal.aborted) setNotice((t) => t.score.side.printFailed(messageOf(e, t)));
    } finally {
      if (printRequest.current === request) {
        printRequest.current = null;
        setPrinting(false);
      }
    }
  }, [doc.title, doc.composer, ready, piece, t, legendAbove, setNotice, preparePaper]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!ready || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      void onPrint();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ready, onPrint]);

  return (
    <aside className="side-panel stack no-print" aria-label={t.score.side.label}>
      <h2 className="visually-hidden">{t.score.side.label}</h2>
      <FingerLegend className={legendAbove ? 'wide-only' : undefined} />
      {doc.midiInfo && plainScore && (
        <MidiImportPanel
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
                <dt>{t.score.side.facts.level}</dt>
                <dd>{t.library.tiers[tierOf(piece.level)]}</dd>
              </div>
              <div>
                <dt>{t.score.side.facts.key}</dt>
                <dd>{keyName(piece.key, t)}</dd>
              </div>
              <div>
                <dt>{t.score.side.facts.time}</dt>
                <dd>{piece.timeSignature}</dd>
              </div>
              <div>
                <dt>{t.score.side.facts.length}</dt>
                <dd>{formatDuration(piece.approxDurationSec)}</dd>
              </div>
            </>
          )}
          {measures !== null && (
            <div>
              <dt>{t.score.side.facts.bars}</dt>
              <dd>{measures}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="hand-size">
        <label className="field">
          {t.score.side.handSize.label}
          <select value={handSize} onChange={onHandSize} aria-describedby={handSizeHelpId}>
            {HAND_SIZES.map((size) => (
              <option key={size} value={size}>
                {t.score.side.handSize[size]}
              </option>
            ))}
          </select>
        </label>
        <p id={handSizeHelpId} className="field-help muted small">
          {t.score.side.handSize.help}
        </p>
      </div>

      {hasEditorial && (
        <label className="check">
          <input
            type="checkbox"
            checked={showEditorial}
            onChange={(e) => setSettings({ showEditorial: e.currentTarget.checked })}
          />{' '}
          {t.score.side.showEditorial}
        </label>
      )}

      <div className="panel-actions">
        <button type="button" disabled={!canExport} onClick={() => void onExport()}>
          {t.score.side.exportButton}
        </button>
        <button
          type="button"
          disabled={!ready || printing}
          aria-busy={printing}
          onClick={() => void onPrint()}
        >
          {t.score.side.print}
        </button>
      </div>

      {/* A beginner can act on neither the timings nor the reader's warnings (review S7), so
          they wait behind a disclosure, closed by default; it is there once there is either. */}
      {(timings || doc.warnings.length > 0) && (
        <details className="panel-details">
          <summary>{t.score.side.details}</summary>
          {timings && (
            <p className="timings muted small">
              {t.score.side.timings(timings.solve, timings.render)}
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
