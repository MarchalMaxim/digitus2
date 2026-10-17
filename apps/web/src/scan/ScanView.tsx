import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import { Button } from '../design/Button.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import { downloadText } from '../export/download.js';
import { createEngineClient } from '../engine/client.js';
import { createRenderer } from '../score/render/renderer.js';
import { ScoreSheet } from '../score/ScoreSheet.js';
import { useLocale, useT } from '../i18n/i18n.js';
import type { Messages, Phrase } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';
import { createScanClient, UNKNOWN_WARNING, type WorkerMetadata } from './client.js';
import { ImagePages, useBlobUrl } from './ImagePages.js';
import { GRAPHIC_SPAN_TAGS, GRAPHIC_SPAN_WARNING, joinScanPages } from './join.js';
import type { ScanPage, ScanSession } from './model.js';
import './scan.css';

const PdfPreview = lazy(() => import('./PdfPreview.js').then((m) => ({ default: m.PdfPreview })));

const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 350));

/** Review renders raw XML, never calls solve or exports replacement XML. */
export function ScanView({ session: initial }: { session: ScanSession }) {
  const [session, setSession] = useState(initial);
  const hasPageRecognition = !!initial.pages?.length && initial.pages.every((page) => !!page.xml);
  const t = useT();
  const [locale] = useLocale();
  const [phase, setPhase] = useState<
    'connect' | 'connected' | 'connecting' | 'scanning' | 'cancelling' | 'review'
  >(initial.xml || hasPageRecognition ? 'review' : 'connect');
  // Errors are kept as phrases, so they follow a change of language while they are on screen.
  const [error, setErrorPhrase] = useState<Phrase | null>(() =>
    hasPageRecognition && !initial.xml && initial.pages!.length > 1
      ? (m: Messages) => m.scan.errors.notCombinedSaved
      : null,
  );
  const setError = (phrase: Phrase | null) => {
    setErrorPhrase(() => phrase);
  };
  const [health, setHealth] = useState<WorkerMetadata>();
  const [pages, setPages] = useState<string[]>([]);
  const [reviewError, setReviewErrorPhrase] = useState<Phrase | null>(null);
  const setReviewError = (phrase: Phrase | null) => {
    setReviewErrorPhrase(() => phrase);
  };
  const [reviewReady, setReviewReady] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [reviewMode, setReviewMode] = useState<'combined' | 'page'>(
    hasPageRecognition && !initial.xml ? 'page' : 'combined',
  );
  const [scanningPage, setScanningPage] = useState(1);
  const [rotating, setRotating] = useState(false);
  const [width, setWidth] = useState(640);
  const resultHost = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const client = useRef(createScanClient()).current;
  const active = useRef<{ id?: string; cancelled: boolean; started?: Promise<string> }>({
    cancelled: false,
  });
  const alive = useRef(true);
  const sourceUrl = useBlobUrl(session.file);
  const sourcePages = session.pages ?? [{ id: session.id, file: session.file, xml: session.xml }];
  const batch = sourcePages.length > 1;
  const isImage = session.file.type !== 'application/pdf';
  const reviewXml = batch && reviewMode === 'page' ? sourcePages[selected]?.xml : session.xml;
  const openLibrary = useAppStore((s) => s.openLibrary);
  const busy = phase === 'connecting' || phase === 'scanning' || phase === 'cancelling';
  const canUseResult =
    !!session.xml && reviewMode === 'combined' && reviewReady && pages.length > 0 && !reviewError;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      active.current.cancelled = true;
      if (active.current.id) void client.cancel(active.current.id).catch(() => {});
    };
  }, [client]);
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
    if (!reviewXml || phase !== 'review') return;
    let current = true;
    const engine = createEngineClient();
    const renderer = createRenderer();
    setReviewReady(false);
    setReviewError(null);
    setPages([]);
    void (async () => {
      // Render independently of import: an importer refusal must not erase the raw result.
      const rendered = renderer
        .render({ xml: reviewXml, widthPx: width })
        .then((result) => {
          if (current) setPages(result.pages);
        })
        .catch((cause: unknown) => {
          if (current) setReviewError((m) => m.scan.errors.notationNotShown(messageOf(cause, m)));
        });
      try {
        const result = await engine.load(reviewXml, 'scan.musicxml', { preserveNotation: true });
        if (current) {
          setWarnings(result.warnings);
          if (!result.score.notes.length) setReviewError((m) => m.scan.errors.noNotes);
          else setReviewReady(true);
        }
      } catch (cause) {
        if (current) setReviewError((m) => m.scan.errors.notUsable(messageOf(cause, m)));
      }
      await rendered;
    })();
    return () => {
      current = false;
      engine.dispose();
      renderer.dispose();
    };
  }, [reviewXml, width, phase]);

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
    });
  };

  const connect = async () => {
    setError(null);
    setPhase('connecting');
    try {
      const metadata = await client.connect();
      if (!alive.current) return;
      setHealth(metadata);
      setPhase('connected');
    } catch {
      if (alive.current) {
        setPhase('connect');
        setError((m) => m.scan.errors.connectFailed);
      }
    }
  };
  const cancel = async () => {
    active.current.cancelled = true;
    setPhase('cancelling');
    try {
      const run = active.current;
      const id = run.id ?? (await run.started);
      if (id) await client.cancel(id);
    } catch {
      setError((m) => m.scan.errors.cancelFailed);
    } finally {
      if (alive.current) setPhase('connected');
    }
  };
  const scan = async () => {
    const run = { cancelled: false } as {
      id?: string;
      cancelled: boolean;
      started?: Promise<string>;
    };
    active.current = run;
    setError(null);
    setPhase('scanning');
    const results = sourcePages.map((page) => ({ ...page }));
    for (const [index, page] of results.entries()) {
      if (page.xml) continue;
      if (run.cancelled || !alive.current) return;
      setScanningPage(index + 1);
      page.error = undefined;
      delete run.id;
      try {
        run.started = client.start(page.file);
        run.id = await run.started;
        if (run.cancelled || !alive.current) {
          await client.cancel(run.id);
          return;
        }
        const deadline = performance.now() + 190000;
        while (!run.cancelled && alive.current) {
          if (performance.now() > deadline) throw new PhraseError((m) => m.scan.errors.timedOut);
          const status = await client.status(run.id);
          if (status.state === 'ready') {
            const xml = await client.result(run.id);
            if (run.cancelled || !alive.current) return;
            page.xml = xml;
            page.recognizer = status.recognizer ?? health?.recognizer;
            page.warnings = status.warnings ?? health?.warnings ?? [];
            retain({ ...session, pages: results.map((p) => ({ ...p })) });
            break;
          }
          if (['failed', 'cancelled', 'timed_out'].includes(status.state ?? ''))
            throw typeof status.failure?.message === 'string'
              ? new Error(status.failure.message)
              : new PhraseError((m) => m.scan.errors.notRecognized);
          await delay();
        }
      } catch (cause) {
        if (run.id) await client.cancel(run.id).catch(() => {});
        if (alive.current && !run.cancelled) {
          page.error = messageOf(cause);
          retain({ ...session, pages: results.map((p) => ({ ...p })) });
        }
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
      setPhase('connected');
      return;
    }
    let xml: string | undefined;
    try {
      xml = joinScanPages(results.map((page) => page.xml!));
    } catch (cause) {
      setError(
        batch ? (m) => m.scan.errors.notCombined(messageOf(cause, m)) : (m) => messageOf(cause, m),
      );
      setReviewMode('page');
    }
    retain({
      ...session,
      pages: results,
      xml,
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
    setPhase('review');
  };
  const warningText = (warning: string) =>
    warning === GRAPHIC_SPAN_WARNING
      ? t.scan.review.graphicSpanWarning
      : warning === UNKNOWN_WARNING
        ? t.scan.review.unknownWarning
        : warning;
  const useResult = () => {
    if (!canUseResult) return;
    useAppStore.getState().openPiece({
      kind: 'file',
      name: session.file.name.replace(/\.[^.]+$/, '') + '.musicxml',
      bytes: new TextEncoder().encode(session.xml),
      scan: session,
    });
  };
  return (
    <main className="page scan-view stack">
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
            <p className="small muted">{t.scan.view.workerNeeded}</p>
            <div className="row">
              {phase === 'connect' || phase === 'connecting' ? (
                <Button
                  primary
                  disabled={busy || rotating}
                  onClick={() => {
                    void connect();
                  }}
                >
                  {phase === 'connecting' ? t.scan.view.connecting : t.scan.view.connect}
                </Button>
              ) : phase === 'scanning' || phase === 'cancelling' ? (
                <Button
                  primary
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
            <p role="status">
              {phase === 'scanning'
                ? batch
                  ? t.scan.view.scanningPage(scanningPage, sourcePages.length)
                  : t.scan.view.scanning
                : phase === 'connected'
                  ? t.scan.view.connected
                  : ''}
            </p>
            {health?.capabilities?.textModelConfigured === false && (
              <p role="status">{t.scan.view.textModelMissing}</p>
            )}
            {error && <p role="alert">{error(t)}</p>}
            <details className="scan-setup">
              <summary>{t.scan.setup.summary}</summary>
              <div className="stack">
                <p>{t.scan.setup.install}</p>
                <pre>
                  <code>
                    powershell -File research/omr/prototypes/oemer-quality/prepare-audiveris.ps1
                    {'\n'}powershell -File
                    research/omr/prototypes/oemer-quality/prepare-text-models.ps1
                    {'\n'}powershell -File research/omr/prototypes/homr-photo/setup.ps1
                  </code>
                </pre>
                <pre>
                  <code>
                    python research/omr/prototypes/local-worker/worker.py --bundle
                    research/omr/results/quality-wave/toolchain --short-staves --text-models
                    research/omr/results/quality-wave/text-models --homr-toolchain
                    research/omr/results/photo-options/toolchain
                  </code>
                </pre>
                <p className="small">{t.scan.setup.keepOpen}</p>
                <a
                  href="https://github.com/MarchalMaxim/digitus2/blob/main/docs/scanning.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.scan.setup.help}
                </a>
              </div>
            </details>
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
          {error && <p role="alert">{error(t)}</p>}
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
            <section className="stack" ref={resultHost}>
              <h2>{t.scan.review.recognized}</h2>
              {batch && (
                <div className="row" aria-label={t.scan.review.viewLabel}>
                  <button
                    aria-pressed={reviewMode === 'page'}
                    onClick={() => {
                      setReviewMode('page');
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
              {pages.length ? (
                <ScoreSheet pages={pages} label={t.scan.review.sheetLabel} />
              ) : (
                <p role="status">{reviewError ? reviewError(t) : t.scan.review.preparing}</p>
              )}
            </section>
          </div>
          <section className="stack scan-decision">
            {reviewError && <p role="alert">{t.scan.review.problem(reviewError(t))}</p>}
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
              </div>
            </details>
            {batch && (
              <details>
                <summary>{t.scan.review.downloadPagesSummary}</summary>
                <div className="stack">
                  {sourcePages.map(
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
            {session.xml && (
              <button
                className="text-button scan-download"
                onClick={() =>
                  downloadText(
                    session.file.name.replace(/\.[^.]+$/, '') + '-recognized.musicxml',
                    session.xml!,
                  )
                }
              >
                {batch ? t.scan.review.downloadCombined : t.scan.review.downloadRaw}
              </button>
            )}
            <div className="row">
              <Button primary disabled={!canUseResult} onClick={useResult}>
                {t.scan.review.useForFingerings}
              </Button>
              <button
                onClick={() => {
                  setPhase('connect');
                  setError(null);
                  setReviewMode('combined');
                  retain({
                    ...session,
                    xml: undefined,
                    pages: sourcePages.map((p) => ({ ...p, xml: undefined, error: undefined })),
                  });
                }}
              >
                {t.scan.review.scanAgain}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
