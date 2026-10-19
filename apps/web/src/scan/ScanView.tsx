import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { messageOf } from '../app/errors.js';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import { Button } from '../design/Button.js';
import { Loader } from '../design/Loader.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import { downloadText } from '../export/download.js';
import { createEngineClient, type EngineClient } from '../engine/client.js';
import { createRenderer, type ScoreRenderer } from '../score/render/renderer.js';
import { ScoreSheet } from '../score/ScoreSheet.js';
import { useLocale, useT } from '../i18n/i18n.js';
import type { Messages, Phrase } from '../i18n/messages.js';
import {
  createScanClient,
  GRAND_STAFF_WARNING,
  newJobId,
  UNKNOWN_WARNING,
  type ScanServiceMetadata,
} from './client.js';
import { meterOffers, type Correction } from './corrections.js';
import { ImagePages, useBlobUrl } from './ImagePages.js';
import { GRAPHIC_SPAN_TAGS, GRAPHIC_SPAN_WARNING, joinScanPages } from './join.js';
import type { ScanPage, ScanSession } from './model.js';
import { chordOf, parseScanXml, readingOrder, readScanScore } from './notes.js';
import { isTouchOnly } from './phone.js';
import {
  correct,
  timingIssue,
  describeCorrection,
  describeNote,
  describeProblem,
  findProblems,
  NoteEditor,
  noteAt,
  problemNote,
  stepPitch,
  timingText,
  tryCorrection,
  useSelectedMark,
} from './ScanEditor.js';
import './scan.css';

const PdfPreview = lazy(() => import('./PdfPreview.js').then((m) => ({ default: m.PdfPreview })));

const NO_CORRECTIONS: Correction[] = [];

/** The scan in progress: the page on the scanner is named by its job, and stopped by both. */
interface ScanRun {
  cancelled: boolean;
  job?: string;
  controller?: AbortController;
}

/**
 * Review renders the raw recognition, or the reader's corrected copy of it, and never calls solve.
 * Corrections are explicit and listed; the raw recognition is kept and downloadable unchanged.
 */
export function ScanView({ session: initial }: { session: ScanSession }) {
  const [session, setSession] = useState(initial);
  const hasPageRecognition = !!initial.pages?.length && initial.pages.every((page) => !!page.xml);
  const t = useT();
  const [locale] = useLocale();
  const [phase, setPhase] = useState<'ready' | 'scanning' | 'cancelling' | 'review'>(
    initial.xml || hasPageRecognition ? 'review' : 'ready',
  );
  // Errors are kept as phrases, so they follow a change of language while they are on screen.
  const [error, setErrorPhrase] = useState<Phrase | null>(() =>
    hasPageRecognition && !initial.xml && initial.pages!.length > 1
      ? (m: Messages) => m.scan.errors.notCombinedSaved
      : null,
  );
  const setError = (phrase: Phrase | null) => {
    setErrorPhrase(() => phrase);
  };
  const [health, setHealth] = useState<ScanServiceMetadata>();
  const [pages, setPages] = useState<string[]>([]);
  // The XML each worker last finished with: use waits until both match what is on screen.
  // `detail` is the worker's own message, shown only under Recognition details.
  const [rendered, setRendered] = useState<{
    xml: string;
    error: Phrase | null;
    detail?: string;
  }>();
  const [imported, setImported] = useState<{
    xml: string;
    error: Phrase | null;
    detail?: string;
  }>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [combineDetail, setCombineDetail] = useState<string>();
  const [selected, setSelected] = useState(0);
  const [reviewMode, setReviewMode] = useState<'combined' | 'page'>(
    hasPageRecognition && !initial.xml ? 'page' : 'combined',
  );
  const [scanningPage, setScanningPage] = useState(1);
  const [rotating, setRotating] = useState(false);
  const [width, setWidth] = useState(640);
  const [touchOnly] = useState(isTouchOnly);
  const [note, setNote] = useState<number | null>(null);
  const [editStatus, setEditStatusPhrase] = useState<Phrase | null>(null);
  const setEditStatus = (phrase: Phrase | null) => {
    setEditStatusPhrase(() => phrase);
  };
  const [undoStack, setUndoStack] = useState<Correction[][]>([]);
  const [sheetHost, setSheetHost] = useState<HTMLDivElement | null>(null);
  const resultHost = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const client = useRef(createScanClient()).current;
  const active = useRef<ScanRun>({ cancelled: false });
  const alive = useRef(true);
  // One engine and one renderer for the whole review, so a correction re-renders without restarting
  // a worker or recompiling Verovio.
  const workers = useRef<{ engine: EngineClient; renderer: ScoreRenderer } | null>(null);
  const getWorkers = () =>
    (workers.current ??= { engine: createEngineClient(), renderer: createRenderer() });
  const sourceUrl = useBlobUrl(session.file);
  const sourcePages = session.pages ?? [{ id: session.id, file: session.file, xml: session.xml }];
  const batch = sourcePages.length > 1;
  const isImage = session.file.type !== 'application/pdf';
  const corrections = session.corrections ?? NO_CORRECTIONS;
  const corrected = useMemo(
    () => (session.xml ? correct(session.xml, corrections) : undefined),
    [session.xml, corrections],
  );
  const rawScore = useMemo(() => {
    if (!session.xml || !corrections.length) return undefined;
    try {
      return readScanScore(parseScanXml(session.xml));
    } catch {
      return undefined;
    }
  }, [session.xml, corrections.length]);
  const pageMode = batch && reviewMode === 'page';
  const editable = phase === 'review' && !pageMode && !!corrected;
  const importXml = pageMode ? sourcePages[selected]?.xml : (corrected?.xml ?? session.xml);
  const renderXml = pageMode ? sourcePages[selected]?.xml : (corrected?.renderXml ?? session.xml);
  const problems = useMemo(
    () => (editable && corrected ? findProblems(corrected.score) : []),
    [editable, corrected],
  );
  // A misread meter is fixed from its place to check, offered only where the hands agree.
  const offers = useMemo(
    () => (corrected ? meterOffers(corrected.score, problems) : new Map()),
    [corrected, problems],
  );
  const openLibrary = useAppStore((s) => s.openLibrary);
  const busy = phase === 'scanning' || phase === 'cancelling';
  const renderError = rendered && rendered.xml === renderXml ? rendered.error : null;
  const importError = imported && imported.xml === importXml ? imported.error : null;
  const reviewError = renderError ?? importError;
  const settled = rendered?.xml === renderXml && imported?.xml === importXml;
  const canUseResult =
    !!session.xml &&
    reviewMode === 'combined' &&
    rendered?.xml === renderXml &&
    imported?.xml === importXml &&
    pages.length > 0 &&
    !reviewError;
  const selectedNote =
    note !== null && editable ? corrected.score.notes.find((n) => n.ordinal === note) : undefined;
  // Saved corrections that no longer apply are dropped by the next change, never replayed.
  const kept = corrected ? corrections.slice(0, corrected.applied) : corrections;
  // The one red: on Use for fingerings while it can be used (or is still being checked); on a
  // refused recognition, on the first place to check, or on Scan again; on a selected note.
  const useLive =
    canUseResult || (!settled && reviewMode === 'combined' && !!session.xml && !reviewError);
  const nextRed = selectedNote
    ? 'note'
    : useLive
      ? 'use'
      : editable && problems.length
        ? 'problem'
        : 'again';
  useSelectedMark(sheetHost, selectedNote ? note : null, pages);

  useEffect(() => {
    // The scan's controls go away when the review opens: the heading takes the focus.
    if (phase === 'review') heading.current?.focus();
  }, [phase]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const run = active.current;
      run.cancelled = true;
      run.controller?.abort();
      if (run.job) void client.cancel(run.job).catch(() => {});
      workers.current?.engine.dispose();
      workers.current?.renderer.dispose();
      workers.current = null;
    };
  }, [client]);
  useEffect(() => {
    // The scanner sleeps when unused: a health request on arrival wakes it before the button is
    // pressed. Its failure says nothing; the scan itself reports any problem.
    if (phase !== 'ready') return;
    client.health().then(
      (metadata) => {
        if (alive.current) setHealth(metadata);
      },
      () => {},
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = resultHost.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(280, Math.round(element.clientWidth / 80) * 80));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [phase]);
  useEffect(() => {
    // A new mode or page shows its own notation; a correction keeps the old one until the new
    // render arrives, so the sheet never flashes empty.
    setPages([]);
  }, [reviewMode, pageMode ? selected : -1]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!renderXml || phase !== 'review') return;
    let current = true;
    // Render independently of import: an importer refusal must not erase the raw result.
    getWorkers()
      .renderer.render({ xml: renderXml, widthPx: width })
      .then((result) => {
        if (!current) return;
        setPages(result.pages);
        setRendered({ xml: renderXml, error: null });
      })
      .catch((cause: unknown) => {
        if (!current || (cause as Error)?.name === 'SupersededError') return;
        setRendered({
          xml: renderXml,
          error: (m) => m.scan.errors.notationNotShown,
          detail: messageOf(cause),
        });
      });
    return () => {
      current = false;
    };
  }, [renderXml, width, phase]);
  useEffect(() => {
    if (!importXml || phase !== 'review') return;
    let current = true;
    getWorkers()
      .engine.load(importXml, 'scan.musicxml', { preserveNotation: true })
      .then((result) => {
        if (!current) return;
        setWarnings(result.warnings);
        setImported({
          xml: importXml,
          error: result.score.notes.length ? null : (m) => m.scan.errors.noNotes,
        });
      })
      .catch((cause: unknown) => {
        if (current)
          setImported({
            xml: importXml,
            error: (m) => m.scan.errors.notUsable,
            detail: messageOf(cause),
          });
      });
    return () => {
      current = false;
    };
  }, [importXml, phase]);

  const retain = (next: ScanSession) => {
    // The local score library retains completed source/recognition snapshots in IndexedDB.
    useAppStore.setState({ view: { name: 'scan', session: next } });
    setSession(next);
  };
  const arrange = (next: ScanPage[]) => {
    if (busy) return;
    setError(null);
    retain({
      ...session,
      file: next[0]!.file,
      pages: next,
      xml: undefined,
      recognizedAt: undefined,
      recognizer: undefined,
      warnings: undefined,
      corrections: undefined,
    });
  };

  const cancel = async () => {
    const run = active.current;
    const job = run.job;
    run.cancelled = true;
    setPhase('cancelling');
    run.controller?.abort();
    try {
      if (job) await client.cancel(job);
    } catch {
      if (alive.current) setError((m) => m.scan.errors.cancelFailed);
    } finally {
      if (alive.current) setPhase('ready');
    }
  };
  const scan = async () => {
    const run: ScanRun = { cancelled: false };
    active.current = run;
    setError(null);
    setPhase('scanning');
    const results = sourcePages.map((page) => ({ ...page }));
    for (const [index, page] of results.entries()) {
      if (page.xml) continue;
      if (run.cancelled || !alive.current) return;
      setScanningPage(index + 1);
      page.error = undefined;
      // One synchronous request per page, named by a job id so a cancel can reach it at once.
      const job = newJobId();
      const controller = new AbortController();
      run.job = job;
      run.controller = controller;
      try {
        const recognition = await client.recognize(page.file, job, controller.signal);
        if (run.cancelled || !alive.current) return;
        page.xml = recognition.xml;
        page.recognizer = recognition.recognizer ?? health?.recognizer;
        // The service's own warnings stand in for a page that reports none.
        page.warnings = recognition.warnings.length
          ? recognition.warnings
          : (health?.warnings ?? []);
        retain({ ...session, pages: results.map((p) => ({ ...p })) });
      } catch (cause) {
        if (run.cancelled || !alive.current) return;
        if ((cause as Error)?.name === 'AbortError') {
          // Cancelled on the scanner's side: the scan stops, and nothing went wrong.
          run.cancelled = true;
          setPhase('ready');
          return;
        }
        page.error = messageOf(cause);
        retain({ ...session, pages: results.map((p) => ({ ...p })) });
      } finally {
        delete run.job;
        delete run.controller;
      }
    }
    if (run.cancelled || !alive.current) return;
    active.current = { cancelled: false };
    if (results.some((page) => !page.xml)) {
      setSelected(
        Math.max(
          0,
          results.findIndex((page) => !page.xml),
        ),
      );
      const reason = results[0]!.error;
      setError(
        batch
          ? (m) => m.scan.errors.somePagesFailed
          : reason
            ? () => reason
            : (m) => m.scan.errors.recognitionFailed,
      );
      setPhase('ready');
      return;
    }
    let xml: string | undefined;
    try {
      xml = joinScanPages(results.map((page) => page.xml!));
    } catch (cause) {
      setError(batch ? (m) => m.scan.errors.notCombinedSaved : (m) => messageOf(cause, m));
      // The joiner's own reason goes under Recognition details.
      if (batch) setCombineDetail(messageOf(cause));
      setReviewMode('page');
    }
    retain({
      ...session,
      pages: results,
      xml,
      corrections: undefined,
      recognizedAt: new Date().toISOString(),
      recognizer: [...new Set(results.map((p) => p.recognizer).filter(Boolean))].join(', '),
      warnings: [
        ...new Set([
          ...results.flatMap((p) => p.warnings ?? []),
          ...(batch &&
          results.some((p) =>
            new DOMParser().parseFromString(p.xml!, 'text/xml').querySelector(GRAPHIC_SPAN_TAGS),
          )
            ? [GRAPHIC_SPAN_WARNING]
            : []),
        ]),
      ],
    });
    setUndoStack([]);
    setPhase('review');
  };
  const warningText = (warning: string) =>
    warning === GRAPHIC_SPAN_WARNING
      ? t.scan.review.graphicSpanWarning
      : warning === UNKNOWN_WARNING
        ? t.scan.review.unknownWarning
        : warning === GRAND_STAFF_WARNING
          ? t.scan.review.grandStaffWarning
          : warning;
  const useResult = () => {
    if (!canUseResult) return;
    useAppStore.getState().openPiece({
      kind: 'file',
      name: session.file.name.replace(/\.[^.]+$/, '') + '.musicxml',
      bytes: new TextEncoder().encode(corrected?.xml ?? session.xml),
      scan: session,
    });
  };

  // Corrections: each one is checked before it is recorded, and recorded only when it applies.
  const applyCorrection = (correction: Correction) => {
    if (!session.xml || !corrected) return;
    const refusal = tryCorrection(session.xml, kept, correction);
    if (refusal) {
      setEditStatus(refusal);
      return;
    }
    if (correction.kind === 'remove') {
      // A removed chord member hands the selection to the note left in its place.
      // A removed rest hands it to the next note in reading order.
      const target = corrected.score.notes.find((n) => n.ordinal === correction.note);
      const chord = target ? chordOf(corrected.score, target) : [];
      const order = readingOrder(corrected.score);
      const neighbour =
        chord.find((n) => n !== target) ??
        (target?.rest ? order[order.indexOf(target) + 1] : undefined);
      if (neighbour) setNote(neighbour.ordinal);
    }
    setUndoStack((stack) => [...stack, kept]);
    if (correction.kind === 'meter') {
      // The place to check it came from goes away: say what changed, and keep the focus nearby.
      const score = corrected.score;
      setEditStatus((m) => `${describeCorrection(m, score, correction)}.`);
      sheetRef.current?.focus();
    } else setEditStatus(null);
    retain({ ...session, corrections: [...kept, correction] });
  };
  const undo = () => {
    if (!corrections.length && !undoStack.length) return;
    const previous = undoStack.at(-1) ?? corrections.slice(0, -1);
    setUndoStack((stack) => stack.slice(0, -1));
    // Say what was undone: the last correction, when one was taken away.
    const undone =
      previous.length === corrections.length - 1 && rawScore
        ? describeCorrection(t, rawScore, corrections.at(-1)!)
        : '';
    setEditStatus((m) => m.scan.edit.undone(undone));
    retain({ ...session, corrections: previous.length ? previous : undefined });
  };
  const reset = () => {
    if (!corrections.length) return;
    setUndoStack((stack) => [...stack, corrections]);
    setEditStatus((m) => m.scan.edit.resetDone);
    retain({ ...session, corrections: undefined });
  };
  const select = useCallback(
    (ordinal: number | null) => {
      setNote(ordinal);
      setEditStatus(null);
      if (ordinal === null || !sheetHost) return;
      requestAnimationFrame(() =>
        sheetHost.querySelector(`[id="s${ordinal}"]`)?.scrollIntoView?.({ block: 'nearest' }),
      );
    },
    [sheetHost],
  );
  const onSheetClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editable || !sheetHost || !corrected) return;
    // A click a screen reader sends for Enter carries no pointer: it starts at the first note.
    if (event.detail === 0 && !selectedNote) {
      const first = readingOrder(corrected.score)[0];
      if (first) select(first.ordinal);
      return;
    }
    const ordinal = noteAt(sheetHost, event);
    if (ordinal !== undefined) select(ordinal);
  };
  const closeEditor = () => {
    select(null);
    sheetRef.current?.focus();
  };
  const onEditKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!editable || !corrected) return;
    const target = event.target as Element;
    const inSheet = !!target.closest?.('.scan-sheet');
    if (!inSheet && !target.closest?.('.note-editor')) return;
    const order = readingOrder(corrected.score);
    if (!order.length) return;
    const position = selectedNote ? order.indexOf(selectedNote) : -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next =
        position < 0
          ? 0
          : Math.min(
              order.length - 1,
              Math.max(0, position + (event.key === 'ArrowRight' ? 1 : -1)),
            );
      select(order[next]!.ordinal);
    } else if (inSheet && (event.key === 'Enter' || event.key === ' ') && !selectedNote) {
      event.preventDefault();
      select(order[0]!.ordinal);
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && selectedNote?.step) {
      event.preventDefault();
      const up = event.key === 'ArrowUp';
      applyCorrection({
        kind: 'pitch',
        note: selectedNote.ordinal,
        // Shift moves a whole octave, the error a misread clef or ledger line gives.
        ...(event.shiftKey
          ? {
              step: selectedNote.step,
              alter: selectedNote.alter,
              octave: selectedNote.octave + (up ? 1 : -1),
            }
          : stepPitch(corrected.score, selectedNote, up ? 1 : -1)),
      });
    } else if (event.key === 'Escape' && selectedNote) {
      event.preventDefault();
      closeEditor();
    }
  };
  const onReviewKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      if (!editable || !corrections.length) return;
      event.preventDefault();
      undo();
    }
  };
  const baseName = session.file.name.replace(/\.[^.]+$/, '');
  // The bar's timing is said only when the hands disagree or a hand overruns the bar.
  const statusText = editStatus
    ? editStatus(t)
    : selectedNote &&
        corrected &&
        timingIssue(corrected.score, selectedNote.part, selectedNote.measure)
      ? timingText(t, corrected.score, selectedNote.part, selectedNote.measure)
      : '';
  const liveText = editStatus ? editStatus(t) : selectedNote ? describeNote(t, selectedNote) : '';

  return (
    <main className="page scan-view stack" onKeyDown={phase === 'review' ? onReviewKey : undefined}>
      <header className="stack">
        <button className="text-button" onClick={openLibrary}>
          {t.scan.view.back}
        </button>
        <ThemeToggle />
        <p className="small muted">{t.scan.view.experimental}</p>
        <h1 ref={heading} tabIndex={-1}>
          {phase === 'review' ? t.scan.view.titleReview : t.scan.view.titleStart}
        </h1>
        <p className="scan-filename">
          {batch ? t.scan.view.pageImages(sourcePages.length) : session.file.name}
        </p>
      </header>
      {phase !== 'review' ? (
        <div className="scan-intro">
          <section className="stack">
            <p>{t.scan.view.advice}</p>
            <p className="small muted">{t.scan.view.where}</p>
            <div className="row">
              {phase === 'scanning' || phase === 'cancelling' ? (
                // Plain while the loader below carries the screen's one red.
                <Button
                  disabled={phase === 'cancelling'}
                  onClick={() => {
                    void cancel();
                  }}
                >
                  {phase === 'cancelling' ? t.scan.view.cancelling : t.scan.view.cancelScan}
                </Button>
              ) : (
                <Button
                  primary
                  disabled={rotating}
                  onClick={() => {
                    void scan();
                  }}
                >
                  {batch && sourcePages.some((p) => p.error)
                    ? t.scan.view.retryFailed
                    : t.scan.view.scanScore}
                </Button>
              )}
            </div>
            {(phase === 'scanning' || phase === 'cancelling') && (
              <div className="scan-loader">
                <Loader tune="scale" />
              </div>
            )}
            <p role="status">
              {phase === 'scanning'
                ? batch
                  ? t.scan.view.scanningPage(scanningPage, sourcePages.length)
                  : t.scan.view.scanning
                : ''}
            </p>
            {health?.capabilities?.textModelConfigured === false && (
              <p role="status">{t.scan.view.textModelMissing}</p>
            )}
            {error && <p role="alert">{error(t)}</p>}
            <a
              href="https://github.com/MarchalMaxim/digitus2/blob/main/docs/scanning.md"
              target="_blank"
              rel="noreferrer"
            >
              {t.scan.view.help}
            </a>
          </section>
          <section className="stack scan-source">
            <h2>{t.scan.view.original}</h2>
            {isImage ? (
              <ImagePages
                pages={sourcePages}
                selected={selected}
                onSelect={setSelected}
                editable
                busy={busy}
                camera={touchOnly}
                onChange={arrange}
                onRotating={setRotating}
              />
            ) : (
              sourceUrl &&
              (session.file.type === 'application/pdf' ? (
                <>
                  <a href={sourceUrl} target="_blank" rel="noreferrer">
                    {t.scan.view.openPdf}
                  </a>
                  <Suspense fallback={<p>{t.scan.view.preparingPdf}</p>}>
                    <PdfPreview file={session.file} />
                  </Suspense>
                </>
              ) : (
                <img src={sourceUrl} alt={t.scan.view.originalAlt} />
              ))
            )}
          </section>
        </div>
      ) : (
        <>
          <p>{t.scan.review.caveat}</p>
          {/* A lost grand staff decides every fingering, so it is said here, not under Details. */}
          {(session.warnings ?? []).includes(GRAND_STAFF_WARNING) && (
            <p role="alert">{t.scan.review.grandStaffWarning}</p>
          )}
          {error && <p role="alert">{error(t)}</p>}
          {corrected && corrected.applied < corrections.length && (
            <p role="alert">{t.scan.edit.stale(corrected.applied)}</p>
          )}
          <div className="scan-review">
            <section className="scan-source stack">
              <h2>{t.scan.view.original}</h2>
              {isImage ? (
                <ImagePages
                  pages={sourcePages}
                  selected={selected}
                  onSelect={setSelected}
                  editable={false}
                  busy={false}
                  onChange={arrange}
                />
              ) : (
                sourceUrl && (
                  <>
                    <a href={sourceUrl} target="_blank" rel="noreferrer">
                      {session.file.type === 'application/pdf'
                        ? t.scan.view.openPdf
                        : t.scan.view.openImage}
                    </a>
                    {session.file.type === 'application/pdf' ? (
                      <Suspense fallback={<p>{t.scan.view.preparingPdf}</p>}>
                        <PdfPreview file={session.file} />
                      </Suspense>
                    ) : (
                      <img src={sourceUrl} alt={t.scan.view.originalAlt} />
                    )}
                  </>
                )
              )}
            </section>
            <section className="stack scan-result" ref={resultHost} onKeyDown={onEditKey}>
              <h2>{t.scan.review.recognized}</h2>
              {batch && (
                <div className="row" aria-label={t.scan.review.viewLabel}>
                  <button
                    aria-pressed={reviewMode === 'page'}
                    onClick={() => {
                      setReviewMode('page');
                      select(null);
                    }}
                  >
                    {t.scan.review.pageRecognition}
                  </button>
                  <button
                    disabled={!session.xml}
                    aria-pressed={reviewMode === 'combined'}
                    onClick={() => {
                      setReviewMode('combined');
                    }}
                  >
                    {t.scan.review.combinedScore}
                  </button>
                </div>
              )}
              {batch && (
                <p className="small muted">
                  {reviewMode === 'page'
                    ? t.scan.review.pageShown(selected + 1)
                    : t.scan.review.allPages}
                </p>
              )}
              {editable && problems.length > 0 && corrected && (
                <details className="scan-problems" open={nextRed === 'problem' || undefined}>
                  <summary>{t.scan.edit.problemsSummary(problems.length)}</summary>
                  <ul className="stack">
                    {problems.map((problem, index) => {
                      const target = problemNote(corrected.score, problem);
                      const offer = offers.get(problem);
                      const bar =
                        offer &&
                        corrected.score.bars.find(
                          (b) => b.part === problem.part && b.index === offer.bar,
                        );
                      return (
                        <li key={index} className={offer ? 'has-offer' : undefined}>
                          <button
                            className={
                              index === 0 && nextRed === 'problem' ? 'is-red' : 'text-button'
                            }
                            disabled={target === undefined}
                            onClick={() => {
                              if (target !== undefined) select(target);
                            }}
                          >
                            {describeProblem(t, corrected.score, problem)}
                          </button>
                          {offer && bar && (
                            <button onClick={() => applyCorrection(offer)}>
                              {t.scan.edit.setMeter(`${offer.beats}/${offer.beatType}`, bar.number)}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {editable && pages.length > 0 && !selectedNote && <p>{t.scan.edit.hint}</p>}
              {pages.length ? (
                <div
                  ref={sheetRef}
                  className={`scan-sheet${editable ? ' is-editable' : ''}`}
                  // Busy while the notation on screen is older than the corrections.
                  aria-busy={rendered?.xml !== renderXml}
                  tabIndex={editable ? 0 : undefined}
                  role={editable ? 'group' : undefined}
                  aria-label={editable ? t.scan.review.recognized : undefined}
                  aria-describedby={editable ? 'scan-edit-keys' : undefined}
                  onClick={onSheetClick}
                >
                  <ScoreSheet
                    pages={pages}
                    label={
                      corrections.length
                        ? t.scan.edit.correctedSheetLabel
                        : t.scan.review.sheetLabel
                    }
                    onHost={setSheetHost}
                  />
                </div>
              ) : (
                <p role="status">{reviewError ? reviewError(t) : t.scan.review.preparing}</p>
              )}
              {editable && (
                <p id="scan-edit-keys" className="visually-hidden">
                  {t.scan.edit.keys}
                </p>
              )}
              <p className="visually-hidden" aria-live="polite">
                {liveText}
              </p>
              {selectedNote && corrected ? (
                <NoteEditor
                  score={corrected.score}
                  ordinal={selectedNote.ordinal}
                  status={statusText}
                  onCorrect={applyCorrection}
                  onSelect={select}
                  onClose={closeEditor}
                />
              ) : (
                editable &&
                editStatus && (
                  <p className="small" aria-hidden="true">
                    {editStatus(t)}
                  </p>
                )
              )}
              {editable && (corrections.length > 0 || undoStack.length > 0) && (
                <div className="stack scan-corrections">
                  <div className="row">
                    {kept.length > 0 && <span>{t.scan.edit.corrections(kept.length)}</span>}
                    <button onClick={undo}>{t.scan.edit.undo}</button>
                    {corrections.length > 0 && <button onClick={reset}>{t.scan.edit.reset}</button>}
                  </div>
                  {corrections.length > 0 && rawScore && (
                    <details>
                      <summary>{t.scan.edit.listSummary}</summary>
                      <ol className="stack small">
                        {corrections.slice(0, corrected?.applied).map((c, index) => (
                          <li key={index}>{describeCorrection(t, rawScore, c)}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              )}
            </section>
          </div>
          <section className="stack scan-decision">
            {reviewError && (
              <p role="alert">
                {(editable
                  ? t.scan.review.problem
                  : pageMode && session.xml
                    ? t.scan.review.problemInCombined
                    : t.scan.review.problemReadOnly)(reviewError(t))}
              </p>
            )}
            <details>
              <summary>{t.scan.review.detailsSummary}</summary>
              <div className="stack small">
                <p>
                  {session.recognizer ?? 'Audiveris'} ·{' '}
                  {session.recognizedAt
                    ? new Date(session.recognizedAt).toLocaleString(locale)
                    : ''}
                </p>
                <p>{t.scan.review.retained}</p>
                {sourcePages.some((p) => /<software>\s*homr\s*<\/software>/i.test(p.xml ?? '')) && (
                  <p>{t.scan.review.beamGrouping}</p>
                )}
                {[...(session.warnings ?? []), ...warnings].map((warning, i) => (
                  <p key={i}>{warningText(warning)}</p>
                ))}
                {combineDetail && <p>{t.scan.review.technical(combineDetail)}</p>}
                {[rendered, imported].map(
                  (state, i) =>
                    state?.detail &&
                    state.xml === (i === 0 ? renderXml : importXml) && (
                      <p key={`detail-${i}`}>{t.scan.review.technical(state.detail)}</p>
                    ),
                )}
              </div>
            </details>
            {(session.xml || sourcePages.some((p) => p.xml)) && (
              <details className="scan-files">
                <summary>{t.scan.review.filesSummary}</summary>
                <div className="stack">
                  {session.xml && (
                    <button
                      className="text-button scan-download"
                      onClick={() => downloadText(baseName + '-recognized.musicxml', session.xml!)}
                    >
                      {batch ? t.scan.review.downloadCombined : t.scan.review.downloadRaw}
                    </button>
                  )}
                  {session.xml && corrected && kept.length > 0 && (
                    <button
                      className="text-button scan-download"
                      onClick={() => downloadText(baseName + '-corrected.musicxml', corrected.xml)}
                    >
                      {t.scan.edit.downloadCorrected}
                    </button>
                  )}
                  {batch &&
                    sourcePages.map(
                      (p, index) =>
                        p.xml && (
                          <button
                            key={p.id}
                            className="text-button scan-download"
                            onClick={() =>
                              downloadText(`page-${index + 1}-recognized.musicxml`, p.xml!)
                            }
                          >
                            {t.scan.review.downloadPage(index + 1)}
                          </button>
                        ),
                    )}
                </div>
              </details>
            )}
            <div className="row">
              {/* Plain while a selected note carries the screen's one red. */}
              <Button
                className="scan-use"
                primary={nextRed === 'use'}
                disabled={!canUseResult}
                onClick={useResult}
              >
                {t.scan.review.useForFingerings}
              </Button>
              <Button
                primary={nextRed === 'again'}
                onClick={() => {
                  setPhase('ready');
                  setError(null);
                  setReviewMode('combined');
                  select(null);
                  setUndoStack([]);
                  retain({
                    ...session,
                    xml: undefined,
                    corrections: undefined,
                    pages: sourcePages.map((p) => ({ ...p, xml: undefined, error: undefined })),
                  });
                }}
              >
                {t.scan.review.scanAgain}
              </Button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
