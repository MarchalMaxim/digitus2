/**
 * The phone's camera: the stream and its light (issue 143). The light is not in TypeScript's DOM
 * types; browsers that lack it simply never report it. Focus needs no request: Chrome on Android
 * already focuses continuously, and Safari offers no focus mode.
 */

interface CameraCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

/**
 * 4:3 at the reference's own size (2560 px, 5 MP). Asking for more buys nothing the page keeps,
 * and Chrome ranks size above frame rate, so a 12 MP ideal can bring a 15 fps sensor mode and
 * a much slower grab of every frame.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 2560 },
    height: { ideal: 1920 },
    frameRate: { ideal: 30 },
  },
};

function capabilities(track: MediaStreamTrack | undefined): CameraCapabilities {
  try {
    return (track?.getCapabilities?.() ?? {}) as CameraCapabilities;
  } catch {
    return {};
  }
}

/** True when the page can switch the camera's light: Chrome on Android and recent iOS Safari report it. */
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

/**
 * Switch the light off first and let the request land: some phones leave it burning after the
 * track stops. A camera that never answers still stops within a moment.
 */
export async function releaseCamera(
  stream: MediaStream | undefined,
  torchOn: boolean,
): Promise<void> {
  if (!stream) return;
  const tracks = stream.getTracks();
  if (torchOn)
    await Promise.race([
      Promise.allSettled(tracks.map((track) => setTorch(track, false))),
      new Promise((resolve) => setTimeout(resolve, 300)),
    ]);
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
