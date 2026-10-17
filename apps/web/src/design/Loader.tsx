import type { CSSProperties } from 'react';

/**
 * What the loader plays (base.css, `.loader`): a C major scale while a score loads or a page is
 * recognised, the same scale with its fingering written on the keys while the engine fingers, and
 * two chords taking turns while the score is laid out.
 */
export type LoaderTune = 'scale' | 'fingering' | 'chords';

const KEY_W = 36;
const KEY_H = 140;
const BLACK_W = 22;
const BLACK_H = 88;
const WHITE_KEYS = 8;
/** The white keys a black key follows in an octave from C to C: C#, D#, F#, G#, A#. */
const BLACK_AFTER = [0, 1, 3, 4, 5];
/** The right hand's fingering of the C major scale, one finger per white key from C to C. */
const C_MAJOR_RH = [1, 2, 3, 1, 2, 3, 4, 5];
/** The keys the red covers at the start: C alone, or the chord C E G. */
const CHORD = [0, 2, 4];
/** The pressed key's height: it shortens from its back edge like the dock's (base.css). */
const PRESSED_H = KEY_H * 0.976;

const key = (i: number) => ({ '--key': i }) as CSSProperties;

/**
 * Says the app is busy: one octave of a piano, a key at a time going down in red. The red is one
 * group stepping from key to key (`.is-red`, so it is the screen's one red while it shows: the
 * caller keeps everything else plain meanwhile). Decoration only: the status line beside it says
 * what is happening, so it is hidden from assistive technology. Under prefers-reduced-motion it
 * stands still on its first key, with the fingering written out.
 */
export function Loader({ tune }: { tune: LoaderTune }) {
  const width = KEY_W * WHITE_KEYS + 1;
  const red = tune === 'chords' ? CHORD : [0];
  return (
    <svg
      className={`loader is-${tune}`}
      viewBox={`0 0 ${width} ${KEY_H + 1}`}
      width={width}
      height={KEY_H + 1}
      aria-hidden="true"
      focusable="false"
    >
      {C_MAJOR_RH.map((_, i) => (
        <rect
          key={i}
          className={`loader-key k${i}`}
          style={key(i)}
          x={0.5 + KEY_W * i}
          y={0.5}
          width={KEY_W}
          height={KEY_H}
        />
      ))}
      <g className="loader-red is-red">
        {red.map((i) => (
          <rect key={i} x={1 + KEY_W * i} y={1} width={KEY_W - 1} height={PRESSED_H - 1} />
        ))}
      </g>
      {BLACK_AFTER.map((i) => (
        <rect
          key={i}
          className="loader-black"
          x={0.5 + KEY_W * (i + 1) - BLACK_W / 2}
          y={0.5}
          width={BLACK_W}
          height={BLACK_H}
        />
      ))}
      {tune === 'fingering' &&
        C_MAJOR_RH.map((finger, i) => (
          <text
            key={i}
            className={`loader-digit d${i}`}
            style={key(i)}
            x={0.5 + KEY_W * i + KEY_W / 2}
            y={KEY_H - 14}
            textAnchor="middle"
          >
            {finger}
          </text>
        ))}
    </svg>
  );
}
