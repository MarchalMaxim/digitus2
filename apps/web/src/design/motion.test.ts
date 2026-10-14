import { afterEach, describe, expect, it, vi } from 'vitest';
import { flash, prefersReducedMotion } from './motion.js';

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
