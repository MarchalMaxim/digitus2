import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DUR_SLOW_FALLBACK_MS,
  durationMs,
  flash,
  prefersReducedMotion,
  restrike,
  RESTRIKE_MS,
} from './motion.js';

afterEach(() => vi.restoreAllMocks());

describe('motion', () => {
  it('flash animates opacity 0 -> 1 over 160 ms ease-out', () => {
    const el = document.createElement('div');
    const animate = vi.fn();
    (el as unknown as { animate: unknown }).animate = animate;
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    flash(el);
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: 'ease-out',
    });
  });
  it('flash fades a dimmed element in to its own opacity', () => {
    const el = document.createElement('div');
    el.style.opacity = '0.4';
    document.body.append(el);
    const animate = vi.fn();
    (el as unknown as { animate: unknown }).animate = animate;
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    flash(el);
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 0.4 }], {
      duration: 160,
      easing: 'ease-out',
    });
    el.remove();
  });
  it('restrike lifts a pressed key and puts it down again, never under reduced motion', () => {
    const el = document.createElement('div');
    el.style.transform = 'scaleY(0.976)';
    document.body.append(el);
    const animate = vi.fn();
    (el as unknown as { animate: unknown }).animate = animate;
    const media = vi
      .spyOn(window, 'matchMedia')
      .mockReturnValue({ matches: false } as MediaQueryList);
    restrike(el);
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0]! as [Keyframe[], KeyframeAnimationOptions];
    expect(frames).toHaveLength(3);
    expect(frames[1]).toEqual({ transform: 'none', offset: 0.35 });
    expect(frames[0]!.transform).toBe(getComputedStyle(el).transform);
    expect(frames[0]!.transform).not.toBe('none');
    expect(frames[0]!.transform).toBe(frames[2]!.transform);
    expect(options.duration).toBe(RESTRIKE_MS);
    media.mockReturnValue({ matches: true } as MediaQueryList);
    restrike(el);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(() => restrike(null)).not.toThrow();
    el.remove();
  });
  it('restrike from an unpressed key starts and ends at none', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const animate = vi.fn();
    (el as unknown as { animate: unknown }).animate = animate;
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    restrike(el);
    const [frames] = animate.mock.calls[0]! as [Keyframe[]];
    expect(frames.map((f) => f.transform)).toEqual(['none', 'none', 'none']);
    el.remove();
  });
  it('flash does nothing under prefers-reduced-motion or without element.animate', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const el = document.createElement('div');
    const animate = vi.fn();
    (el as unknown as { animate: unknown }).animate = animate;
    flash(el);
    expect(animate).not.toHaveBeenCalled();
    expect(prefersReducedMotion()).toBe(true);
    delete (el as unknown as { animate?: unknown }).animate;
    expect(() => flash(el)).not.toThrow();
  });
});

describe('durationMs', () => {
  const root = document.documentElement;
  afterEach(() => root.style.removeProperty('--dur-slow'));

  function media(reduce: boolean) {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduce } as MediaQueryList);
  }

  it('reads a duration token from the root’s style, in milliseconds or seconds', () => {
    media(false);
    for (const [value, ms] of [
      ['200ms', 200],
      ['0.2s', 200],
      ['0ms', 0],
      ['  520ms ', 520],
      ['1s', 1000],
    ] as const) {
      root.style.setProperty('--dur-slow', value);
      expect(durationMs('--dur-slow'), value).toBe(ms);
    }
  });

  it('reads 0 under reduced motion when the stylesheet says so, whatever the fallback', () => {
    media(true);
    root.style.setProperty('--dur-slow', '0ms');
    expect(durationMs('--dur-slow')).toBe(0);
    expect(durationMs('--dur-slow', 500)).toBe(0);
  });

  it('falls back without a value: 200 ms by default, the given one otherwise', () => {
    media(false);
    expect(DUR_SLOW_FALLBACK_MS).toBe(200);
    expect(durationMs('--dur-slow')).toBe(DUR_SLOW_FALLBACK_MS);
    expect(durationMs('--dur-slow', 120)).toBe(120);
    root.style.setProperty('--dur-slow', 'slowly');
    expect(durationMs('--dur-slow', 120)).toBe(120);
  });

  it('is 0 without a value when the reader prefers reduced motion', () => {
    media(true);
    expect(durationMs('--dur-slow')).toBe(0);
    expect(durationMs('--dur-slow', 120)).toBe(0);
  });
});
