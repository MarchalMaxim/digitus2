import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPrintPages, printPages } from './print.js';

beforeEach(() => {
  window.print = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

it('installs separate pages before print and removes them when the dialog is cancelled', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {
    expect(document.querySelectorAll('.print-system')).toHaveLength(2);
    expect(document.querySelector('.print-heading')?.textContent).toContain('Title');
    window.dispatchEvent(new Event('afterprint'));
  });
  await printPages(['<svg/>', '<svg/>'], 'Title', 'Composer', new AbortController().signal);
  expect(print).toHaveBeenCalledOnce();
  expect(document.querySelector('.print-score')).toBeNull();
  expect(document.body.classList.contains('printing-score')).toBe(false);
});

it('cleans up if printing throws and never prints an aborted request', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {
    throw new Error('printer');
  });
  await expect(printPages(['<svg/>'], '', '', new AbortController().signal)).rejects.toThrow(
    'printer',
  );
  expect(document.querySelector('.print-score')).toBeNull();
  const abort = new AbortController();
  abort.abort();
  await printPages(['<svg/>'], '', '', abort.signal);
  expect(print).toHaveBeenCalledOnce();
});

it('cleans an open paper document when its score is left', async () => {
  const request = new AbortController();
  vi.spyOn(window, 'print').mockImplementation(() => request.abort());
  await printPages(['<svg/>'], '', '', request.signal);
  expect(document.querySelector('.print-score')).toBeNull();
  expect(document.body.classList.contains('printing-score')).toBe(false);
});

it('fits metadata within its reserved heading without dropping text', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return { height: Number.parseFloat(this.style.fontSize) > 8 ? 150 : 100 } as DOMRect;
  });
  const cleanup = installPrintPages(['<svg/>'], 'A long title', 'Composer');
  expect(document.querySelector('.print-score')?.getAttribute('style')).toContain('8pt');
  expect(document.querySelector('.print-heading')?.textContent).toContain('A long title');
  cleanup();
});

it('refuses metadata that cannot fit even at the minimum legible font', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 1000,
  } as DOMRect);
  expect(() => installPrintPages(['<svg/>'], 'Huge title', 'Composer')).toThrow(
    'title and credits',
  );
  expect(document.querySelector('.print-score')).toBeNull();
  expect(document.body.classList.contains('printing-score')).toBe(false);
});

it('installs and cleans a native refusal sheet without score notation', () => {
  const cleanup = installPrintPages([''], 'Could not print the score: metadata is too long.', '');
  expect(document.querySelector('.print-score')?.textContent).toContain(
    'Could not print the score',
  );
  expect(document.querySelectorAll('.print-system')).toHaveLength(0);
  expect(document.querySelector('.print-score svg')).toBeNull();
  cleanup();
  expect(document.querySelector('.print-score')).toBeNull();
  expect(document.body.classList.contains('printing-score')).toBe(false);
});

it('settles and removes paper when print returns without any print lifecycle event', async () => {
  await printPages(['<svg/>'], 'Title', 'Composer', new AbortController().signal);
  expect(document.querySelector('.print-score')).toBeNull();
});

it('keeps active print media until it exits when afterprint is missing', async () => {
  let active = false;
  const media = new EventTarget() as EventTarget & { matches: boolean };
  Object.defineProperty(media, 'matches', { get: () => active });
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as MediaQueryList);
  window.print = () => {
    active = true;
  };
  const pending = printPages(['<svg/>'], 'Title', 'Composer', new AbortController().signal);
  await vi.waitFor(() => expect(active).toBe(true));
  expect(document.querySelector('.print-score')).not.toBeNull();
  active = false;
  media.dispatchEvent(new Event('change'));
  await pending;
  expect(document.querySelector('.print-score')).toBeNull();
});

it('creates the title and credits only once for a multi-page engraving', () => {
  const cleanup = installPrintPages(['<svg/>', '<svg/>'], 'Title', 'Composer');
  expect(document.querySelectorAll('.print-heading')).toHaveLength(1);
  cleanup();
});
