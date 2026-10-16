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
import { createScanClient, type WorkerMetadata } from './client.js';
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
  const [phase, setPhase] = useState<
    'connect' | 'connected' | 'connecting' | 'scanning' | 'cancelling' | 'review'
  >(initial.xml || hasPageRecognition ? 'review' : 'connect');
  const [error, setError] = useState(
    hasPageRecognition && !initial.xml && initial.pages!.length > 1
      ? 'The pages were recognized, but their notation could not be combined. Individual page files are available below.'
      : '',
  );
  const [health, setHealth] = useState<WorkerMetadata>();
  const [pages, setPages] = useState<string[]>([]);
  const [reviewError, setReviewError] = useState('');
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
    setReviewError('');
    setPages([]);
    void (async () => {
      // Render independently of import: an importer refusal must not erase the raw result.
      const rendered = renderer
        .render({ xml: reviewXml, widthPx: width })
        .then((result) => {
          if (current) setPages(result.pages);
        })
        .catch((cause: unknown) => {
          if (current) setReviewError('Notation could not be displayed: ' + messageOf(cause));
        });
      try {
        const result = await engine.load(reviewXml, 'scan.musicxml', { preserveNotation: true });
        if (current) {
          setWarnings(result.warnings);
          if (!result.score.notes.length) setReviewError('No playable notes were recognized.');
          else setReviewReady(true);
        }
      } catch (cause) {
        if (current)
          setReviewError('This recognition cannot be used for fingerings: ' + messageOf(cause));
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
    setError('');
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
    setError('');
    setPhase('connecting');
    try {
      const metadata = await client.connect();
      if (!alive.current) return;
      setHealth(metadata);
      setPhase('connected');
    } catch {
      if (alive.current) {
        setPhase('connect');
        setError(
          'Could not connect to this PC. Start the worker, then allow this site’s local connection when your browser asks. If you denied it, change this site’s local-network permission and try again.',
        );
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
      setError('Could not confirm cancellation. Close the worker terminal to stop processing.');
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
    setError('');
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
          if (performance.now() > deadline)
            throw new Error('Recognition timed out. Try a smaller, clearer page.');
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
            throw new Error(
              typeof status.failure?.message === 'string'
                ? status.failure.message
                : 'The PC could not recognize a complete score from this page. Try the original PDF or a flatter, higher-resolution image.',
            );
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
      setError(
        batch
          ? 'Some pages need another scan. Recognized pages are kept.'
          : (results[0]!.error ?? 'Recognition failed.'),
      );
      setPhase('connected');
      return;
    }
    let xml: string | undefined;
    try {
      xml = joinScanPages(results.map((page) => page.xml!));
    } catch (cause) {
      setError(
        batch
          ? 'The pages were recognized, but their notation could not be combined. ' +
              messageOf(cause)
          : messageOf(cause),
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
          Back to library
        </button>
        <ThemeToggle />
        <p className="small muted">Experimental scan</p>
        <h1 ref={heading} tabIndex={-1}>
          {phase === 'review' ? 'Review the recognition' : 'From paper to piano'}
        </h1>
        <p className="scan-filename">
          {batch ? `${sourcePages.length} page images` : session.file.name}
        </p>
      </header>
      {phase !== 'review' ? (
        <div className="scan-intro">
          <section className="stack">
            <p>
              Original PDFs and flat, high-resolution scans work best. Book photos are experimental
              and can fail, even when well lit. Results open beside the original for review.
            </p>
            <p className="small muted">
              This experimental option needs the PC worker on this computer. Your score goes to that
              worker, never an external recognition service. A phone’s localhost cannot reach your
              PC.
            </p>
            <div className="row">
              {phase === 'connect' || phase === 'connecting' ? (
                <Button
                  primary
                  disabled={busy || rotating}
                  onClick={() => {
                    void connect();
                  }}
                >
                  {phase === 'connecting' ? 'Connecting…' : 'Connect to this PC'}
                </Button>
              ) : phase === 'scanning' || phase === 'cancelling' ? (
                <Button
                  primary
                  disabled={phase === 'cancelling'}
                  onClick={() => {
                    void cancel();
                  }}
                >
                  {phase === 'cancelling' ? 'Cancelling…' : 'Cancel scan'}
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
                    ? 'Retry failed pages'
                    : 'Scan this score'}
                </Button>
              )}
            </div>
            <p role="status">
              {phase === 'scanning'
                ? `${batch ? `Page ${scanningPage} of ${sourcePages.length} · ` : ''}Recognizing on this PC… Usually a few seconds; longer pages can take a few minutes.`
                : phase === 'connected'
                  ? 'PC connected.'
                  : ''}
            </p>
            {health?.capabilities?.textModelConfigured === false && (
              <p role="status">
                English text recognition is not configured. Musical text may be missing. See setup
                below.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <details className="scan-setup">
              <summary>Set up the PC worker</summary>
              <div className="stack">
                <p>
                  On the PC running this browser, open the digitus2 project folder. Install the
                  photo and PDF recognizers once, then start the worker when you need it.
                </p>
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
                <p className="small">
                  Keep that terminal open. Allow the browser’s local connection after pressing
                  Connect. To stop processing, close the worker. No public server or account is
                  needed.
                </p>
                <a
                  href="https://github.com/MarchalMaxim/digitus2/blob/main/docs/scanning.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Setup and troubleshooting
                </a>
              </div>
            </details>
          </section>
          <section className="stack scan-source">
            <h2>Original</h2>
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
                    Open original PDF
                  </a>
                  <Suspense fallback={<p>Preparing original PDF…</p>}>
                    <PdfPreview file={session.file} />
                  </Suspense>
                </>
              ) : (
                <img src={sourceUrl} alt="Original printed score" />
              ))
            )}
          </section>
        </div>
      ) : (
        <>
          <p>
            Recognition may contain errors in notes, rhythms, ties or hands. Text and tempo may be
            incomplete. No fingerings have been added yet.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="scan-review">
            <section className="scan-source stack">
              <h2>Original</h2>
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
                      Open original {session.file.type === 'application/pdf' ? 'PDF' : 'image'}
                    </a>
                    {session.file.type === 'application/pdf' ? (
                      <Suspense fallback={<p>Preparing original PDF…</p>}>
                        <PdfPreview file={session.file} />
                      </Suspense>
                    ) : (
                      <img src={sourceUrl} alt="Original printed score" />
                    )}
                  </>
                )
              )}
            </section>
            <section className="stack" ref={resultHost}>
              <h2>Recognized notation</h2>
              {batch && (
                <div className="row" aria-label="Recognition view">
                  <button
                    aria-pressed={reviewMode === 'page'}
                    onClick={() => {
                      setReviewMode('page');
                    }}
                  >
                    Page recognition
                  </button>
                  <button
                    disabled={!session.xml}
                    aria-pressed={reviewMode === 'combined'}
                    onClick={() => {
                      setReviewMode('combined');
                    }}
                  >
                    Combined score
                  </button>
                </div>
              )}
              {batch && (
                <p className="small muted">
                  {reviewMode === 'page'
                    ? `Recognition of page ${selected + 1}`
                    : 'All pages in reading order'}
                </p>
              )}
              {pages.length ? (
                <ScoreSheet pages={pages} label="raw scan recognition" />
              ) : (
                <p role="status">{reviewError || 'Preparing recognized notation…'}</p>
              )}
            </section>
          </div>
          <section className="stack scan-decision">
            {reviewError && (
              <p role="alert">
                {reviewError} Download the raw file for correction in a notation editor, or try
                another image.
              </p>
            )}
            <details>
              <summary>Recognition details</summary>
              <div className="stack small">
                <p>
                  {session.recognizer ?? 'Audiveris'} ·{' '}
                  {session.recognizedAt ? new Date(session.recognizedAt).toLocaleString() : ''}
                </p>
                <p>
                  Find retained originals and recognition in My scores in this browser. Keep your
                  own original files; browser storage can be cleared. Recognition is not certified
                  accurate; playback tempo may use an app default.
                </p>
                {sourcePages.some((p) => /<software>\s*homr\s*<\/software>/i.test(p.xml ?? '')) && (
                  <p>Beam grouping is inferred and may differ from the original.</p>
                )}
                {[...(session.warnings ?? []), ...warnings].map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
              </div>
            </details>
            {batch && (
              <details>
                <summary>Download individual page files</summary>
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
                          Download page {index + 1} MusicXML
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
                {batch ? 'Download combined MusicXML' : 'Download raw MusicXML'}
              </button>
            )}
            <div className="row">
              <Button primary disabled={!canUseResult} onClick={useResult}>
                Use for fingerings
              </Button>
              <button
                onClick={() => {
                  setPhase('connect');
                  setError('');
                  setReviewMode('combined');
                  retain({
                    ...session,
                    xml: undefined,
                    pages: sourcePages.map((p) => ({ ...p, xml: undefined, error: undefined })),
                  });
                }}
              >
                Scan again
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
