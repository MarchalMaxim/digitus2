import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DARK_QUERY,
  THEME_STORAGE_KEY,
  chooseTheme,
  subscribeTheme,
  themeOnScreen,
  useTheme,
} from './theme.js';

/** A matchMedia for the system's color scheme whose answer the test sets. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  let matches = dark;
  const list = {
    get matches() {
      return matches;
    },
    media: DARK_QUERY,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      expect(query).toBe(DARK_QUERY);
      return list;
    }),
  );
  return {
    listeners,
    set(value: boolean) {
      matches = value;
      for (const listener of listeners) listener();
    },
  };
}

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the theme on screen', () => {
  it("follows the system's color scheme while the reader has chosen none", () => {
    const system = fakeSystem(false);
    expect(themeOnScreen()).toBe('light');
    system.set(true);
    expect(themeOnScreen()).toBe('dark');
  });

  it('is light where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(themeOnScreen()).toBe('light');
  });

  it('is the theme chosen with the switch, whatever the system says', () => {
    fakeSystem(false);
    root().setAttribute('data-theme', 'dark');
    expect(themeOnScreen()).toBe('dark');
  });

  it('ignores a data-theme that names no theme', () => {
    fakeSystem(true);
    root().setAttribute('data-theme', 'sepia');
    expect(themeOnScreen()).toBe('dark');
  });
});

describe('chooseTheme', () => {
  it('shows and remembers a theme other than the system’s', () => {
    fakeSystem(false);
    chooseTheme('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(themeOnScreen()).toBe('dark');
  });

  it('forgets the choice when the reader comes back to the system’s theme', () => {
    fakeSystem(true);
    chooseTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    chooseTheme('dark');
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(themeOnScreen()).toBe('dark');
  });

  it('still switches the page when site data is blocked', () => {
    fakeSystem(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => chooseTheme('dark')).not.toThrow();
    expect(themeOnScreen()).toBe('dark');
  });

  it('tells the subscribers', () => {
    fakeSystem(false);
    const onChange = vi.fn();
    const stop = subscribeTheme(onChange);
    chooseTheme('dark');
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    chooseTheme('light');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeTheme', () => {
  it('reports a change of the system’s color scheme and stops listening when asked', () => {
    const system = fakeSystem(false);
    const onChange = vi.fn();
    const stop = subscribeTheme(onChange);
    system.set(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(system.listeners.size).toBe(0);
  });

  it('takes up a theme chosen in another tab', () => {
    fakeSystem(false);
    const onChange = vi.fn();
    const stop = subscribeTheme(onChange);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(onChange).toHaveBeenCalledTimes(1);
    localStorage.removeItem(THEME_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(root().hasAttribute('data-theme')).toBe(false);
    window.dispatchEvent(new StorageEvent('storage', { key: 'digitus2.settings.v1' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('useTheme', () => {
  it('renders the theme on screen and switches it', () => {
    fakeSystem(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]('dark'));
    expect(result.current[0]).toBe('dark');
  });
});

/**
 * The script in index.html that applies a chosen theme before the first paint, run against a
 * fake document and storage: it must agree with theme.ts on the key and the values.
 */
function runPrePaint(stored: () => string | null): string | null {
  // A path, not a URL: under happy-dom `URL` is the fake window's, which node:fs refuses.
  const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../index.html'),
    'utf8',
  );
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(script, 'index.html has an inline script').toBeTruthy();
  expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
  const attributes = new Map<string, string>();
  const doc = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
  };
  new Function('localStorage', 'document', script!)({ getItem: stored }, doc);
  return attributes.get('data-theme') ?? null;
}

describe('the pre-paint script in index.html', () => {
  it('applies a stored theme', () => {
    expect(runPrePaint(() => 'dark')).toBe('dark');
    expect(runPrePaint(() => 'light')).toBe('light');
  });

  it('leaves the page to the system without a stored theme or with a stray value', () => {
    expect(runPrePaint(() => null)).toBeNull();
    expect(runPrePaint(() => 'sepia')).toBeNull();
  });

  it('never throws when site data is blocked', () => {
    expect(
      runPrePaint(() => {
        throw new DOMException('blocked', 'SecurityError');
      }),
    ).toBeNull();
  });
});
