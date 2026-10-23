import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoreSheet } from './ScoreSheet.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const page = (p: number) =>
  `<svg viewBox="0 0 100 200" data-p="${p}"><g class="measure"><g class="staff"><g class="note" id="n${p}"/></g></g></svg>`;

describe('ScoreSheet', () => {
  it('renders the pages as inline SVG inside an image-labelled host', () => {
    const { container } = render(
      <ScoreSheet
        pages={['<svg data-p="1"></svg>', '<svg data-p="2"></svg>']}
        label="Twinkle, Twinkle, Little Star"
      />,
    );
    const host = container.querySelector('.score-sheet')!;
    expect(host).toHaveAttribute('role', 'img');
    // The host is announced with the piece's title in it, whatever the wording around it.
    expect(host).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Twinkle, Twinkle, Little Star'),
    );
    expect(host.querySelectorAll('svg')).toHaveLength(2);
  });
  it('replaces pages instead of appending', () => {
    const { container, rerender } = render(
      <ScoreSheet pages={['<svg data-p="1"></svg>']} label="x" />,
    );
    rerender(<ScoreSheet pages={['<svg data-p="2"></svg>']} label="x" />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('svg')).toHaveAttribute('data-p', '2');
  });
  // Issue #79: pages off screen skip their rendering (base.css, `content-visibility: auto`), and a
  // skipped page has no natural size; its own aspect ratio keeps its height.
  it("gives every page its viewBox's aspect ratio, so a page off screen keeps its height", () => {
    const { container } = render(
      <ScoreSheet
        pages={[
          '<svg viewBox="0 0 832 1181"></svg>',
          '<svg viewBox="0 0 832 640"></svg>',
          '<svg></svg>',
        ]}
        label="x"
      />,
    );
    const ratios = [...container.querySelectorAll<SVGSVGElement>('.score-sheet > svg')].map(
      (page) => page.style.aspectRatio,
    );
    expect(ratios).toEqual(['832 / 1181', '832 / 640', '']);
  });
  it('is neither resting nor hopping unless asked', () => {
    const { container } = render(<ScoreSheet pages={[]} label="x" />);
    expect(container.querySelector('.score-sheet')).not.toHaveClass('is-resting');
    expect(container.querySelector('.score-sheet')).not.toHaveClass('is-hopping');
  });
  it('marks resting and hopping independently, and drops each mark when it ends', () => {
    const { container, rerender } = render(
      <ScoreSheet pages={[]} label="x" resting={true} hopping={false} />,
    );
    const host = container.querySelector('.score-sheet')!;
    expect(host).toHaveClass('is-resting');
    expect(host).not.toHaveClass('is-hopping');
    rerender(<ScoreSheet pages={[]} label="x" resting={false} hopping={true} />);
    expect(host).not.toHaveClass('is-resting');
    expect(host).toHaveClass('is-hopping');
  });
  // Issue 99: a piece of six pages or more keeps only the pages near the screen in the DOM.
  it('builds every page of a windowed sheet that is short', () => {
    const built = vi.fn();
    const { container } = render(
      <ScoreSheet pages={[page(0), page(1), page(2)]} label="x" windowed onPageBuilt={built} />,
    );
    expect(container.querySelectorAll('.score-sheet > svg g.note')).toHaveLength(3);
    expect(built).not.toHaveBeenCalled();
  });
  it('builds only the pages near the screen of a windowed long one, and every page when not windowed', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const p = this.getAttribute('data-page');
      return new DOMRect(0, p === null ? 0 : 1000 * Number(p), 1000, p === null ? 0 : 1000);
    });
    const pages = Array.from({ length: 8 }, (_, p) => page(p));
    const built = vi.fn();
    const { container, rerender } = render(
      <ScoreSheet pages={pages} label="x" windowed onPageBuilt={built} />,
    );
    const filled = () =>
      [...container.querySelectorAll('.score-sheet > svg')].flatMap((s, i) =>
        s.childElementCount > 0 ? [i] : [],
      );
    expect(filled()).toEqual([0, 1]);
    expect(container.querySelectorAll('.score-sheet > svg')).toHaveLength(8);
    expect(container.querySelector('.score-sheet > svg')).toHaveAttribute('viewBox', '0 0 100 200');
    rerender(<ScoreSheet pages={pages} label="x" windowed={false} />);
    expect(filled()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
