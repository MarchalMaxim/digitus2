/**
 * Correcting a recognised score inside the scan review. Nothing here is shown until a note is
 * selected or a correction exists: the review stays a comparison first, and editing appears only
 * where a reader asks for it (progressive disclosure).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useT } from '../i18n/i18n.js';
import type { Messages } from '../i18n/messages.js';
import {
  applyCorrections,
  barTiming,
  CorrectionError,
  findProblems,
  NOTE_TYPES,
  type Correction,
  type CorrectionResult,
  type NoteType,
  type Problem,
} from './corrections.js';
import {
  chordOf,
  parseScanXml,
  readScanScore,
  readingOrder,
  STEPS,
  type ScanNote,
  type ScanScore,
  type Step,
} from './notes.js';
import { NoteCrop } from './NoteCrop.js';
import { pitchSuggestions } from './suggestions.js';

export interface Corrected extends CorrectionResult {
  score: ScanScore;
}

/** The corrected copy, or undefined when the raw recognition cannot be read as MusicXML. */
export function correct(raw: string, corrections: readonly Correction[]): Corrected | undefined {
  try {
    const result = applyCorrections(raw, corrections);
    const doc = parseScanXml(result.renderXml);
    // The render copy carries `id="s<ordinal>"` on every note: the identity the editor uses.
    for (const note of doc.getElementsByTagName('note'))
      note.setAttribute('data-scan-note', note.id.slice(1));
    return { ...result, score: readScanScore(doc) };
  } catch {
    return undefined;
  }
}

/** Checks a new correction against the current list; returns the refusal, or null when it applies. */
export function tryCorrection(raw: string, corrections: readonly Correction[], next: Correction) {
  try {
    applyCorrections(raw, [...corrections, next], { strict: true });
    return null;
  } catch (cause) {
    if (cause instanceof CorrectionError) return cause.phrase;
    throw cause;
  }
}

const hand = (t: Messages, note: Pick<ScanNote, 'staff' | 'staves' | 'part'>) =>
  note.staves === 2
    ? note.staff === 1
      ? t.scan.edit.rightHand
      : t.scan.edit.leftHand
    : t.scan.edit.staff(note.staff);
const where = (t: Messages, note: ScanNote) =>
  `${t.scan.edit.bar(note.measureNumber)}, ${hand(t, note)}`;
const pitchOf = (t: Messages, note: Pick<ScanNote, 'step' | 'alter' | 'octave'>) =>
  note.step ? t.scan.edit.pitch(note.step, note.alter, note.octave) : '';
function lengthOf(t: Messages, note: ScanNote) {
  const name = note.type ? (t.scan.edit.lengths[note.type] ?? note.type) : '';
  if (!name) return '';
  return note.rest
    ? t.scan.edit.restLength(name, note.dots > 0)
    : t.scan.edit.noteLength(name, note.dots > 0);
}

export function describeNote(t: Messages, note: ScanNote): string {
  const parts = [t.scan.edit.bar(note.measureNumber), hand(t, note)];
  const body = [pitchOf(t, note), lengthOf(t, note)].filter(Boolean).join(' ');
  if (body) parts.push(body);
  if (note.tieStart || note.tieStop) parts.push(t.scan.edit.tied);
  return t.scan.edit.describe(parts);
}

/** The bar timing sentence: "Bar 11: right hand 3 beats, left hand 3 beats, in 3/4." */
export function timingText(t: Messages, score: ScanScore, part: number, measure: number): string {
  const timing = barTiming(score, part, measure);
  const bar = score.bars.find((b) => b.part === part && b.index === measure);
  if (!timing || !bar) return '';
  const staves = timing.staves.length;
  const hands = timing.staves.map((s) =>
    t.scan.edit.handBeats(
      hand(t, { staff: s.staff, staves, part }),
      Math.round(s.beats * 1000) / 1000,
    ),
  );
  return t.scan.edit.timing(
    t.scan.edit.bar(bar.number),
    hands,
    bar.meter ? `${bar.meter.beats}/${bar.meter.beatType}` : undefined,
  );
}

/** True when the bar's hands disagree on its length or one runs past the time signature. */
export function timingIssue(score: ScanScore, part: number, measure: number): boolean {
  const timing = barTiming(score, part, measure);
  if (!timing) return false;
  const used = timing.staves.filter((s) => s.beats > 0);
  return (
    used.some((s) => Math.abs(s.beats - used[0]!.beats) > 1e-9) ||
    (timing.expected !== undefined && used.some((s) => s.beats > timing.expected! + 1e-9))
  );
}

/**
 * The pitch a rest becomes when the reader says it is a note: the nearest earlier note on its
 * staff, else the next one, else the middle line (B4 in treble, D3 in bass).
 */
export function restPitch(score: ScanScore, rest: ScanNote) {
  const order = readingOrder(score).filter(
    (n) => n.part === rest.part && n.staff === rest.staff && n.step !== undefined && !n.rest,
  );
  const before = order.filter((n) => n.onset <= rest.onset).at(-1);
  const after = order.find((n) => n.onset > rest.onset);
  const near = before ?? after;
  if (near) return { step: near.step!, alter: near.alter, octave: near.octave };
  return rest.staff === 1
    ? { step: 'B' as Step, alter: 0, octave: 4 }
    : { step: 'D' as Step, alter: 0, octave: 3 };
}

/** A correction as listed for review, described from the raw recognition it applies to. */
export function describeCorrection(t: Messages, raw: ScanScore, c: Correction): string {
  if (c.kind === 'barline') {
    const bar = raw.bars.find((b) => b.part === 0 && b.index === c.bar);
    return bar ? t.scan.edit.changed.barline(bar.number) : '';
  }
  if (c.kind === 'meter') {
    const bar = raw.bars.find((b) => b.part === 0 && b.index === c.bar);
    if (!bar) return '';
    const from = bar.meter ? `${bar.meter.beats}/${bar.meter.beatType}` : undefined;
    return t.scan.edit.changed.meter(bar.number, from, `${c.beats}/${c.beatType}`);
  }
  const note = raw.notes.find((n) => n.ordinal === c.note);
  if (!note) return '';
  const at = where(t, note);
  const pitch = pitchOf(t, note);
  switch (c.kind) {
    case 'pitch':
      return t.scan.edit.changed.pitch(
        at,
        pitch || lengthOf(t, note),
        t.scan.edit.pitch(c.step, c.alter, c.octave),
      );
    case 'duration':
      return t.scan.edit.changed.duration(
        at,
        pitch,
        lengthOf(t, note),
        note.rest
          ? t.scan.edit.restLength(t.scan.edit.lengths[c.type]!, c.dots > 0)
          : t.scan.edit.noteLength(t.scan.edit.lengths[c.type]!, c.dots > 0),
      );
    case 'tie':
      return c.tied ? t.scan.edit.changed.tie(at, pitch) : t.scan.edit.changed.untie(at, pitch);
    case 'hand':
      return t.scan.edit.changed.hand(
        t.scan.edit.bar(note.measureNumber),
        pitch,
        hand(t, { ...note, staff: c.staff }),
      );
    case 'remove':
      return t.scan.edit.changed.removed(at, pitch || lengthOf(t, note));
  }
}

export function describeProblem(t: Messages, score: ScanScore, problem: Problem): string {
  if (problem.kind === 'form') {
    const bar = score.bars.find((b) => b.part === problem.part && b.index === problem.bar);
    if (!bar) return '';
    const at = t.scan.edit.bar(bar.number);
    return problem.mark === 'ending'
      ? t.scan.edit.problems.endingWithoutRepeat(at)
      : t.scan.edit.problems.repeatWithoutEnd(at);
  }
  if (problem.kind === 'bar-timing') {
    const used = problem.timing.staves.filter((s) => s.beats > 0);
    const disagree = used.some((s) => Math.abs(s.beats - used[0]!.beats) > 1e-9);
    const timing = timingText(t, score, problem.part, problem.bar);
    return disagree ? t.scan.edit.problems.barTiming(timing) : t.scan.edit.problems.barLong(timing);
  }
  const note = score.notes.find((n) => n.ordinal === problem.note);
  if (problem.kind === 'tie-repaired') {
    if (note)
      return t.scan.edit.problems.tieRepaired(where(t, note), pitchOf(t, note), problem.reason);
    // The import's count found no note here: the bar alone is named.
    const bar = score.bars.find((b) => b.part === problem.part && b.index === problem.measure);
    return t.scan.edit.problems.tieRepairedBar(
      t.scan.edit.bar(bar?.number ?? String(problem.measure + 1)),
    );
  }
  if (!note) return '';
  if (problem.kind === 'tie-unmatched')
    return t.scan.edit.problems.tieUnmatched(where(t, note), pitchOf(t, note), problem.side);
  if (problem.kind === 'tie-grace')
    return t.scan.edit.problems.tieGrace(where(t, note), pitchOf(t, note));
  const beats = Math.abs(problem.gapTicks) / score.ticksPerQuarter;
  const gap = t.scan.edit.gap(Math.round(beats * 1000) / 1000);
  return problem.gapTicks > 0
    ? t.scan.edit.problems.tieGap(where(t, note), pitchOf(t, note), gap)
    : t.scan.edit.problems.tieEarly(where(t, note), pitchOf(t, note), gap);
}

/**
 * The button text of a correction offered on a place to check (`offersFor`): "Set 9/8 time from
 * bar 3", "Remove the repeat sign", "Make the A4 in bar 11 a dotted half so the tie reaches",
 * "Remove the tie".
 */
export function offerLabel(
  t: Messages,
  score: ScanScore,
  problem: Problem,
  offer: Correction,
): string {
  switch (offer.kind) {
    case 'meter': {
      const bar = score.bars.find((b) => b.part === problem.part && b.index === offer.bar);
      return t.scan.edit.setMeter(
        `${offer.beats}/${offer.beatType}`,
        bar?.number ?? String(offer.bar + 1),
      );
    }
    case 'barline':
      return t.scan.edit.removeMark(problem.kind === 'form' ? problem.mark : 'repeat');
    case 'duration': {
      const note = score.notes.find((n) => n.ordinal === offer.note);
      if (!note) return '';
      return t.scan.edit.lengthenTie(
        pitchOf(t, note),
        note.measureNumber,
        t.scan.edit.lengths[offer.type]!,
        offer.dots > 0,
      );
    }
    case 'tie':
      return t.scan.edit.removeTie;
    default:
      return '';
  }
}

/** The note a problem points at: its note, or the first note of its bar. */
export function problemNote(score: ScanScore, problem: Problem): number | undefined {
  const firstOf = (measure: number) =>
    readingOrder(score).find((n) => n.part === problem.part && n.measure === measure)?.ordinal;
  if (problem.kind === 'bar-timing' || problem.kind === 'form') return firstOf(problem.bar);
  // A note the import named that the review cannot find: its bar's first note.
  if (score.notes.some((n) => n.ordinal === problem.note)) return problem.note;
  return firstOf(problem.measure);
}

/** A diatonic step from `note`, taking the key signature's alteration for the new letter. */
export function stepPitch(score: ScanScore, note: ScanNote, direction: 1 | -1) {
  const index = STEPS.indexOf(note.step!);
  const next = index + direction;
  const step = STEPS[(next + 7) % 7]!;
  const octave = note.octave + (next < 0 ? -1 : next > 6 ? 1 : 0);
  const bar = score.bars.find((b) => b.part === note.part && b.index === note.measure);
  const fifths = bar?.fifths.get(note.staff) ?? 0;
  const order: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const alter =
    fifths > 0
      ? order.slice(0, fifths).includes(step)
        ? 1
        : 0
      : fifths < 0
        ? [...order].reverse().slice(0, -fifths).includes(step)
          ? -1
          : 0
        : 0;
  return { step, alter, octave };
}

export function NoteEditor({
  score,
  ordinal,
  status,
  onCorrect,
  onSelect,
  onClose,
  photo,
}: {
  score: ScanScore;
  ordinal: number;
  status: string;
  /** The page photo the note was read from, drawn around where homr saw the note (issue 161). */
  photo?: Blob | undefined;
  onCorrect(correction: Correction): void;
  onSelect(ordinal: number): void;
  onClose(): void;
}) {
  const t = useT();
  const note = score.notes.find((n) => n.ordinal === ordinal);
  const order = useMemo(() => readingOrder(score), [score]);
  const title = useRef<HTMLParagraphElement>(null);
  const kind = note ? (note.rest ? 'rest' : 'note') : 'none';
  const shown = useRef(kind);
  useEffect(() => {
    // When a note becomes a rest (or back) its buttons change: keep the focus in the panel.
    // (Only when the focus fell to the page; a reader on the sheet keeps it there.)
    if (shown.current !== kind && document.activeElement === document.body) title.current?.focus();
    shown.current = kind;
  }, [kind]);
  if (!note) return null;
  const position = order.indexOf(note);
  const chord = chordOf(score, note);
  const pitched = !note.rest && note.step !== undefined;
  const tiedFrom = note.tieStop;
  // homr's other readings of the pitch, when it thought them likely enough (issue 130).
  const suggestions = pitched ? pitchSuggestions(note) : [];
  const step = (direction: 1 | -1) => {
    const next = stepPitch(score, note, direction);
    onCorrect({ kind: 'pitch', note: ordinal, ...next });
  };
  return (
    <section className="note-editor stack" aria-label={t.scan.edit.panelLabel}>
      <div className="note-editor-head">
        <p className="note-editor-title" ref={title} tabIndex={-1}>
          {describeNote(t, note)}
        </p>
        <button
          className="note-editor-symbol"
          aria-label={t.scan.edit.previous}
          disabled={position <= 0}
          onClick={() => onSelect(order[position - 1]!.ordinal)}
        >
          ‹
        </button>
        <button
          className="note-editor-symbol"
          aria-label={t.scan.edit.next}
          disabled={position < 0 || position >= order.length - 1}
          onClick={() => onSelect(order[position + 1]!.ordinal)}
        >
          ›
        </button>
        <button onClick={onClose}>{t.scan.edit.done}</button>
      </div>
      {photo && note.imgpos && (
        <NoteCrop
          image={photo}
          at={note.imgpos}
          note={note}
          size="large"
          label={t.scan.edit.photoAt(t.scan.edit.bar(note.measureNumber))}
        />
      )}
      {pitched && suggestions.length > 0 && (
        <div className="note-editor-row" role="group" aria-label={t.scan.edit.suggestedLabel}>
          <span className="note-editor-label">{t.scan.edit.suggestedLabel}</span>
          {suggestions.map((s) => (
            <button
              key={`${s.step}${s.alter}${s.octave}`}
              onClick={() =>
                onCorrect({
                  kind: 'pitch',
                  note: ordinal,
                  step: s.step,
                  alter: s.alter,
                  octave: s.octave,
                })
              }
            >
              {t.scan.edit.pitch(s.step, s.alter, s.octave)}
            </button>
          ))}
        </div>
      )}
      {pitched && (
        <div className="note-editor-row" role="group" aria-label={t.scan.edit.pitchLabel}>
          <span className="note-editor-label">{t.scan.edit.pitchLabel}</span>
          <button aria-label={t.scan.edit.lowerLabel} onClick={() => step(-1)}>
            {t.scan.edit.lower}
          </button>
          <button aria-label={t.scan.edit.higherLabel} onClick={() => step(1)}>
            {t.scan.edit.higher}
          </button>
          {([-1, 0, 1] as const).map((alter) => (
            <button
              key={alter}
              className="note-editor-symbol"
              aria-label={[t.scan.edit.flat, t.scan.edit.natural, t.scan.edit.sharp][alter + 1]}
              aria-pressed={note.alter === alter}
              onClick={() => {
                if (note.alter !== alter)
                  onCorrect({
                    kind: 'pitch',
                    note: ordinal,
                    step: note.step!,
                    alter,
                    octave: note.octave,
                  });
              }}
            >
              {['♭', '♮', '♯'][alter + 1]}
            </button>
          ))}
        </div>
      )}
      {!note.grace && (
        <div className="note-editor-row" role="group" aria-label={t.scan.edit.lengthLabel}>
          <span className="note-editor-label">{t.scan.edit.lengthLabel}</span>
          {NOTE_TYPES.filter((type) => type !== '32nd').map((type: NoteType) => (
            <button
              key={type}
              aria-pressed={note.type === type}
              onClick={() => {
                if (note.type !== type || chord.some((n) => n.type !== type))
                  onCorrect({ kind: 'duration', note: ordinal, type, dots: note.dots ? 1 : 0 });
              }}
            >
              {t.scan.edit.lengthButtons[type]}
            </button>
          ))}
          <button
            aria-pressed={note.dots > 0}
            disabled={!note.type || !NOTE_TYPES.includes(note.type as NoteType)}
            onClick={() =>
              onCorrect({
                kind: 'duration',
                note: ordinal,
                type: note.type as NoteType,
                dots: note.dots ? 0 : 1,
              })
            }
          >
            {t.scan.edit.dotted}
          </button>
        </div>
      )}
      {pitched && (
        <div className="note-editor-row">
          <button
            aria-pressed={note.tieStart}
            onClick={() => onCorrect({ kind: 'tie', note: ordinal, tied: !note.tieStart })}
          >
            {t.scan.edit.tieNext}
          </button>
          {tiedFrom && (
            <button
              aria-pressed
              onClick={() =>
                onCorrect({ kind: 'tie', note: ordinal, tied: false, side: 'previous' })
              }
            >
              {t.scan.edit.tiePrevious}
            </button>
          )}
          {note.staves === 2 && (
            <button
              onClick={() =>
                onCorrect({ kind: 'hand', note: ordinal, staff: note.staff === 1 ? 2 : 1 })
              }
            >
              {note.staff === 1 ? t.scan.edit.toLeftHand : t.scan.edit.toRightHand}
            </button>
          )}
          <button onClick={() => onCorrect({ kind: 'remove', note: ordinal })}>
            {t.scan.edit.remove}
          </button>
        </div>
      )}
      {note.rest && !note.chord && (
        <div className="note-editor-row">
          <button
            onClick={() => onCorrect({ kind: 'pitch', note: ordinal, ...restPitch(score, note) })}
          >
            {t.scan.edit.makeNote}
          </button>
          <button onClick={() => onCorrect({ kind: 'remove', note: ordinal })}>
            {t.scan.edit.remove}
          </button>
        </div>
      )}
      {/* Read out through the review's live region; shown here beside the controls. */}
      <p className="small">{status}</p>
    </section>
  );
}

/**
 * Marks the selected note in the rendered sheet: it carries the screen's one red while selected,
 * and an ink box around it says the same without colour (high contrast, colour blindness).
 */
export function useSelectedMark(host: HTMLElement | null, ordinal: number | null, pages: string[]) {
  useLayoutEffect(() => {
    if (!host || ordinal === null) return;
    const element = host.querySelector(`[id="s${ordinal}"]`);
    element?.classList.add('is-red');
    const frame = host.parentElement;
    let box: HTMLDivElement | undefined;
    const place = () => {
      if (!element || !frame) return;
      const outer = frame.getBoundingClientRect();
      const inner = element.getBoundingClientRect();
      box ??= frame.appendChild(document.createElement('div'));
      box.className = 'scan-selection-box';
      box.setAttribute('aria-hidden', 'true');
      Object.assign(box.style, {
        left: `${inner.left - outer.left - 4}px`,
        top: `${inner.top - outer.top - 4}px`,
        width: `${inner.width + 8}px`,
        height: `${inner.height + 8}px`,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      element?.classList.remove('is-red');
      window.removeEventListener('resize', place);
      box?.remove();
    };
  }, [host, ordinal, pages]);
}

/** The note under a click or tap, or the nearest one within reach of a fingertip. */
export function noteAt(
  host: HTMLElement,
  event: { target: EventTarget | null; clientX: number; clientY: number },
) {
  const hit = (event.target as Element | null)?.closest?.('g.note, g.rest');
  const id = (el: Element | null | undefined) => {
    const match = /^s(\d+)$/.exec(el?.id ?? '');
    return match ? Number(match[1]) : undefined;
  };
  if (hit && id(hit) !== undefined) return id(hit);
  let best: { ordinal: number; distance: number } | undefined;
  for (const el of host.querySelectorAll('g.note, g.rest')) {
    const ordinal = id(el);
    if (ordinal === undefined) continue;
    const box = el.getBoundingClientRect();
    const dx = Math.max(box.left - event.clientX, 0, event.clientX - box.right);
    const dy = Math.max(box.top - event.clientY, 0, event.clientY - box.bottom);
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { ordinal, distance };
  }
  // About a fingertip: 22 CSS pixels around the note's own box.
  return best && best.distance <= 22 ? best.ordinal : undefined;
}

export { findProblems };
