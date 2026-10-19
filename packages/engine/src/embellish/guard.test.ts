// The guard: the light embellisher, the independent check, then solve and beginner lint at every
// hand profile, with one drop-and-retry of the offending bars' figures.
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { lintFingering } from '../lint/index.js';
import type { LintReport } from '../lint/index.js';
import type { LintRuleId } from '../lint/rules.js';
import type { Score } from '../score/types.js';
import { checkEmbellishment } from './check.js';
import { embellishMusicXml } from './embellish.js';
import { GUARD_PROFILES, guardEmbellishment, guardErrors } from './guard.js';
import { fixtureScore } from './testing/score.js';
import type { Bar } from './testing/score.js';

const CEDC: Bar = [
  ['C4', 1],
  ['E4', 1],
  ['D4', 1],
  ['C4', 1],
];
/** `k` bars of C-E-D-C, then a whole-note C: light puts a passing D in bars 0, 2, 4, ... */
const cedc = (k: number) => fixtureScore([...Array.from({ length: k }, () => CEDC), [['C4', 4]]]);

const SIX = cedc(6);
const EIGHT = cedc(8);
const plainNotes = (xml: string) => parseMusicXml(xml).score.notes.length;

/**
 * A lint stub: the real report, plus one error of `rule` on a staff-1 note of each bar in `bars`
 * when `when(score)` says so. The plain score always gets the real report.
 */
function stubLint(
  plainXml: string,
  rule: LintRuleId,
  bars: number[],
  when: (score: Score) => boolean,
): typeof lintFingering {
  const plain = plainNotes(plainXml);
  return (score, assignment, opts) => {
    const real = lintFingering(score, assignment, opts);
    if (score.notes.length === plain || !when(score)) return real;
    const extra = bars.map((b) => {
      const n = score.notes.find((x) => x.measureIndex === b && x.staff === 1)!;
      return {
        rule,
        severity: 'error' as const,
        hand: 'R' as const,
        noteIds: [n.id],
        message: 'stub',
      };
    });
    const report: LintReport = {
      ...real,
      issues: [...real.issues, ...extra],
      errors: real.errors + extra.length,
    };
    return report;
  };
}

describe('guardEmbellishment', () => {
  it('offers an embellishment with three figures that passes at every profile', () => {
    const out = guardEmbellishment(SIX);
    expect(out.reason).toBeNull();
    expect(out.kind).toBeNull();
    const e = out.offered!;
    expect(e).not.toBeNull();
    expect(e.figures).toBe(3);
    expect(e.inserted.map((i) => i.bar)).toEqual(['1', '3', '5']);
    expect(e.droppedBars).toEqual([]);
    expect(Object.keys(e.assignments)).toEqual([...GUARD_PROFILES]);
    expect(e.melodyVoice).toBe('1');
    expect(e.score.notes).toHaveLength(plainNotes(SIX) + 3);
    expect(
      guardErrors(lintFingering(e.score, e.assignments.child, { profile: 'child', beginner: true }))
        .law,
    ).toEqual([]);
  }, 20_000);

  it('refuses fewer than three figures', () => {
    const out = guardEmbellishment(fixtureScore([CEDC, [['C4', 4]]]));
    expect(out.offered).toBeNull();
    expect(out.reason).toMatch(/1 figure/);
    expect(out.kind).toBe('few-figures');
  }, 20_000);

  it("passes the embellisher's refusal through", () => {
    const out = guardEmbellishment(
      fixtureScore(
        [
          [
            ['C4', 1],
            ['E4', 1],
            ['G4', 2],
          ],
        ],
        { staves: 1 },
      ),
    );
    expect(out.offered).toBeNull();
    expect(out.reason).toContain('staff');
    expect(out.kind).toBe('embellisher');
  }, 20_000);

  it('refuses unreadable input instead of throwing', () => {
    const broken = SIX.replace('<octave>4</octave>', '');
    expect(() => embellishMusicXml(broken)).toThrow();
    const out = guardEmbellishment(broken);
    expect(out.offered).toBeNull();
    expect(out.reason).toMatch(/^unreadable input: /);
    expect(out.kind).toBe('embellisher');
  }, 20_000);

  it('drops the figures of an offending bar and checks again', () => {
    const first = plainNotes(EIGHT) + 4;
    // The injected L06 offends only because the real beginner errors are level at that profile.
    const lint = stubLint(EIGHT, 'L06', [2], (s) => s.notes.length === first);
    const out = guardEmbellishment(EIGHT, { lint });
    expect(out.reason).toBeNull();
    const e = out.offered!;
    expect(e.droppedBars).toEqual([2]);
    expect(e.figures).toBe(3);
    expect(e.inserted.map((i) => i.measureIndex)).toEqual([0, 4, 6]);
    expect(e.inserted.some((i) => i.measureIndex === 2)).toBe(false);
  }, 20_000);

  it('refuses when the offending bar has no figure', () => {
    const lint = stubLint(EIGHT, 'L01', [1], () => true);
    const out = guardEmbellishment(EIGHT, { lint });
    expect(out.offered).toBeNull();
    expect(out.reason).toMatch(/no figure/);
    expect(out.kind).toBe('guard');
  }, 20_000);

  it('refuses when the retry still fails', () => {
    const lint = stubLint(EIGHT, 'L01', [2], () => true);
    const out = guardEmbellishment(EIGHT, { lint });
    expect(out.offered).toBeNull();
    expect(out.reason).toMatch(/after dropping/);
    expect(out.kind).toBe('guard');
  }, 20_000);

  it('refuses when the retry leaves fewer than three figures', () => {
    const lint = stubLint(SIX, 'L01', [0, 2], (s) => s.notes.length === plainNotes(SIX) + 3);
    const out = guardEmbellishment(SIX, { lint });
    expect(out.offered).toBeNull();
    expect(out.reason).toMatch(/^1 figure \(at least 3\) after dropping the figures of bars 0, 2$/);
    expect(out.kind).toBe('guard');
  }, 20_000);

  it('drops the bars of every note an issue names', () => {
    const first = plainNotes(EIGHT) + 4;
    const plain = plainNotes(EIGHT);
    // One issue naming a note of bar 2 and a note of bar 4: both bars go, leaving two figures.
    const lint: typeof lintFingering = (score, assignment, opts) => {
      const real = lintFingering(score, assignment, opts);
      if (score.notes.length !== first || score.notes.length === plain) return real;
      const at = (bar: number) => score.notes.find((x) => x.measureIndex === bar && x.staff === 1)!;
      const issue = {
        rule: 'L01' as const,
        severity: 'error' as const,
        hand: 'R' as const,
        noteIds: [at(2).id, at(4).id],
        message: 'stub',
      };
      return { ...real, issues: [...real.issues, issue], errors: real.errors + 1 };
    };
    const out = guardEmbellishment(EIGHT, { lint });
    expect(out.offered).toBeNull();
    expect(out.reason).toBe('2 figures (at least 3) after dropping the figures of bars 2, 4');
  }, 20_000);

  it('checks the reduced embellishment again', () => {
    const first = plainNotes(EIGHT) + 4;
    const lint = stubLint(EIGHT, 'L06', [2], (s) => s.notes.length === first);
    let calls = 0;
    const out = guardEmbellishment(EIGHT, {
      lint,
      check: (...args) => {
        calls += 1;
        return calls === 1
          ? checkEmbellishment(...args)
          : { ok: false, problems: ['y'], strongTotal: 0, strongKept: 0 };
      },
    });
    expect(calls).toBe(2);
    expect(out.offered).toBeNull();
    expect(out.reason).toBe('check: y');
  }, 20_000);

  it('a failing independent check refuses', () => {
    const out = guardEmbellishment(SIX, {
      check: () => ({ ok: false, problems: ['x'], strongTotal: 0, strongKept: 0 }),
    });
    expect(out.offered).toBeNull();
    expect(out.reason).toBe('check: x');
    expect(out.kind).toBe('guard');
  }, 20_000);
});

describe('guardErrors', () => {
  it('counts law errors and the beginner errors L06 and L10, not infos or warnings', () => {
    const issue = (rule: LintRuleId, severity: 'error' | 'warning' | 'info') => ({
      rule,
      severity,
      hand: 'R' as const,
      noteIds: ['n0'],
      message: '',
    });
    const issues = [
      issue('L01', 'error'),
      issue('L01', 'info'),
      issue('L05', 'error'),
      issue('L06', 'error'),
      issue('L06', 'warning'),
      issue('L10', 'error'),
      issue('L08', 'warning'),
    ];
    const report: LintReport = { issues, counts: {}, errors: 5, warnings: 2, infos: 1, notes: 1 };
    const { law, beginner } = guardErrors(report);
    expect(law.map((i) => i.rule)).toEqual(['L01', 'L05']);
    expect(beginner.map((i) => i.rule)).toEqual(['L06', 'L10']);
  });
});
