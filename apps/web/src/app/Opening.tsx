import { useEffect, useState } from 'react';
import { Loader } from '../design/Loader.js';
import { useT } from '../i18n/i18n.js';

/**
 * Says a score is on its way in (issue 240): the loader and the score view's own "Loading the
 * score…", so the score view picks up with the same words. It stands in the middle of the window,
 * wherever the page is scrolled, and while it shows it is the screen's one red (the loader's
 * `.is-red` group): the library hides the rest of its page meanwhile (`.is-opening`, library.css),
 * and the callers show nothing else red. It lives in the entry chunk, because the library has to
 * be able to show it at once.
 */
export function Opening() {
  const t = useT();
  const text = t.score.view.status.loading;
  // The status region mounts empty and is filled a moment later: a region that appears with its
  // text already inside is skipped by some screen readers.
  const [said, setSaid] = useState('');
  useEffect(() => setSaid(text), [text]);
  return (
    <div className="opening">
      <Loader tune="scale" />
      <p className="muted" aria-hidden="true">
        {text}
      </p>
      <p className="visually-hidden" role="status">
        {said}
      </p>
    </div>
  );
}
