import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from './store.js';
import { hashToView, installHashSync, viewToHash } from './routes.js';

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
    expect(useAppStore.getState().notice).toBe('Open it from My scores, or choose the file again.');
    uninstall();
  });
});
