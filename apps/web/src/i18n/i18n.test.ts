import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from './en/index.js';
import { formatNumber, plural } from './format.js';
import {
  browserLocale,
  chooseLocale,
  currentLocale,
  messages,
  resetLocaleForTests,
  startLocale,
} from './i18n.js';
import { LOCALE_STORAGE_KEY, LOCALES, matchLocale } from './locales.js';
import type { Messages } from './messages.js';
import { PhraseError } from './PhraseError.js';
import { messageOf } from '../app/errors.js';

function browserSpeaks(...languages: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
}

afterEach(() => {
  vi.doUnmock('./fr/index.js');
  vi.doUnmock('./es/index.js');
  vi.restoreAllMocks();
  resetLocaleForTests();
});

describe('failed language loads', () => {
  it('restores English metadata after the requested startup language fails', async () => {
    vi.resetModules();
    vi.doMock('./fr/index.js', () => Promise.reject(new Error('offline')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    browserSpeaks('fr-FR');
    const locale = await import('./i18n.js');
    document.documentElement.lang = runPrePaint(() => null, ['fr-FR']);
    expect(document.documentElement.lang).toBe('fr');

    await locale.startLocale();

    expect(locale.currentLocale()).toBe('en');
    expect(locale.messages().common.dismiss).toBe('Dismiss');
    expect(document.documentElement.lang).toBe('en');
  });

  it('retains active French when a later Spanish switch fails', async () => {
    vi.resetModules();
    vi.doMock('./es/index.js', () => Promise.reject(new Error('offline')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    browserSpeaks('fr-FR');
    const locale = await import('./i18n.js');
    await locale.startLocale();

    await locale.chooseLocale('es');

    expect(locale.currentLocale()).toBe('fr');
    expect(locale.messages().common.dismiss).toBe('Fermer');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('ignores a stale failure after a newer switch succeeds', async () => {
    vi.resetModules();
    let rejectFrench!: (reason: Error) => void;
    vi.doMock(
      './fr/index.js',
      () =>
        new Promise((_, reject) => {
          rejectFrench = reject;
        }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    browserSpeaks('en-US');
    const locale = await import('./i18n.js');
    const older = locale.chooseLocale('fr');
    await vi.waitFor(() => expect(rejectFrench).toBeTypeOf('function'));
    await locale.chooseLocale('es');
    const onChange = vi.fn();
    const unsubscribe = locale.subscribeLocale(onChange);

    rejectFrench(new Error('offline'));
    await older;

    expect(locale.currentLocale()).toBe('es');
    expect(locale.messages().common.dismiss).toBe('Cerrar');
    expect(document.documentElement.lang).toBe('es');
    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('matchLocale', () => {
  it('takes the first browser language the app speaks, by primary subtag', () => {
    expect(matchLocale(['de-CH', 'fr-CH', 'en'])).toBe('fr');
    expect(matchLocale(['nl-BE'])).toBe('nl');
    expect(matchLocale(['pt-BR', 'en-US'])).toBe('pt');
    expect(matchLocale(['ES'])).toBe('es');
  });

  it('falls back to English', () => {
    expect(matchLocale(['de-DE', 'ja'])).toBe('en');
    expect(matchLocale([])).toBe('en');
  });
});

describe('the language on screen', () => {
  it('starts in the browser language and sets <html lang>', async () => {
    browserSpeaks('fr-FR', 'en');
    await startLocale();
    expect(currentLocale()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(messages().common.dismiss).toBe('Fermer');
  });

  it('keeps a pick that differs from the browser, and forgets one that matches it', async () => {
    browserSpeaks('en-US');
    await chooseLocale('nl');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('nl');
    expect(currentLocale()).toBe('nl');
    await chooseLocale('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(currentLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('prefers the kept pick over the browser', async () => {
    browserSpeaks('es-ES');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'pt');
    await startLocale();
    expect(currentLocale()).toBe('pt');
  });

  it('ignores a kept value it does not know', async () => {
    browserSpeaks('es-ES');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(browserLocale()).toBe('es');
    await startLocale();
    expect(currentLocale()).toBe('es');
  });

  it('lands on the last of two quick picks', async () => {
    browserSpeaks('en-US');
    await Promise.all([chooseLocale('fr'), chooseLocale('es')]);
    expect(currentLocale()).toBe('es');
  });
});

describe('PhraseError', () => {
  it('carries English as its message and is written in the language on screen', async () => {
    const error = new PhraseError((t) => t.common.dismiss);
    expect(error.message).toBe('Dismiss');
    browserSpeaks('en');
    await chooseLocale('es');
    expect(messageOf(error)).toBe('Cerrar');
    expect(messageOf(new Error('raw'))).toBe('raw');
  });
});

describe('format', () => {
  it('writes counts and numbers the way each language does', () => {
    const forms = { one: '# piece', other: '# pieces' };
    expect(plural('en', 1, forms)).toBe('1 piece');
    expect(plural('en', 2700, forms)).toBe('2,700 pieces');
    expect(formatNumber('nl', 2700)).toBe('2.700');
    // French writes 0 and 1 in the singular.
    expect(plural('fr', 0, { one: '# morceau', other: '# morceaux' })).toBe('0 morceau');
  });
});

/** The shape of a dictionary: each key's kind, and a function's number of values. */
function shape(value: unknown, path: string, out: Map<string, string>): Map<string, string> {
  if (typeof value === 'function') out.set(path, `function/${value.length}`);
  else if (typeof value === 'string') out.set(path, 'string');
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) shape(child, `${path}.${key}`, out);
  else out.set(path, typeof value);
  return out;
}

function strings(value: unknown, path: string): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  return [];
}

describe('every language has every text', () => {
  const english = shape(en, '', new Map());

  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    it(`${locale} has the keys of English, of the same kind, and no empty text`, async () => {
      const { messages: t } = (await import(`./${locale}/index.ts`)) as { messages: Messages };
      expect(Object.fromEntries(shape(t, '', new Map()))).toEqual(Object.fromEntries(english));
      for (const [path, text] of strings(t, '')) expect(text.trim(), path).not.toBe('');
    });
  }
});

/**
 * The script in index.html that sets <html lang> before the first paint, run against a fake
 * document, storage and navigator: it must agree with i18n.ts on the key and the matching.
 */
function runPrePaint(stored: () => string | null, languages: string[]): string {
  // A path, not a URL: under happy-dom `URL` is the fake window's, which node:fs refuses.
  const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../index.html'),
    'utf8',
  );
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(script).toContain(`'${LOCALE_STORAGE_KEY}'`);
  const doc = { documentElement: { lang: '', setAttribute: () => {} } };
  new Function('localStorage', 'document', 'navigator', script!)({ getItem: stored }, doc, {
    languages,
  });
  return doc.documentElement.lang;
}

describe('the pre-paint script in index.html', () => {
  it('sets the kept pick, else the browser language the app speaks, else English', () => {
    expect(runPrePaint(() => 'es', ['fr-FR'])).toBe('es');
    expect(runPrePaint(() => null, ['de-CH', 'fr-CH'])).toBe('fr');
    expect(runPrePaint(() => 'klingon', ['pt-BR'])).toBe('pt');
    expect(runPrePaint(() => null, ['ja'])).toBe('en');
  });

  it('agrees with matchLocale', () => {
    for (const tags of [['nl-BE'], ['EN-gb'], ['it', 'es-MX'], []])
      expect(runPrePaint(() => null, tags)).toBe(matchLocale(tags));
  });

  it('never throws when site data is blocked', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(runPrePaint(blocked, ['nl'])).toBe('nl');
  });
});
