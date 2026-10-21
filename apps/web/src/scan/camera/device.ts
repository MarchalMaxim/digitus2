/**
 * The phone's camera: the stream, its light and its focus (issue 143). The light and the focus
 * mode are not in TypeScript's DOM types; browsers that lack them simply never report them.
 */

interface CameraCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  focusMode?: string[];
}

/** 4:3, about 12 MP: the browser picks the largest size the camera offers up to this. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 4032 },
    height: { ideal: 3024 },
  },
};

function capabilities(track: MediaStreamTrack | undefined): CameraCapabilities {
  try {
    return (track?.getCapabilities?.() ?? {}) as CameraCapabilities;
  } catch {
    return {};
  }
}

/** True when the page can switch the camera's light (Android Chrome reports it; iOS Safari does not). */
export function hasTorch(track: MediaStreamTrack | undefined): boolean {
  return capabilities(track).torch === true;
}

/** Resolves true once the light is set, false when the camera refused. */
export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** Keep refocusing as the phone moves between the views; best effort. */
export function focusContinuously(track: MediaStreamTrack): void {
  if (!capabilities(track).focusMode?.includes('continuous')) return;
  track
    .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
    .catch(() => {});
}

/** Switch the light off first: some phones leave it burning after the track stops. */
export function releaseCamera(stream: MediaStream | undefined, torchOn: boolean): void {
  if (!stream) return;
  const tracks = stream.getTracks();
  if (torchOn) for (const track of tracks) void setTorch(track, false);
  for (const track of tracks) track.stop();
}

/** A short tick on phones that vibrate, so a capture is felt as well as seen. */
export function tick(): void {
  try {
    navigator.vibrate?.(18);
  } catch {
    // Some browsers throw when vibration is blocked by policy.
  }
}
