import { describe, expect, it, vi } from 'vitest';
import { build, buildDay, DEV_BUILD, formatBuildDay, readBuild } from './build.js';

describe('readBuild', () => {
  it('reads the commit and the date the build defined', () => {
    expect(readBuild({ commit: 'c581d66', date: '2026-10-22T09:30:00.000Z' })).toEqual({
      commit: 'c581d66',
      date: '2026-10-22T09:30:00.000Z',
    });
  });

  it.each([undefined, null, 'c581d66', 42, [], {}])(
    'is a dev build where no stamp was defined (%j)',
    (raw) => {
      expect(readBuild(raw)).toEqual(DEV_BUILD);
    },
  );

  it('keeps a valid commit when the date is unusable, and the reverse', () => {
    expect(readBuild({ commit: 'abc1234', date: 'not a date' })).toEqual({
      commit: 'abc1234',
      date: '',
    });
    expect(readBuild({ commit: '', date: '2026-10-22T00:00:00.000Z' })).toEqual({
      commit: 'dev',
      date: '2026-10-22T00:00:00.000Z',
    });
    expect(readBuild({ commit: 7, date: 7 })).toEqual(DEV_BUILD);
  });
});

describe('build', () => {
  it('is the stamp of this run: a commit, and a date that is empty or a valid timestamp', () => {
    expect(build.commit).toMatch(/^([0-9a-f]{7,40}|dev)$/);
    expect(build.date === '' || !Number.isNaN(Date.parse(build.date))).toBe(true);
  });

  it('is a dev build where the global is not defined', async () => {
    vi.stubGlobal('__DIGITUS2_BUILD__', undefined);
    vi.resetModules();
    try {
      const fresh = await import('./build.js');
      expect(fresh.build).toEqual(DEV_BUILD);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('the build day', () => {
  const stamp = { commit: 'c581d66', date: '2026-10-22T23:30:00.000Z' };

  it('is the ISO day in UTC, whatever the time zone', () => {
    expect(buildDay(stamp)).toBe('2026-10-22');
  });

  it('is written in the language of the reader, naming the same day', () => {
    expect(formatBuildDay('en', stamp)).toBe('October 22, 2026');
    expect(formatBuildDay('fr', stamp)).toBe('22 octobre 2026');
    expect(formatBuildDay('nl', stamp)).toBe('22 oktober 2026');
  });

  it('is empty where the date is unknown', () => {
    expect(buildDay(DEV_BUILD)).toBe('');
    expect(formatBuildDay('en', DEV_BUILD)).toBe('');
  });
});
