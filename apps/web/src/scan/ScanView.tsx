import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { build, formatBuildDay } from '../app/build.js';
import { messageOf } from '../app/errors.js';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import { Button } from '../design/Button.js';
import { Loader } from '../design/Loader.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import { downloadText, shareOrDownload } from '../export/download.js';
import { createEngineClient, SCAN_LOAD, type EngineClient } from '../engine/client.js';
import { createRenderer, NO_MUSIC, type ScoreRenderer } from '../score/render/renderer.js';
import { ScoreSheet } from '../score/ScoreSheet.js';
import { en } from '../i18n/en/index.js';
import { useLocale, useT } from '../i18n/i18n.js';
import type { Messages, Phrase } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';
import {
  BUSY,
  BusyError,
  BUSY_WAIT_MS,
  createScanClient,
  LIMITED,
  newJobId,
  pause,
  type ScanServiceMetadata,
} from './client.js';
import { makeScanArchive } from './bundle.js';
import {
  fixAll,
  inReadingOrder,
  offersFor,
  placesFromRepairs,
  type Correction,
  type Problem,
  type TieRepair,
} from './corrections.js';
import { keepScans, reportCase, scanIdOf } from './diagnostics.js';
import type { ReviewFacts } from './facts.js';
import { ImagePages, useBlobUrl } from './ImagePages.js';
import {
  GRAPHIC_SPAN_TAGS,
  GRAPHIC_SPAN_WARNING,
  JoinRefusal,
  joinScanPages,
  PAIRED_STAVES_WARNING,
  stavesWerePaired,
} from './join.js';
import { reviewWarnings } from './warnings.js';
import {
  validateScanImages,
  type PendingRetake,
  type ScanPage,
  type ScanSession,
} from './model.js';
import {
  chordOf,
  parseScanXml,
  readingOrder,
  readScanScore,
  type ScanNote,
  type ScanScore,
} from './notes.js';
import { NoteCrop, pageImage, type PageImage } from './NoteCrop.js';
import { placeHead } from './heads.js';
import { fallbackSpace } from './crop.js';
import { useHoverMark, useScanMarks } from './linked.js';
import { isTouchOnly } from './phone.js';
import { PhotoMarks } from './PhotoMarks.js';
import { carryOver } from './retake.js';
import { RetakePage } from './RetakePage.js';
import { barAt, expectedBatchMs, pdfPageCount, type Stretch } from './progress.js';
import { ScanProgress } from './ScanProgress.js';
import { blocks, pageDoubt, verdict as readVerdict, verdictText } from './verdict.js';
import {
  correct,
  timingIssue,
  describeCorrection,
  describeNote,
  describeProblem,
  findProblems,
  NoteEditor,
  noteAt,
  offerLabel,
  problemNote,
  stepPitch,
  timingText,
  tryCorrection,
  useSelectedMark,
} from './ScanEditor.js';
import './scan.css';

const PdfPreview = lazy(() => import('./PdfPreview.js').then((m) => ({ default: m.PdfPreview })));

const NO_CORRECTIONS: Correction[] = [];
const NO_REPAIRS: TieRepair[] = [];
/** Where the engine's refusal names its place, "(part 1, bar 12)": the first one is said. */
const ENGINE_PLACE = /\(part (\d+), bar ([^)]+)\)/;
/** Renderer failures that come out the same however often they are tried. */
const RENDER_FINAL = new Set([NO_MUSIC, 'the score could not be laid out', 'renderer disposed']);
/**
 * While waiting, an offer of the job that is not answered busy within this time has been taken
 * by the scanner: the bar replaces the waiting line. A busy answer comes back at once.
 */
const TAKEN_AFTER_MS = 2_000;
/** How long the full bar stays on screen after the last answer, so the reader sees it fill. */
const FULL_HOLD_MS = 400;
/** Said by the review's verdict line (verdict.ts), so the alert that would repeat it is not shown. */
const NOT_COMBINED: Phrase = (m) => m.scan.errors.notCombinedSaved;

/** The printed number of the bar a place to check points at. */
function placeBar(score: ScanScore, problem: Problem): string | undefined {
  const measure =
    problem.kind === 'bar-timing' || problem.kind === 'form' ? problem.bar : problem.measure;
  return score.bars.find((b) => b.part === problem.part && b.index === measure)?.number;
}

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
  // Waiting: the scanner is busy with another reader's page, and this page is offered again.
  const [phase, setPhase] = useState<'ready' | 'waiting' | 'scanning' | 'cancelling' | 'review'>(
    initial.xml || hasPageRecognition ? 'review' : 'ready',
  );
  // Errors are kept as phrases, so they follow a change of language while they are on screen.
  const [error, setErrorPhrase] = useState<Phrase | null>(() =>
    hasPageRecognition && !initial.xml && initial.pages!.length > 1 ? NOT_COMBINED : null,
  );
  const setError = (phrase: Phrase | null) => {
    setErrorPhrase(() => phrase);
  };
  const [health, setHealth] = useState<ScanServiceMetadata>();
  // Read by a scan that started before the warm-up answered.
  const latestHealth = useRef<ScanServiceMetadata | undefined>(undefined);
  // True from arrival until the warm-up has answered, in any way: the bar allows for a start.
  const warmingUp = useRef(false);
  const [pages, setPages] = useState<string[]>([]);
  // The XML each worker last finished with: use waits until both match what is on screen.
  // `detail` is the worker's own message, shown only under Recognition details; `page` is the page
  // a failure names (1-based), when one is.
  const [rendered, setRendered] = useState<{
    xml: string;
    error: Phrase | null;
    detail?: string;
    page?: number | undefined;
  }>();
  // `repairs` are the ties the import played as separate notes (issue 233). `stopped`: the
  // engine's worker stopped, twice, so the notes were never checked.
  const [imported, setImported] = useState<{
    xml: string;
    error: Phrase | null;
    detail?: string;
    stopped?: boolean;
    repairs: TieRepair[];
  }>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [reviewMode, setReviewMode] = useState<'combined' | 'page'>(
    hasPageRecognition && !initial.xml ? 'page' : 'combined',
  );
  const [scanningPage, setScanningPage] = useState(1);
  // The bar of the whole batch: the stretch it runs now, and whether the last answer filled it.
  const [bar, setBar] = useState<{ stretch: Stretch; done: boolean }>();
  const [rotating, setRotating] = useState(false);
  const [width, setWidth] = useState(640);
  const [touchOnly] = useState(isTouchOnly);
  const [note, setNote] = useState<number | null>(null);
  const [editStatus, setEditStatusPhrase] = useState<Phrase | null>(null);
  const setEditStatus = (phrase: Phrase | null) => {
    setEditStatusPhrase(() => phrase);
  };
  const [undoStack, setUndoStack] = useState<Correction[][]>([]);
  // The places list stays as the reader left it while a fix is checked again and the list,
  // empty for that moment, is gone from the screen.
  const [placesOpen, setPlacesOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // This device keeps its scans as validation cases (diagnostics.ts); read once per review.
  const [keeping] = useState(keepScans);
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
  // What Use for fingerings opens is the combined score, whichever page is on screen: it is the
  // one imported. Only a scan whose pages did not join imports the page shown.
  const importXml = session.xml
    ? (corrected?.xml ?? session.xml)
    : pageMode
      ? sourcePages[selected]?.xml
      : undefined;
  const renderXml = pageMode ? sourcePages[selected]?.xml : (corrected?.renderXml ?? session.xml);
  // The ties the import played as separate notes, while they are of the score corrected here (a
  // page that did not join imports another document, and a correction waits for its import).
  const repairs =
    imported && corrected && imported.xml === corrected.xml ? imported.repairs : NO_REPAIRS;
  // Counted whichever page is on screen: the verdict says how many places to check there are.
  // Every tie the import played as separate notes is one of them (issue 233).
  const checked = useMemo(() => (corrected ? findProblems(corrected.score) : []), [corrected]);
  const problems = useMemo(
    () =>
      corrected && repairs.length
        ? inReadingOrder([...checked, ...placesFromRepairs(corrected.score, checked, repairs)])
        : checked,
    [corrected, checked, repairs],
  );
  // Each place's corrections, in the order they are offered (corrections.ts `offersFor`).
  const offers = useMemo(
    () =>
      corrected ? offersFor(corrected.score, problems, repairs) : new Map<Problem, Correction[]>(),
    [corrected, problems, repairs],
  );
  // Fix all: the offers that follow from the file alone, when there are two or more of them.
  const fixes = useMemo(
    () =>
      editable && problems.length > 1 && corrected
        ? fixAll(corrected.score, problems, offers)
        : NO_CORRECTIONS,
    [editable, corrected, problems, offers],
  );
  const openLibrary = useAppStore((s) => s.openLibrary);
  const busy = phase === 'waiting' || phase === 'scanning' || phase === 'cancelling';
  const renderError = rendered && rendered.xml === renderXml ? rendered.error : null;
  const importError = imported && imported.xml === importXml ? imported.error : null;
  const reviewError = renderError ?? importError;
  const settled = rendered?.xml === renderXml && imported?.xml === importXml;
  const canUseResult =
    !!session.xml &&
    rendered?.xml === renderXml &&
    imported?.xml === importXml &&
    pages.length > 0 &&
    !reviewError;
  const selectedNote =
    note !== null && editable ? corrected.score.notes.find((n) => n.ordinal === note) : undefined;
  // The bar an import refusal names, with its first note, so the alert leads there (issue 233).
  const refusedAt = (() => {
    const at =
      editable && !renderError && importError && !imported?.stopped && imported?.detail
        ? ENGINE_PLACE.exec(imported.detail)
        : null;
    if (!at || !corrected) return undefined;
    const part = Number(at[1]) - 1;
    const bar = at[2]!;
    const first = corrected.score.notes.find((n) => n.part === part && n.measureNumber === bar);
    return first && { bar, ordinal: first.ordinal };
  })();
  // The photo a note was read from, when homr placed it there (issue 161). The joined score reads
  // its pages in the order of the results, so a score of another page count (an old saved session,
  // a page that failed) shows no photo rather than the wrong one.
  const photoOf = (n?: ScanNote): Blob | undefined => {
    const file =
      n?.imgpos && corrected && corrected.score.pages === sourcePages.length
        ? sourcePages[n.page]?.file
        : undefined;
    return file?.type.startsWith('image/') ? file : undefined;
  };
  // Saved corrections that no longer apply are dropped by the next change, never replayed.
  const kept = corrected ? corrections.slice(0, corrected.applied) : corrections;
  // The verdict line (issue 158): what was read, from the facts the session holds.
  // How unsure homr was of each page, from the page's own recognition (issue 130).
  const doubts = useMemo(
    () =>
      sourcePages.map((page) => {
        if (!page.xml) return undefined;
        try {
          return pageDoubt(readScanScore(parseScanXml(page.xml)));
        } catch {
          return undefined;
        }
      }),
    // sourcePages is rebuilt each render for a single file; its contents are these two.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.pages, session.xml],
  );
  // Why the pages did not join, read from the pages themselves whenever there is no joined score
  // (issue 230): it names the page, for the verdict line and Recognition details, in the language
  // on screen, and a saved scan keeps it.
  const refusal = useMemo(() => {
    if (session.xml || !batch) return undefined;
    const xmls = sourcePages.map((page) => page.xml);
    if (!xmls.length || xmls.some((xml) => !xml)) return undefined;
    try {
      joinScanPages(xmls as string[]);
    } catch (cause) {
      return cause instanceof JoinRefusal ? cause : undefined;
    }
    return undefined;
    // A batch's pages are session.pages (sourcePages is rebuilt each render for a single file).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.pages, session.xml, batch]);
  const found = readVerdict({
    pages: isImage
      ? sourcePages.map((page, index) => ({ warnings: page.warnings, doubt: doubts[index] }))
      : undefined,
    warnings: session.warnings ?? [],
    joined: !!session.xml || !batch,
    refusal: refusal && { page: refusal.page, reason: refusal.reason },
    score: corrected?.score,
    problems: problems.length,
  });
  // The page the verdict names, in an image batch: it alone is photographed again (issue 130). A
  // single photo read unclearly is photographed again too, rather than scanned again as it is.
  const flaggedPages =
    found.kind === 'oneStaff' || found.kind === 'partlyRead' || found.kind === 'unclear'
      ? found.pages
      : found.kind === 'notJoined' && found.page !== undefined
        ? [found.page]
        : [];
  // Else the page whose notation could not be drawn, in a batch of photos.
  const undrawnPage = renderError ? rendered?.page : undefined;
  const retakePage =
    isImage && flaggedPages.length && (batch || found.kind === 'unclear')
      ? flaggedPages[0]! - 1
      : isImage && batch && undrawnPage !== undefined
        ? undrawnPage - 1
        : undefined;
  // The one red: on the next action. A selected note first; Scan again when the verdict says the
  // scan itself needs another go (a verdict that says "scan again" must not leave the red on
  // Use); else Use for fingerings while it can be used (or is still being checked), else the
  // first place to check, else the bar the import refused, else Scan again.
  // Notation that could not be drawn has nothing to correct on: Scan again.
  const useLive = canUseResult || (!settled && !!session.xml && !reviewError);
  const nextRed = selectedNote
    ? 'note'
    : blocks(found)
      ? 'again'
      : useLive
        ? 'use'
        : !renderError && editable && problems.length
          ? 'problem'
          : refusedAt
            ? 'bar'
            : 'again';
  useSelectedMark(sheetHost, selectedNote ? note : null, pages);
  // The photo and the notation are linked (issue 130): the notes to check are ringed in both, and
  // the note pointed at in one is framed in the other.
  const marked = useMemo(() => {
    if (!editable || !corrected) return [];
    const out = new Set<number>();
    for (const problem of problems) {
      const target = problemNote(corrected.score, problem);
      if (target !== undefined) out.add(target);
    }
    return [...out];
  }, [editable, corrected, problems]);
  const markedSet = useMemo(() => new Set(marked), [marked]);
  useScanMarks(sheetHost, marked, pages);
  const [pointed, setPointed] = useState<{ ordinal: number; from: 'photo' | 'sheet' } | null>(null);
  useHoverMark(sheetHost, pointed?.from === 'photo' ? pointed.ordinal : null, pages);
  // The page whose photo is shown follows the selected note while the whole score is reviewed.
  // A note only pointed at moves nothing: the mouse may be on its way to the photo.
  const inHand = selectedNote ? note : null;
  useEffect(() => {
    if (inHand === null || pageMode || !corrected) return;
    const n = corrected.score.notes.find((x) => x.ordinal === inHand);
    if (n && photoOf(n) && n.page !== selected) setSelected(n.page);
    // Only a new note in hand moves the photo; the reader's own page choice stays otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inHand]);
  // A note pointed at belongs to the page it was pointed at on.
  useEffect(() => {
    setPointed(null);
  }, [selected]);
  // The shown photo, once decoded: its staff space sizes the rings (a guess until then) and its
  // staves place each note's frame on the notehead (issue 226).
  const [shown, setShown] = useState<{ file: Blob; image: PageImage }>();
  const shownPhoto = isImage && editable ? sourcePages[selected]?.file : undefined;
  useEffect(() => {
    if (!shownPhoto) return;
    let live = true;
    void pageImage(shownPhoto).then((image) => {
      if (live && image) setShown({ file: shownPhoto, image });
    });
    return () => {
      live = false;
    };
  }, [shownPhoto]);
  const heads = shown?.file === shownPhoto ? shown?.image.heads : undefined;
  const photoPoints = useMemo(
    () =>
      editable && corrected && corrected.score.pages === sourcePages.length
        ? corrected.score.notes.flatMap((n) => {
            if (n.page !== selected || !n.imgpos) return [];
            // Where homr saw the note, until the photo has been read for its notehead.
            const at = (heads && placeHead(heads, n)) ?? n.imgpos;
            return [{ ordinal: n.ordinal, x: at.x, y: at.y }];
          })
        : [],
    [editable, corrected, selected, sourcePages.length, heads],
  );
  // The ink frame: the note pointed at when it is on the photo shown, else the selected one.
  const focus =
    pointed && photoPoints.some((p) => p.ordinal === pointed.ordinal)
      ? pointed.ordinal
      : selectedNote
        ? note
        : null;

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
    warmingUp.current = true;
    client.health().then(
      (metadata) => {
        warmingUp.current = false;
        latestHealth.current = metadata;
        if (alive.current) setHealth(metadata);
      },
      () => {
        warmingUp.current = false;
      },
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
    // The page a failure names: the one shown on its own, else none (the whole scan).
    const shownPage = pageMode ? selected + 1 : undefined;
    // The whole score of a batch that cannot be drawn: the first page that cannot be drawn on its
    // own is the one named (issue 233), else none.
    const failingPage = async (): Promise<number | undefined> => {
      if (pageMode || !batch) return undefined;
      for (const [index, source] of sourcePages.entries()) {
        if (!current || !source.xml) return undefined;
        try {
          await getWorkers().renderer.render({ xml: source.xml, widthPx: width });
        } catch (cause) {
          // A newer render (a resize) has taken over: it says what it finds itself.
          if ((cause as Error)?.name === 'SupersededError') return undefined;
          return index + 1;
        }
      }
      return undefined;
    };
    // Render independently of import: an importer refusal must not erase the raw result.
    const draw = (again: boolean): Promise<void> =>
      getWorkers()
        .renderer.render({ xml: renderXml, widthPx: width })
        .then((result) => {
          if (!current) return;
          setPages(result.pages);
          setRendered({ xml: renderXml, error: null });
        })
        .catch(async (cause: unknown) => {
          if (!current || (cause as Error)?.name === 'SupersededError') return;
          const detail = messageOf(cause, en);
          // A worker that died or aborted is replaced by the next render: the notation is drawn
          // once more. A layout that is refused as such would be refused again.
          if (again && !RENDER_FINAL.has(detail)) return draw(false);
          const page = shownPage ?? (detail === NO_MUSIC ? undefined : await failingPage());
          if (!current) return;
          setRendered({
            xml: renderXml,
            error:
              detail === NO_MUSIC
                ? (m) => m.scan.errors.noMusic(page)
                : (m) => m.scan.errors.notDrawn(page),
            detail,
            page,
          });
        });
    void draw(true);
    return () => {
      current = false;
    };
  }, [renderXml, width, phase, reviewMode, pageMode ? selected : -1]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!importXml || phase !== 'review') return;
    let current = true;
    // The scan import plays a tie it cannot keep as separate notes and lists it (issue 233): a
    // tie never stops Use for fingerings, and each one so played is a place to check.
    const load = (again: boolean): Promise<void> =>
      getWorkers()
        .engine.load(importXml, 'scan.musicxml', SCAN_LOAD)
        .then((result) => {
          if (!current) return;
          setWarnings(result.warnings);
          setImported({
            xml: importXml,
            error: result.score.notes.length ? null : (m) => m.scan.errors.noNotes,
            repairs: result.tieRepairs,
          });
        })
        .catch((cause: unknown) => {
          if (!current) return;
          // English, as the engine's own refusals are: the detail is also a validation case's.
          const detail = messageOf(cause, en);
          // The worker itself stopped (the client says so with a phrase; a refusal is a plain
          // error), and the client stays closed: a fresh one reads the notes once more.
          const stopped = cause instanceof PhraseError;
          if (stopped && workers.current) {
            workers.current.engine.dispose();
            workers.current.engine = createEngineClient();
            if (again) return load(false);
          }
          // The engine names the bar it refused; the reader is told that bar.
          const bar = stopped ? undefined : ENGINE_PLACE.exec(detail)?.[2];
          setImported({
            xml: importXml,
            error: stopped
              ? (m) => m.scan.errors.notChecked
              : bar === undefined
                ? (m) => m.scan.errors.notUsable
                : (m) => m.scan.errors.notUsableAt(bar),
            detail,
            stopped,
            repairs: NO_REPAIRS,
          });
        });
    void load(true);
    return () => {
      current = false;
    };
  }, [importXml, phase]);

  const retain = (next: ScanSession) => {
    // The local score library retains completed source/recognition snapshots in IndexedDB.
    useAppStore.setState({ view: { name: 'scan', session: next } });
    setSession(next);
  };
  // A page photographed again (issue 130): the recognition and corrections it replaces, so the
  // corrections of the other pages carry over to the new recognition (retake.ts).
  // The session keeps them (ScanSession.retake) until the joined recognition is stored.
  const [pendingScan, setPendingScan] = useState(false);
  const retake = (index: number, file: File) => {
    if (busy) return;
    void validateScanImages([file]).then(
      ([valid]) => {
        if (!alive.current || !valid) return;
        const pages = sourcePages.map((p, i) =>
          i === index ? { id: crypto.randomUUID(), file: valid } : p,
        );
        // Pages already photographed again whose scan did not finish keep what they replaced.
        const pending: PendingRetake | undefined = session.xml
          ? kept.length
            ? { xml: session.xml, corrections: kept, pages: [index] }
            : undefined
          : session.retake && {
              ...session.retake,
              pages: [...new Set([...session.retake.pages, index])],
            };
        select(null);
        setReviewMode('combined');
        setUndoStack([]);
        setError(null);
        retain({
          ...session,
          file: pages[0]!.file,
          pages,
          xml: undefined,
          corrections: undefined,
          retake: pending,
        });
        setPhase('ready');
        setPendingScan(true);
      },
      (cause: unknown) => {
        if (alive.current) setError((m) => messageOf(cause, m));
      },
    );
  };
  // The retaken page is scanned at once: the reader's press was the consent, as for the first scan.
  useEffect(() => {
    if (!pendingScan || phase !== 'ready') return;
    setPendingScan(false);
    void scan();
    // scan() reads the session of this render, the one with the new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScan, phase]);
  const arrange = (next: ScanPage[]) => {
    if (busy) return;
    // A pending retake stays while only the retaken pages change; any other change ends it.
    const pending = session.retake;
    const onlyRetaken =
      pending &&
      next.length === sourcePages.length &&
      next.every(
        (p, i) =>
          pending.pages.includes(i) ||
          (p.id === sourcePages[i]!.id && p.file === sourcePages[i]!.file),
      );
    setError(null);
    retain({
      ...session,
      retake: onlyRetaken ? pending : undefined,
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
    setBar(undefined);
    setPhase('scanning');
    const results = sourcePages.map((page) => ({ ...page }));
    // One request reads every page of a PDF, so the bar counts them.
    const pdfPages = await Promise.all(
      results.map((page) => (page.xml ? 1 : pdfPageCount(page.file))),
    );
    if (run.cancelled || !alive.current) return;
    const toScan = (from: number) =>
      results.flatMap((p, i) =>
        i >= from && !p.xml ? [{ file: p.file, pdfPages: pdfPages[i] ?? 1 }] : [],
      );
    // The stretch of the one bar that runs now; each page starts the next from where it stands.
    const track: { stretch?: Stretch } = {};
    for (const [index, page] of results.entries()) {
      if (page.xml) continue;
      if (run.cancelled || !alive.current) return;
      setScanningPage(index + 1);
      page.error = undefined;
      // One synchronous request per page, named by a job id so a cancel can reach it at once.
      const job = newJobId();
      const controller = new AbortController();
      run.controller = controller;
      // Where the bar stood when this page began, and again each time a busy answer ends a stretch
      // it showed: a page offered again never moves the bar back.
      let base = track.stretch ? barAt(track.stretch, Date.now()) : 0;
      const warming = warmingUp.current;
      const expected = expectedBatchMs(toScan(index), warming);
      const own = expectedBatchMs(toScan(index).slice(0, 1), warming);
      let shown: Stretch | undefined;
      const begin = (since: number) => {
        if (run.cancelled || !alive.current) return;
        shown = track.stretch = { since, expected, own, base };
        setBar({ stretch: track.stretch, done: false });
        setPhase('scanning');
      };
      try {
        // A busy scanner is waited for: the same job is offered again until it is taken, for at
        // most BUSY_WAIT_MS, then the busy answer stands as this page's failure.
        const giveUp = Date.now() + BUSY_WAIT_MS;
        let waiting = false;
        let recognition;
        for (;;) {
          const sent = Date.now();
          // Named only while the offer is out: a refused offer started nothing to cancel.
          run.job = job;
          const taken = waiting ? setTimeout(() => begin(sent), TAKEN_AFTER_MS) : undefined;
          if (!waiting) begin(sent);
          let again: number;
          try {
            // Named by its scan: a device that opted in keeps it as a validation case (issue 233).
            recognition = await client.recognize(
              page.file,
              job,
              controller.signal,
              scanIdOf(session.id),
              scanIdOf(page.id),
            );
            break;
          } catch (cause) {
            if (!(cause instanceof BusyError) || Date.now() + cause.retryAfterMs > giveUp)
              throw cause;
            again = cause.retryAfterMs;
            if (shown) base = barAt(shown, Date.now());
            shown = undefined;
          } finally {
            clearTimeout(taken);
          }
          delete run.job;
          if (run.cancelled || !alive.current) return;
          waiting = true;
          setPhase('waiting');
          await pause(again, controller.signal);
          if (run.cancelled || !alive.current) return;
        }
        if (run.cancelled || !alive.current) return;
        if (results.every((p) => p.xml || p === page)) {
          // The last answer fills the bar, and the reader sees it full.
          setBar((current) => current && { ...current, done: true });
          await pause(FULL_HOLD_MS, controller.signal).catch(() => {});
          if (run.cancelled || !alive.current) return;
        }
        page.xml = recognition.xml;
        page.recognizer = recognition.recognizer ?? latestHealth.current?.recognizer;
        // A page's warnings are its own: an empty list stays empty.
        page.warnings = recognition.warnings;
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
        const refusal =
          cause instanceof PhraseError && (cause.phrase === BUSY || cause.phrase === LIMITED)
            ? cause.phrase
            : undefined;
        if (refusal) {
          // The pages after it would meet the same answer: they wait for the reader's retry.
          for (const rest of results.slice(index + 1)) if (!rest.xml) rest.error = page.error;
        }
        retain({ ...session, pages: results.map((p) => ({ ...p })) });
        if (refusal) {
          active.current = { cancelled: false };
          setSelected(index);
          setError(refusal);
          setPhase('ready');
          return;
        }
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
      // The join's own reason is read again from the pages, for the verdict line and Recognition
      // details.
      setError(batch ? NOT_COMBINED : (m) => messageOf(cause, m));
      setReviewMode('page');
    }
    // After a page was photographed again, the other pages' corrections follow their notes.
    // They are settled once the joined recognition is stored; pages that did not join keep them.
    const before = session.retake;
    let carried: Correction[] | undefined;
    if (before && xml && before.corrections.length)
      try {
        carried = carryOver(before.xml, xml, before.corrections, before.pages);
      } catch {
        carried = undefined;
      }
    retain({
      ...session,
      pages: results,
      xml,
      retake: xml ? undefined : before,
      corrections: carried?.length ? carried : undefined,
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
          ...(xml && stavesWerePaired(xml) ? [PAIRED_STAVES_WARNING] : []),
        ]),
      ],
    });
    setUndoStack([]);
    setPhase('review');
  };
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
  // `fromPlace`: offered on a place to check, which goes away once it is made.
  const applyCorrection = (correction: Correction, fromPlace = false) => {
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
    if (fromPlace || correction.kind === 'meter' || correction.kind === 'barline') {
      // The place to check it came from goes away: say what changed, and keep the focus nearby.
      const score = corrected.score;
      setEditStatus((m) => `${describeCorrection(m, score, correction)}.`);
      sheetRef.current?.focus();
    } else setEditStatus(null);
    retain({ ...session, corrections: [...kept, correction] });
  };
  // Fix all (issue 233): every fix that follows from the file alone, as one step that one Undo
  // takes back. Each is checked on the ones before it, as a single correction is.
  const applyFixes = () => {
    if (!session.xml || !corrected) return;
    const made: Correction[] = [];
    for (const fix of fixes)
      if (!tryCorrection(session.xml, [...kept, ...made], fix)) made.push(fix);
    if (!made.length) return;
    setUndoStack((stack) => [...stack, kept]);
    setEditStatus((m) => m.scan.review.fixedAll(made.length));
    sheetRef.current?.focus();
    retain({ ...session, corrections: [...kept, ...made] });
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
      setPointed(null);
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
  // A mouse over the notation points at a note: its place in the photo is framed (issue 130).
  // Searching every note's box is done once per frame, for where the mouse is by then.
  const sheetFrame = useRef<number | undefined>(undefined);
  const sheetMouse = useRef<{ target: EventTarget | null; clientX: number; clientY: number }>(
    undefined,
  );
  const stopSheetFrame = () => {
    if (sheetFrame.current !== undefined) cancelAnimationFrame(sheetFrame.current);
    sheetFrame.current = undefined;
  };
  useEffect(() => stopSheetFrame, []);
  const onSheetPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || !editable || !sheetHost || !photoPoints.length) return;
    const { target, clientX, clientY } = event;
    sheetMouse.current = { target, clientX, clientY };
    if (sheetFrame.current !== undefined) return;
    sheetFrame.current = requestAnimationFrame(() => {
      sheetFrame.current = undefined;
      const mouse = sheetMouse.current;
      if (!mouse) return;
      const ordinal = noteAt(sheetHost, mouse);
      setPointed((p) =>
        ordinal === undefined
          ? p?.from === 'sheet'
            ? null
            : p
          : p?.ordinal === ordinal && p.from === 'sheet'
            ? p
            : { ordinal, from: 'sheet' },
      );
    });
  };
  const onSheetLeave = () => {
    stopSheetFrame();
    setPointed((p) => (p?.from === 'sheet' ? null : p));
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
  // A thumbnail is the view switch: a page shows its own recognition, the same page again the
  // whole score. Pages that did not join have no whole score to return to.
  const showPage = (index: number) => {
    select(null);
    if (pageMode && index === selected && session.xml) setReviewMode('combined');
    else {
      setSelected(index);
      if (batch) setReviewMode('page');
    }
    // On a phone the recognition sits above the thumbnails: bring it into view.
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches)
      resultHost.current?.scrollIntoView?.({ block: 'start' });
  };
  const baseName = session.file.name.replace(/\.[^.]+$/, '');
  // The alert under the buttons: what failed and where, in the reader's words, then what to do.
  // Notation that could not be drawn has no notes to correct: it is scanned again or downloaded.
  const reviewAlert = (m: Messages): string | undefined => {
    if (!reviewError) return undefined;
    const reason = reviewError(m);
    if (renderError) return m.scan.review.notDrawnProblem(reason);
    // The notes were never checked: nothing here blames them, and the reason says what to do.
    if (imported?.stopped) return reason;
    return (
      editable
        ? m.scan.review.problem
        : pageMode && session.xml
          ? m.scan.review.problemInCombined
          : m.scan.review.problemReadOnly
    )(reason);
  };
  // Under Recognition details only: the join's and the workers' own messages, as a supplement.
  const technicalLines = (m: Messages): string[] => [
    ...(refusal ? [m.scan.review.technical(refusal.phrase(m))] : []),
    ...[rendered, imported].flatMap((state, i) =>
      state?.detail && state.xml === (i === 0 ? renderXml : importXml)
        ? [m.scan.review.technical(state.detail)]
        : [],
    ),
  ];
  // What the review told the reader (issue 233), in English whatever the language on screen, so
  // validation cases compare across devices: kept in the scan's archive and, on a device that
  // opted in, with the scan's pages at the scan service. They are the facts of what Use opens:
  // while a page of a joined batch is shown alone, the whole score's last ones stand.
  const placeFacts = useMemo(
    () =>
      corrected
        ? problems.map((problem) => ({
            text: describeProblem(en, corrected.score, problem),
            bar: placeBar(corrected.score, problem),
          }))
        : [],
    [corrected, problems],
  );
  const shownError = error && error !== NOT_COMBINED ? error : null;
  const facts: ReviewFacts = {
    verdict: verdictText(en, found),
    usable: canUseResult,
    alert: reviewAlert(en) ?? shownError?.(en),
    technical: technicalLines(en),
    places: placeFacts,
    page:
      found.kind === 'notJoined' ? found.page : found.kind === 'read' ? undefined : found.pages[0],
    corrections: kept.length,
    pages: sourcePages.map((source) => scanIdOf(source.id)),
  };
  const factsKey = JSON.stringify(facts);
  const wholeScan = !(pageMode && session.xml);
  const scanFacts = useRef<ReviewFacts | undefined>(undefined);
  // Reported once the review has settled, and again whenever what it says changes.
  const reportable = phase === 'review' && settled && wholeScan;
  useEffect(() => {
    if (!reportable) return;
    scanFacts.current = facts;
    void reportCase(scanIdOf(session.id), facts);
    // The facts are rebuilt each render; their text says when they changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportable, factsKey, session.id]);
  // Everything the scan did in one file: the phone's share sheet where it has one, else a download.
  const downloadAll = async () => {
    if (archiving) return;
    setArchiving(true);
    try {
      const archive = await makeScanArchive(session, {
        correctedXml: corrected && kept.length > 0 ? corrected.xml : undefined,
        warnings: [...new Set([...(session.warnings ?? []), ...warnings])],
        review: wholeScan ? facts : scanFacts.current,
        build,
        userAgent: navigator.userAgent,
      });
      await shareOrDownload(archive, baseName || archive.name);
    } catch (cause) {
      if (alive.current) setError((m) => messageOf(cause, m));
    } finally {
      if (alive.current) setArchiving(false);
    }
  };
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
              {busy ? (
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
            {busy && (
              <div className="scan-loader">
                <Loader tune="scale" />
              </div>
            )}
            <p role="status">
              {phase === 'waiting'
                ? t.scan.view.waiting
                : phase === 'scanning'
                  ? batch
                    ? t.scan.view.scanningPage(scanningPage, sourcePages.length)
                    : t.scan.view.scanning
                  : ''}
            </p>
            {phase === 'scanning' && bar && <ScanProgress {...bar} />}
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
          {/* What was read, in facts. A page read as one staff, a line read in part and pages that
              did not join are said here, with the action: they decide every fingering. */}
          <p className="scan-verdict" role={blocks(found) ? 'alert' : undefined}>
            {verdictText(t, found)}
          </p>
          {shownError && <p role="alert">{shownError(t)}</p>}
          {corrected && corrected.applied < corrections.length && (
            <p role="alert">{t.scan.edit.stale(corrected.applied)}</p>
          )}
          <div className="row scan-next">
            {/* Plain while a selected note, or the first place to check, carries the one red. */}
            <Button
              className="scan-use"
              primary={nextRed === 'use'}
              disabled={!canUseResult}
              onClick={useResult}
            >
              {t.scan.review.useForFingerings}
            </Button>
            {retakePage !== undefined && (
              <RetakePage
                page={retakePage + 1}
                single={!batch}
                touch={touchOnly}
                primary={nextRed === 'again'}
                onFile={(file) => retake(retakePage, file)}
              />
            )}
            <Button
              primary={nextRed === 'again' && retakePage === undefined}
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
                  retake: undefined,
                  pages: sourcePages.map((p) => ({ ...p, xml: undefined, error: undefined })),
                });
              }}
            >
              {t.scan.review.scanAgain}
            </Button>
          </div>
          {reviewError && <p role="alert">{reviewAlert(t)}</p>}
          {refusedAt && (
            <button
              className={`scan-show-bar ${nextRed === 'bar' ? 'is-red' : 'text-button'}`}
              onClick={() => select(refusedAt.ordinal)}
            >
              {t.scan.review.showBar(refusedAt.bar)}
            </button>
          )}
          <div className="scan-review">
            <section className="scan-source stack">
              <h2>{t.scan.view.original}</h2>
              {isImage ? (
                <ImagePages
                  pages={sourcePages}
                  selected={selected}
                  onSelect={showPage}
                  recognized={pageMode ? selected : null}
                  editable={false}
                  busy={false}
                  onChange={arrange}
                  overlay={
                    photoPoints.length
                      ? (size) => (
                          <PhotoMarks
                            width={size.width}
                            height={size.height}
                            space={
                              shown && shown.file === shownPhoto
                                ? shown.image.space
                                : fallbackSpace(size.width)
                            }
                            points={photoPoints}
                            marked={markedSet}
                            focus={focus}
                            onPoint={(ordinal) =>
                              setPointed((p) =>
                                ordinal === null
                                  ? null
                                  : p?.ordinal === ordinal && p.from === 'photo'
                                    ? p
                                    : { ordinal, from: 'photo' },
                              )
                            }
                            onPick={select}
                          />
                        )
                      : undefined
                  }
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
              {/* A page shown on its own can be photographed again, unless the verdict offers it. */}
              {isImage && pageMode && retakePage !== selected && (
                <RetakePage
                  page={selected + 1}
                  single={!batch}
                  touch={touchOnly}
                  onFile={(file) => retake(selected, file)}
                />
              )}
            </section>
            <section className="stack scan-result" ref={resultHost} onKeyDown={onEditKey}>
              <h2>{t.scan.review.recognized}</h2>
              {batch && (
                <p className="small muted">
                  {reviewMode === 'page'
                    ? t.scan.review.pageShown(selected + 1, !!session.xml)
                    : t.scan.review.allPages}
                </p>
              )}
              {editable && problems.length > 0 && corrected && (
                <details
                  className="scan-problems"
                  open={placesOpen || nextRed === 'problem' || undefined}
                  onToggle={(event) => setPlacesOpen(event.currentTarget.open)}
                >
                  <summary>{t.scan.edit.problemsSummary(problems.length)}</summary>
                  {/* One step for every fix the file decides alone; Undo takes it back whole. */}
                  {fixes.length > 1 && (
                    <button className="scan-fix-all" onClick={applyFixes}>
                      {t.scan.edit.fixAll(fixes.length)}
                    </button>
                  )}
                  <ul className="stack">
                    {problems.map((problem, index) => {
                      const target = problemNote(corrected.score, problem);
                      const choices = offers.get(problem) ?? NO_CORRECTIONS;
                      const offer = choices.length > 0;
                      const where = corrected.score.notes.find((n) => n.ordinal === target);
                      const photo = photoOf(where);
                      // The first place carries the red on its first fix, else on its note.
                      const red = index === 0 && nextRed === 'problem';
                      return (
                        <li key={index}>
                          {photo && where?.imgpos && (
                            <NoteCrop
                              image={photo}
                              at={where.imgpos}
                              note={where}
                              size="small"
                              label={t.scan.edit.photoAt(t.scan.edit.bar(where.measureNumber))}
                            />
                          )}
                          <div className={`scan-problem-body${offer ? ' has-offer' : ''}`}>
                            <button
                              className={red && !offer ? 'is-red' : 'text-button'}
                              disabled={target === undefined}
                              onClick={() => {
                                if (target !== undefined) select(target);
                              }}
                            >
                              {describeProblem(t, corrected.score, problem)}
                            </button>
                            {choices.map((choice, at) => (
                              <button
                                key={at}
                                className={red && at === 0 ? 'is-red' : undefined}
                                onClick={() => applyCorrection(choice, true)}
                              >
                                {offerLabel(t, corrected.score, problem, choice)}
                              </button>
                            ))}
                          </div>
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
                  onPointerMove={onSheetPoint}
                  onPointerLeave={onSheetLeave}
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
                  photo={photoOf(selectedNote)}
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
            <details>
              <summary>{t.scan.review.detailsSummary}</summary>
              <div className="stack small">
                <p>
                  {session.recognizer ?? 'Audiveris'} ·{' '}
                  {session.recognizedAt
                    ? new Date(session.recognizedAt).toLocaleString(locale)
                    : ''}
                </p>
                <p>{t.about.build(build.commit, formatBuildDay(locale, build))}</p>
                <p>{t.scan.review.retained}</p>
                {sourcePages.some((p) => /<software>\s*homr\s*<\/software>/i.test(p.xml ?? '')) && (
                  <p>{t.scan.review.beamGrouping}</p>
                )}
                {reviewWarnings(t, [...(session.warnings ?? []), ...warnings]).map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
                {technicalLines(t).map((line, i) => (
                  <p key={`detail-${i}`}>{line}</p>
                ))}
                {keeping && <p>{t.scan.review.kept}</p>}
              </div>
            </details>
            {(session.xml || sourcePages.some((p) => p.xml)) && (
              // Open by itself when the notation could not be drawn: the files are the way on.
              <details className="scan-files" open={!!renderError || undefined}>
                <summary>{t.scan.review.filesSummary}</summary>
                <div className="stack">
                  <button
                    className="text-button scan-download"
                    disabled={archiving}
                    onClick={() => {
                      void downloadAll();
                    }}
                  >
                    {t.scan.review.downloadAll}
                  </button>
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
          </section>
        </>
      )}
    </main>
  );
}
