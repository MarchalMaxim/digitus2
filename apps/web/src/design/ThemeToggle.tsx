import { useTheme } from './theme.js';

/** One toggle per page (it sits in each view's header), so a fixed id names its mask. */
const MASK_ID = 'theme-crescent';

/**
 * The light and dark switch (T7, chosen on the design canvas as "sun to crescent"): a sun of a
 * small disc and eight rays in light; in dark the disc grows, a second disc slides in from the top
 * right and bites a crescent out of it, and the rays turn away and fade. The bite is a mask, so the
 * crescent is cut whatever lies behind the button (its hover fill). Ink only, never red; the
 * motion is in base.css, on the button's pressed state. Named "Dark theme" and pressed while the
 * page is dark, so a screen reader hears what a click will do.
 */
export function ThemeToggle() {
  const [theme, choose] = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle no-print"
      aria-label="Dark theme"
      aria-pressed={dark}
      onClick={() => choose(dark ? 'light' : 'dark')}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        {/* A mask's own luminance, not a color on screen: white keeps the disc, black cuts it. */}
        <mask id={MASK_ID} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" />
          <circle className="theme-bite" cx="15" cy="9" r="6.5" fill="black" />
        </mask>
        <path
          className="theme-rays"
          d="M18.4 12H20.6M16.53 7.47L18.08 5.92M12 5.6V3.4M7.47 7.47L5.92 5.92M5.6 12H3.4M7.47 16.53L5.92 18.08M12 18.4V20.6M16.53 16.53L18.08 18.08"
        />
        <g mask={`url(#${MASK_ID})`}>
          <circle className="theme-core" cx="12" cy="12" r="7" />
        </g>
      </svg>
    </button>
  );
}
