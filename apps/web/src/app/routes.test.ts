import { en } from '../i18n/en/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from './store.js';
import {
  FILE_NOT_RESTORABLE_NOTICE,
  UNKNOWN_PIECE_NOTICE,
  SHARED_NOT_LOADED_NOTICE,
  hashToView,
  installHashSync,
  sharedIdFromHash,
  viewToHash,
} from './routes.js';
import { keepScans } from '../scan/diagnostics.js';

afterEach(() => {
  location.hash = '';
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  });
});

describe('routes', () => {
  it('maps views to hashes and back', () => {
    expect(viewToHash({ name: 'library' })).toBe('#/');
    expect(viewToHash({ name: 'about' })).toBe('#/about');
    expect(viewToHash({ name: 'score', source: { kind: 'library', slug: 'ode-to-joy' } })).toBe(
      '#/piece/ode-to-joy',
    );
    expect(
      viewToHash({
        name: 'score',
        source: { kind: 'file', name: 'x.mxl', bytes: new Uint8Array() },
      }),
    ).toBe('#/piece/file');
    expect(hashToView('#/')).toEqual({ name: 'library' });
    expect(hashToView('')).toEqual({ name: 'library' });
    expect(hashToView('#/about')).toEqual({ name: 'about' });
    expect(hashToView('#/piece/ode-to-joy')).toEqual({
      name: 'score',
      source: { kind: 'library', slug: 'ode-to-joy' },
    });
    expect(hashToView('#/piece/no-such-piece')).toBeNull();
    expect(hashToView('#/piece/file')).toBeNull();
    expect(hashToView('#/garbage')).toBeNull();
  });
  it('writes the hash when the view changes and reads it on hashchange', () => {
    const uninstall = installHashSync(useAppStore);
    useAppStore.getState().openAbout();
    expect(location.hash).toBe('#/about');
    location.hash = '#/piece/ode-to-joy';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(useAppStore.getState().view).toEqual({
      name: 'score',
      source: { kind: 'library', slug: 'ode-to-joy' },
    });
    uninstall();
  });
  it('restores the available scan review on browser Back without loading a new job', () => {
    const uninstall = installHashSync(useAppStore);
    const session = {
      id: 'visit-scan',
      file: new File(['%PDF-1.4'], 'piano.pdf'),
      xml: '<score-partwise/>',
    };
    useAppStore.getState().openScan(session);
    useAppStore.getState().openPiece({
      kind: 'file',
      name: 'piano.musicxml',
      bytes: new TextEncoder().encode(session.xml),
      scan: session,
    });
    location.hash = '#/scan';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(useAppStore.getState().view).toEqual({ name: 'scan', session });
    uninstall();
  });
  it('falls back to the library with a notice when the hash cannot be restored', () => {
    location.hash = '#/piece/file';
    const uninstall = installHashSync(useAppStore);
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    expect(useAppStore.getState().notice).toBe(FILE_NOT_RESTORABLE_NOTICE);
    expect(FILE_NOT_RESTORABLE_NOTICE(en)).toBe(
      'Open it from My scores, or choose the file again.',
    );
    uninstall();
  });
  it('falls back to the library with a notice when the piece is not in the library', () => {
    location.hash = '#/piece/does-not-exist';
    const uninstall = installHashSync(useAppStore);
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    expect(location.hash).toBe('#/');
    expect(useAppStore.getState().notice).toBe(UNKNOWN_PIECE_NOTICE);
    expect(UNKNOWN_PIECE_NOTICE(en)).toBe('That piece is not in the library.');
    useAppStore.setState({ notice: null });
    location.hash = '#/piece/no-such-piece';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(useAppStore.getState().notice).toBe(UNKNOWN_PIECE_NOTICE);
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    uninstall();
  });
  it('corrects an unrestorable hash in place, without a new history entry', () => {
    location.hash = '#/garbage';
    const entries = history.length;
    const uninstall = installHashSync(useAppStore);
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    expect(location.hash).toBe('#/');
    expect(useAppStore.getState().notice).toBeNull();
    expect(history.length).toBe(entries);
    uninstall();
  });
  it('names a shared score by 32 lowercase hex characters, and only those', () => {
    const id = 'ab01'.repeat(8);
    expect(sharedIdFromHash(`#/shared/${id}`)).toBe(id);
    for (const bad of [
      '#/shared/',
      '#/shared/abc',
      `#/shared/${id}0`,
      `#/shared/${id.toUpperCase()}`,
      `#/shared/${'g'.repeat(32)}`,
      `#/shared/${id}/x`,
      `#/piece/${id}`,
    ])
      expect(sharedIdFromHash(bad), bad).toBeNull();
    expect(
      viewToHash({
        name: 'score',
        source: {
          kind: 'shared',
          id,
          name: 'x.musicxml',
          bytes: new Uint8Array(),
          title: 'x',
          composer: '',
          origin: 'file',
        },
      }),
    ).toBe(`#/shared/${id}`);
    // The score has to be fetched before there is a view to show.
    expect(hashToView(`#/shared/${id}`)).toBeNull();
  });
  it('falls back to the library with a notice for a shared address that is not an id', () => {
    location.hash = '#/shared/nonsense';
    const uninstall = installHashSync(useAppStore);
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    expect(location.hash).toBe('#/');
    expect(useAppStore.getState().notice).toBe(SHARED_NOT_LOADED_NOTICE);
    expect(SHARED_NOT_LOADED_NOTICE(en)).toBe('This shared score could not be loaded.');
    uninstall();
  });
  it('turns scan keeping on and off from its address, without moving the reader or a history entry', () => {
    const entries = history.length;
    location.hash = '#keep-scans';
    const uninstall = installHashSync(useAppStore);
    expect(keepScans()).toBe(true);
    expect(location.hash).toBe('#/');
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    expect(useAppStore.getState().notice).toBeNull();
    useAppStore.getState().openAbout();
    const before = history.length;
    history.replaceState(history.state, '', '#keep-scans-off');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(keepScans()).toBe(false);
    expect(location.hash).toBe('#/about');
    expect(useAppStore.getState().view).toEqual({ name: 'about' });
    expect(history.length).toBe(before);
    expect(before).toBeGreaterThanOrEqual(entries);
    uninstall();
  });
});
