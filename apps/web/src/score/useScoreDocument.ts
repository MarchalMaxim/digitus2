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
 */
import type { Assignment, MidiInfo, Score } from '@digitus2/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { fileIdentity, useAppStore, type PieceSource } from '../app/store.js';
import { createEngineClient, type EngineClient } from '../engine/client.js';
import { loadPiece, pieceBySlug, readScoreFile } from '../library/manifest.js';
import { injectNoteIds } from './render/injectIds.js';
import { createRenderer, SupersededError, type ScoreRenderer } from './render/renderer.js';

/** 'idle' is reserved (the plan's interface; nothing sets it yet): a document starts 'loading'. */
export type DocStatus = 'idle' | 'loading' | 'fingering' | 'rendering' | 'ready' | 'error';

export interface ScoreDocument {
  status: DocStatus;
  error: string | null;
  score: Score | null;
  /** The unpacked source text, without our ids or fingerings. */
  xml: string | null;
  /** What is shown: the engine's fingering, or the editorial one when showEditorial is on. */
  assignment: Assignment | null;
  /** The piece's editorial fingering (library .fingered file, or <fingering> in a dropped file). */
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
}

/** The state the pipeline keeps; `splitMidi` is the user's request and lives beside it. */
type DocState = Omit<ScoreDocument, 'splitMidi'>;

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

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the score file could not be fetched (HTTP ${res.status})`);
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

interface OpenDoc {
  score: Score;
  xml: string;
  /** The newest engine fingering for the current hand size; null until the first solve. */
  engine: Assignment | null;
  editorial: Assignment | null;
  /** A library piece's `.fingered` file, loaded once, when the editor's fingering is first shown. */
  fingeredPath: string | null;
  editorialLoad: Promise<Assignment | null> | null;
  /**
   * The text given to the renderer (fingered, with our note ids) for each fingering laid out so
   * far. A new width, or switching back to a fingering shown before, lays the same text out
   * again: writing a fingering into the MusicXML costs the engine a whole parse and serialisation
   * (about 2 s for K.545), the layout itself 0.3 s.
   */
  laidOut: WeakMap<Assignment, string>;
}

function initialDoc(slug: string | null, fileName: string | null): DocState {
  const piece = slug === null ? undefined : pieceBySlug(slug);
  return {
    status: 'loading',
    error: null,
    score: null,
    xml: null,
    assignment: null,
    editorial: null,
    pages: [],
    solveMs: null,
    renderMs: null,
    title: piece?.title ?? fileName ?? slug ?? '',
    composer: piece?.composer ?? '',
    warnings: [],
    digitChanges: null,
    midiInfo: null,
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
  const slug = source.kind === 'library' ? source.slug : null;
  const fileName = source.kind === 'file' ? source.name : null;
  const fileBytes = source.kind === 'file' ? source.bytes : null;
  const fileKey = fileBytes ? fileIdentity(fileBytes) : null;
  const sourceKey = JSON.stringify([slug, fileName, fileKey]);

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
  const setSplitMidi = useCallback(
    (value: number | null) => setSplit({ source: sourceKey, value }),
    [sourceKey],
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
  const solvedForRef = useRef<string | null>(null); // the hand size docRef.engine is (being) solved for
  const solveSeqRef = useRef(0);
  const renderKeyRef = useRef<string | null>(null); // the layout last asked for
  const renderSeqRef = useRef(0);
  const openedRef = useRef<string | null>(null); // the source the last open was for

  // Each stage starts in an effect, after React has committed the previous status, so the status
  // line is on screen before the next stage's work is posted to a worker.
  const status = state.status;

  // 1. Load: bytes -> engine.load -> 'fingering'. Also when the hand split of a MIDI file
  //    changes: the same source is opened again, and what it showed (the pages, the import facts
  //    and the Hand split control with its focus) stays until the new import replaces it.
  useEffect(() => {
    const session: Session = { cancelled: false };
    sessionRef.current = session;
    const live = () => !session.cancelled;
    docRef.current = null;
    shownRef.current = null;
    solvedForRef.current = null;
    renderKeyRef.current = null;
    const reopen = openedRef.current === sourceKey;
    openedRef.current = sourceKey;
    setState(
      reopen
        ? (s) => ({ ...s, status: 'loading', error: null, digitChanges: null })
        : initialDoc(slug, fileName),
    );
    const svc = svcRef.current;
    const bytes = bytesRef.current;
    void (async () => {
      try {
        let input: Uint8Array;
        let sourceName: string;
        let fingeredPath: string | null = null;
        if (slug !== null) {
          const piece = await loadPiece(slug);
          if (!piece) throw new Error(`there is no piece called "${slug}"`);
          input = await readScoreFile(piece.files.score, svc.fetchText ?? fetchBytes);
          sourceName = piece.files.score;
          fingeredPath = piece.files.fingered;
        } else {
          input = bytes ?? new Uint8Array();
          sourceName = fileName ?? 'score.musicxml';
        }
        const loaded =
          splitMidi === null
            ? await svc.engine.load(input, sourceName)
            : await svc.engine.load(input, sourceName, { splitMidi });
        if (!live()) return;
        const editorial = nonEmpty(loaded.editorial);
        docRef.current = {
          score: loaded.score,
          xml: loaded.xml,
          engine: null,
          editorial,
          fingeredPath,
          editorialLoad: null,
          laidOut: new WeakMap(),
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
        if (live()) setState((s) => ({ ...s, status: 'error', error: messageOf(e) }));
      }
    })();
    return () => {
      session.cancelled = true;
    };
  }, [slug, fileName, fileKey, sourceKey, splitMidi]);

  // 2. First solve: 'fingering' -> engine.solve -> 'rendering'.
  useEffect(() => {
    if (status !== 'fingering') return;
    const doc = docRef.current;
    if (!doc) return;
    const session = sessionRef.current;
    const live = () => !session.cancelled;
    const profile = useAppStore.getState().settings.handSize;
    solvedForRef.current = profile;
    svcRef.current.engine.solve(doc.score, profile).then(
      (solved) => {
        if (!live()) return;
        doc.engine = solved.assignment;
        setState((s) => ({ ...s, status: 'rendering', solveMs: solved.ms }));
      },
      (e: unknown) => {
        if (live()) setState((s) => ({ ...s, status: 'error', error: messageOf(e) }));
      },
    );
  }, [status]);

  // 3. Lay out: 'rendering' -> 'ready', and again when the editor's-fingering setting, the
  //    width bucket or reRender() asks for it. Results of superseded requests are dropped.
  const widthBucket = bucket(widthPx > 0 ? widthPx : FALLBACK_WIDTH_PX);
  useEffect(() => {
    if (status !== 'rendering' && status !== 'ready') return;
    const doc = docRef.current;
    if (!doc?.engine) return;
    const engineAtRequest = doc.engine;
    const key = `${widthBucket}|${showEditorial}|${nonce}`;
    if (renderKeyRef.current === key) return;
    renderKeyRef.current = key;
    const session = sessionRef.current;
    const seq = ++renderSeqRef.current;
    const current = () => !session.cancelled && renderSeqRef.current === seq;
    const svc = svcRef.current;
    void (async () => {
      try {
        const editorial = showEditorial ? await loadEditorial(doc, svc) : doc.editorial;
        if (!current()) return;
        const useEditorial = showEditorial && editorial !== null;
        const shown = useEditorial ? editorial : engineAtRequest;
        let xml = doc.laidOut.get(shown);
        if (xml === undefined) {
          const fingered = await svc.engine.fingeredXml(doc.xml, doc.score, shown);
          if (!current()) return;
          xml = injectNoteIds(fingered, doc.score);
          doc.laidOut.set(shown, xml);
        }
        let rendered: { pages: string[]; ms: number } | undefined;
        for (let attempt = 1; !rendered; attempt++) {
          try {
            const width = widthRef.current > 0 ? widthRef.current : FALLBACK_WIDTH_PX;
            rendered = await svc.renderer.render({ xml, widthPx: width });
          } catch (e) {
            // Superseded by our own newer request: that one publishes. Superseded by another
            // document on the shared worker while still wanted: ask again.
            if (!(e instanceof SupersededError) || !current() || attempt >= RENDER_ATTEMPTS) {
              throw e;
            }
          }
        }
        const result = rendered;
        if (!current()) return;
        // A re-solve may have landed while this layout was in flight: patch its digits next.
        const latest = useEditorial ? shown : (doc.engine ?? shown);
        const diff = latest === shown ? null : diffDigits(shown, latest);
        if (diff?.structural) {
          setNonce((n) => n + 1);
          return;
        }
        shownRef.current = latest;
        setState((s) => ({
          ...s,
          status: 'ready',
          error: null,
          pages: result.pages,
          renderMs: result.ms,
          assignment: latest,
          editorial,
          digitChanges: diff && diff.changes.size > 0 ? diff.changes : null,
        }));
      } catch (e) {
        // Superseded by a newer request of this document: that one publishes. Still the newest
        // request after every attempt (other documents kept taking the worker): an error with a
        // way back, never a score left 'Preparing' for good.
        if (!current()) return;
        const error =
          e instanceof SupersededError ? 'the score could not be laid out, please try again' : e;
        setState((s) => ({ ...s, status: 'error', error: messageOf(error) }));
      }
    })();
  }, [status, showEditorial, widthBucket, nonce]);

  // 4. Re-solve when the hand size changes; the digits are patched in place by the view.
  useEffect(() => {
    if (status !== 'ready') return;
    const doc = docRef.current;
    if (!doc || solvedForRef.current === handSize) return;
    solvedForRef.current = handSize;
    const session = sessionRef.current;
    const seq = ++solveSeqRef.current;
    const current = () => !session.cancelled && solveSeqRef.current === seq;
    const svc = svcRef.current;
    void (async () => {
      try {
        const solved = await svc.engine.solve(doc.score, handSize);
        if (!current()) return;
        doc.engine = solved.assignment;
        const shown = shownRef.current;
        // The editor's fingering is on screen: keep it; the new engine digits show when it is
        // switched off (that lays the score out again with doc.engine).
        const showingEngine = shown !== null && shown !== doc.editorial;
        if (!showingEngine) {
          setState((s) => ({ ...s, solveMs: solved.ms }));
          return;
        }
        const diff = diffDigits(shown, solved.assignment);
        if (diff.structural) {
          setState((s) => ({ ...s, solveMs: solved.ms }));
          setNonce((n) => n + 1);
          return;
        }
        shownRef.current = solved.assignment;
        setState((s) => ({
          ...s,
          solveMs: solved.ms,
          assignment: solved.assignment,
          digitChanges: diff.changes.size > 0 ? diff.changes : null,
        }));
      } catch (e) {
        if (current()) setState((s) => ({ ...s, status: 'error', error: messageOf(e) }));
      }
    })();
  }, [status, handSize]);

  return { ...state, splitMidi, reRender, setSplitMidi };
}

/** The editorial fingering, loading a library piece's `.fingered` file on first use. */
async function loadEditorial(doc: OpenDoc, svc: ScoreServices): Promise<Assignment | null> {
  if (doc.editorial || !doc.fingeredPath) return doc.editorial;
  const path = doc.fingeredPath;
  doc.editorialLoad ??= (async () => {
    const bytes = await readScoreFile(path, svc.fetchText ?? fetchBytes);
    const loaded = await svc.engine.load(bytes, path);
    return rekeyByIndex(loaded.score, loaded.editorial, doc.score);
  })();
  try {
    doc.editorial = await doc.editorialLoad;
  } catch (e) {
    doc.editorialLoad = null; // a failed fetch is tried again next time
    throw e;
  }
  return doc.editorial;
}
