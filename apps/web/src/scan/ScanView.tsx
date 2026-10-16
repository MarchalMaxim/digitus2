import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import { Button } from '../design/Button.js';
import { downloadText } from '../export/download.js';
import { createEngineClient } from '../engine/client.js';
import { createRenderer } from '../score/render/renderer.js';
import { ScoreSheet } from '../score/ScoreSheet.js';
import { createScanClient, type WorkerMetadata } from './client.js';
import type { ScanSession } from './model.js';
import './scan.css';

const PdfPreview = lazy(() => import('./PdfPreview.js').then((m) => ({ default: m.PdfPreview })));

const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 350));

function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** Review renders raw XML, never calls solve or exports replacement XML. */
export function ScanView({ session: initial }: { session: ScanSession }) {
  const [session, setSession] = useState(initial);
  const [phase, setPhase] = useState<
    'connect' | 'connected' | 'connecting' | 'scanning' | 'cancelling' | 'review'
  >(initial.xml ? 'review' : 'connect');
  const [error, setError] = useState('');
  const [health, setHealth] = useState<WorkerMetadata>();
  const [pages, setPages] = useState<string[]>([]);
  const [reviewError, setReviewError] = useState('');
  const [reviewReady, setReviewReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
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
  const openLibrary = useAppStore((s) => s.openLibrary);
  const busy = phase === 'connecting' || phase === 'scanning' || phase === 'cancelling';

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
    if (!session.xml) return;
    let current = true;
    const engine = createEngineClient();
    const renderer = createRenderer();
    setReviewReady(false);
    setReviewError('');
    setPages([]);
    void (async () => {
      // Render independently of import: an importer refusal must not erase the raw result.
      const rendered = renderer
        .render({ xml: session.xml!, widthPx: width })
        .then((result) => {
          if (current) setPages(result.pages);
        })
        .catch((cause: unknown) => {
          if (current) setReviewError('Notation could not be displayed: ' + messageOf(cause));
        });
      try {
        const result = await engine.load(session.xml!, 'scan.musicxml', { preserveNotation: true });
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
  }, [session.xml, width]);

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
    try {
      run.started = client.start(session.file);
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
          const next: ScanSession = {
            ...session,
            xml,
            recognizedAt: new Date().toISOString(),
            recognizer: status.recognizer ?? health?.recognizer,
            warnings: status.warnings ?? health?.warnings ?? [],
          };
          // Persist in the visit-only navigation record, never localStorage.
          useAppStore.setState({ view: { name: 'scan', session: next } });
          setSession(next);
          setPhase('review');
          active.current = { cancelled: false };
          return;
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
        setError(messageOf(cause));
        setPhase('connected');
      }
    }
  };
  const useResult = () => {
    if (!session.xml || !reviewReady || !pages.length || reviewError || !checked) return;
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
        <p className="small muted">Experimental scan</p>
        <h1 ref={heading} tabIndex={-1}>
          {phase === 'review' ? 'Review the recognition' : 'From paper to piano'}
        </h1>
        <p className="scan-filename">{session.file.name}</p>
      </header>
      {phase !== 'review' ? (
        <div className="scan-intro">
          <section className="stack">
            <p>
              Original PDFs and flat, high-resolution scans work best. Book photos are experimental
              and can fail, even when well lit. You’ll check any result before adding finger
              numbers.
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
                  disabled={busy}
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
                  onClick={() => {
                    void scan();
                  }}
                >
                  Scan this score
                </Button>
              )}
            </div>
            <p role="status">
              {phase === 'scanning'
                ? 'Recognizing on this PC… Usually a few seconds; longer pages can take a few minutes.'
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
            {sourceUrl &&
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
              ))}
          </section>
        </div>
      ) : (
        <>
          <p>
            Compare every page: pitches, rhythms, ties, missing bars, hands and key/time signatures.
            Text and tempo may be incomplete. No fingerings have been added yet.
          </p>
          <div className="scan-review">
            <section className="scan-source stack">
              <h2>Original</h2>
              {sourceUrl && (
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
              )}
            </section>
            <section className="stack" ref={resultHost}>
              <h2>Recognized notation</h2>
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
                  Original document and unmodified recognition are retained only during this visit.
                  Reloading clears them. Recognition is not certified accurate; playback tempo may
                  use an app default.
                </p>
                {[...(session.warnings ?? []), ...warnings].map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
              </div>
            </details>
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
                Download raw MusicXML
              </button>
            )}
            <label className="scan-confirm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.currentTarget.checked)}
                disabled={!reviewReady || !pages.length || !!reviewError}
              />
              I compared the recognition with my original.
            </label>
            <div className="row">
              <Button
                primary
                disabled={!checked || !reviewReady || !pages.length || !!reviewError}
                onClick={useResult}
              >
                Use for fingerings
              </Button>
              <button
                onClick={() => {
                  setPhase('connect');
                  setError('');
                  setChecked(false);
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
