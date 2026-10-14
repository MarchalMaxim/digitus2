import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App.js';
import { DEFAULT_SETTINGS, useAppStore } from './store.js';

beforeEach(() => {
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
  });
  window.scrollTo({ top: 0 });
});
// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

describe('App', () => {
  it('renders the wordmark', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'digitus2' })).toBeInTheDocument();
  });
});

// Review S2 and L2: a new view used to keep the old one's (clamped) scroll offset, so a piece
// opened from far down the library showed neither its title nor Play, and Back always landed at
// the top of the list.
describe('scrolling on a view change', () => {
  it('leaves the scroll of the view the page loads with to the browser', () => {
    window.scrollTo({ top: 640 });
    render(<App />);
    expect(window.scrollY).toBe(640);
  });

  it('opens a new view at the top and brings the library back where the reader left it', async () => {
    render(<App />);
    window.scrollTo({ top: 1852 });
    await userEvent.click(screen.getByRole('button', { name: 'About and licences' }));
    expect(useAppStore.getState().view.name).toBe('about');
    expect(window.scrollY).toBe(0);
    window.scrollTo({ top: 300 });
    act(() => useAppStore.getState().openLibrary());
    expect(window.scrollY).toBe(1852);
  });

  it('brings the library back where the reader left it through the history, not where it was opened from', () => {
    // Review of Task 2: list left at 2722, back there, scrolled to 500, Forward, then Back
    // landed at 2722. A change of view from outside the library (the hash) is such a step.
    useAppStore.setState({ libraryScrollY: 2722 });
    render(<App />);
    window.scrollTo({ top: 500 });
    fireEvent.scroll(window);
    act(() => useAppStore.setState({ view: { name: 'about' } }));
    expect(window.scrollY).toBe(0);
    act(() => useAppStore.setState({ view: { name: 'library' } }));
    expect(window.scrollY).toBe(500);
  });

  it('does not scroll when the same view is set again', () => {
    // The same piece set again keeps its score view (and a running playback, whose cursor
    // scrolls the page): only a real change of view may move the page.
    useAppStore.setState({ view: { name: 'about' } });
    render(<App />);
    window.scrollTo({ top: 300 });
    act(() => useAppStore.setState({ view: { name: 'about' } }));
    expect(window.scrollY).toBe(300);
  });
});
