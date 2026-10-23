import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { chooseLocale, resetLocaleForTests } from '../i18n/i18n.js';
import { resetPianoForTests } from '../midi/piano.js';
import type { AccessEvents, OpenedAccess } from '../midi/types.js';
import { PianoLine } from './PianoLine.js';

// The lazy chunk is replaced by a fake the tests drive (the factory is not reached unless pressed).
const access = vi.hoisted(() => ({
  open: vi.fn<(events: AccessEvents) => Promise<OpenedAccess>>(),
}));
vi.mock('../midi/access.js', () => ({
  openMidiAccess: (events: AccessEvents) => access.open(events),
}));

function setNavigator(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}
function clearNavigator(name: string): void {
  delete (navigator as unknown as Record<string, unknown>)[name];
}

const closes = vi.fn();
/** The piano answers at once with these inputs; the events stay for the test to drive. */
function answerWith(...names: string[]) {
  const link: { events: AccessEvents | null } = { events: null };
  access.open.mockImplementation((events) => {
    link.events = events;
    events.inputs(names);
    return Promise.resolve({ close: closes });
  });
  return link;
}
/** The browser's prompt stays open until the test answers it. */
function promptOpen() {
  const link: { events: AccessEvents | null } = { events: null };
  let resolve!: () => void;
  access.open.mockImplementation((events) => {
    link.events = events;
    return new Promise<OpenedAccess>((yes) => {
      resolve = () => yes({ close: closes });
    });
  });
  return { link, answer: () => resolve() };
}

const button = () => screen.getByRole('button');
const sentence = () => screen.getByRole('status');

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  access.open.mockReset();
  closes.mockReset();
  resetPianoForTests();
  setNavigator('requestMIDIAccess', () => Promise.resolve());
  setNavigator('permissions', { query: () => Promise.resolve({ state: 'prompt' }) });
});
afterEach(() => {
  cleanup();
  clearNavigator('requestMIDIAccess');
  clearNavigator('permissions');
  clearNavigator('userAgentData');
  resetPianoForTests();
  resetLocaleForTests();
});

describe('the piano line', () => {
  it('is absent where the browser has no Web MIDI', () => {
    clearNavigator('requestMIDIAccess');
    resetPianoForTests();
    const { container } = render(<PianoLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is one quiet button and an empty status until it is pressed', () => {
    const { container } = render(<PianoLine />);
    expect(button()).toHaveTextContent('Play along on your piano');
    expect(button()).toHaveAttribute('type', 'button');
    expect(button()).toHaveClass('text-button');
    expect(button()).not.toHaveAttribute('aria-disabled');
    expect(button()).not.toHaveAttribute('aria-busy');
    // The sentence is the status element, kept in the page and hidden while it has nothing to say.
    expect(sentence()).toHaveTextContent('');
    expect(sentence()).toHaveClass('visually-hidden');
    expect(container.querySelectorAll('.piano-line')).toHaveLength(1);
    expect(container.querySelector('.piano-line')!.children).toHaveLength(2);
  });

  it('asks the browser only in the press', async () => {
    render(<PianoLine />);
    expect(access.open).not.toHaveBeenCalled();
    answerWith('GO:PIANO MIDI 1');
    await userEvent.click(button());
    expect(access.open).toHaveBeenCalledTimes(1);
  });

  it('says the browser is asking while the prompt is open, and the button stays but is busy', async () => {
    const prompt = promptOpen();
    render(<PianoLine />);
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent('Allow the browser to use your piano.');
    expect(sentence()).not.toHaveClass('visually-hidden');
    expect(button()).toHaveTextContent('Play along on your piano');
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    expect(button()).toHaveAttribute('aria-busy', 'true');
    // A second press while the prompt is open asks nothing more.
    await userEvent.click(button());
    expect(access.open).toHaveBeenCalledTimes(1);
    prompt.link.events!.inputs(['GO:PIANO MIDI 1']);
    await act(async () => prompt.answer());
    expect(button()).not.toHaveAttribute('aria-busy');
    expect(button()).not.toHaveAttribute('aria-disabled');
  });

  it('names the connected piano, and Turn off takes the line back to the plain button', async () => {
    answerWith('GO:PIANO MIDI 1');
    render(<PianoLine />);
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent(
      'GO:PIANO MIDI 1 is connected. Open a piece and play the red note.',
    );
    expect(button()).toHaveTextContent('Turn off');
    expect(useAppStore.getState().settings.playAlong).toBe(true);
    await userEvent.click(button());
    expect(closes).toHaveBeenCalledTimes(1);
    expect(sentence()).toHaveTextContent('');
    expect(sentence()).toHaveClass('visually-hidden');
    expect(button()).toHaveTextContent('Play along on your piano');
    expect(useAppStore.getState().settings.playAlong).toBe(false);
  });

  it('calls a piano with no name Your piano', async () => {
    answerWith('');
    render(<PianoLine />);
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent(
      'Your piano is connected. Open a piece and play the red note.',
    );
  });

  it('says no piano was found, and moves to connected when one is plugged in, with no reload', async () => {
    const link = answerWith();
    render(<PianoLine />);
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent(
      'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on.',
    );
    expect(sentence().textContent).not.toContain('flags');
    expect(button()).toHaveTextContent('Turn off');
    act(() => link.events!.inputs(['Yamaha P-45']));
    expect(sentence()).toHaveTextContent(
      'Yamaha P-45 is connected. Open a piece and play the red note.',
    );
    act(() => link.events!.inputs([]));
    expect(sentence()).toHaveTextContent('No piano found.');
  });

  it('adds the flag sentence on Windows Chrome and Windows Edge only', async () => {
    const windows = (brand: string) =>
      setNavigator('userAgentData', { platform: 'Windows', brands: [{ brand }] });
    const none = async () => {
      cleanup();
      resetPianoForTests();
      answerWith();
      render(<PianoLine />);
      await userEvent.click(button());
      return sentence().textContent;
    };
    windows('Google Chrome');
    expect(await none()).toBe(
      'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on. On Windows, a Bluetooth piano also needs chrome://flags/#use-winrt-midi-api set to Enabled.',
    );
    windows('Microsoft Edge');
    expect(await none()).toBe(
      'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on. On Windows, a Bluetooth piano also needs edge://flags/#use-winrt-midi-api set to Enabled.',
    );
    setNavigator('userAgentData', { platform: 'Linux', brands: [{ brand: 'Google Chrome' }] });
    expect(await none()).toBe(
      'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on.',
    );
  });

  it('says the browser blocked MIDI, with the plain button to press again', async () => {
    access.open.mockRejectedValue('denied');
    render(<PianoLine />);
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent(
      'The browser blocked MIDI for this site. Allow it in the site settings, then press again.',
    );
    expect(button()).toHaveTextContent('Play along on your piano');
    expect(button()).not.toHaveAttribute('aria-disabled');
    expect(useAppStore.getState().settings.playAlong).toBe(false);
    answerWith('GO:PIANO MIDI 1');
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent('GO:PIANO MIDI 1 is connected.');
  });

  it('goes back to the plain line when the prompt is dismissed', async () => {
    access.open.mockRejectedValue('dismissed');
    render(<PianoLine />);
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent('');
    expect(button()).toHaveTextContent('Play along on your piano');
  });

  it('describes the button by the sentence while there is one, so Turn off says what it turns off', async () => {
    const link = answerWith('GO:PIANO MIDI 1');
    render(<PianoLine />);
    // Nothing to say: nothing to describe it with.
    expect(button()).not.toHaveAttribute('aria-describedby');
    await userEvent.click(button());
    expect(button()).toHaveAccessibleDescription(
      'GO:PIANO MIDI 1 is connected. Open a piece and play the red note.',
    );
    act(() => link.events!.inputs([]));
    expect(button()).toHaveAccessibleDescription(/^No piano found\./);
    expect(sentence()).toHaveAttribute('id', button().getAttribute('aria-describedby'));
    await userEvent.click(button()); // Turn off
    expect(button()).not.toHaveAttribute('aria-describedby');
    expect(button()).toHaveAccessibleName('Play along on your piano');
  });

  it('keeps the focus on the one button through asking, connected and Turn off', async () => {
    const prompt = promptOpen();
    render(<PianoLine />);
    const first = button();
    await userEvent.click(first);
    expect(first).toHaveFocus();
    expect(button()).toBe(first); // asking
    prompt.link.events!.inputs(['GO:PIANO MIDI 1']);
    await act(async () => prompt.answer());
    expect(button()).toBe(first);
    expect(first).toHaveTextContent('Turn off');
    expect(first).toHaveFocus();
    await userEvent.click(first);
    expect(button()).toBe(first);
    expect(first).toHaveTextContent('Play along on your piano');
    expect(first).toHaveFocus();
  });

  it('is never red, in any state', async () => {
    const link = answerWith('GO:PIANO MIDI 1');
    const { container } = render(<PianoLine />);
    const red = () => container.querySelectorAll('.is-red, [class*="red"]').length;
    expect(red()).toBe(0);
    await userEvent.click(button());
    expect(red()).toBe(0);
    act(() => link.events!.inputs([]));
    expect(red()).toBe(0);
    await userEvent.click(button());
    expect(red()).toBe(0);
    access.open.mockRejectedValue('denied');
    await userEvent.click(button());
    expect(red()).toBe(0);
  });

  it('speaks the language on screen', async () => {
    await chooseLocale('fr');
    answerWith('GO:PIANO MIDI 1');
    render(<PianoLine />);
    expect(button()).toHaveTextContent('Jouer avec votre piano');
    await userEvent.click(button());
    expect(sentence()).toHaveTextContent(
      'GO:PIANO MIDI 1 est connecté. Ouvrez un morceau et jouez la note rouge.',
    );
    expect(button()).toHaveTextContent('Désactiver');
  });

  it('is laid out as a left-aligned stack whose long flag address wraps', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'library.css'), 'utf8');
    expect(css).toMatch(/\.piano-line\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*start;/);
    expect(css).toMatch(/\.piano-line p\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  });
});
