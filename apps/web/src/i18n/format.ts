import type { Locale } from './locales.js';

/** The plural forms a count can take; `other` is the one every language has. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const rules = new Map<Locale, Intl.PluralRules>();
const numbers = new Map<Locale, Intl.NumberFormat>();

/** `n` written the way the language writes numbers: 2,700 in English, 2.700 in Dutch. */
export function formatNumber(locale: Locale, n: number): string {
  let format = numbers.get(locale);
  if (!format) numbers.set(locale, (format = new Intl.NumberFormat(locale)));
  return format.format(n);
}

/**
 * The form of `forms` the language uses for `n`, with each `#` replaced by the number written
 * in that language: `plural('en', 253, { one: '# piece', other: '# pieces' })` is "253 pieces".
 */
export function plural(locale: Locale, n: number, forms: PluralForms): string {
  let rule = rules.get(locale);
  if (!rule) rules.set(locale, (rule = new Intl.PluralRules(locale)));
  const form = forms[rule.select(n)] ?? forms.other;
  return form.replaceAll('#', formatNumber(locale, n));
}

/** A list of items joined the way the language joins them: "A, B and C", "A, B et C". */
export function formatList(locale: Locale, items: readonly string[]): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
}
