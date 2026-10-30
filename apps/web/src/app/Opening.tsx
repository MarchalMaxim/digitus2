import { useEffect, useState } from 'react';
import { Loader } from '../design/Loader.js';
import { useT } from '../i18n/i18n.js';
import { useAppStore } from './store.js';

/**
 * Says a score is on its way in (issues 240, 242): the loader alone, in the middle of the window
 * wherever the page is scrolled, at the size and place of the score view's own loader (library.css),
 * so the reader sees one loader from the choice until the score shows. While it shows it is the
 * screen's one red (the loader's `.is-red` group): the library hides the rest of its page meanwhile
 * (`.is-opening`, library.css), and the callers show nothing else red. It lives in the entry chunk,
 * because the library has to be able to show it at once. Decoration only; `OpeningAnnouncement`
 * says it in words.
 */
export function Opening() {
  return (
    <div className="opening">
      <Loader tune="scale" />
    </div>
  );
}

/**
 * The words for assistive technology while a file is chosen or an address reopens: one live region
 * that is in the page from the first render, so its text, put in later, is announced (a region
 * that appears with its text inside is skipped by some screen readers). Its text is the score
 * view's own "Loading the score…", which that view's status line picks up. A live region and not
 * a `role="status"`: the score view's status line is the page's one status.
 */
export function OpeningAnnouncement() {
  const t = useT();
  const opening = useAppStore((s) => s.opening);
  // The words are put in after the region is in the page, also when the page loads on an address
  // that names a saved score: the first render has the region empty.
  const [announced, setAnnounced] = useState(false);
  useEffect(() => setAnnounced(opening !== null), [opening]);
  return (
    <p className="visually-hidden" aria-live="polite" data-testid="opening-announcement">
      {announced && opening ? t.score.view.status.loading : ''}
    </p>
  );
}
