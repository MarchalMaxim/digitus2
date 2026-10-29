import type { Locale } from '../locales.js';
import { useLocale } from '../i18n.js';
import { whistle as en } from './en.js';
import { whistle as es } from './es.js';
import { whistle as fr } from './fr.js';
import { whistle as nl } from './nl.js';
import { whistle as pt } from './pt.js';

export type WhistleText = typeof en;

export const WHISTLE_TEXTS: Record<Locale, WhistleText> = { en, nl, fr, es, pt };

/** The whistle texts in the language on screen. */
export function useWhistleText(): WhistleText {
  const [locale] = useLocale();
  return WHISTLE_TEXTS[locale];
}
