import type { TempoEvent } from '@digitus2/engine';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore, type HandsMode } from '../app/store.js';
import { Button } from '../design/Button.js';
import { TOUCH_QUERY, useMediaQuery } from '../design/media.js';
import { en } from '../i18n/en/index.js';
import { useT } from '../i18n/i18n.js';
import type { Messages, Phrase } from '../i18n/messages.js';
import type { LoopRange, Playback } from './usePlayback.js';

/** What the loop says when its "from" is after its "to" (polish plan Task 6, review S11). */
export const LOOP_REVERSED_TEXT: Phrase = (t) => t.transport.loopReversed;

/**
 * The engine's tempo before a score's first tempo mark, or for a score with none, in quarter
 * notes per minute (`ticksToSeconds` in the engine; the MusicXML reader adds it at tick 0).
 */
const DEFAULT_QPM = 120;

/**
 * The tempo in force where the piece starts, in quarter notes per minute, as the transport plays
 * it: the last tempo mark at tick 0, else the engine's default (the same reading as the engine's
 * `ticksToSeconds`). The tempo control shows what the factor makes of it.
 */
export function startQpm(tempoMap: readonly TempoEvent[]): number {
  let qpm = DEFAULT_QPM;
  for (const ev of [...tempoMap].sort((a, b) => a.tick - b.tick)) {
    if (ev.tick > 0) break;
    qpm = ev.qpm;
  }
  return qpm;
}

/**
 * The tempo control's text: the factor as a percentage and the tempo it makes, in quarter notes
 * per minute ("70 % · ♩ = 70" for a piece written at 100 played at 70 %; review S8 found "70 %"
 * next to the printed "♩ = 100"). The percentage alone while the score is not read yet.
 */
export function tempoText(factor: number, qpm: number | null, t: Messages = en): string {
  const percent = t.transport.tempoPercent(Math.round(factor * 100));
  return qpm === null ? percent : `${percent} · ♩ = ${Math.round(qpm * factor)}`;
}

/** The same for the slider's `aria-valuetext`, in words. */
function tempoValueText(t: Messages, factor: number, qpm: number | null): string {
  const percent = t.transport.tempoPercent(Math.round(factor * 100));
  return qpm === null ? percent : t.transport.tempoSpoken(percent, Math.round(qpm * factor));
}

const HANDS: { value: HandsMode; label: Phrase }[] = [
  { value: 'both', label: (t) => t.transport.handsBoth },
  { value: 'R', label: (t) => t.transport.handsRight },
  { value: 'L', label: (t) => t.transport.handsLeft },
];

export interface TransportProps {
  playback: Playback;
  /**
   * True while the score cannot be played (not ready yet, or no notes in the selected hand):
   * Play and Rewind are unavailable. A playing transport can still be paused.
   */
  disabled?: boolean;
  /** Paused with the last group heard marked (T10): the cursor is the red element, Play is plain. */
  resumeShown?: boolean;
  /**
   * The red is on its way between Play and the cursor (RedFlight.tsx): the traveling shape is the
   * red element meanwhile, so the button is plain even where it would be red.
   */
  redAway?: boolean;
}

export interface PracticeControlsProps {
  playback: Playback;
  /** Bars in the piece: the loop inputs are clamped to 1..measureCount. */
  measureCount: number;
  /**
   * The piece's tempo where it starts, in quarter notes per minute (`startQpm`), for the tempo
   * the factor makes; null (the default) while the score is not read yet.
   */
  qpm?: number | null;
  /** The bar the cursor is in, 1-based (1 when nothing is marked): where "Loop bars" starts. */
  currentBar: number;
}

/**
 * The focused elements that take Space for themselves: a field types it, a button or a summary
 * presses, a checkbox or a radio toggles, a select opens. Space is theirs, not the play key. A
 * link is not one of them: it takes Enter, and Space on it would only scroll the page, so there
 * Space plays and pauses like anywhere else.
 */
const TAKES_SPACE = [
  'input',
  'textarea',
  'select',
  'button',
  'summary',
  "[contenteditable]:not([contenteditable='false'])",
  ...[
    'button',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'spinbutton',
    'textbox',
    'searchbox',
    'combobox',
    'listbox',
    'option',
    'menuitem',
    'tab',
  ].map((role) => `[role='${role}']`),
].join(', ');

/** A plain Space press that no focused control takes for itself: the play and pause key. */
function isPlayKey(e: KeyboardEvent): boolean {
  if (e.key !== ' ' || e.defaultPrevented || e.isComposing) return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  return !(e.target instanceof Element && e.target.closest(TAKES_SPACE) !== null);
}

/** The two bars typed into the loop inputs, as whole numbers; null unless both are numbers. */
function typedBars(fromText: string, toText: string): [number, number] | null {
  if (fromText.trim() === '' || toText.trim() === '') return null;
  const a = Number(fromText);
  const b = Number(toText);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [Math.trunc(a), Math.trunc(b)];
}

/**
 * Whether both loop inputs hold a bar and "from" is after "to", as typed (before clamping to the
 * piece): such a range is not a loop, and the controls say so (LOOP_REVERSED_TEXT).
 */
export function loopIsReversed(fromText: string, toText: string): boolean {
  const bars = typedBars(fromText, toText);
  return bars !== null && bars[0] > bars[1];
}

/**
 * The loop typed into the two inputs (1-based bars) as 0-based measure indices, each clamped to
 * the piece; null when either input is empty or not a number, or when from is after to (as
 * typed: from 20 to 15 in a 12-bar piece is reversed, not bar 12).
 */
export function loopFromInputs(
  fromText: string,
  toText: string,
  measureCount: number,
): LoopRange | null {
  const bars = typedBars(fromText, toText);
  if (bars === null || measureCount < 1 || bars[0] > bars[1]) return null;
  const clamp = (bar: number) => Math.min(measureCount, Math.max(1, bar));
  return { from: clamp(bars[0]) - 1, to: clamp(bars[1]) - 1 };
}

/** The loop fields' first values: the cursor's bar and the next, both within the piece. */
export function loopPrefill(currentBar: number, measureCount: number): [string, string] {
  const last = Math.max(1, measureCount);
  const clamp = (bar: number) => Math.min(last, Math.max(1, bar));
  const from = clamp(currentBar);
  return [String(from), String(clamp(from + 1))];
}

/**
 * The transport: Play or Pause, and Rewind, in the score view's dock (always on screen while the
 * score is). The play state lives in usePlayback. Play is the screen's one red element while the
 * score is stopped with nothing to resume (ready, rewound, at the end, or paused before any note
 * was heard); while playing the same button reads Pause and is plain, because the cursor is the
 * red element then. In the lead-in (`playback.waiting`: the count-in, and anything before the
 * first note of the hands played, such as the other hand's pickup) nothing is marked in the
 * score yet, so Pause keeps the red until that note sounds and the cursor takes it. Paused after
 * a note was heard (`resumeShown`, T10), the cursor keeps the last group heard red and Play is
 * plain. Where the red travels between the button and the cursor (`redAway`, RedFlight.tsx), the
 * button is plain while the traveling shape carries it.
 *
 * Space plays and pauses from anywhere while the transport is mounted, unless the focus is in a
 * control that takes Space itself (TAKES_SPACE). Its default, scrolling the page, is cancelled,
 * so the score stays where the cursor put it; a held Space toggles once.
 */
export function Transport({
  playback,
  disabled = false,
  resumeShown = false,
  redAway = false,
}: TransportProps) {
  const t = useT();
  const playing = playback.playing;
  const loading = playback.loading;
  /**
   * The button is the red element unless the cursor is: stopped with no resume point marked, or
   * playing its lead-in.
   */
  const red = (playing ? playback.waiting : !resumeShown) && !redAway;
  /** Play cannot start now (the score is not ready, or the samples are loading); Pause always works. */
  const playBlocked = !playing && (disabled || loading);
  /** Stopped at the start (fresh, rewound, at the end): there is nothing to rewind. */
  const rewindIdle = !playing && playback.atStart;
  const toggle = () => {
    if (playing) playback.pause();
    else if (!playBlocked) playback.play();
  };

  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPlayKey(e)) return;
      e.preventDefault();
      if (!e.repeat) toggleRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="transport-group" role="toolbar" aria-label={t.transport.playback}>
      {/* One button for both states, so focus stays on it when it flips. It is never natively
          disabled: a disabled button drops the focus to <body> (Play cannot start while the
          samples load after the first Play of a score), and a reader who started playback with
          Enter could not press it again to pause. aria-disabled says it is unavailable instead,
          and the click does nothing then. */}
      <Button
        primary={red}
        className="play-button"
        aria-label={playing ? t.transport.pause : t.transport.play}
        aria-keyshortcuts="Space"
        aria-busy={loading || undefined}
        aria-disabled={playBlocked || undefined}
        onClick={toggle}
      >
        {playing ? t.transport.pause : t.transport.play}
      </Button>
      {/* Rewind is unavailable at the start, where it has nothing to do. Like Play it says so
          with aria-disabled rather than natively: Rewind while paused brings the start, and a
          natively disabled button would then drop the focus that pressed it. */}
      <button
        type="button"
        disabled={disabled}
        aria-disabled={rewindIdle || undefined}
        onClick={() => {
          if (!rewindIdle) playback.rewind();
        }}
      >
        {t.transport.rewind}
      </button>
    </div>
  );
}

/**
 * The sliding thumb of a segmented control (base.css, `.segmented-thumb`): put over the checked
 * label before the paint on every change of `value`, its leading edge first. It is placed without
 * a transition the first time and whenever the control's size changes (the Practice panel opening
 * from hidden, a font arriving), so it never slides in from a stale place. While the control is
 * hidden (no size) the checked label paints its own fill. The classes are set here, not through
 * React: the fieldset's className prop never changes, so a render never undoes them.
 */
function useSegmentedThumb(value: string) {
  const ref = useRef<HTMLFieldSetElement>(null);
  /** The index of the label the thumb was last put over; null while it is not placed. */
  const lastRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (ref.current) placeThumb(ref.current, lastRef, true);
  }, [value]);

  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => placeThumb(box, lastRef, false));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/** Puts the thumb over the checked label; `moving` slides it there when it is already placed. */
function placeThumb(
  box: HTMLFieldSetElement,
  lastRef: { current: number | null },
  moving: boolean,
): void {
  const thumb = box.querySelector<HTMLElement>('.segmented-thumb');
  const labels = [...box.querySelectorAll('label')];
  const index = labels.findIndex((l) => l.querySelector('input:checked') !== null);
  const label = labels[index];
  const last = lastRef.current;
  if (!thumb || !label || box.clientWidth === 0) {
    box.classList.remove('has-thumb', 'is-ready');
    lastRef.current = null;
    return;
  }
  const slides = moving && last !== null && box.classList.contains('is-ready');
  if (!slides) box.classList.remove('is-ready');
  box.classList.toggle('to-right', slides && last !== null && index > last);
  box.classList.toggle('to-left', slides && last !== null && index < last);
  thumb.style.left = `${label.offsetLeft + 1}px`;
  thumb.style.right = `${box.clientWidth - label.offsetLeft - label.offsetWidth + 1}px`;
  box.classList.add('has-thumb');
  lastRef.current = index;
  if (!slides) requestAnimationFrame(() => box.classList.add('is-ready'));
}

/**
 * The practice controls: tempo, hands, metronome, count-in and the bar loop. Settings live in
 * the store; the loop lives in usePlayback. The score view keeps them in the dock's Practice
 * panel at every width (UI batch, spec 13); the panel's toggle names them, so they are no group
 * of their own (a screen reader would announce "Practice" twice). The panel only hides them, so
 * what was typed survives closing and opening it.
 *
 * The loop is one checkbox, "Loop bars": its two bar fields show only while it is ticked. Ticking
 * it fills them with the bar the cursor is in and the next (`loopPrefill`) and loops at once;
 * unticking hides them and turns the loop off, and the bars typed come back when it is ticked
 * again. The controls start from the loop already set, so they show it whenever they mount.
 *
 * They say what they mean (polish plan Task 6): the tempo shows the tempo it makes ("70 % · ♩ =
 * 70") and is the open piece's own, so a different piece opens at 100 %; a loop typed in reverse
 * is not applied, and a line under the inputs says why.
 *
 * Moving through the piece has no control of its own (T13): the score is the timeline. The
 * panel's last line says so, in the words of the screen it is on (a tap; a click and the arrow
 * keys).
 */
export function PracticeControls({
  playback,
  measureCount,
  qpm = null,
  currentBar,
}: PracticeControlsProps) {
  const t = useT();
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const tempoFactor = useAppStore(tempoFactorOf);
  const setTempoFactor = useAppStore((s) => s.setTempoFactor);
  const [loopFrom, setLoopFrom] = useState(() =>
    playback.loop ? String(playback.loop.from + 1) : '',
  );
  const [loopTo, setLoopTo] = useState(() => (playback.loop ? String(playback.loop.to + 1) : ''));
  const [looping, setLooping] = useState(() => playback.loop !== null);
  const tempoPercent = Math.round(tempoFactor * 100);
  const handsRef = useSegmentedThumb(settings.hands);
  const reversed = loopIsReversed(loopFrom, loopTo);
  const loopMessageId = useId();
  const touch = useMediaQuery(TOUCH_QUERY);

  const changeLoop = (fromText: string, toText: string) => {
    setLoopFrom(fromText);
    setLoopTo(toText);
    playback.setLoop(loopFromInputs(fromText, toText, measureCount));
  };

  const toggleLoop = (on: boolean) => {
    setLooping(on);
    if (!on) {
      playback.setLoop(null);
      return;
    }
    const [from, to] =
      loopFrom === '' && loopTo === '' ? loopPrefill(currentBar, measureCount) : [loopFrom, loopTo];
    changeLoop(from, to);
  };

  return (
    <div className="transport no-print">
      <label className="tempo">
        {t.transport.tempo}
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={tempoPercent}
          aria-valuetext={tempoValueText(t, tempoFactor, qpm)}
          onChange={(e) => setTempoFactor(Number(e.currentTarget.value) / 100)}
        />
        {/* A plain span: <output> is an implicit status region, and the score view's status line
            must be the only one. The slider announces the same value through aria-valuetext. */}
        <span className="tempo-value" aria-hidden="true">
          {tempoText(tempoFactor, qpm, t)}
        </span>
      </label>

      <fieldset className="segmented" ref={handsRef}>
        <legend className="visually-hidden">{t.transport.hands}</legend>
        <span className="segmented-thumb" aria-hidden="true" />
        {HANDS.map((h) => (
          <label key={h.value}>
            <input
              type="radio"
              name="hands"
              value={h.value}
              checked={settings.hands === h.value}
              onChange={() => setSettings({ hands: h.value })}
            />
            <span>{h.label(t)}</span>
          </label>
        ))}
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.metronome}
          onChange={(e) => setSettings({ metronome: e.currentTarget.checked })}
        />{' '}
        {t.transport.metronome}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.countIn}
          onChange={(e) => setSettings({ countIn: e.currentTarget.checked })}
        />{' '}
        {t.transport.countIn}
      </label>

      <div className="loop">
        <label className="check">
          <input
            type="checkbox"
            checked={looping}
            onChange={(e) => toggleLoop(e.currentTarget.checked)}
          />{' '}
          {t.transport.loopBars}
        </label>
        {looping && (
          <>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={measureCount > 0 ? measureCount : undefined}
              aria-label={t.transport.loopFromBar}
              value={loopFrom}
              aria-invalid={reversed || undefined}
              aria-describedby={reversed ? loopMessageId : undefined}
              onChange={(e) => changeLoop(e.currentTarget.value, loopTo)}
            />
            <span>{t.transport.loopTo}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={measureCount > 0 ? measureCount : undefined}
              aria-label={t.transport.loopToBar}
              value={loopTo}
              aria-invalid={reversed || undefined}
              aria-describedby={reversed ? loopMessageId : undefined}
              onChange={(e) => changeLoop(loopFrom, e.currentTarget.value)}
            />
            {/* Says why a reversed range plays no loop (review S11: it was ignored without a
                word). It describes both inputs, which say they are invalid, rather than being a
                live region: the dock's status line must be the page's only one, and an alert on
                every keystroke of "12" after "6" would interrupt the typing. In ink, never red:
                the accent is Play. */}
            {reversed && (
              <p id={loopMessageId} className="loop-message small">
                {LOOP_REVERSED_TEXT(t)}
              </p>
            )}
          </>
        )}
      </div>

      <p className="seek-help small muted">
        {touch ? t.transport.seekHelpTouch : t.transport.seekHelp}
      </p>
    </div>
  );
}
