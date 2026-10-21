import { useSyncExternalStore } from 'react';
import { en } from './en/index.js';
import {
  asLocale,
  LOCALE_STORAGE_KEY,
  matchLocale,
  SOURCE_LOCALE,
  type Locale,
} from './locales.js';
import type { Messages } from './messages.js';

/**
 * The language on screen (issue #6), kept like the theme (design/theme.ts): the page speaks the
 * first of the browser's languages it knows until the reader picks one from the line at the foot
 * of the library (LanguageLine.tsx). The pick is kept per browser and set as `<html lang>` before
 * the first paint by the script in index.html, which reads the same key; a pick that matches the
 * browser is not kept, so the page follows the browser again.
 *
 * English is bundled; every other language is its own chunk, fetched when first needed, so a
 * reader in English downloads none of them. The language switches once its texts have arrived.
 */

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Messages>> = {
  nl: () => import('./nl/index.js').then((m) => m.messages),
  fr: () => import('./fr/index.js').then((m) => m.messages),
  es: () => import('./es/index.js').then((m) => m.messages),
  pt: () => import('./pt/index.js').then((m) => m.messages),
};

const loaded = new Map<Locale, Messages>([[SOURCE_LOCALE, en]]);

function load(locale: Locale): Promise<Messages> {
  const ready = loaded.get(locale);
  if (ready) return Promise.resolve(ready);
  return loaders[locale as Exclude<Locale, 'en'>]().then((messages) => {
    loaded.set(locale, messages);
    return messages;
  });
}

/** The browser's language, as far as the app speaks it. */
export function browserLocale(): Locale {
  const nav = globalThis.navigator;
  return matchLocale(nav?.languages?.length ? nav.languages : [nav?.language ?? '']);
}

/** The kept pick; null without one, or where site data is blocked. */
function storedLocale(): Locale | null {
  try {
    return asLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** The language the page should speak: the reader's pick, otherwise the browser's. */
export function wantedLocale(): Locale {
  return storedLocale() ?? browserLocale();
}

type State = { locale: Locale; t: Messages };

let state: State = { locale: SOURCE_LOCALE, t: en };
const listeners = new Set<() => void>();
/** The latest switch asked for; an earlier one whose texts arrive later is dropped. */
let latest = 0;

function show(locale: Locale, t: Messages): void {
  state = { locale, t };
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

/** Switches to `locale` once its texts have loaded; resolves when it is on screen. */
function switchTo(locale: Locale): Promise<void> {
  const mine = ++latest;
  return load(locale).then(
    (t) => {
      if (mine === latest) show(locale, t);
    },
    (error: unknown) => {
      // No connection for the chunk: the page stays in the language it already speaks.
      if (mine === latest) show(state.locale, state.t);
      console.error(error);
    },
  );
}

/**
 * Starts the page in the wanted language. main.tsx awaits it before the first render, so the page
 * never shows English first to a reader in another language.
 */
export function startLocale(): Promise<void> {
  return switchTo(wantedLocale());
}

/**
 * Shows the page in `locale` and keeps the pick, or forgets it when `locale` is the browser's own.
 * Where site data is blocked the page still switches; the pick then lasts as long as the page.
 */
export function chooseLocale(locale: Locale): Promise<void> {
  try {
    if (locale === browserLocale()) localStorage.removeItem(LOCALE_STORAGE_KEY);
    else localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Blocked site data, a private window: nothing to keep the pick in.
  }
  return switchTo(locale);
}

/**
 * Calls `onChange` when the language on screen changes: a pick made here, or one made in another
 * tab (which this page then takes up too). Returns the unsubscribe.
 */
export function subscribeLocale(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
    void switchTo(wantedLocale());
  };
  const onLanguages = () => {
    if (!storedLocale()) void switchTo(browserLocale());
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('languagechange', onLanguages);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('languagechange', onLanguages);
  };
}

/** The language on screen, outside React. */
export function currentLocale(): Locale {
  return state.locale;
}

/**
 * The texts on screen, outside React: for code that must write a text when it runs. Prefer a
 * Phrase (messages.ts), written when it is shown, so it follows a later switch.
 */
export function messages(): Messages {
  return state.t;
}

const getState = () => state;

/** The texts on screen, kept current: `const t = useT(); t.library.title`. */
export function useT(): Messages {
  return useSyncExternalStore(subscribeLocale, getState).t;
}

/** The language on screen, kept current, and the way to pick another. */
export function useLocale(): [Locale, (locale: Locale) => Promise<void>] {
  return [useSyncExternalStore(subscribeLocale, getState).locale, chooseLocale];
}

/** Tests only: back to English with no pick, as at a fresh page. */
export function resetLocaleForTests(): void {
  latest++;
  try {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // Nothing kept.
  }
  show(SOURCE_LOCALE, en);
}
