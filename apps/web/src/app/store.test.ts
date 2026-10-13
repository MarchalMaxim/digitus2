import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, useAppStore } from './store.js';

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  });
});

describe('store', () => {
  it('starts on the library with default settings', () => {
    expect(useAppStore.getState().view).toEqual({ name: 'library' });
    expect(useAppStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });
  it('opens a library piece, the about page, and goes back', () => {
    useAppStore.getState().openPiece({ kind: 'library', slug: 'ode-to-joy' });
    expect(useAppStore.getState().view).toEqual({
      name: 'score',
      source: { kind: 'library', slug: 'ode-to-joy' },
    });
    useAppStore.getState().openAbout();
    expect(useAppStore.getState().view.name).toBe('about');
    useAppStore.getState().openLibrary();
    expect(useAppStore.getState().view.name).toBe('library');
  });
  it('persists settings to localStorage and clamps the tempo factor', () => {
    useAppStore.getState().setSettings({ handSize: 'small', tempoFactor: 9 });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(stored.state.settings.handSize).toBe('small');
    expect(useAppStore.getState().settings.tempoFactor).toBe(1.5);
    expect(stored.state).not.toHaveProperty('view');
  });
  it('merges a partial stored settings object with the defaults', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { handSize: 'child', bogus: 1 } }, version: 0 }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, handSize: 'child' });
  });
  it('clears a notice', () => {
    useAppStore.getState().setNotice('hello');
    expect(useAppStore.getState().notice).toBe('hello');
    useAppStore.getState().setNotice(null);
    expect(useAppStore.getState().notice).toBeNull();
  });
});
