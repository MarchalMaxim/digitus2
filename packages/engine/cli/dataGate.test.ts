import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataGate } from './dataGate.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('dataGate', () => {
  it('says nothing and lets the suite run when the data is there', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(dataGate('corpora', true)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips loudly, naming what did not run, when the data is missing', () => {
    vi.stubEnv('DIGITUS2_REQUIRE_DATA', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(dataGate('the corpora checks', false)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^SKIPPED the corpora checks: .*did not run/);
  });

  it('fails instead of skipping when the data is required', () => {
    vi.stubEnv('DIGITUS2_REQUIRE_DATA', '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => dataGate('the corpora checks', false)).toThrow(/the corpora checks.*did not run/);
    expect(warn).not.toHaveBeenCalled();
    expect(dataGate('the corpora checks', true)).toBe(true); // required data that is there is fine
  });

  it('treats any other value of the variable as not required', () => {
    vi.stubEnv('DIGITUS2_REQUIRE_DATA', '0');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(dataGate('x', false)).toBe(false);
  });
});
