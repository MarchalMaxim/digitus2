import { describe, expect, it } from 'vitest';
import { fmtBeat, frac, fracFrom, mod, parsePyFraction, roundHalfEven } from './frac.js';

describe('Frac', () => {
  it('is normalised and prints as Python prints a Fraction', () => {
    expect(frac(6, 4).toString()).toBe('3/2');
    expect(frac(4, 2).toString()).toBe('2');
    expect(frac(-1, 2).toString()).toBe('-1/2');
    expect(frac(1, -2).toString()).toBe('-1/2');
    expect(frac(0, 5).toString()).toBe('0');
  });

  it('adds exactly', () => {
    expect(frac(1, 3).add(frac(1, 3)).add(frac(1, 3)).eq(frac(1))).toBe(true);
    expect(frac(1, 2).sub(frac(3, 4)).toString()).toBe('-1/4');
    expect(frac(2, 3).mul(frac(3, 4)).toString()).toBe('1/2');
    expect(frac(1, 2).div(frac(3, 2)).toString()).toBe('1/3');
  });

  it('compares', () => {
    expect(frac(1, 3).cmp(frac(1, 2))).toBe(-1);
    expect(frac(2, 4).cmp(frac(1, 2))).toBe(0);
    expect(frac(3, 4).cmp(frac(1, 2))).toBe(1);
    expect(frac(1, 3).lt(frac(1, 2))).toBe(true);
    expect(frac(1, 2).le(frac(1, 2))).toBe(true);
    expect(frac(4, 2).isInteger()).toBe(true);
    expect(frac(3, 2).isInteger()).toBe(false);
  });

  it('refuses a zero denominator', () => {
    expect(() => frac(1, 0)).toThrow();
    expect(() => frac(1).div(frac(0))).toThrow();
  });

  it('reads its own string form', () => {
    expect(fracFrom('9/2').eq(frac(9, 2))).toBe(true);
    expect(fracFrom('3').eq(frac(3))).toBe(true);
    expect(fracFrom('-1/2').eq(frac(-1, 2))).toBe(true);
    expect(() => fracFrom('x')).toThrow();
  });
});

describe('mod', () => {
  it('floors as Python does', () => {
    expect(mod(-7, 12)).toBe(5);
    expect(mod(-1, 12)).toBe(11);
    expect(mod(14, 12)).toBe(2);
    expect(mod(-12, 12)).toBe(0);
  });
});

describe('fmtBeat', () => {
  it('formats as core.fmt_beat', () => {
    expect(fmtBeat(frac(3, 2))).toBe('1.5');
    expect(fmtBeat(frac(5, 3))).toBe('1.667');
    expect(fmtBeat(frac(2))).toBe('2');
    expect(fmtBeat(frac(17, 16))).toBe('1.062');
    expect(fmtBeat(frac(19, 16))).toBe('1.188');
    expect(fmtBeat(frac(7, 4))).toBe('1.75');
  });

  it('rounds the float as Python does when the rational tie is not a float tie', () => {
    // 1/80 = 0.0125 exactly, but float(1/80) is a little above it, so Python prints 0.013;
    // float(81/80) is a little below 1.0125, so Python prints 1.012
    expect(fmtBeat(frac(1, 80))).toBe('0.013');
    expect(fmtBeat(frac(81, 80))).toBe('1.012');
  });
});

describe('roundHalfEven', () => {
  it('rounds half to even, as Python round', () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(-1.5)).toBe(-2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(0.6)).toBe(1);
    expect(roundHalfEven(-0.4)).toBe(0);
  });
});

describe('parsePyFraction', () => {
  it('reads what Python reads as a Fraction', () => {
    expect(parsePyFraction('3').toString()).toBe('3');
    expect(parsePyFraction(' 3/4 ').toString()).toBe('3/4');
    expect(parsePyFraction('1.5').toString()).toBe('3/2');
    expect(parsePyFraction('-.25').toString()).toBe('-1/4');
    expect(parsePyFraction('1e2').toString()).toBe('100');
    expect(parsePyFraction('1_0/4').toString()).toBe('5/2');
  });

  it('names what is wrong', () => {
    expect(() => parsePyFraction('x')).toThrow(/^MusicXML: not a number: "x"$/);
    expect(() => parsePyFraction('')).toThrow(/not a number/);
    expect(() => parsePyFraction('1/0')).toThrow(/^MusicXML: zero denominator: "1\/0"$/);
  });
});
