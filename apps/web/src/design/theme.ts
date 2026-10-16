import { useSyncExternalStore } from 'react';

/**
 * Light and dark (T7). The page follows the system's color scheme until the reader chooses a
 * theme with the switch (ThemeToggle.tsx); the choice is kept per browser and applied before the
 * first paint by the script in index.html, which reads the same key. The stylesheet does the rest
 * (tokens.css): a `data-theme` on the root wins over the system's preference, and without one the
 * dark set follows `prefers-color-scheme`.
 *
 * A choice that matches the system's theme is not kept: picking it means "as the system", so the
 * page follows the system again from then on.
 */
export type Theme = 'light' | 'dark';

/** Where the switch's choice is kept. index.html reads it before the first paint. */
export const THEME_STORAGE_KEY = 'digitus2.theme';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

const ATTRIBUTE = 'data-theme';

function asTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

function systemList(): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
}

function systemTheme(): Theme {
  return systemList()?.matches ? 'dark' : 'light';
}

/** The kept choice; null without one, or where site data is blocked. */
function storedTheme(): Theme | null {
  try {
    return asTheme(globalThis.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function show(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) root.setAttribute(ATTRIBUTE, theme);
  else root.removeAttribute(ATTRIBUTE);
}

/** The theme on screen: the reader's choice, otherwise the system's. */
export function themeOnScreen(): Theme {
  return asTheme(document.documentElement.getAttribute(ATTRIBUTE)) ?? systemTheme();
}

const listeners = new Set<() => void>();

/**
 * Shows `theme` and keeps it, or forgets the choice when `theme` is the system's own. Where site
 * data is blocked the page still switches; the choice then lasts as long as the page.
 */
export function chooseTheme(theme: Theme): void {
  const own = theme === systemTheme() ? null : theme;
  show(own);
  try {
    if (own) localStorage.setItem(THEME_STORAGE_KEY, own);
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Blocked site data, a private window: nothing to keep the choice in.
  }
  for (const listener of listeners) listener();
}

/**
 * Calls `onChange` when the theme on screen may have changed: a choice made here, a change of the
 * system's color scheme, or a choice made in another tab (which this page then takes up too).
 * Returns the unsubscribe.
 */
export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  const list = systemList();
  list?.addEventListener('change', onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    show(storedTheme());
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    list?.removeEventListener('change', onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The theme on screen, kept current, and the way to choose another. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  return [useSyncExternalStore(subscribeTheme, themeOnScreen), chooseTheme];
}
