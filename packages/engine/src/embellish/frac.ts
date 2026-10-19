// Exact rationals for the embellisher, as research/embellish/core.py uses Python's Fraction, and
// the few Python number semantics the port needs (floor modulo, round half to even, `:.3f`).

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function checked(x: number): number {
  if (!Number.isSafeInteger(x)) throw new RangeError(`Frac: ${x} is not a safe integer`);
  return x;
}

/** An exact rational, always normalised: `d > 0` and `gcd(|n|, d) = 1`. */
export class Frac {
  readonly n: number;
  readonly d: number;

  constructor(n: number, d = 1) {
    checked(n);
    checked(d);
    if (d === 0) throw new RangeError('Frac: zero denominator');
    if (d < 0) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1;
    this.n = n / g + 0; // + 0 turns -0 into 0
    this.d = d / g;
  }

  add(o: Frac): Frac {
    const g = gcd(this.d, o.d);
    return new Frac(checked(this.n * (o.d / g) + o.n * (this.d / g)), checked((this.d / g) * o.d));
  }

  sub(o: Frac): Frac {
    return this.add(new Frac(-o.n, o.d));
  }

  mul(o: Frac): Frac {
    const g1 = gcd(this.n, o.d) || 1;
    const g2 = gcd(o.n, this.d) || 1;
    return new Frac(checked((this.n / g1) * (o.n / g2)), checked((this.d / g2) * (o.d / g1)));
  }

  div(o: Frac): Frac {
    if (o.n === 0) throw new RangeError('Frac: division by zero');
    return this.mul(new Frac(o.d, o.n));
  }

  cmp(o: Frac): -1 | 0 | 1 {
    const x = this.sub(o).n;
    return x < 0 ? -1 : x > 0 ? 1 : 0;
  }

  eq(o: Frac): boolean {
    return this.n === o.n && this.d === o.d;
  }

  lt(o: Frac): boolean {
    return this.cmp(o) < 0;
  }

  le(o: Frac): boolean {
    return this.cmp(o) <= 0;
  }

  isInteger(): boolean {
    return this.d === 1;
  }

  /** As Python's `str(Fraction)`: `"9/2"`, or `"2"` for an integer. */
  toString(): string {
    return this.d === 1 ? String(this.n) : `${this.n}/${this.d}`;
  }
}

export function frac(n: number, d = 1): Frac {
  return new Frac(n, d);
}

/** Reads `Frac.toString()`'s form: `"9/2"`, `"-1/2"`, `"3"`. */
export function fracFrom(s: string): Frac {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`not a fraction: ${JSON.stringify(s)}`);
  return frac(Number(m[1]), m[2] === undefined ? 1 : Number(m[2]));
}

const PY_FRACTION =
  /^\s*([-+]?)(?=\d|\.\d)(\d*|\d+(?:_\d+)*)(?:\/(\d+(?:_\d+)*)|(?:\.(\d*|\d+(?:_\d+)*))?(?:[eE]([-+]?\d+(?:_\d+)*))?)\s*$/;

/**
 * Python's `Fraction(s)` for a string: an integer, `"3/4"`, `"1.5"` or `"1e2"`; throws otherwise
 * (`not a number` for text Python rejects, `zero denominator` for `"1/0"`).
 */
export function parsePyFraction(s: string): Frac {
  const m = PY_FRACTION.exec(s);
  if (!m) throw new Error(`MusicXML: not a number: ${JSON.stringify(s)}`);
  const digits = (x: string | undefined) => (x ?? '').replace(/_/g, '');
  const sign = m[1] === '-' ? -1 : 1;
  if (m[3] !== undefined) {
    const den = Number(digits(m[3]));
    if (den === 0) throw new Error(`MusicXML: zero denominator: ${JSON.stringify(s)}`);
    return frac(sign * Number(digits(m[2])), den);
  }
  const decimal = digits(m[4]);
  let n = Number(digits(m[2]) + decimal || '0');
  let d = 10 ** decimal.length;
  const exp = m[5] === undefined ? 0 : Number(digits(m[5]));
  if (exp >= 0) n *= 10 ** exp;
  else d *= 10 ** -exp;
  return frac(sign * n, d);
}

/** Floor modulo, as Python's `%`. */
export function mod(a: number, n: number): number {
  return (((a % n) + n) % n) + 0;
}

/** Round half to even, as Python's `round(x)`. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const r = x - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
  return r + 0;
}

function isPowerOfTwo(d: number): boolean {
  while (d % 2 === 0) d /= 2;
  return d === 1;
}

/**
 * A beat or a length for the record, as `core.fmt_beat`: `"2"` for an integer, else
 * `f"{float(b):.3f}"` with trailing zeros and the point stripped (`"1.5"`, `"1.667"`).
 *
 * Python rounds the float to 3 decimals, half to even on an exact tie. A dyadic value (a power of
 * two below the line) is its own float, so it is rounded exactly here, half to even (17/16 is
 * 1.062, where `toFixed(3)` gives 1.063). Any other value cannot be a tie as a float, and
 * `toFixed`, which rounds the float's exact value, gives Python's digits (1/80 is 0.013).
 */
export function fmtBeat(b: Frac): string {
  if (b.isInteger()) return String(b.n);
  let s: string;
  if (isPowerOfTwo(b.d)) {
    const num = checked(b.n * 1000);
    let k = Math.floor(num / b.d);
    while (k * b.d > num) k -= 1; // the float quotient may round up to the next integer
    while ((k + 1) * b.d <= num) k += 1;
    const twice = 2 * (num - k * b.d);
    if (twice > b.d || (twice === b.d && mod(k, 2) === 1)) k += 1;
    const abs = Math.abs(k);
    const sign = k < 0 || (k === 0 && b.n < 0) ? '-' : '';
    s = `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
  } else {
    s = (b.n / b.d).toFixed(3);
  }
  return s.replace(/0+$/, '').replace(/\.$/, '');
}
