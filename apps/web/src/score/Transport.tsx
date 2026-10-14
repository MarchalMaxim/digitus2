import type { TempoEvent } from '@digitus2/engine';
import { useEffect, useId, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore, type HandsMode } from '../app/store.js';
import { Button } from '../design/Button.js';
import type { LoopRange, Playback } from './usePlayback.js';

/** What the loop says when its "from" is after its "to" (polish plan Task 6, review S11). */
export const LOOP_REVERSED_TEXT = 'The loop needs "from" before "to".';

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
export function tempoText(factor: number, qpm: number | null): string {
  const percent = `${Math.round(factor * 100)} %`;
  return qpm === null ? percent : `${percent} · ♩ = ${Math.round(qpm * factor)}`;
}

/** The same for the slider's `aria-valuetext`, in words. */
function tempoValueText(factor: number, qpm: number | null): string {
  const percent = `${Math.round(factor * 100)} %`;
  return qpm === null
    ? percent
    : `${percent}, ${Math.round(qpm * factor)} quarter notes per minute`;
}

const HANDS: { value: HandsMode; label: string }[] = [
  { value: 'both', label: 'Both hands' },
  { value: 'R', label: 'Right hand' },
  { value: 'L', label: 'Left hand' },
];

export interface TransportProps {
  playback: Playback;
  /**
   * True while the score cannot be played (not ready yet, or no notes in the selected hand):
   * Play and Rewind are unavailable. A playing transport can still be paused.
   */
  disabled?: boolean;
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
  /**
   * Folds the controls into a disclosure titled "Practice", closed until the reader opens it.
   * The score view does this below 480 px, in the same place above the score, so a phone opens
   * a score with the music on its first screen and the controls one tap away.
   */
  collapsible?: boolean;
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

/**
 * The transport: Play or Pause, and Rewind, in the score view's dock (always on screen while the
 * score is). The play state lives in usePlayback. Play is the screen's one red element while the
 * score is stopped; while playing the same button reads Pause and is plain, because the cursor
 * is the red element then. In the lead-in (`playback.waiting`: the count-in, and anything before
 * the first note of the hands played, such as the other hand's pickup) nothing is marked in the
 * score yet, so Pause keeps the red until that note sounds and the cursor takes it.
 *
 * Space plays and pauses from anywhere while the transport is mounted, unless the focus is in a
 * control that takes Space itself (TAKES_SPACE). Its default, scrolling the page, is cancelled,
 * so the score stays where the cursor put it; a held Space toggles once.
 */
export function Transport({ playback, disabled = false }: TransportProps) {
  const playing = playback.playing;
  const loading = playback.loading;
  /** The button is the red element unless the cursor is: stopped, or playing its lead-in. */
  const red = !playing || playback.waiting;
  /** Play cannot start now (the score is not ready, or the samples are loading); Pause always works. */
  const playBlocked = !playing && (disabled || loading);
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
    <div className="transport-group" role="toolbar" aria-label="Playback">
      {/* One button for both states, so focus stays on it when it flips. It is never natively
          disabled: a disabled button drops the focus to <body> (Play cannot start while the
          samples load after the first Play of a score), and a reader who started playback with
          Enter could not press it again to pause. aria-disabled says it is unavailable instead,
          and the click does nothing then. */}
      <Button
        primary={red}
        className="play-button"
        aria-label={playing ? 'Pause' : 'Play'}
        aria-keyshortcuts="Space"
        aria-busy={loading || undefined}
        aria-disabled={playBlocked || undefined}
        onClick={toggle}
      >
        {playing ? 'Pause' : 'Play'}
      </Button>
      <button type="button" disabled={disabled} onClick={() => playback.rewind()}>
        Rewind
      </button>
    </div>
  );
}

/**
 * The practice controls: tempo, hands, metronome, count-in and the bar loop. Settings live in
 * the store; the loop lives in usePlayback. The loop inputs start from the loop already set, so
 * they show it whenever the controls mount. Folding them into the disclosure (or unfolding them)
 * keeps this component and what was typed: only the elements around the controls change.
 *
 * Standing open they are a group named "Practice". Folded, the disclosure is that group and its
 * summary says "Practice", so the controls inside carry no second name (a screen reader would
 * announce "Practice" twice).
 *
 * They say what they mean (polish plan Task 6): the tempo shows the tempo it makes ("70 % · ♩ =
 * 70") and is the open piece's own, so a different piece opens at 100 %; a loop typed in reverse
 * is not applied, and a line under the inputs says why.
 */
export function PracticeControls({
  playback,
  measureCount,
  qpm = null,
  collapsible = false,
}: PracticeControlsProps) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const tempoFactor = useAppStore(tempoFactorOf);
  const setTempoFactor = useAppStore((s) => s.setTempoFactor);
  const [loopFrom, setLoopFrom] = useState(() =>
    playback.loop ? String(playback.loop.from + 1) : '',
  );
  const [loopTo, setLoopTo] = useState(() => (playback.loop ? String(playback.loop.to + 1) : ''));
  const tempoPercent = Math.round(tempoFactor * 100);
  const reversed = loopIsReversed(loopFrom, loopTo);
  const loopMessageId = useId();

  const changeLoop = (fromText: string, toText: string) => {
    setLoopFrom(fromText);
    setLoopTo(toText);
    playback.setLoop(loopFromInputs(fromText, toText, measureCount));
  };

  const controls = (
    <div
      className="transport no-print"
      role={collapsible ? undefined : 'group'}
      aria-label={collapsible ? undefined : 'Practice'}
    >
      <label className="tempo">
        Tempo
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={tempoPercent}
          aria-valuetext={tempoValueText(tempoFactor, qpm)}
          onChange={(e) => setTempoFactor(Number(e.currentTarget.value) / 100)}
        />
        {/* A plain span: <output> is an implicit status region, and the score view's status line
            must be the only one. The slider announces the same value through aria-valuetext. */}
        <span className="tempo-value" aria-hidden="true">
          {tempoText(tempoFactor, qpm)}
        </span>
      </label>

      <fieldset className="segmented">
        <legend className="visually-hidden">Hands</legend>
        {HANDS.map((h) => (
          <label key={h.value}>
            <input
              type="radio"
              name="hands"
              value={h.value}
              checked={settings.hands === h.value}
              onChange={() => setSettings({ hands: h.value })}
            />
            <span>{h.label}</span>
          </label>
        ))}
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.metronome}
          onChange={(e) => setSettings({ metronome: e.currentTarget.checked })}
        />{' '}
        Metronome
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.countIn}
          onChange={(e) => setSettings({ countIn: e.currentTarget.checked })}
        />{' '}
        Count-in
      </label>

      <fieldset className="loop">
        <legend>Loop bars</legend>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={measureCount > 0 ? measureCount : undefined}
          aria-label="Loop from bar"
          placeholder="from"
          value={loopFrom}
          aria-invalid={reversed || undefined}
          aria-describedby={reversed ? loopMessageId : undefined}
          onChange={(e) => changeLoop(e.currentTarget.value, loopTo)}
        />
        <span aria-hidden="true">–</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={measureCount > 0 ? measureCount : undefined}
          aria-label="Loop to bar"
          placeholder="to"
          value={loopTo}
          aria-invalid={reversed || undefined}
          aria-describedby={reversed ? loopMessageId : undefined}
          onChange={(e) => changeLoop(loopFrom, e.currentTarget.value)}
        />
        <button
          type="button"
          className="text-button"
          disabled={loopFrom === '' && loopTo === ''}
          onClick={() => changeLoop('', '')}
        >
          Clear loop
        </button>
        {/* Says why a reversed range plays no loop (review S11: it was ignored without a word).
            It describes both inputs, which say they are invalid, rather than being a live region:
            the dock's status line must be the page's only one, and an alert on every keystroke of
            "12" after "6" would interrupt the typing. In ink, never red: the accent is Play. */}
        {reversed && (
          <p id={loopMessageId} className="loop-message small">
            {LOOP_REVERSED_TEXT}
          </p>
        )}
      </fieldset>
    </div>
  );
  if (!collapsible) return controls;
  // Uncontrolled: closed when it mounts, then the reader's to open and close.
  return (
    <details className="practice no-print">
      <summary>Practice</summary>
      {controls}
    </details>
  );
}
