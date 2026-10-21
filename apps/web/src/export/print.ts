import { PhraseError } from '../i18n/PhraseError.js';

/** A temporary paper document. The screen engraving is never resized or patched for printing. */
export function installPrintPages(
  pages: string[],
  title: string,
  composer: string,
  credit?: { text: string; url: string | null } | null,
  legend?: string,
): () => void {
  const root = document.createElement('div');
  root.className = 'print-score';
  root.setAttribute('aria-hidden', 'true');
  for (const [i, svg] of pages.entries()) {
    const page = document.createElement('section');
    page.className = 'print-page';
    const heading = document.createElement('div');
    heading.className = 'print-heading';
    if (i === 0) {
      const name = document.createElement('strong');
      name.textContent = title;
      const credit = document.createElement('div');
      credit.textContent = composer;
      heading.append(name, credit);
      if (legend) {
        const line = document.createElement('div');
        line.textContent = legend;
        heading.append(line);
      }
    }
    const music = document.createElement('div');
    music.className = 'print-music';
    music.innerHTML = svg;
    page.append(heading, music);
    root.append(page);
  }
  if (credit) {
    const line = document.createElement(credit.url ? 'a' : 'div');
    line.textContent = credit.text;
    if (credit.url) line.setAttribute('href', credit.url);
    root.querySelector('.print-heading')?.append(line);
  }
  // Measure the actual metadata at paper width before it can overlap music. System fonts
  // need no asynchronous loading, so the same installation is safe in native beforeprint.
  const measure = root.querySelector('.print-heading')!.cloneNode(true) as HTMLElement;
  measure.style.cssText =
    'position:absolute;left:-100000px;width:190mm;height:auto;overflow-wrap:anywhere;font:10pt/1.2 serif';
  document.body.append(measure);
  let fontPt = 10;
  try {
    while (measure.getBoundingClientRect().height > (35 * 96) / 25.4 && fontPt > 7) {
      measure.style.fontSize = `${--fontPt}pt`;
    }
    if (measure.getBoundingClientRect().height > (35 * 96) / 25.4) {
      throw new PhraseError((t) => t.score.side.printHeadingTooLong);
    }
  } finally {
    measure.remove();
  }
  root.style.setProperty('--print-heading-font', `${fontPt}pt`);
  document.body.append(root);
  document.body.classList.add('printing-score');
  return () => {
    document.body.classList.remove('printing-score');
    root.remove();
  };
}

export async function printPages(
  pages: string[],
  title: string,
  composer: string,
  signal: AbortSignal,
  credit?: { text: string; url: string | null } | null,
  legend?: string,
): Promise<void> {
  if (signal.aborted) return;
  const cleanup = installPrintPages(pages, title, composer, credit, legend);
  // Install and settle the SVG before entering the synchronous print lifecycle. An async
  // beforeprint handler cannot delay the browser's print snapshot.
  try {
    await document.fonts?.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (signal.aborted) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        window.removeEventListener('afterprint', done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      window.addEventListener('afterprint', done);
      signal.addEventListener('abort', done, { once: true });
      try {
        window.print();
      } catch (error) {
        window.removeEventListener('afterprint', done);
        signal.removeEventListener('abort', done);
        reject(error);
      }
    });
  } finally {
    cleanup();
  }
}
