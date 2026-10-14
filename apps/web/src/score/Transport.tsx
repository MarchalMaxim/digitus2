import { useState } from 'react';
import { useAppStore, type HandsMode } from '../app/store.js';
import { Button } from '../design/Button.js';
import type { LoopRange, Playback } from './usePlayback.js';

const HANDS: { value: HandsMode; label: string }[] = [
  { value: 'both', label: 'Both hands' },
  { value: 'R', label: 'Right hand' },
  { value: 'L', label: 'Left hand' },
];

export interface TransportProps {
  playback: Playback;
  /** Bars in the piece: the loop inputs are clamped to 1..measureCount. */
  measureCount: number;
  /**
   * True while the score cannot be played (not ready yet, or no notes in the selected hand):
   * Play and Rewind are unavailable. A playing transport can still be paused.
   */
  disabled?: boolean;
}

/**
 * The loop typed into the two inputs (1-based bars) as 0-based measure indices, each clamped to
 * the piece; null when either input is empty or not a number, or when from is after to.
 */
export function loopFromInputs(
  fromText: string,
  toText: string,
  measureCount: number,
): LoopRange | null {
  if (fromText.trim() === '' || toText.trim() === '' || measureCount < 1) return null;
  const a = Number(fromText);
  const b = Number(toText);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const clamp = (bar: number) => Math.min(measureCount, Math.max(1, Math.trunc(bar)));
  const from = clamp(a);
  const to = clamp(b);
  return from > to ? null : { from: from - 1, to: to - 1 };
}

/**
 * The transport bar. Settings live in the store; the play state and the loop live in
 * usePlayback. Play is the screen's one red element while the score is stopped; while playing
 * the same button reads Pause and is plain, because the cursor is the red element then.
 */
export function Transport({ playback, measureCount, disabled = false }: TransportProps) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const [loopFrom, setLoopFrom] = useState('');
  const [loopTo, setLoopTo] = useState('');
  const tempoPercent = Math.round(settings.tempoFactor * 100);
  const playing = playback.playing;
  const loading = playback.loading;
  /** Play cannot start now (the score is not ready, or the samples are loading); Pause always works. */
  const playBlocked = !playing && (disabled || loading);

  const changeLoop = (fromText: string, toText: string) => {
    setLoopFrom(fromText);
    setLoopTo(toText);
    playback.setLoop(loopFromInputs(fromText, toText, measureCount));
  };

  return (
    <div className="transport no-print" role="toolbar" aria-label="Playback">
      <div className="transport-group">
        {/* One button for both states, so focus stays on it when it flips. It is never natively
            disabled: a disabled button drops the focus to <body> (Play cannot start while the
            samples load after the first Play of a score), and a reader who started playback
            with Enter could not press it again to pause. aria-disabled says it is unavailable instead, and
            the click does nothing then. */}
        <Button
          primary={!playing}
          className="play-button"
          aria-label={playing ? 'Pause' : 'Play'}
          aria-busy={loading || undefined}
          aria-disabled={playBlocked || undefined}
          onClick={() => {
            if (playing) playback.pause();
            else if (!playBlocked) playback.play();
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <button type="button" disabled={disabled} onClick={() => playback.rewind()}>
          Rewind
        </button>
      </div>

      <label className="tempo">
        Tempo
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={tempoPercent}
          aria-valuetext={`${tempoPercent} %`}
          onChange={(e) => setSettings({ tempoFactor: Number(e.currentTarget.value) / 100 })}
        />
        {/* A plain span: <output> is an implicit status region, and the score view's status line
            must be the only one. The slider announces the same value through aria-valuetext. */}
        <span className="tempo-value" aria-hidden="true">
          {tempoPercent} %
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
      </fieldset>
    </div>
  );
}
