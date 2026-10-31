import type { ReactNode, Ref } from 'react';

/**
 * A switch (issue 254, chosen on the design canvas as "cartwheel"): a real checkbox with
 * `role="switch"` lies invisible over its drawing, so the label, the keyboard and screen readers
 * work as a native one does. The drawing is a track and, for the thumb, a quarter note whose head
 * rides in the track and whose stem stands out of it: off, gray at the left with the stem down;
 * on, it turns half a cartwheel on its way and lands in ink at the right with the stem up. Both
 * ends are how an engraver writes the note. Ink and grays only, never red; the motion is in
 * base.css. The whole `.check` row is the 44 px touch target.
 */
export function Switch({
  checked,
  onChange,
  ref,
  children,
}: {
  checked: boolean;
  onChange(on: boolean): void;
  ref?: Ref<HTMLInputElement>;
  children: ReactNode;
}) {
  return (
    <label className="check switch">
      <span className="switch-art">
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
        <svg viewBox="0 0 44 24" aria-hidden="true" focusable="false">
          <rect className="switch-track" x="0.5" y="0.5" width="43" height="23" rx="11.5" />
          <g className="switch-note">
            <ellipse
              className="switch-head"
              cx="12"
              cy="12"
              rx="6"
              ry="4.4"
              transform="rotate(-22 12 12)"
            />
            <rect className="switch-stem" x="16.55" y="-2" width="1.35" height="13.6" />
          </g>
        </svg>
      </span>{' '}
      {children}
    </label>
  );
}
