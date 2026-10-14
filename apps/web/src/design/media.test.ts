import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NARROW_QUERY, useMediaQuery } from './media.js';

/** A matchMedia whose answer the test sets, with the listeners it was given. */
function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  let matches = initial;
  const list = {
    get matches() {
      return matches;
    },
    media: NARROW_QUERY,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    matchMedia: vi.fn((_query: string) => list),
    listeners,
    set(value: boolean) {
      matches = value;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('is the breakpoint the stylesheet uses for narrow screens', () => {
    expect(NARROW_QUERY).toBe('(max-width: 479.98px)');
  });

  it('follows the media query as it changes, and stops listening when unmounted', () => {
    const fake = fakeMatchMedia(true);
    vi.stubGlobal('matchMedia', fake.matchMedia);
    const { result, unmount } = renderHook(() => useMediaQuery(NARROW_QUERY));
    expect(result.current).toBe(true);
    expect(fake.matchMedia).toHaveBeenCalledWith(NARROW_QUERY);
    act(() => fake.set(false));
    expect(result.current).toBe(false);
    act(() => fake.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(fake.listeners.size).toBe(0);
  });

  it('makes one MediaQueryList per query, however often it renders', () => {
    // The score view renders on every change of pressed keys during playback.
    const fake = fakeMatchMedia(false);
    vi.stubGlobal('matchMedia', fake.matchMedia);
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: NARROW_QUERY },
    });
    for (let i = 0; i < 5; i++) rerender({ query: NARROW_QUERY });
    act(() => fake.set(true));
    expect(result.current).toBe(true);
    expect(fake.matchMedia).toHaveBeenCalledTimes(1);
    expect(fake.listeners.size).toBe(1);
    // A different query is a different list, listened to instead of the first.
    rerender({ query: '(min-width: 900px)' });
    expect(fake.matchMedia).toHaveBeenCalledTimes(2);
    expect(fake.matchMedia).toHaveBeenLastCalledWith('(min-width: 900px)');
    expect(fake.listeners.size).toBe(1);
  });

  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery(NARROW_QUERY));
    expect(result.current).toBe(false);
  });
});
