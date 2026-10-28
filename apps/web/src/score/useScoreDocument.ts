/**
 * The open pipeline of the score view: bytes -> engine.load -> engine.solve -> fingered MusicXML
 * -> our note ids -> Verovio pages, as a status machine the view renders. Parsing and solving
 * run in the engine worker and layout in the Verovio worker; the main thread only injects ids
 * and swaps state.
 *
 * After the first open, a hand size change re-solves and publishes the changed digits for the
 * view to patch in place (no re-layout); a change of the editor's-fingering setting or of the
 * width bucket lays the score out again. Every async step checks that it still belongs to the
 * current document and the newest request, so a late answer never overwrites a newer one.
 *
 * A MIDI file is imported by the engine worker into generated MusicXML; a change of its hand
 * split opens the same bytes again with the split (loading -> fingering -> rendering -> ready),
 * while the previous import stays on screen until the new one replaces it.
 *
 * "Add notes between" (issue #67): once the plain score is ready, an eligible piece is sent to the
 * worker's guard. An offered embellishment becomes a second version of the document, fingered at
 * every hand size by the guard and laid out ahead of time, so the switch swaps the score, the
 * fingering and the pages in one state change. Only the version on screen is laid out again or
 * patched; `xml` and `plain` stay the plain score's, for export and the side panel.
 */
import type { Assignment, MidiInfo, Score } from '@digitus2/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { fileIdentity, useAppStore, type HandSize, type PieceSource } from '../app/store.js';
import { createEngineClient, type EngineClient } from '../engine/client.js';
import { PhraseError } from '../i18n/PhraseError.js';
import { loadPiece, pieceBySlug, readScoreFile } from '../library/manifest.js';
import { injectNoteIds } from './render/injectIds.js';
import { createRenderer, SupersededError, type ScoreRenderer } from './render/renderer.js';

/** 'idle' is reserved (the plan's interface; nothing sets it yet): a document starts 'loading'. */
export type DocStatus = 'idle' | 'loading' | 'fingering' | 'rendering' | 'ready' | 'error';

export interface ScoreDocument {
  status: DocStatus;
  error: string | null;
  /**
   * What was thrown, so the screen writes the reason in the language it shows now (a language
   * switch while the error is open); `error` is the same text written when it happened.
   */
  errorCause?: unknown;
  /** The score of the version shown (`shownVersion`). */
  score: Score | null;
  /** The unpacked plain source text, without our ids or fingerings, whichever version is shown. */
  xml: string | null;
  /** Source of the version on screen, for paper engraving with its current assignment. */
  printXml?: string | null;
  /** What is shown: the engine's fingering, or the editorial one when showEditorial is on. */
  assignment: Assignment | null;
  /**
   * The notes whose digits the edition prints at rest (issue 94), for the fingering shown; the
   * rest are spare and the view hides them outside the bar played, cued or hovered. Null while the
   * editor's fingering is shown (an edition already) and until the first solve has answered.
   */
  printed: ReadonlySet<string> | null;
  /**
   * The editorial fingering of the version shown (library .fingered file, or <fingering> in a
   * dropped file; on the embellished version, on its original notes only).
   */
  editorial: Assignment | null;
  pages: string[];
  solveMs: number | null;
  renderMs: number | null;
  title: string;
  composer: string;
  warnings: string[];
  /**
   * Digits to patch into the current pages (note id -> digit text) after a re-solve; a new Map
   * each time, so the view applies it once per change. Null when the pages are up to date.
   */
  digitChanges: Map<string, string> | null;
  /** What the MIDI import did; null for MusicXML files and library pieces. */
  midiInfo: MidiInfo | null;
  /**
   * The fixed hand split asked for (the lowest right-hand key), or null for the automatic
   * separation. Per document, not persisted; meaningful for MIDI files only.
   */
  splitMidi: number | null;
  /** "Add notes between": 'pending' until decided, 'offered' once the guarded version is laid
   *  out (the switch shows), 'none' for a piece that does not get one. */
  embellish: 'pending' | 'offered' | 'none';
  /** The switch: on or off, for this open document only (off on every open). */
  embellished: boolean;
  /** Which version `score`, `assignment`, `editorial` and `pages` show. */
  shownVersion: 'plain' | 'embellished';
  /** The plain document, for export and the side panel's facts: its score and the fingering the
   *  plain pages show or would show (the engine's for the hand size, or the editor's when shown). */
  plain: { score: Score; assignment: Assignment | null } | null;
  setEmbellished(on: boolean): void;
}

/** The state the pipeline keeps; the hand split and the switch are the user's and live beside it. */
type DocState = Omit<ScoreDocument, 'splitMidi' | 'embellished' | 'setEmbellished'>;

export interface ScoreServices {
  engine: EngineClient;
  renderer: ScoreRenderer;
  fetchText?: (url: string) => Promise<Uint8Array>;
}

let engineClient: EngineClient | undefined;
let scoreRenderer: ScoreRenderer | undefined;

/**
 * The module singletons: one engine worker and one Verovio worker per page, created on first
 * access (the library view touches them while idle so the first piece opens faster). A worker
 * that fails is forgotten: the piece it was serving shows an error, and the next access starts a
 * fresh worker.
 */
export const services: ScoreServices = {
  get engine() {
    if (engineClient) return engineClient;
    const client = createEngineClient(undefined, () => {
      if (engineClient === client) engineClient = undefined;
    });
    return (engineClient = client);
  },
  get renderer() {
    if (scoreRenderer) return scoreRenderer;
    const renderer = createRenderer(undefined, () => {
      if (scoreRenderer === renderer) scoreRenderer = undefined;
    });
    return (scoreRenderer = renderer);
  },
};

/** Starts both workers ahead of the first open: the engine bundle loads, the WASM compiles. */
export function warmUpServices(): void {
  services.renderer.warmUp();
  void services.engine;
}

/** Layout width buckets: the score is laid out again only when the width crosses into another. */
export const WIDTH_BUCKET_PX = 160;
export function bucket(widthPx: number): number {
  return Math.round(widthPx / WIDTH_BUCKET_PX) * WIDTH_BUCKET_PX;
}

/** Used until the sheet column has been measured (it has no width while hidden). */
const FALLBACK_WIDTH_PX = 800;

/** How often a render that another document superseded on the shared worker is asked again. */
const RENDER_ATTEMPTS = 3;

/** The highest library grade tried for "Add notes between". */
export const EMBELLISH_MAX_GRADE = 2;

/**
 * The most notes a dropped file may have to be tried: the guard solves and lints it at every hand
 * size in the engine worker, and nothing else runs there meanwhile. The library's grade 1 and 2
 * pieces have at most 884.
 */
export const EMBELLISH_MAX_NOTES = 900;

/**
 * Whether a piece is sent to the guard: a library piece at grade 1 or 2; a dropped MusicXML or
 * MIDI file (`grade` null) of at most `EMBELLISH_MAX_NOTES` notes; never a scan import.
 */
export function embellishEligible(grade: number | null, scan: boolean, notes = 0): boolean {
  if (scan) return false;
  return grade === null ? notes <= EMBELLISH_MAX_NOTES : grade <= EMBELLISH_MAX_GRADE;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new PhraseError((t) => t.score.doc.fetchFailed(res.status));
  return new Uint8Array(await res.arrayBuffer());
}

function nonEmpty(a: Assignment | null | undefined): Assignment | null {
  return a && Object.keys(a).length > 0 ? a : null;
}

/**
 * Moves an editorial fingering read from a library piece's `.fingered` file onto the ids of the
 * stripped score: both files have the same notes in the same order, so notes pair by index. A
 * pair whose pitches differ is skipped rather than trusted.
 */
export function rekeyByIndex(from: Score, assignment: Assignment, onto: Score): Assignment | null {
  const out: Assignment = {};
  const n = Math.min(from.notes.length, onto.notes.length);
  for (let i = 0; i < n; i++) {
    const a = from.notes[i]!;
    const b = onto.notes[i]!;
    const f = assignment[a.id];
    if (f && a.midi === b.midi) out[b.id] = f;
  }
  return nonEmpty(out);
}

/**
 * Moves a fingering of the plain score onto the embellished one: a note pairs with the note at
 * the same onset (in quarters, as the two files may count divisions differently), pitch, staff
 * and voice. The added notes have no partner and get no entry; null when nothing matches.
 */
export function carryAssignment(from: Score, a: Assignment, onto: Score): Assignment | null {
  const key = (s: Score, n: Score['notes'][number]) =>
    `${n.onsetTick / s.divisions}|${n.midi}|${n.staff}|${n.voice}`;
  const byKey = new Map<string, Assignment[string]>();
  for (const n of from.notes) {
    const f = a[n.id];
    if (f) byKey.set(key(from, n), f);
  }
  const out: Assignment = {};
  for (const n of onto.notes) {
    const f = byKey.get(key(onto, n));
    if (f) out[n.id] = f;
  }
  return nonEmpty(out);
}

/**
 * The digits that differ between two fingerings of the same score. `structural` is true when a
 * note gains or loses a digit or a substitution: those need a new layout, not a text patch.
 */
export function diffDigits(
  prev: Assignment,
  next: Assignment,
): { changes: Map<string, string>; structural: boolean } {
  const changes = new Map<string, string>();
  let structural = false;
  for (const id of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[id];
    const b = next[id];
    if (!a || !b || a.substitution !== b.substitution) {
      structural = true;
      continue;
    }
    if (a.finger !== b.finger) changes.set(id, String(b.finger));
  }
  return { changes, structural };
}

interface Session {
  cancelled: boolean;
}

type VersionName = 'plain' | 'embellished';

/** One version of the open document: the plain score, or its embellishment. */
interface Version {
  score: Score;
  xml: string;
  /** The newest engine fingering for the current hand size; null until the first solve. */
  engine: Assignment | null;
  /** Plain: the file's or the library's. Embellished: the file's, or the library's carried over. */
  editorial: Assignment | null;
  /** The printed notes (issue 94) of each engine fingering solved so far; the editor's has none. */
  printedOf: WeakMap<Assignment, ReadonlySet<string>>;
  /**
   * The text given to the renderer (fingered, with our note ids) for each fingering laid out so
   * far. A new width, or switching back to a fingering shown before, lays the same text out
   * again: writing a fingering into the MusicXML costs the engine a whole parse and serialisation
   * (about 2 s for K.545), the layout itself 0.3 s.
   */
  laidOut: WeakMap<Assignment, string>;
  /** The embellished version only: the guard's fingering at every hand size (no re-solve). */
  assignments?: Record<HandSize, Assignment>;
}

interface OpenDoc {
  plain: Version;
  /** Set once the guard has offered an embellishment; null before and for a refused piece. */
  embellished: Version | null;
  /** A library piece's grade; null for a dropped file. */
  grade: number | null;
  /**
   * What the printed digits depend on besides the fingering (issue 94): a library piece's level
   * and, with an editor's fingering, the editor's digit count as the cap. A dropped file or a scan
   * has neither: three stray fingerings must not cap a whole piece at three digits.
   */
  edition: { level?: number; editorDigits?: number } | undefined;
  /** A library piece's `.fingered` file, loaded once, when the editor's fingering is first shown. */
  fingeredPath: string | null;
  editorialLoad: Promise<Assignment | null> | null;
  /** The guard has been asked, or the piece found not eligible: once per open. */
  embellishAsked: boolean;
  /**
   * Pages laid out so far, by `pagesKey`, with the fingering they show: a switch between the
   * versions, or back to a fingering, takes them without a layout while that fingering is still
   * the one to show.
   */
  pages: Map<string, { pages: string[]; assignment: Assignment; ms: number }>;
}

function pagesKey(version: VersionName, widthBucket: number, editorial: boolean): string {
  return `${version}|${widthBucket}|${editorial ? 'editorial' : 'engine'}`;
}

/**
 * Keeps pages laid out for one version at one width bucket. The version's pages at other buckets
 * are dropped (a switch needs only the other version at the current width, and a window dragged
 * across the buckets would otherwise keep a full set of pages per bucket), and the entry is
 * stored last, so the newest entry is the last in the map.
 */
function storePages(
  doc: OpenDoc,
  version: VersionName,
  widthBucket: number,
  editorial: boolean,
  entry: { pages: string[]; assignment: Assignment; ms: number },
): void {
  for (const k of [...doc.pages.keys()])
    if (k.startsWith(`${version}|`) && !k.startsWith(`${version}|${widthBucket}|`))
      doc.pages.delete(k);
  const key = pagesKey(version, widthBucket, editorial);
  doc.pages.delete(key);
  doc.pages.set(key, entry);
}

/** The width to lay out at: the measured one, or the fallback while the column has none. */
function layoutWidth(widthPx: number): number {
  return widthPx > 0 ? widthPx : FALLBACK_WIDTH_PX;
}

/**
 * The text the renderer lays out for `assignment` on version `v` (fingered, with our note ids):
 * written by the engine once per fingering, then kept in `v.laidOut`. Null when `live()` turned
 * false while the engine wrote it.
 */
async function laidOutText(
  v: Version,
  assignment: Assignment,
  svc: ScoreServices,
  live: () => boolean,
): Promise<string | null> {
  const kept = v.laidOut.get(assignment);
  if (kept !== undefined) return kept;
  const fingered = await svc.engine.fingeredXml(v.xml, v.score, assignment);
  if (!live()) return null;
  const xml = injectNoteIds(fingered, v.score);
  v.laidOut.set(assignment, xml);
  return xml;
}

/** Records which notes the edition prints for `assignment` (the worker's `printed`, when it sent it). */
function keepPrinted(v: Version, assignment: Assignment, printed: readonly string[] | undefined) {
  if (printed) v.printedOf.set(assignment, new Set(printed));
}

/** The fingering the plain pages show or would show: the editor's when shown, else the engine's. */
function plainFingering(doc: OpenDoc, showEditorial: boolean): Assignment | null {
  return (showEditorial ? doc.plain.editorial : null) ?? doc.plain.engine;
}

/**
 * The plain version back on screen, for a reopen that starts while the embellished version is
 * shown: the plain score with plain pages laid out before and the fingering those pages show, so
 * no render pairs one version's note ids with the other's pages or fingering. The pages at this
 * width with the fingering to show are preferred. Null when the plain version is on screen.
 */
function plainOnScreen(
  doc: OpenDoc | null,
  shownVersion: VersionName,
  widthBucket: number,
  showEditorial: boolean,
): Pick<DocState, 'score' | 'assignment' | 'editorial' | 'pages' | 'printed'> | null {
  if (!doc || shownVersion !== 'embellished') return null;
  const want = plainFingering(doc, showEditorial);
  const exact = pagesKey('plain', widthBucket, showEditorial && doc.plain.editorial !== null);
  const laid = [...doc.pages].filter(([k]) => k.startsWith('plain|')).reverse();
  const hit =
    laid.find(([k, e]) => k === exact && e.assignment === want) ??
    laid.find(([, e]) => e.assignment === want) ??
    laid.find(([k]) => k.startsWith(`plain|${widthBucket}|`)) ??
    laid[0];
  const assignment = hit?.[1].assignment ?? want;
  return {
    score: doc.plain.score,
    editorial: doc.plain.editorial,
    assignment,
    printed: assignment ? (doc.plain.printedOf.get(assignment) ?? null) : null,
    pages: hit?.[1].pages ?? [],
  };
}

function initialDoc(slug: string | null, fileName: string | null): DocState {
  const piece = slug === null ? undefined : pieceBySlug(slug);
  return {
    status: 'loading',
    error: null,
    score: null,
    xml: null,
    assignment: null,
    printed: null,
    editorial: null,
    pages: [],
    solveMs: null,
    renderMs: null,
    title: piece?.title ?? fileName ?? slug ?? '',
    composer: piece?.composer ?? '',
    warnings: [],
    digitChanges: null,
    midiInfo: null,
    embellish: 'pending',
    shownVersion: 'plain',
    plain: null,
  };
}

/**
 * The state a reopen of the same source starts from: `restore` on screen (the plain version, when
 * the embellished one was shown), and "Add notes between" withdrawn until the new import is
 * guarded, so the switch never acts on a document that has no embellished version.
 */
function reopening(s: DocState, restore: ReturnType<typeof plainOnScreen>): DocState {
  return {
    ...s,
    ...restore,
    status: 'loading',
    error: null,
    digitChanges: null,
    embellish: 'pending',
    shownVersion: 'plain',
    plain: null,
  };
}

// A dropped file's identity lives with the store since polish plan Task 6 (its tempo is kept per
// piece, by `pieceKey`); re-exported here, where it was.
export { fileIdentity };

export function useScoreDocument(
  source: PieceSource,
  widthPx: number,
  servicesArg?: ScoreServices,
): ScoreDocument & { reRender(): void; setSplitMidi(value: number | null): void } {
  // The source's identity: the slug, or the dropped file's name and content.
  // A shared score is opened as a file; one that began as a scan is read as a scan is.
  const scanImport =
    (source.kind === 'file' && !!source.scan) ||
    (source.kind === 'shared' && source.origin === 'scan');
  const slug = source.kind === 'library' ? source.slug : null;
  const fileName = source.kind === 'library' ? null : source.name;
  const fileBytes = source.kind === 'library' ? null : source.bytes;
  const fileKey = fileBytes ? fileIdentity(fileBytes) : null;
  const sourceKey = JSON.stringify([slug, fileName, fileKey, scanImport]);

  const handSize = useAppStore((s) => s.settings.handSize);
  const showEditorial = useAppStore((s) => s.settings.showEditorial);

  const [state, setState] = useState<DocState>(() => initialDoc(slug, fileName));
  const [nonce, setNonce] = useState(0);
  const reRender = useCallback(() => setNonce((n) => n + 1), []);

  // The hand split asked for, tied to the source it was asked for: another source starts with
  // the automatic separation.
  const [split, setSplit] = useState<{ source: string; value: number | null }>({
    source: sourceKey,
    value: null,
  });
  const splitMidi = split.source === sourceKey ? split.value : null;

  // "Add notes between", tied to the source and the hand split it was set for: every open, new
  // source and new hand split starts off. It does anything only while a version is offered.
  const switchKey = `${sourceKey}|${splitMidi}`;
  const [switchState, setSwitch] = useState({ source: switchKey, on: false });
  const offered = state.embellish === 'offered';
  const embellishedOn = offered && switchState.on && switchState.source === switchKey;
  const setEmbellished = useCallback(
    (on: boolean) => {
      if (offered) setSwitch({ source: switchKey, on });
    },
    [offered, switchKey],
  );

  // Latest values for async work, which must not restart when these change. Declared before the
  // other effects so they see this commit's values.
  const svcRef = useRef<ScoreServices>(servicesArg ?? services);
  const widthRef = useRef(widthPx);
  const bytesRef = useRef(fileBytes);
  useEffect(() => {
    svcRef.current = servicesArg ?? services;
    widthRef.current = widthPx;
    bytesRef.current = fileBytes;
  });

  // The open document's session: cancelled when the source or its hand split changes, or the
  // hook unmounts.
  const sessionRef = useRef<Session>({ cancelled: true });
  const docRef = useRef<OpenDoc | null>(null);
  const shownRef = useRef<Assignment | null>(null); // the fingering the current pages show
  const shownVersionRef = useRef<VersionName>('plain'); // the version the current pages show
  const solvedForRef = useRef<HandSize | null>(null); // the hand size plain.engine is (being) solved for
  const solveSeqRef = useRef(0);
  const renderKeyRef = useRef<string | null>(null); // the layout last asked for
  const renderSeqRef = useRef(0);
  const openedRef = useRef<string | null>(null); // the source the last open was for

  /**
   * What a reopen of the same source puts on screen: the plain version, if the embellished one is
   * shown. Reads the refs, so it is taken before they are reset.
   */
  const plainRestore = useCallback(() => {
    const showEd = useAppStore.getState().settings.showEditorial;
    const widthBucket = bucket(layoutWidth(widthRef.current));
    return plainOnScreen(docRef.current, shownVersionRef.current, widthBucket, showEd);
  }, []);

  // A new hand split reopens the source (effect 1). The reopen starts here, in the same update as
  // the split: the old session stops publishing, and the plain version is on screen at once.
  const setSplitMidi = useCallback(
    (value: number | null) => {
      setSplit({ source: sourceKey, value });
      if (value === splitMidi) return;
      sessionRef.current.cancelled = true;
      const restore = plainRestore();
      shownVersionRef.current = 'plain';
      setState((s) => reopening(s, restore));
    },
    [sourceKey, splitMidi, plainRestore],
  );

  // Each stage starts in an effect, after React has committed the previous status, so the status
  // line is on screen before the next stage's work is posted to a worker.
  const status = state.status;

  // 1. Load: bytes -> engine.load -> 'fingering'. Also when the hand split of a MIDI file
  //    changes: the same source is opened again, and what it showed (the pages, the import facts
  //    and the Hand split control with its focus) stays until the new import replaces it.
  useEffect(() => {
    const session: Session = { cancelled: false };
    const reopen = openedRef.current === sourceKey;
    openedRef.current = sourceKey;
    // Taken from the document being left, before the refs are reset. A new hand split has put
    // the plain version back already (setSplitMidi); then this changes nothing.
    const restore = reopen ? plainRestore() : null;
    sessionRef.current = session;
    const live = () => !session.cancelled;
    docRef.current = null;
    shownRef.current = null;
    shownVersionRef.current = 'plain';
    solvedForRef.current = null;
    renderKeyRef.current = null;
    setState(reopen ? (s) => reopening(s, restore) : initialDoc(slug, fileName));
    // Every open starts with the switch off. The key check turns it off in the render that
    // changes the source or the split; this keeps it off when the key comes back (a split
    // round trip, 60 then automatic), so the embellished version never shows unasked.
    setSwitch((s) => (s.on ? { ...s, on: false } : s));
    const svc = svcRef.current;
    const bytes = bytesRef.current;
    void (async () => {
      try {
        let input: Uint8Array;
        let sourceName: string;
        let fingeredPath: string | null = null;
        let grade: number | null = null;
        let edition: OpenDoc['edition'];
        if (slug !== null) {
          const piece = await loadPiece(slug);
          if (!piece) throw new PhraseError((t) => t.score.doc.noPiece(slug));
          input = await readScoreFile(piece.files.score, svc.fetchText ?? fetchBytes);
          sourceName = piece.files.score;
          fingeredPath = piece.files.fingered;
          grade = piece.level;
          // The cap is the editor's count, and only a library piece with an editor's fingering has
          // one; the level sets the density for every library piece.
          edition = {
            level: piece.level,
            ...(piece.editorDigits !== undefined ? { editorDigits: piece.editorDigits } : {}),
          };
        } else {
          input = bytes ?? new Uint8Array();
          sourceName = fileName ?? 'score.musicxml';
        }
        const loaded = scanImport
          ? await svc.engine.load(input, sourceName, { preserveNotation: true })
          : splitMidi === null
            ? await svc.engine.load(input, sourceName)
            : await svc.engine.load(input, sourceName, { splitMidi });
        if (!live()) return;
        const editorial = nonEmpty(loaded.editorial);
        docRef.current = {
          plain: {
            score: loaded.score,
            xml: loaded.xml,
            engine: null,
            editorial,
            printedOf: new WeakMap(),
            laidOut: new WeakMap(),
          },
          embellished: null,
          grade,
          edition,
          fingeredPath,
          editorialLoad: null,
          embellishAsked: false,
          pages: new Map(),
        };
        const metaTitle = loaded.score.meta.title?.trim();
        const metaComposer = loaded.score.meta.composer?.trim();
        setState((s) => ({
          ...s,
          status: 'fingering',
          score: loaded.score,
          xml: loaded.xml,
          editorial,
          warnings: loaded.warnings,
          midiInfo: loaded.midiInfo ?? null,
          title: slug === null && metaTitle ? metaTitle : s.title,
          composer: slug === null && metaComposer ? metaComposer : s.composer,
        }));
      } catch (e) {
        if (live())
          setState((s) => ({ ...s, status: 'error', error: messageOf(e), errorCause: e }));
      }
    })();
    return () => {
      session.cancelled = true;
    };
  }, [slug, fileName, fileKey, sourceKey, splitMidi, scanImport, plainRestore]);

  // 2. First solve: 'fingering' -> engine.solve -> 'rendering'.
  useEffect(() => {
    if (status !== 'fingering') return;
    const doc = docRef.current;
    if (!doc) return;
    const session = sessionRef.current;
    const live = () => !session.cancelled;
    const profile = useAppStore.getState().settings.handSize;
    solvedForRef.current = profile;
    solveFor(svcRef.current.engine, doc, profile).then(
      (solved) => {
        if (!live()) return;
        doc.plain.engine = solved.assignment;
        keepPrinted(doc.plain, solved.assignment, solved.printed);
        setState((s) => ({ ...s, status: 'rendering', solveMs: solved.ms }));
      },
      (e: unknown) => {
        if (live())
          setState((s) => ({ ...s, status: 'error', error: messageOf(e), errorCause: e }));
      },
    );
  }, [status]);

  // 3. Lay out: 'rendering' -> 'ready', and again when the editor's-fingering setting, the
  //    width bucket, the "Add notes between" switch or reRender() asks for it. Pages laid out
  //    before for the same version, width bucket and fingering are taken as they are. Results
  //    of superseded requests are dropped.
  const widthBucket = bucket(layoutWidth(widthPx));
  useEffect(() => {
    // Print media hides the screen and changes its measured width. Keep its engraving intact.
    if (document.body.classList.contains('printing-score')) return;
    if (status !== 'rendering' && status !== 'ready') return;
    const doc = docRef.current;
    if (!doc?.plain.engine) return;
    const v = embellishedOn && doc.embellished ? doc.embellished : doc.plain;
    const version: VersionName = v === doc.plain ? 'plain' : 'embellished';
    const engineAtRequest = v.engine;
    if (!engineAtRequest) return;
    const key = `${version}|${widthBucket}|${showEditorial}|${nonce}`;
    if (renderKeyRef.current === key) return;
    renderKeyRef.current = key;
    const session = sessionRef.current;
    const seq = ++renderSeqRef.current;
    const current = () => !session.cancelled && renderSeqRef.current === seq;
    const svc = svcRef.current;
    // Set once the plain editorial is in: a failure before that (the `.fingered` file did not
    // load) is the plain document's, never the embellished version's.
    let laying = false;
    void (async () => {
      try {
        // Awaited only when there is a file to load, so a switch to pages laid out before lands
        // in the same state change as the switch.
        const plainEditorial =
          showEditorial && !doc.plain.editorial && doc.fingeredPath !== null
            ? await loadEditorial(doc, svc)
            : doc.plain.editorial;
        if (!current()) return;
        laying = true;
        const editorial =
          version === 'plain'
            ? plainEditorial
            : showEditorial
              ? embellishedEditorial(doc, v, plainEditorial)
              : v.editorial;
        const useEditorial = showEditorial && editorial !== null;
        const shown = useEditorial ? editorial : engineAtRequest;
        const cached = doc.pages.get(pagesKey(version, widthBucket, useEditorial));
        let result: { pages: string[]; ms: number };
        if (cached && cached.assignment === shown) {
          result = cached;
        } else {
          const xml = await laidOutText(v, shown, svc, current);
          if (xml === null) return;
          let rendered: { pages: string[]; ms: number } | undefined;
          let width = FALLBACK_WIDTH_PX;
          for (let attempt = 1; !rendered; attempt++) {
            try {
              width = layoutWidth(widthRef.current);
              rendered = await svc.renderer.render({
                xml,
                widthPx: width,
                notes: v.score.notes.length,
              });
            } catch (e) {
              // Superseded by our own newer request: that one publishes. Superseded by another
              // document on the shared worker while still wanted: ask again.
              if (!(e instanceof SupersededError) || !current() || attempt >= RENDER_ATTEMPTS) {
                throw e;
              }
            }
          }
          if (!current()) return;
          result = rendered;
          storePages(doc, version, bucket(width), useEditorial, {
            pages: result.pages,
            assignment: shown,
            ms: result.ms,
          });
        }
        // A re-solve may have landed while this layout was in flight: patch its digits next.
        const latest = useEditorial ? shown : (v.engine ?? shown);
        const diff = latest === shown ? null : diffDigits(shown, latest);
        if (diff?.structural) {
          setNonce((n) => n + 1);
          return;
        }
        shownRef.current = latest;
        shownVersionRef.current = version;
        // The score, the fingering and the pages of one version change together: note ids mean
        // other notes in the other version, so nothing keyed by them may outlive a switch.
        const plain = {
          score: doc.plain.score,
          assignment: version === 'plain' ? latest : plainFingering(doc, showEditorial),
        };
        setState((s) => ({
          ...s,
          status: 'ready',
          error: null,
          score: v.score,
          pages: result.pages,
          renderMs: result.ms,
          assignment: latest,
          printed: useEditorial ? null : (v.printedOf.get(latest) ?? null),
          editorial,
          shownVersion: version,
          plain,
          digitChanges: diff && diff.changes.size > 0 ? diff.changes : null,
        }));
      } catch (e) {
        // Superseded by a newer request of this document: that one publishes. Still the newest
        // request after every attempt (other documents kept taking the worker): an error with a
        // way back, never a score left 'Preparing' for good.
        if (!current()) return;
        if (version === 'embellished' && laying) {
          // The embellished version cannot be laid out: the switch goes, and the plain version
          // (still or again) on screen is laid out by the run this triggers. Never an error.
          doc.embellished = null;
          setState((s) => ({ ...s, embellish: 'none' }));
          return;
        }
        const error =
          e instanceof SupersededError ? new PhraseError((t) => t.score.doc.layoutFailed) : e;
        setState((s) => ({ ...s, status: 'error', error: messageOf(error), errorCause: error }));
      }
    })();
  }, [status, showEditorial, widthBucket, nonce, embellishedOn]);

  // 4. Re-solve when the hand size changes; the digits are patched in place by the view. The
  //    embellished version was fingered at every hand size by the guard: it takes this size's
  //    fingering at once. Only the version on screen is patched; `plain` follows either way.
  useEffect(() => {
    if (status !== 'ready') return;
    const doc = docRef.current;
    if (!doc || solvedForRef.current === handSize) return;
    solvedForRef.current = handSize;
    const session = sessionRef.current;
    const seq = ++solveSeqRef.current;
    const current = () => !session.cancelled && solveSeqRef.current === seq;
    const svc = svcRef.current;
    /**
     * Shows `next` in place of the fingering on screen: its changed digits are patched into the
     * pages, or, when a digit or a substitution comes or goes, the pages are laid out again.
     * `extra` is published either way.
     */
    const patchShown = (shown: Assignment, next: Assignment, extra: Partial<DocState>) => {
      const diff = diffDigits(shown, next);
      if (diff.structural) {
        if (Object.keys(extra).length > 0) setState((s) => ({ ...s, ...extra }));
        setNonce((n) => n + 1);
        return;
      }
      shownRef.current = next;
      const v = shownVersionRef.current === 'embellished' ? doc.embellished : doc.plain;
      setState((s) => ({
        ...s,
        ...extra,
        assignment: next,
        // With the digits that changed: the spare marks and the patched digits move together.
        printed: v?.printedOf.get(next) ?? null,
        digitChanges: diff.changes.size > 0 ? diff.changes : null,
      }));
    };
    const embellished = doc.embellished;
    if (embellished?.assignments) {
      const next = embellished.assignments[handSize];
      embellished.engine = next;
      const shown = shownRef.current;
      // The editor's fingering on screen stays, as on the plain version.
      const showingEngine =
        shownVersionRef.current === 'embellished' &&
        shown !== null &&
        shown !== embellished.editorial;
      if (showingEngine) patchShown(shown, next, {});
    }
    void (async () => {
      try {
        const solved = await solveFor(svc.engine, doc, handSize);
        if (!current()) return;
        doc.plain.engine = solved.assignment;
        keepPrinted(doc.plain, solved.assignment, solved.printed);
        const plain = {
          score: doc.plain.score,
          assignment: plainFingering(doc, useAppStore.getState().settings.showEditorial),
        };
        const shown = shownRef.current;
        // The editor's fingering, or the embellished version, is on screen: keep it; the new
        // engine digits show when the plain engine fingering is shown again (that lays the
        // score out again with plain.engine).
        const showingEngine =
          shownVersionRef.current === 'plain' && shown !== null && shown !== doc.plain.editorial;
        if (!showingEngine) setState((s) => ({ ...s, solveMs: solved.ms, plain }));
        else patchShown(shown, solved.assignment, { solveMs: solved.ms, plain });
      } catch (e) {
        if (current())
          setState((s) => ({ ...s, status: 'error', error: messageOf(e), errorCause: e }));
      }
    })();
  }, [status, handSize]);

  // 5. "Add notes between": once the plain score is ready, an eligible piece goes to the guard.
  //    An offered version is fingered at the current hand size and laid out at the current width
  //    before the switch appears, so the first switch is instant. This layout is not one of
  //    effect 3's requests (it never touches renderSeqRef): a newer layout of the plain score
  //    supersedes it, and then the first switch lays the version out.
  useEffect(() => {
    if (status !== 'ready') return;
    const doc = docRef.current;
    if (!doc || doc.embellishAsked) return;
    doc.embellishAsked = true;
    const session = sessionRef.current;
    const live = () => !session.cancelled;
    const publish = (embellish: 'offered' | 'none') => {
      if (live()) setState((s) => ({ ...s, embellish }));
    };
    if (!embellishEligible(doc.grade, scanImport, doc.plain.score.notes.length)) {
      publish('none');
      return;
    }
    const svc = svcRef.current;
    void (async () => {
      let engine: Assignment;
      let xml: string | null;
      let notes: number;
      try {
        const { offered } = await (doc.edition?.level !== undefined
          ? svc.engine.embellish(doc.plain.xml, doc.edition.level)
          : svc.engine.embellish(doc.plain.xml));
        if (!live()) return;
        if (!offered) {
          publish('none');
          return;
        }
        const profile = solvedForRef.current ?? useAppStore.getState().settings.handSize;
        engine = offered.assignments[profile];
        notes = offered.score.notes.length;
        const v: Version = {
          score: offered.score,
          xml: offered.xml,
          engine,
          editorial: nonEmpty(offered.editorial),
          printedOf: new WeakMap(),
          laidOut: new WeakMap(),
          assignments: offered.assignments,
        };
        for (const size of Object.keys(offered.assignments) as HandSize[]) {
          keepPrinted(v, offered.assignments[size], offered.printed?.[size]);
        }
        // Set before the next await, so a hand-size change meanwhile re-fingers it (effect 4).
        doc.embellished = v;
        xml = await laidOutText(v, engine, svc, live);
        if (xml === null) return;
      } catch {
        // The switch is an extra: a failure here only means the piece does not get one.
        doc.embellished = null;
        publish('none');
        return;
      }
      try {
        const width = layoutWidth(widthRef.current);
        const rendered = await svc.renderer.render({ xml, widthPx: width, notes });
        if (!live()) return;
        storePages(doc, 'embellished', bucket(width), false, {
          pages: rendered.pages,
          assignment: engine,
          ms: rendered.ms,
        });
      } catch (e) {
        // Superseded by a newer layout: the first switch lays it out. Failed: no switch.
        if (!(e instanceof SupersededError)) {
          doc.embellished = null;
          publish('none');
          return;
        }
      }
      publish('offered');
    })();
  }, [status, scanImport]);

  return {
    ...state,
    printXml: docRef.current?.[state.shownVersion]?.xml ?? null,
    embellished: embellishedOn,
    splitMidi,
    reRender,
    setSplitMidi,
    setEmbellished,
  };
}

/** Solves the plain score at a hand size, with what the printed digits depend on (issue 94). */
function solveFor(engine: EngineClient, doc: OpenDoc, profile: HandSize) {
  return doc.edition
    ? engine.solve(doc.plain.score, profile, undefined, doc.edition)
    : engine.solve(doc.plain.score, profile);
}

/** The plain editorial fingering, loading a library piece's `.fingered` file on first use. */
async function loadEditorial(doc: OpenDoc, svc: ScoreServices): Promise<Assignment | null> {
  const plain = doc.plain;
  if (plain.editorial || !doc.fingeredPath) return plain.editorial;
  const path = doc.fingeredPath;
  doc.editorialLoad ??= (async () => {
    const bytes = await readScoreFile(path, svc.fetchText ?? fetchBytes);
    const loaded = await svc.engine.load(bytes, path);
    return rekeyByIndex(loaded.score, loaded.editorial, plain.score);
  })();
  try {
    plain.editorial = await doc.editorialLoad;
  } catch (e) {
    doc.editorialLoad = null; // a failed fetch is tried again next time
    throw e;
  }
  return plain.editorial;
}

/**
 * The embellished version's editorial fingering: a dropped file's own (the embellisher keeps it
 * on the original notes), or a library piece's carried over from the plain score once, so the
 * same object is shown every time.
 */
function embellishedEditorial(
  doc: OpenDoc,
  v: Version,
  plainEditorial: Assignment | null,
): Assignment | null {
  if (!v.editorial && plainEditorial)
    v.editorial = carryAssignment(doc.plain.score, plainEditorial, v.score);
  return v.editorial;
}
