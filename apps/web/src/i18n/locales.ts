/**
 * The languages the app speaks (issue #6). Plain TypeScript with no Vite imports, so the
 * Playwright helpers import it too.
 */
export type Locale = 'en' | 'nl' | 'fr' | 'es' | 'pt';

/** English first: the source language and the fallback. */
export const LOCALES: readonly Locale[] = ['en', 'nl', 'fr', 'es', 'pt'];

export const SOURCE_LOCALE: Locale = 'en';

/** Each language's name in that language, so a reader who cannot read the rest finds theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
};

/** Where a chosen language is kept. index.html reads it before the first paint. */
export const LOCALE_STORAGE_KEY = 'digitus2.lang';

export function asLocale(value: string | null | undefined): Locale | null {
  return LOCALES.find((l) => l === value) ?? null;
}

/**
 * The first of the browser's languages (`navigator.languages`, most wanted first) that the app
 * speaks, by primary subtag ("nl-BE" is Dutch, "pt-BR" Portuguese); English when none is. Never
 * the reader's location: Belgium and Switzerland speak several languages.
 */
export function matchLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const locale = asLocale(tag.split('-')[0]?.toLowerCase());
    if (locale) return locale;
  }
  return SOURCE_LOCALE;
}
