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
          {i > 0 && <span aria-hidden="true"> · </span>}
          <button
            type="button"
            className="text-button"
            lang={l}
            aria-current={l === locale ? 'true' : undefined}
            onClick={() => void choose(l)}
          >
            {LOCALE_NAMES[l]}
          </button>
        </span>
      ))}
    </nav>
  );
}
