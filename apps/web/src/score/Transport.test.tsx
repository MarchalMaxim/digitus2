import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_SETTINGS, tempoFactorOf, useAppStore } from '../app/store.js';
import {
  LOOP_REVERSED_TEXT,
  loopFromInputs,
  loopPrefill,
  PracticeControls,
  startQpm,
  tempoText,
  Transport,
} from './Transport.js';
import { en } from '../i18n/en/index.js';
import { chooseLocale, resetLocaleForTests } from '../i18n/i18n.js';
import type { Playback } from './usePlayback.js';

/** The practice controls and the transport (the dock's buttons), as the score view shows them. */
function Controls({ playback: pb, disabled = false }: { playback: Playback; disabled?: boolean }) {
  return (
    <>
      <PracticeControls playback={pb} measureCount={12} currentBar={1} />
      <Transport playback={pb} disabled={disabled} />
    </>
  );
}

function playback(
  playing = false,
  loading = false,
): Playback & {
  play: Mock<() => void>;
  pause: Mock<() => void>;
  setLoop: Mock<Playback['setLoop']>;
} {
  return {
    playing,
    loading,
    countIn: null,
    waiting: false,
    atStart: !playing,
    ended: 0,
    cue: null,
    play: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    rewind: vi.fn(),
    seek: vi.fn(),
    cueAt: () => {},
    finish: () => {},
    positionSec: () => 0,
    startSec: () => 0,
    startPerformanceSec: () => 0,
    performanceLoop: () => null,
    leadingIn: () => false,
    playingNow: () => false,
    leadInRemainingSec: () => null,
    loop: null,
    setLoop: vi.fn<Playback['setLoop']>(),
    strike: () => () => undefined,
    prepare: () => {},
    preparing: false,
    soundWaits: false,
    accompany: () => {},
    stopAccompaniment: () => {},
  };
}
afterEach(() => {
  cleanup();
  resetLocaleForTests();
});
// The controls belong to the score view, and the tempo factor is the open piece's own.
beforeEach(() =>
  useAppStore.setState({
    view: { name: 'score', source: { kind: 'library', slug: 'twinkle-twinkle-little-star' } },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  }),
);

describe('Transport', () => {
  it('shows a red Play when stopped and a plain Pause when playing', () => {
    const { rerender } = render(<Controls playback={playback(false)} />);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('is-red');
    rerender(<Controls playback={playback(true)} />);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveClass('is-red');
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });
  it('keeps Pause the red element during the count-in (no note is red yet), and it still pauses', async () => {
    // The count-in is the first part of the lead-in: usePlayback reports both.
    const counting = {
      ...playback(true),
      countIn: { beat: 1, beats: 4, beatInBar: 2 },
      waiting: true,
    };
    const { rerender } = render(<Controls playback={counting} />);
    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(pause).toHaveClass('is-red');
    expect(pause).not.toHaveAttribute('aria-disabled');
    await userEvent.click(pause);
    expect(counting.pause).toHaveBeenCalledTimes(1);
    // The music starts: the cursor takes the red, Pause turns plain.
    rerender(<Controls playback={playback(true)} />);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveClass('is-red');
  });
  it('keeps Pause the red element until the first note of the hands played sounds, after the count-in or without one', () => {
    // The left hand alone after the right hand's pickup: nothing the cursor marks sounds yet.
    const leadIn = { ...playback(true), waiting: true };
    const { rerender } = render(<Controls playback={leadIn} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('is-red');
    rerender(<Controls playback={playback(true)} />);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveClass('is-red');
  });
  it('is plain while paused with the resume point marked, red when there is nothing to resume (T10)', () => {
    const { rerender } = render(<Transport playback={playback(false)} resumeShown />);
    expect(screen.getByRole('button', { name: 'Play' })).not.toHaveClass('is-red');
    rerender(<Transport playback={playback(false)} resumeShown={false} />);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('is-red');
  });
  // Motion study 05: while the red travels between Play and the cursor, the traveling shape is the
  // one red element, so the button is plain wherever it would be red.
  it('is plain while the red travels (redAway), red again once it has arrived', () => {
    const { rerender } = render(<Transport playback={playback(false)} redAway />);
    expect(screen.getByRole('button', { name: 'Play' })).not.toHaveClass('is-red');
    rerender(<Transport playback={playback(false)} />);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('is-red');
    const leadIn = { ...playback(true), waiting: true };
    rerender(<Transport playback={leadIn} redAway />);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveClass('is-red');
  });
  // UI batch review: at the start there is nothing to rewind. Rewind says it is unavailable
  // (aria-disabled, like Play, so a reader who rewinds keeps the focus on it) and ignores a
  // click, until Play or a pause away from the start gives it something to do.
  it('keeps Rewind unavailable while stopped at the start, focusable, and ignores it then', async () => {
    const rewind = vi.fn();
    const atStart = { ...playback(false), rewind };
    const { rerender } = render(<Transport playback={atStart} />);
    const button = screen.getByRole('button', { name: 'Rewind' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(rewind).not.toHaveBeenCalled();
    rerender(<Transport playback={{ ...playback(true), rewind }} />);
    expect(button).not.toHaveAttribute('aria-disabled');
    await userEvent.click(button);
    expect(rewind).toHaveBeenCalledTimes(1);
    rerender(<Transport playback={{ ...playback(false), atStart: false, rewind }} resumeShown />);
    expect(button).not.toHaveAttribute('aria-disabled');
    await userEvent.click(button);
    expect(rewind).toHaveBeenCalledTimes(2);
    // Rewound: at the start again, and the focus stays on the button.
    rerender(<Transport playback={{ ...playback(false), rewind }} />);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
  });
  // Playing along (issue 182): the red waits on the piece's first note for the piano. The
  // position is a cue, not the start, yet there is nothing to rewind to.
  it('keeps Rewind unavailable while the red waits on the first note, and ignores it then', async () => {
    const rewind = vi.fn();
    const waiting = { ...playback(false), atStart: false, rewind };
    const { rerender } = render(<Transport playback={waiting} resumeShown atFirstNote />);
    const button = screen.getByRole('button', { name: 'Rewind' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(rewind).not.toHaveBeenCalled();
    // The red has moved on (or the piano went): Rewind has something to do again.
    rerender(<Transport playback={waiting} resumeShown atFirstNote={false} />);
    expect(button).not.toHaveAttribute('aria-disabled');
    await userEvent.click(button);
    expect(rewind).toHaveBeenCalledTimes(1);
    // The default is off, and a playing transport can always be rewound.
    rerender(<Transport playback={waiting} resumeShown />);
    expect(button).not.toHaveAttribute('aria-disabled');
    rerender(<Transport playback={{ ...playback(true), rewind }} atFirstNote />);
    expect(button).not.toHaveAttribute('aria-disabled');
  });
  it('wires play, pause, hands, tempo, metronome, count-in and loop', async () => {
    const pb = playback(false);
    render(<Controls playback={pb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(pb.play).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: 'Left hand' }));
    expect(useAppStore.getState().settings.hands).toBe('L');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Metronome' }));
    expect(useAppStore.getState().settings.metronome).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Count-in' }));
    expect(useAppStore.getState().settings.countIn).toBe(false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    const from = screen.getByLabelText('Loop from bar');
    const to = screen.getByLabelText('Loop to bar');
    await userEvent.clear(from);
    await userEvent.type(from, '3');
    await userEvent.clear(to);
    await userEvent.type(to, '20');
    expect(pb.setLoop).toHaveBeenLastCalledWith({ from: 2, to: 11 });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    expect(pb.setLoop).toHaveBeenLastCalledWith(null);
  });
  it('keeps Play focusable while it cannot start, and ignores it then', async () => {
    // A natively disabled button would drop the focus to <body> while the samples load.
    const loading = playback(false, true);
    const { rerender } = render(<Controls playback={loading} />);
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play).not.toBeDisabled();
    expect(play).toHaveAttribute('aria-disabled', 'true');
    expect(play).toHaveAttribute('aria-busy', 'true');
    expect(play).toHaveClass('is-red');
    play.focus();
    await userEvent.keyboard('{Enter}');
    expect(loading.play).not.toHaveBeenCalled();
    expect(play).toHaveFocus();

    const notReady = playback(false);
    rerender(<Controls playback={notReady} disabled />);
    expect(play).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(play);
    expect(notReady.play).not.toHaveBeenCalled();

    const ready = playback(false);
    rerender(<Controls playback={ready} />);
    expect(play).not.toHaveAttribute('aria-disabled');
    expect(play).not.toHaveAttribute('aria-busy');
    await userEvent.keyboard('{Enter}');
    expect(ready.play).toHaveBeenCalledTimes(1);

    // Playing while the score re-lays out (disabled): Pause still works.
    const relayout = playback(true);
    rerender(<Controls playback={relayout} disabled />);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveAttribute('aria-disabled');
    await userEvent.keyboard('{Enter}');
    expect(relayout.pause).toHaveBeenCalledTimes(1);
  });
});

describe('Space plays and pauses', () => {
  // fireEvent returns false when a listener cancelled the default action (scrolling the page).
  const space = (target: Element, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(target, { key: ' ', code: 'Space', ...init });

  it('while no control has the focus, without scrolling the page', () => {
    const stopped = playback(false);
    const { rerender } = render(<Controls playback={stopped} />);
    expect(document.activeElement).toBe(document.body);
    expect(space(document.body)).toBe(false);
    expect(stopped.play).toHaveBeenCalledTimes(1);

    const playing = playback(true);
    rerender(<Controls playback={playing} />);
    expect(space(document.body)).toBe(false);
    expect(playing.pause).toHaveBeenCalledTimes(1);
    expect(playing.play).not.toHaveBeenCalled();
  });

  it('leaves Space to a focused control: a field types it, a button or a checkbox takes it once', async () => {
    const pb = playback(false);
    render(
      <>
        <input aria-label="Note" />
        <select aria-label="Size">
          <option>Medium</option>
        </select>
        <details>
          <summary>More</summary>
        </details>
        <Controls playback={pb} />
      </>,
    );
    const field = screen.getByLabelText('Note');
    field.focus();
    await userEvent.keyboard(' ');
    expect(field).toHaveValue(' ');
    expect(space(screen.getByLabelText('Size'))).toBe(true);
    expect(space(screen.getByText('More'))).toBe(true);
    expect(pb.play).not.toHaveBeenCalled();
    // On the Play button Space is the button's own: one press, one play, never two toggles.
    screen.getByRole('button', { name: 'Play' }).focus();
    await userEvent.keyboard(' ');
    expect(pb.play).toHaveBeenCalledTimes(1);
    // A checkbox toggles, and playback is left alone.
    screen.getByRole('checkbox', { name: 'Metronome' }).focus();
    await userEvent.keyboard(' ');
    expect(useAppStore.getState().settings.metronome).toBe(true);
    expect(pb.play).toHaveBeenCalledTimes(1);
  });

  it('plays from a focused link: a link takes Enter, and its Space would only scroll the page', () => {
    const pb = playback(false);
    render(
      <>
        <a href="#/about">About</a>
        <Controls playback={pb} />
      </>,
    );
    const link = screen.getByRole('link', { name: 'About' });
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(space(link)).toBe(false);
    expect(pb.play).toHaveBeenCalledTimes(1);
  });

  it('ignores Space with a modifier, held down, or while Play cannot start', () => {
    const pb = playback(false);
    const { rerender } = render(<Controls playback={pb} />);
    expect(space(document.body, { shiftKey: true })).toBe(true);
    expect(space(document.body, { ctrlKey: true })).toBe(true);
    // Held down: the repeats keep the page still but do not toggle again.
    expect(space(document.body, { repeat: true })).toBe(false);
    expect(pb.play).not.toHaveBeenCalled();

    const loading = playback(false, true);
    rerender(<Controls playback={loading} />);
    expect(space(document.body)).toBe(false);
    expect(loading.play).not.toHaveBeenCalled();

    const notReady = playback(false);
    rerender(<Controls playback={notReady} disabled />);
    expect(space(document.body)).toBe(false);
    expect(notReady.play).not.toHaveBeenCalled();
  });

  it('stops listening when the transport goes', () => {
    const pb = playback(false);
    const { unmount } = render(<Controls playback={pb} />);
    unmount();
    expect(space(document.body)).toBe(true);
    expect(pb.play).not.toHaveBeenCalled();
  });
});

// The score view folds the practice controls into the dock's "Practice" panel at every width
// (UI batch, spec 13); the panel and its toggle belong to the score view, not to these controls.
describe('PracticeControls', () => {
  it('shows the loop that is set when it mounts, ticked', () => {
    const pb = { ...playback(), loop: { from: 1, to: 2 } };
    render(<PracticeControls playback={pb} measureCount={12} currentBar={1} />);
    expect(screen.getByRole('checkbox', { name: 'Loop bars' })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Loop from bar' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Loop to bar' })).toHaveValue(3);
    expect(pb.setLoop).not.toHaveBeenCalled();
  });

  // Issue #112: a piece with notes in one hand has nothing for the Hands control to choose.
  it('leaves the Hands control out on a one-hand piece', () => {
    const { rerender } = render(
      <PracticeControls playback={playback()} measureCount={12} currentBar={1} />,
    );
    expect(screen.getByRole('radio', { name: 'Left hand' })).toBeInTheDocument();
    rerender(<PracticeControls playback={playback()} measureCount={12} currentBar={1} oneHanded />);
    expect(screen.queryByRole('radio', { name: 'Left hand' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Both hands' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Metronome' })).toBeInTheDocument();
  });
});

// "Add notes between" (issue #67): a tick box like Metronome, there only once the piece has an
// embellished version (the score view passes `embellish` then, and null before).
describe('"Add notes between"', () => {
  it('PracticeControls without embellish shows no Add notes between', () => {
    const { rerender } = render(
      <PracticeControls playback={playback()} measureCount={12} currentBar={1} />,
    );
    expect(screen.queryByRole('checkbox', { name: 'Add notes between' })).toBeNull();
    rerender(
      <PracticeControls playback={playback()} measureCount={12} currentBar={1} embellish={null} />,
    );
    expect(screen.queryByRole('checkbox', { name: 'Add notes between' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Metronome' })).toBeInTheDocument();
  });

  it('with embellish it shows an unticked Add notes between that calls set', async () => {
    const set = vi.fn<(on: boolean) => void>();
    const { container } = render(
      <PracticeControls
        playback={playback()}
        measureCount={12}
        currentBar={1}
        embellish={{ on: false, set }}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Add notes between' });
    expect(box).not.toBeChecked();
    // A tick box like its neighbours: a native checkbox inside a `label.check`, nothing else.
    const label = box.closest('label')!;
    expect(label).toHaveClass('check');
    expect(label.className).toBe(
      screen.getByRole('checkbox', { name: 'Metronome' }).closest('label')!.className,
    );
    expect(label.parentElement).toBe(container.querySelector('.transport'));
    // After the loop block, before the seek help line.
    const loopBars = screen.getByRole('checkbox', { name: 'Loop bars' });
    expect(loopBars.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.previousElementSibling).toHaveClass('loop');
    expect(label.nextElementSibling).toHaveClass('seek-help');
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);

    await userEvent.click(box);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(true);
  });

  it('shows the switch ticked while notes are added, and unticking calls set(false)', async () => {
    const set = vi.fn<(on: boolean) => void>();
    render(
      <PracticeControls
        playback={playback()}
        measureCount={12}
        currentBar={1}
        embellish={{ on: true, set }}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Add notes between' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(set).toHaveBeenCalledWith(false);
  });

  // Review minor 1: a switch that fails takes the focused box away; focus stays in the panel, on
  // the control before it, rather than falling to the page.
  it('moves focus to the control before the box when the box goes while focused', () => {
    const set = vi.fn<(on: boolean) => void>();
    const pb = playback();
    const { rerender } = render(
      <PracticeControls
        playback={pb}
        measureCount={12}
        currentBar={1}
        embellish={{ on: true, set }}
      />,
    );
    screen.getByRole('checkbox', { name: 'Add notes between' }).focus();
    rerender(<PracticeControls playback={pb} measureCount={12} currentBar={1} embellish={null} />);
    expect(screen.queryByRole('checkbox', { name: 'Add notes between' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Loop bars' })).toHaveFocus();
  });

  it('moves focus to the last loop field when the loop is on', () => {
    const set = vi.fn<(on: boolean) => void>();
    const pb = { ...playback(), loop: { from: 2, to: 3 } };
    const { rerender } = render(
      <PracticeControls
        playback={pb}
        measureCount={12}
        currentBar={1}
        embellish={{ on: true, set }}
      />,
    );
    screen.getByRole('checkbox', { name: 'Add notes between' }).focus();
    rerender(<PracticeControls playback={pb} measureCount={12} currentBar={1} embellish={null} />);
    expect(screen.getByLabelText('Loop to bar')).toHaveFocus();
  });

  it('leaves focus where it is when the box goes unfocused', () => {
    const set = vi.fn<(on: boolean) => void>();
    const pb = playback();
    const { rerender } = render(
      <PracticeControls
        playback={pb}
        measureCount={12}
        currentBar={1}
        embellish={{ on: true, set }}
      />,
    );
    const metronome = screen.getByRole('checkbox', { name: 'Metronome' });
    metronome.focus();
    rerender(<PracticeControls playback={pb} measureCount={12} currentBar={1} embellish={null} />);
    expect(metronome).toHaveFocus();
  });
});

describe('the loop as one checkbox (spec 13)', () => {
  it('prefills the bar at the cursor and the next, clamped to the piece', () => {
    expect(loopPrefill(3, 12)).toEqual(['3', '4']);
    expect(loopPrefill(12, 12)).toEqual(['12', '12']);
    expect(loopPrefill(1, 1)).toEqual(['1', '1']);
    expect(loopPrefill(0, 12)).toEqual(['1', '2']);
  });
  it('shows no bar fields until "Loop bars" is ticked, then loops at once; unticking clears it', async () => {
    const pb = playback();
    render(<PracticeControls playback={pb} measureCount={12} currentBar={3} />);
    expect(screen.queryByLabelText('Loop from bar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear loop' })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    expect(screen.getByLabelText('Loop from bar')).toHaveValue(3);
    expect(screen.getByLabelText('Loop to bar')).toHaveValue(4);
    expect(pb.setLoop).toHaveBeenLastCalledWith({ from: 2, to: 3 });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    expect(screen.queryByLabelText('Loop from bar')).toBeNull();
    expect(pb.setLoop).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    expect(screen.getByLabelText('Loop from bar')).toHaveValue(3); // the bars come back
  });
  it('still refuses a range typed in reverse, with the message', async () => {
    const pb = playback();
    render(<PracticeControls playback={pb} measureCount={12} currentBar={1} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    await userEvent.clear(screen.getByLabelText('Loop from bar'));
    await userEvent.type(screen.getByLabelText('Loop from bar'), '6');
    await userEvent.clear(screen.getByLabelText('Loop to bar'));
    await userEvent.type(screen.getByLabelText('Loop to bar'), '2');
    expect(screen.getByText('The loop needs "from" before "to".')).toBeInTheDocument();
    expect(pb.setLoop).toHaveBeenLastCalledWith(null);
  });
  it('is not a group named Practice any more: the dock toggle names it', () => {
    render(<PracticeControls playback={playback()} measureCount={12} currentBar={1} />);
    expect(screen.getByRole('checkbox', { name: 'Loop bars' })).toBeInTheDocument(); // it did render
    expect(screen.queryByRole('group', { name: 'Practice' })).toBeNull();
  });
});

// Polish plan Task 6, review S8: the tempo control read "70 %" while the score still printed
// "♩ = 100". It now says the tempo the percentage makes, and the factor is the piece's own.
describe('the tempo control', () => {
  it('writes the percentage and the tempo it makes, in quarter notes per minute', () => {
    expect(tempoText(0.7, 100)).toBe('70 % · ♩ = 70');
    expect(tempoText(1, 108)).toBe('100 % · ♩ = 108');
    expect(tempoText(0.7, 108)).toBe('70 % · ♩ = 76');
    expect(tempoText(1.5, 152)).toBe('150 % · ♩ = 228');
    // Before the score is read there is no tempo to show yet.
    expect(tempoText(0.5, null)).toBe('50 %');
  });

  it("reads the piece's tempo where it starts, as the transport plays it", () => {
    expect(startQpm([{ tick: 0, qpm: 100 }])).toBe(100);
    expect(
      startQpm([
        { tick: 960, qpm: 60 },
        { tick: 0, qpm: 90 },
      ]),
    ).toBe(90);
    // Several marks at the start: the last one is in force (ticksToSeconds does the same).
    expect(
      startQpm([
        { tick: 0, qpm: 90 },
        { tick: 0, qpm: 100 },
      ]),
    ).toBe(100);
    // No tempo before the first mark (or none at all): the engine's default, 120.
    expect(startQpm([{ tick: 480, qpm: 60 }])).toBe(120);
    expect(startQpm([])).toBe(120);
  });

  it("shows 70 % · ♩ = 70 for Twinkle (100 qpm) at 70 %, and follows the piece's tempo", () => {
    useAppStore.getState().setTempoFactor(0.7);
    const pb = playback();
    const { container, rerender } = render(
      <PracticeControls playback={pb} measureCount={12} currentBar={1} qpm={100} />,
    );
    const slider = screen.getByRole('slider', { name: 'Tempo' });
    expect(slider).toHaveValue('70');
    expect(container.querySelector('.tempo-value')).toHaveTextContent(/^70 % · ♩ = 70$/);
    expect(slider).toHaveAttribute('aria-valuetext', '70 %, 70 quarter notes per minute');

    // Another tempo (Ode to Joy is written at 108): the same percentage makes another tempo.
    rerender(<PracticeControls playback={pb} measureCount={12} currentBar={1} qpm={108} />);
    expect(container.querySelector('.tempo-value')).toHaveTextContent(/^70 % · ♩ = 76$/);
    expect(slider).toHaveAttribute('aria-valuetext', '70 %, 76 quarter notes per minute');

    // Moving the slider sets the open piece's factor and updates both.
    fireEvent.change(slider, { target: { value: '50' } });
    expect(tempoFactorOf(useAppStore.getState())).toBe(0.5);
    expect(container.querySelector('.tempo-value')).toHaveTextContent(/^50 % · ♩ = 54$/);

    // While the score is not read yet, the percentage alone.
    rerender(<PracticeControls playback={pb} measureCount={12} currentBar={1} qpm={null} />);
    expect(container.querySelector('.tempo-value')).toHaveTextContent(/^50 %$/);
    expect(slider).toHaveAttribute('aria-valuetext', '50 %');
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });

  it('opens a different piece at 100 %', () => {
    useAppStore.getState().setTempoFactor(0.7);
    useAppStore.getState().openPiece({ kind: 'library', slug: 'ode-to-joy' });
    const { container } = render(
      <PracticeControls playback={playback()} measureCount={16} currentBar={1} qpm={108} />,
    );
    expect(screen.getByRole('slider', { name: 'Tempo' })).toHaveValue('100');
    expect(container.querySelector('.tempo-value')).toHaveTextContent(/^100 % · ♩ = 108$/);
  });
});

const LOOP_REVERSED = LOOP_REVERSED_TEXT(en);

// Polish plan Task 6, review S11: a reversed range (from 6, to 2) was ignored without a word.
describe('a loop whose "from" is after "to"', () => {
  it('is not a loop: the bars typed in reverse, before or after clamping to the piece', () => {
    expect(LOOP_REVERSED_TEXT(en)).toBe('The loop needs "from" before "to".');
    expect(loopFromInputs('6', '2', 12)).toBeNull();
    expect(loopFromInputs('20', '15', 12)).toBeNull();
    expect(loopFromInputs('15', '20', 12)).toEqual({ from: 11, to: 11 });
    expect(loopFromInputs('2', '6', 12)).toEqual({ from: 1, to: 5 });
  });

  it('loops the only bar of a one-bar piece', () => {
    expect(loopFromInputs('1', '1', 1)).toEqual({ from: 0, to: 0 });
    expect(loopFromInputs('1', '5', 1)).toEqual({ from: 0, to: 0 });
  });

  it('says so under the loop inputs and is not applied; a range in order clears the message', () => {
    const pb = playback();
    const { container } = render(
      <PracticeControls playback={pb} measureCount={12} currentBar={1} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    const from = screen.getByRole('spinbutton', { name: 'Loop from bar' });
    const to = screen.getByRole('spinbutton', { name: 'Loop to bar' });
    expect(screen.queryByText(LOOP_REVERSED)).toBeNull();
    expect(from).not.toHaveAttribute('aria-invalid');

    // "Loop bars" prefilled bars 1 and 2; empty "to" to type the range from scratch.
    fireEvent.change(to, { target: { value: '' } });
    fireEvent.change(from, { target: { value: '6' } });
    // Half typed is not reversed: nothing to say yet.
    expect(screen.queryByText(LOOP_REVERSED)).toBeNull();
    fireEvent.change(to, { target: { value: '2' } });
    const message = screen.getByText(LOOP_REVERSED);
    expect(message).toBeVisible();
    expect(pb.setLoop).toHaveBeenLastCalledWith(null);
    for (const input of [from, to]) {
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(LOOP_REVERSED);
    }
    expect(container.querySelector('.loop')).toContainElement(message);
    // Never red: the brief's one red stays Play, and an error is not the next action.
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);

    fireEvent.change(to, { target: { value: '8' } });
    expect(screen.queryByText(LOOP_REVERSED)).toBeNull();
    expect(pb.setLoop).toHaveBeenLastCalledWith({ from: 5, to: 7 });
    for (const input of [from, to]) {
      expect(input).not.toHaveAttribute('aria-invalid');
      expect(input).not.toHaveAccessibleDescription(LOOP_REVERSED);
    }

    // Reversed again, then unticked: the message goes with the inputs.
    fireEvent.change(from, { target: { value: '9' } });
    expect(screen.getByText(LOOP_REVERSED)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Loop bars' }));
    expect(screen.queryByText(LOOP_REVERSED)).toBeNull();
    expect(pb.setLoop).toHaveBeenLastCalledWith(null);
  });
});

describe('in another language', () => {
  it("writes the controls in French, with the tempo in the language's own number style", async () => {
    await act(() => chooseLocale('fr'));
    const { container } = render(<Controls playback={playback()} />);
    expect(screen.getByRole('toolbar', { name: 'Lecture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lire' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rembobiner' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Métronome' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Gauche' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /Tempo/ })).toHaveAttribute(
      'aria-valuetext',
      '100\u00a0%',
    );
    expect(container.querySelector('.tempo-value')?.textContent).toBe('100\u00a0%');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Boucle de mesures' }));
    expect(
      screen.getByRole('spinbutton', { name: 'Boucle jusqu’à la mesure' }),
    ).toBeInTheDocument();
  });
});
