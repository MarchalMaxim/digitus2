import { expect, it, vi } from 'vitest';
import { focusContinuously, hasTorch, releaseCamera, setTorch } from './device.js';

function track(capabilities: object | (() => never), applied: unknown[] = []) {
  return {
    getCapabilities: typeof capabilities === 'function' ? capabilities : () => capabilities,
    applyConstraints: vi.fn(async (constraints: unknown) => {
      applied.push(constraints);
    }),
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

it('offers the light only when the camera reports one', () => {
  expect(hasTorch(track({ torch: true }))).toBe(true);
  expect(hasTorch(track({ torch: false }))).toBe(false);
  expect(hasTorch(track({}))).toBe(false);
  expect(
    hasTorch(
      track(() => {
        throw new Error('not supported');
      }),
    ),
  ).toBe(false);
  expect(hasTorch({} as MediaStreamTrack)).toBe(false);
  expect(hasTorch(undefined)).toBe(false);
});

it('sets the light through an advanced constraint and reports a refusal', async () => {
  const applied: unknown[] = [];
  expect(await setTorch(track({ torch: true }, applied), true)).toBe(true);
  expect(applied).toEqual([{ advanced: [{ torch: true }] }]);
  const refusing = track({ torch: true });
  vi.mocked(refusing.applyConstraints).mockRejectedValue(
    new DOMException('no', 'OverconstrainedError'),
  );
  expect(await setTorch(refusing, true)).toBe(false);
});

it('asks for continuous focus only from a camera that offers it', () => {
  const applied: unknown[] = [];
  focusContinuously(track({ focusMode: ['manual', 'continuous'] }, applied));
  focusContinuously(track({ focusMode: ['manual'] }, applied));
  focusContinuously(track({}, applied));
  expect(applied).toEqual([{ advanced: [{ focusMode: 'continuous' }] }]);
});

it('switches the light off before stopping every track', () => {
  const order: string[] = [];
  const video = track({ torch: true });
  vi.mocked(video.applyConstraints).mockImplementation(async () => {
    order.push('light off');
  });
  vi.mocked(video.stop).mockImplementation(() => order.push('stop'));
  releaseCamera({ getTracks: () => [video] } as unknown as MediaStream, true);
  expect(order).toEqual(['light off', 'stop']);
  releaseCamera(undefined, true);
});
