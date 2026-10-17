import { useLocale, useT } from './i18n.js';
import { LOCALE_NAMES, LOCALES } from './locales.js';

/**
 * One quiet line at the foot of the library: every language in its own name, the one on screen
 * marked. The page already speaks the browser's language, so this is only for the rare mismatch;
 * it appears nowhere else. No flags: they stand for countries, not languages.
 */
export function LanguageLine() {
  const [locale, choose] = useLocale();
  const t = useT();
  return (
    <nav className="language-line" aria-label={t.common.language}>
      {LOCALES.map((l, i) => (
        <span key={l}>
          <button
            type="button"
            className="text-button"
            lang={l}
            aria-current={l === locale ? 'true' : undefined}
            onClick={() => void choose(l)}
          >
            {LOCALE_NAMES[l]}
          </button>
          {/* After the name, so a wrapped line ends with the dot; no-break spaces, since a flex
              item drops ordinary spaces at its edges. */}
          {i < LOCALES.length - 1 && <span aria-hidden="true">{'\u00a0·\u00a0'}</span>}
        </span>
      ))}
    </nav>
  );
}
