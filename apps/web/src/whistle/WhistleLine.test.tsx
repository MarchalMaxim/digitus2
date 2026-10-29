import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useAppStore } from '../app/store.js';
import { askToWhistleAgain, takeWhistleAgain } from './again.js';
import { RecorderError, type Recorder } from './recorder.js';
import type * as recorderModule from './recorder.js';
import type { Transcription } from './transcribe.js';
import WhistleLine from './WhistleLine.js';

const { startRecorder } = vi.hoisted(() => ({ startRecorder: vi.fn() }));
vi.mock('./recorder.js', async (importOriginal) => ({
  ...(await importOriginal<typeof recorderModule>()),
  startRecorder,
}));

function recorder(heard: Transcription | null): Recorder & { stop: Mock; cancel: Mock } {
  return {
    elapsed: () => 3.4,
    latest: () => ({ hz: 880, clarity: 0.97 }),
    stop: vi.fn().mockResolvedValue(heard),
    cancel: vi.fn(),
  };
}

const heard: Transcription = {
  notes: [{ midi: 64, start: 0, end: 0.5 }],
  rhythm: {
    bpm: 100,
    notes: [{ midi: 64, start: 0, length: 4 }],
    key: { fifths: 0, mode: 'major' },
  },
  xml: '<score-partwise version="4.0"/>',
  wav: new Uint8Array([...new TextEncoder().encode('RIFF'), ...new Uint8Array(40)]),
};

beforeEach(() => {
  startRecorder.mockReset();
  vi.stubGlobal('AudioWorkletNode', class {});
  vi.stubGlobal(
    'AudioContext',
    class {
      close = vi.fn().mockResolvedValue(undefined);
    },
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
  useAppStore.setState({ view: { name: 'library' } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
});

describe('the whistle line', () => {
  it('is absent where the browser has no microphone', () => {
    delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    const { container } = render(<WhistleLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is one quiet line, and nothing on it is red', () => {
    render(<WhistleLine />);
    expect(screen.getByRole('button', { name: 'Whistle a tune' })).toBeVisible();
    expect(document.querySelectorAll('.is-red')).toHaveLength(0);
    expect(startRecorder).not.toHaveBeenCalled();
  });

  it('opens the microphone only on a press, and shows the recording in place of the line', async () => {
    const live = recorder(heard);
    startRecorder.mockResolvedValue(live);
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    const stop = await screen.findByRole('button', { name: 'Stop' });
    expect(stop).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Recording' })).toBeVisible();
    expect(screen.getByText('Whistle or hum, then press Stop.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Whistle a tune' })).toBeNull();
    expect(document.querySelectorAll('.is-red')).toHaveLength(0);
  });

  it('cancels on Escape, releasing the microphone and bringing the line back', async () => {
    const live = recorder(heard);
    startRecorder.mockResolvedValue(live);
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    await screen.findByRole('button', { name: 'Stop' });
    await userEvent.keyboard('{Escape}');
    expect(live.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Whistle a tune' })).toHaveFocus();
    expect(live.stop).not.toHaveBeenCalled();
  });

  it('releases the microphone when the library is left', async () => {
    const live = recorder(heard);
    startRecorder.mockResolvedValue(live);
    const { unmount } = render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    await screen.findByRole('button', { name: 'Stop' });
    unmount();
    expect(live.cancel).toHaveBeenCalledTimes(1);
  });

  it('opens the review on Stop with the recording as the file and the notes as the recognition', async () => {
    const live = recorder(heard);
    startRecorder.mockResolvedValue(live);
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await vi.waitFor(() => expect(useAppStore.getState().view.name).toBe('scan'));
    const view = useAppStore.getState().view;
    if (view.name !== 'scan') throw new Error('expected the review');
    expect(view.session.xml).toBe(heard.xml);
    expect(view.session.file.type).toBe('audio/wav');
    expect(view.session.file.name).toMatch(/^Whistled tune \d\d\.\d\d\.\d\d\.wav$/);
    expect(view.session.recognizer).toBe('digitus2-whistle/1');
    expect(view.session.recognizedAt).toBeTruthy();
    expect(live.stop).toHaveBeenCalledTimes(1);
  });

  it('says so when no note was heard, and stays on the library', async () => {
    startRecorder.mockResolvedValue(recorder(null));
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No notes were heard. Whistle a little louder or closer to the microphone.',
    );
    expect(useAppStore.getState().view.name).toBe('library');
    expect(screen.getByRole('button', { name: 'Whistle a tune' })).toHaveFocus();
  });

  it('says so, and stays on the library, when the notes cannot be written', async () => {
    const live = recorder(heard);
    live.stop.mockRejectedValue(new Error('no'));
    startRecorder.mockResolvedValue(live);
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The microphone could not be started.',
    );
    expect(useAppStore.getState().view.name).toBe('library');
  });

  it.each([
    [
      'denied',
      'The browser blocked the microphone. Allow it in the site settings, then press again.',
    ],
    ['noMicrophone', 'No microphone was found.'],
    ['failed', 'The microphone could not be started.'],
  ] as const)('says what went wrong when the microphone is %s', async (reason, line) => {
    startRecorder.mockRejectedValue(new RecorderError(reason));
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(line);
    expect(screen.getByRole('button', { name: 'Whistle a tune' })).toBeEnabled();
  });

  it('starts recording on arrival after the review asked to whistle again', async () => {
    const live = recorder(heard);
    startRecorder.mockResolvedValue(live);
    askToWhistleAgain();
    render(<WhistleLine />);
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeVisible();
    // It records with the context the review made in its press.
    expect(startRecorder).toHaveBeenCalledTimes(1);
    expect(startRecorder.mock.calls[0]![0]).toBeInstanceOf(AudioContext);
    expect(takeWhistleAgain()).toBeNull();
    cleanup();
    render(<WhistleLine />);
    expect(screen.getByRole('button', { name: 'Whistle a tune' })).toBeVisible();
  });

  it('makes the audio context in the press and gives it to the recorder', async () => {
    startRecorder.mockResolvedValue(recorder(heard));
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    await screen.findByRole('button', { name: 'Stop' });
    expect(startRecorder.mock.calls[0]![0]).toBeInstanceOf(AudioContext);
  });

  it('closes the context when the microphone is refused', async () => {
    let context!: { close: Mock };
    startRecorder.mockImplementation(async (made: { close: Mock }) => {
      context = made;
      throw new RecorderError('denied');
    });
    render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    await screen.findByRole('alert');
    expect(context.close).toHaveBeenCalled();
  });

  it('lets go of a microphone that opened after the library was left', async () => {
    const live = recorder(heard);
    let open!: (r: Recorder) => void;
    startRecorder.mockReturnValue(new Promise((resolve) => (open = resolve)));
    const { unmount } = render(<WhistleLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Whistle a tune' }));
    unmount();
    await act(async () => open(live));
    expect(live.cancel).toHaveBeenCalledTimes(1);
  });
});
