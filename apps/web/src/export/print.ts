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
  const heading = document.createElement('div');
  heading.className = 'print-heading';
  const name = document.createElement('strong');
  name.textContent = title;
  const composerLine = document.createElement('div');
  composerLine.textContent = composer;
  heading.append(name, composerLine);
  if (legend) {
    const line = document.createElement('div');
    line.textContent = legend;
    heading.append(line);
  }
  root.append(heading);
  appendSystems(root, pages);
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
      const media = window.matchMedia('print');
      const mediaEnd = () => {
        if (!media.matches) done();
      };
      const done = () => {
        media.removeEventListener('change', mediaEnd);
        window.removeEventListener('afterprint', done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      media.addEventListener('change', mediaEnd);
      window.addEventListener('afterprint', done);
      signal.addEventListener('abort', done, { once: true });
      try {
        window.print();
        // The browser has captured the document by return, even for a nonblocking dialog.
        // An ignored print may emit no events at all. Never remove an active print document.
        if (!media.matches) done();
      } catch (error) {
        media.removeEventListener('change', mediaEnd);
        window.removeEventListener('afterprint', done);
        signal.removeEventListener('abort', done);
        reject(error);
      }
    });
  } finally {
    cleanup();
  }
}

/** Let the browser paginate complete systems for its selected paper, rather than forcing A4.
 * Measure real glyph bounds (including lyrics, dynamics and digits) with all SVG transforms.
 * Each crop retains the source definitions and exactly one system; no hidden duplicate notes.
 */
function appendSystems(root: HTMLElement, pages: string[]): void {
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;left:-100000px;top:0;width:760px;visibility:hidden';
  document.body.append(stage);
  try {
    for (const source of pages) {
      stage.innerHTML = source;
      const svg = stage.querySelector('svg');
      if (!svg) continue;
      const systems = [...svg.querySelectorAll<SVGGraphicsElement>('g.system')];
      if (!systems.length) {
        const block = document.createElement('div');
        block.className = 'print-system';
        block.append(svg);
        root.append(block);
        continue;
      }
      const view = svg.viewBox.baseVal;
      svg.style.width = '760px';
      svg.style.height = `${(view.height / view.width) * 760}px`;
      const frame = svg.getBoundingClientRect();
      const unitsPerPx = view.width / frame.width;
      for (const [index, system] of systems.entries()) {
        const bounds = system.getBoundingClientRect();
        // A millimetre of ink-safe breathing room above and below each system.
        const top = view.y + (bounds.top - frame.top) * unitsPerPx - view.width / 190;
        const height = bounds.height * unitsPerPx + (2 * view.width) / 190;
        const crop = svg.cloneNode(true) as SVGSVGElement;
        for (const [other, element] of [...crop.querySelectorAll('g.system')].entries()) {
          if (other !== index) element.remove();
        }
        // Verovio's nested SVG defaults to a percentage viewport. Preserve its original
        // dimensions so cropping the outer viewBox cannot rescale the notation.
        const definition = crop.querySelector('svg.definition-scale');
        definition?.setAttribute('width', String(view.width));
        definition?.setAttribute('height', String(view.height));
        crop.setAttribute('viewBox', `${view.x} ${top} ${view.width} ${height}`);
        crop.style.width = '190mm';
        crop.style.height = `${(height / view.width) * 190}mm`;
        crop.style.overflow = 'hidden';
        const block = document.createElement('div');
        block.className = 'print-system';
        block.append(crop);
        root.append(block);
      }
    }
  } finally {
    stage.remove();
  }
}
