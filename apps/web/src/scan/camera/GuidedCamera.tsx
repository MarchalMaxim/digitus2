import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/i18n.js';
import { SCAN_LIMIT, validateScanImages } from '../model.js';
import { namedCapture } from '../phone.js';
import {
  alignmentStep,
  continuityWindow,
  HOLD_MS,
  initialAlignment,
  scaledMatrix,
  targetPoints,
  validView,
  validCorners,
} from './captureState.js';
import { CAMERA_CONSTRAINTS, hasTorch, releaseCamera, setTorch, tick as haptic } from './device.js';
import {
  CameraLog,
  cameraDebugRequested,
  diagnosisLines,
  type CameraDiagnosis,
} from './diagnosis.js';
import { advise, measureFrame, photographable, type Advice, type FrameQuality } from './quality.js';
import { createTracker, type Measured, type Tracked, type Tracker } from './tracker.js';
import {
  project,
  reconstructPage,
  sharpness,
  type Capture,
  type Frame,
  type Matrix,
  type Point,
} from './vision.js';
import './camera.css';

type Stage = 'starting' | 'aim' | 'track' | 'processing' | 'review' | 'kept' | 'error';
type CameraError =
  'denied' | 'insecure' | 'unavailable' | 'interrupted' | 'processingFailed' | 'tooMany';
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** A reference and four views, as PhotoScan takes them. */
const PHOTOS = 5;
/** A press looks this long for the sharpest frame before it settles for the best one seen. */
const BURST_MS = 1200;
/** The way out appears only after the reader has tried one dot for this long. */
const SKIP_AFTER_MS = 10_000;
/** Registration's own floor (vision.registerFrame): a reference below it can never be tracked. */
const TRACKABLE = 80;

function dimensions(width: number, height: number, limit: number) {
  const scale = Math.min(
    1,
    limit / Math.max(width, height),
    Math.sqrt(5_000_000 / (width * height)),
  );
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
/** The picture (the video, or a canvas holding one of its frames) scaled to width x height. */
function videoFrame(source: CanvasImageSource, width: number, height: number): Frame {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    // A fresh GPU canvas scales the video before one small read-back; willReadFrequently would
    // force the whole camera frame through the CPU first (8 to 30 ms a frame on a desktop).
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(source, 0, 0, width, height);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    canvas.width = canvas.height = 0;
  }
}
/**
 * One video frame at full size, held on the GPU: its small copy can be measured first, and its
 * pixels read back (a 5 MP read-back costs tens of ms) only when it turns out to be worth keeping.
 */
function holdFrame(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(video, 0, 0, width, height);
  return {
    small: (size: { width: number; height: number }) => videoFrame(canvas, size.width, size.height),
    pixels: () => canvasPixels(canvas),
  };
}
/** The pixels a canvas holds: one read-back, which iOS refuses once a page has made too many. */
function canvasPixels(canvas: HTMLCanvasElement): Frame {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const { width, height } = canvas;
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}
function drawFrame(canvas: HTMLCanvasElement, frame: Frame) {
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas
    .getContext('2d')
    ?.putImageData(
      new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
      0,
      0,
    );
}
async function pageFile(frame: Frame, signal: AbortSignal): Promise<File> {
  const canvas = document.createElement('canvas');
  try {
    signal.throwIfAborted();
    drawFrame(canvas, frame);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Encoding failed'))),
        'image/jpeg',
        0.94,
      ),
    );
    signal.throwIfAborted();
    if (blob.size > SCAN_LIMIT || !['image/jpeg', 'image/png'].includes(blob.type))
      throw new Error('Invalid capture');
    return (
      await validateScanImages([
        namedCapture(
          new File([blob], blob.type === 'image/png' ? 'photo.png' : 'photo.jpg', {
            type: blob.type,
          }),
        ),
      ])
    )[0]!;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
const insetCorners = (width: number, height: number): Point[] => [
  { x: width * 0.05, y: height * 0.05 },
  { x: width * 0.95, y: height * 0.05 },
  { x: width * 0.95, y: height * 0.95 },
  { x: width * 0.05, y: height * 0.95 },
];
const scalePoints = (points: readonly Point[], sx: number, sy: number) =>
  points.map((point) => ({ x: point.x * sx, y: point.y * sy }));

/** Universal symbols, drawn like the scan page's tools: close and the camera's light. */
function Icon({ name }: { name: 'close' | 'light' | 'lightOn' }) {
  const bolt = 'M13 3 6 13.5h5L10 21l7-10.5h-5L13 3Z';
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path
        d={name === 'close' ? 'M6 6l12 12M18 6 6 18' : bolt}
        fill={name === 'lightOn' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A measured frame of a press: its small picture, as analysed, and what the analysis said. */
interface Candidate {
  small: Frame;
  quality: FrameQuality;
  sharp: number;
}
/** The press's photograph: the best candidate with its full picture. */
type Shot = Candidate & { frame: Frame };
/** A frame registration can track beats one it cannot; then the crisper one wins. */
function better(a: Candidate, b: Candidate | undefined) {
  if (!b) return true;
  const trackable = a.sharp >= TRACKABLE;
  return trackable !== b.sharp >= TRACKABLE ? trackable : a.quality.blur < b.quality.blur;
}

/**
 * PhotoScan's capture (issue 143): the reader photographs the page once, then moves the phone so
 * the centre circle rests on four dots anchored to the page, and the camera takes each view by
 * itself. Every frame is measured, so the reader is always told what to fix; the shutter always
 * answers. The live video and its overlays share the same contained aspect ratio.
 */
export function GuidedCamera({
  maxPages,
  onComplete,
  onClose,
}: {
  maxPages: number;
  onComplete(files: File[]): void;
  onClose(): void;
}): React.JSX.Element {
  const t = useT().scan.camera;
  const [stage, setStage] = useState<Stage>('starting');
  const stageRef = useRef<Stage>('starting');
  const move = (next: Stage) => {
    stageRef.current = next;
    setStage(next);
  };
  const [error, setError] = useState<CameraError>();
  const [request, setRequest] = useState(0);
  const [size, setSize] = useState({ width: 3, height: 4 });
  const [preview, setPreview] = useState<Frame>();
  const [corners, setCorners] = useState<Point[]>([]);
  const cornersRef = useRef<Point[]>([]);
  const [editing, setEditing] = useState(false);
  const [kept, setKept] = useState<File[]>([]);
  const keptRef = useRef<File[]>([]);
  const [reviewFile, setReviewFile] = useState<File>();
  const [nativePreviewUrl, setNativePreviewUrl] = useState<string>();
  const [target, setTarget] = useState(0);
  const [projected, setProjected] = useState<Point[]>([]);
  const [holdSince, setHoldSince] = useState<number | null>(null);
  const [quality, setQuality] = useState<'align' | 'hold' | 'lost' | 'blurry'>('align');
  const [advice, setAdvice] = useState<Advice>('good');
  const [outline, setOutline] = useState<Point[] | null>(null);
  const [notice, setNotice] = useState<'retryBlurry' | 'retryCapture' | 'turned'>();
  const [blurryResult, setBlurryResult] = useState(false);
  const [shooting, setShooting] = useState(false);
  /** The shutter has been pressed once in this camera: the opening hint has done its job. */
  const [pressed, setPressed] = useState(false);
  const [invalidPresses, setInvalidPresses] = useState(0);
  const fallbackInput = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const [light, setLight] = useState({ available: false, on: false });
  const lightRef = useRef(false);
  /** The reader's choice, kept while the light is off for processing between pages. */
  const lightWanted = useRef(false);
  const lightBusy = useRef(false);
  const lightKnown = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const session = useRef<AbortController | undefined>(undefined);
  const operation = useRef<AbortController | undefined>(undefined);
  const captures = useRef<Capture[]>([]);
  const reference = useRef<Frame | undefined>(undefined);
  const geometry = useRef<{ width: number; height: number } | undefined>(undefined);
  const hold = useRef(initialAlignment());
  const recent = useRef<FrameQuality[]>([]);
  const burst = useRef<
    | {
        best?: Candidate;
        timer: ReturnType<typeof setTimeout>;
        /** The frame being analysed is drawn on `scratch`; the best one so far stays on `keep`,
         * and the two swap, so the full picture is read back once, when the press settles. */
        scratch: HTMLCanvasElement;
        keep: HTMLCanvasElement;
        /** New video frames during the press, and those sent for analysis. */
        seen: number;
        asked: number;
      }
    | undefined
  >(undefined);
  /** Behind `?camera=debug` only: what the camera saw, for a phone no cable can reach. */
  const debug = useRef(cameraDebugRequested());
  const log = useRef(new CameraLog());
  const [diagnosis, setDiagnosis] = useState<CameraDiagnosis>();
  const blurryAttempts = useRef(0);
  const noticeAt = useRef(-Infinity);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frameId = useRef(0);
  const cancelVideoFrame = useRef<(() => void) | undefined>(undefined);
  const freshnessExpiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSample = useRef(-Infinity);
  const tracker = useRef<Tracker | undefined>(undefined);
  /** Bumped whenever the page in progress is forgotten: answers about older frames are dropped. */
  const epoch = useRef(0);
  /** Recent gaps between camera updates, in ms: how fast this phone delivers them. */
  const gaps = useRef<number[]>([]);
  const lastUpdate = useRef(-Infinity);
  /** A view's still is being checked: no tracking frame meanwhile. */
  const capturing = useRef(false);
  /** How long one update may stand for the next on this phone (continuityWindow). */
  const continuity = () => continuityWindow(gaps.current);
  /** An update arrived for a frame taken at `now`; a long pause (another stage) is no gap. */
  const updated = (now: number) => {
    const gap = now - lastUpdate.current;
    if (gap > 0 && gap < 5000) gaps.current = [...gaps.current.slice(-4), gap];
    lastUpdate.current = now;
  };
  const capacity = Math.max(0, Math.min(20, Math.floor(maxPages)));

  const endBurst = () => {
    clearTimeout(burst.current?.timer);
    for (const canvas of burst.current ? [burst.current.scratch, burst.current.keep] : [])
      canvas.width = canvas.height = 0;
    burst.current = undefined;
    setShooting(false);
  };
  const stop = () => {
    epoch.current++;
    capturing.current = false;
    void releaseCamera(stream.current, lightRef.current);
    stream.current = undefined;
    lightRef.current = false;
    lightWanted.current = false;
    lightBusy.current = false;
    setLight({ available: false, on: false });
    if (video.current) video.current.srcObject = null;
    cancelAnimationFrame(frameId.current);
    cancelVideoFrame.current?.();
    cancelVideoFrame.current = undefined;
    clearTimeout(freshnessExpiry.current);
    clearTimeout(skipTimer.current);
    endBurst();
    operation.current?.abort();
    hold.current = initialAlignment();
    recent.current = [];
    captures.current = [];
    reference.current = undefined;
  };
  /** Forget the page in progress, whatever stage it reached, so nothing leaks into the next one. */
  const clearPage = () => {
    epoch.current++;
    capturing.current = false;
    lastUpdate.current = -Infinity;
    clearTimeout(skipTimer.current);
    endBurst();
    captures.current = [];
    reference.current = undefined;
    hold.current = initialAlignment();
    recent.current = [];
    blurryAttempts.current = 0;
    cornersRef.current = [];
    setCorners([]);
    setTarget(0);
    setHoldSince(null);
    setCanSkip(false);
    setEditing(false);
    setPreview(undefined);
    setReviewFile(undefined);
    setProjected([]);
    setOutline(null);
    setNotice(undefined);
    setBlurryResult(false);
  };
  const fail = (reason: CameraError) => {
    stop();
    clearPage();
    setError(reason);
    move('error');
  };
  const close = () => {
    session.current?.abort();
    stop();
    keptRef.current = [];
    onClose();
  };
  const finish = () => {
    if (
      session.current?.signal.aborted ||
      !keptRef.current.length ||
      keptRef.current.length > capacity
    )
      return;
    const files = keptRef.current;
    session.current?.abort();
    stop();
    onComplete(files);
  };
  const resetPage = () => {
    operation.current?.abort();
    operation.current = new AbortController();
    clearPage();
    setError(undefined);
    // The light went off while the page was prepared; it comes back for the next photographs.
    if (lightWanted.current && !lightRef.current) switchLight(true);
    move(stream.current ? 'aim' : 'error');
  };
  /** The phone turned and the picture changed shape: this page's photographs no longer fit
   * together, so the page starts again, saying why; pages already kept stay. */
  const turned = () => {
    resetPage();
    noticeAt.current = performance.now();
    setNotice('turned');
  };
  /** The way out of a dot that will not register, offered only once it is needed. */
  const armSkip = () => {
    clearTimeout(skipTimer.current);
    setCanSkip(false);
    skipTimer.current = setTimeout(() => setCanSkip(true), SKIP_AFTER_MS);
  };
  const process = async () => {
    const count = captures.current.length;
    if (count < 1 || count > PHOTOS || session.current?.signal.aborted) return;
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    clearTimeout(skipTimer.current);
    setCanSkip(false);
    setHoldSince(null);
    // No light while the page is prepared and reviewed: its button is gone until the next page.
    if (lightRef.current) switchLight(false);
    move('processing');
    setEditing(false);
    setError(undefined);
    try {
      const result = (
        await reconstructPage(captures.current, cornersRef.current, controller.signal)
      ).frame;
      const file = await pageFile(result, controller.signal);
      if (session.current?.signal.aborted || controller.signal.aborted) return;
      setPreview(result);
      setReviewFile(file);
      move('review');
    } catch {
      if (!session.current?.signal.aborted && !controller.signal.aborted) {
        setError('processingFailed');
        setPreview(captures.current[0]!.frame);
        setEditing(true);
        move('review');
      }
    }
  };
  const captured = () => {
    setFlash((value) => value + 1);
    haptic();
  };
  const lostView = () => {
    hold.current = initialAlignment();
    setHoldSince(null);
    setQuality('lost');
  };
  /**
   * The hold is complete: photograph the view at full size, and keep it only once the tracker
   * confirms that this very still, not just the preview before it, shows the dot under the circle.
   * The full picture waits on the GPU until then.
   */
  const captureView = () => {
    const element = video.current;
    const base = reference.current;
    const analysis = tracker.current;
    if (
      stageRef.current !== 'track' ||
      !element ||
      !base ||
      !analysis ||
      capturing.current ||
      !hold.current.aligned ||
      session.current?.signal.aborted
    )
      return;
    hold.current = initialAlignment();
    setHoldSince(null);
    if (performance.now() - lastSample.current > continuity()) return;
    if (
      element.videoWidth !== geometry.current?.width ||
      element.videoHeight !== geometry.current?.height
    ) {
      turned();
      return;
    }
    const token = epoch.current;
    const canvas = document.createElement('canvas');
    const release = () => {
      canvas.width = canvas.height = 0;
    };
    try {
      const first = captures.current[0]!.frame;
      const still = holdFrame(canvas, element, first.width, first.height);
      const small = still.small(base);
      // Set first: without a worker the answer comes before track() returns.
      capturing.current = true;
      const asked = analysis.track(small, (answer) => {
        capturing.current = false;
        try {
          if (token !== epoch.current || stageRef.current !== 'track') return;
          if (!answer) {
            lostView();
            return;
          }
          const index = captures.current.length - 1;
          const point = targetPoints(cornersRef.current, {
            x: first.width / 2,
            y: first.height / 2,
          })[index]!;
          const matrix =
            answer.registration &&
            scaledMatrix(
              answer.registration.matrix,
              first.width / base.width,
              first.height / base.height,
            );
          const valid = validView({
            matrix,
            previous: captures.current.map((capture) => capture.matrix),
            target: point,
            center: { x: first.width / 2, y: first.height / 2 },
            sharp: answer.sharp >= TRACKABLE,
          });
          if (!valid || !matrix) {
            lostView();
            return;
          }
          captures.current.push({ frame: still.pixels(), matrix });
          captured();
          if (captures.current.length === PHOTOS) void process();
          else {
            setTarget(index + 1);
            setQuality('align');
            armSkip();
          }
        } catch {
          lostView();
        } finally {
          release();
        }
      });
      if (!asked) {
        capturing.current = false;
        release();
      }
    } catch (cause) {
      log.current.error('view', cause);
      capturing.current = false;
      release();
      lostView();
    }
  };
  /**
   * The camera still gives pictures: a live track that is not muted (iOS mutes it while Control
   * Center, a call or another app holds the camera) on a video that plays.
   */
  const cameraLive = (element: HTMLVideoElement) => {
    const track = stream.current?.getVideoTracks?.()[0];
    return (
      !!track &&
      track.readyState !== 'ended' &&
      !track.muted &&
      !element.paused &&
      !element.ended &&
      element.videoWidth > 0
    );
  };
  /**
   * The picture the video shows now, measured here: the press's photograph when the camera gave
   * the press new frames but none came back analysed in time (a slow or failing analysis, not a
   * stopped camera). A phone short of canvas memory may still manage the smaller size.
   */
  const directShot = (element: HTMLVideoElement): Shot | undefined => {
    const { videoWidth: width, videoHeight: height } = element;
    for (const limit of [2560, 1600]) {
      const canvas = document.createElement('canvas');
      try {
        const size = dimensions(width, height, limit);
        const full = holdFrame(canvas, element, size.width, size.height);
        const small = full.small(dimensions(width, height, 360));
        return {
          small,
          quality: measureFrame(small),
          sharp: sharpness(small),
          frame: full.pixels(),
        };
      } catch (cause) {
        log.current.error('direct', cause);
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    return undefined;
  };
  /** The sharpest frame of the burst becomes the page's reference, or the reader is told why not. */
  const settleBurst = () => {
    const element = video.current;
    const pending = burst.current;
    if (!pending) return;
    let shot: Shot | undefined;
    let how: 'best' | 'direct' | 'none' = 'none';
    const settling = stageRef.current === 'aim' && !session.current?.signal.aborted && element;
    if (settling && pending.best)
      try {
        shot = { ...pending.best, frame: canvasPixels(pending.keep) };
        how = 'best';
      } catch (cause) {
        log.current.error('read', cause);
      }
    if (settling && !shot && pending.seen > 0 && cameraLive(element)) {
      shot = directShot(element);
      if (shot) how = 'direct';
    }
    log.current.press({ seen: pending.seen, asked: pending.asked, how });
    endBurst();
    if (stageRef.current !== 'aim' || session.current?.signal.aborted || !element) return;
    if (!shot) {
      // Not one new picture during the whole press, or a track that ended or was taken away: the
      // camera stopped. A live camera whose picture could not be kept asks for another tap.
      if (pending.seen > 0 && cameraLive(element)) {
        noticeAt.current = performance.now();
        setNotice('retryCapture');
      } else fail('interrupted');
      return;
    }
    const { frame, small, quality: q } = shot;
    const page =
      q.page && scalePoints(q.page, frame.width / small.width, frame.height / small.height);
    const quad =
      page && validCorners(page, frame.width, frame.height)
        ? page
        : insetCorners(frame.width, frame.height);
    cornersRef.current = quad;
    setCorners(quad);
    if (shot.sharp < TRACKABLE) {
      // A blurred reference can never be tracked. Say so once; a second blurred press keeps the
      // single photograph, for the review to show and the reader to keep or retake.
      blurryAttempts.current += 1;
      if (blurryAttempts.current < 2) {
        noticeAt.current = performance.now();
        setNotice('retryBlurry');
        return;
      }
      captures.current = [{ frame, matrix: IDENTITY }];
      setBlurryResult(true);
      captured();
      void process();
      return;
    }
    blurryAttempts.current = 0;
    captured();
    reference.current = small;
    tracker.current?.setReference(
      small,
      quad.map((point) => ({
        x: (point.x * small.width) / frame.width,
        y: (point.y * small.height) / frame.height,
      })),
    );
    captures.current = [{ frame, matrix: IDENTITY }];
    hold.current = initialAlignment();
    setNotice(undefined);
    setTarget(0);
    // The dots start where the photograph put them, so the red one shows before the first
    // tracking answer, however slow the phone (issue 145).
    setProjected(
      scalePoints(
        targetPoints(quad, { x: frame.width / 2, y: frame.height / 2 }),
        element.videoWidth / frame.width,
        element.videoHeight / frame.height,
      ),
    );
    setQuality('align');
    move('track');
    armSkip();
  };
  const shoot = () => {
    if (stageRef.current !== 'aim' || burst.current || session.current?.signal.aborted) return;
    setNotice(undefined);
    setPressed(true);
    setShooting(true);
    burst.current = {
      timer: setTimeout(() => actions.current.settleBurst(), BURST_MS),
      scratch: document.createElement('canvas'),
      keep: document.createElement('canvas'),
      seen: 0,
      asked: 0,
    };
  };
  /** Optimistic, one request at a time: a quick second tap is not lost or doubled, and a close
   * while the light is coming on still switches it off. */
  function switchLight(on: boolean) {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || lightBusy.current) return;
    lightBusy.current = true;
    lightRef.current = on;
    setLight({ available: true, on });
    void setTorch(track, on).then((ok) => {
      lightBusy.current = false;
      if (ok || stream.current?.getVideoTracks()[0] !== track) return;
      lightRef.current = !on;
      setLight({ available: true, on: !on });
    });
  }
  const toggleLight = () => {
    if (lightBusy.current) return;
    lightWanted.current = !lightRef.current;
    switchLight(!lightRef.current);
  };

  useEffect(() => {
    if (!debug.current) return;
    const timer = setInterval(() => setDiagnosis(log.current.snapshot()), 500);
    return () => clearInterval(timer);
  }, []);
  const actions = useRef({ captureView, fail, settleBurst, turned });
  useEffect(() => {
    actions.current = { captureView, fail, settleBurst, turned };
  });
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    operation.current = new AbortController();
    move('starting');
    clearPage();
    setError(undefined);
    geometry.current = undefined;
    const analysis = createTracker();
    tracker.current = analysis;
    gaps.current = [];
    let cleanupTracks = () => {};
    const interrupted = () => {
      if (!controller.signal.aborted) {
        controller.abort();
        // Cancel acquisition and late processing while keeping explicit native fallback usable.
        session.current = new AbortController();
        actions.current.fail('interrupted');
      }
    };
    const onHidden = () => {
      if (document.hidden) interrupted();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', interrupted);
    window.addEventListener('popstate', interrupted);
    const run = async () => {
      if (!capacity) {
        actions.current.fail('tooMany');
        return;
      }
      if (!globalThis.isSecureContext) {
        actions.current.fail('insecure');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        actions.current.fail('unavailable');
        return;
      }
      try {
        const acquired = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        if (controller.signal.aborted) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = acquired;
        acquired.getTracks().forEach((track) => track.addEventListener('ended', interrupted));
        cleanupTracks = () =>
          acquired.getTracks().forEach((track) => track.removeEventListener('ended', interrupted));
        const element = video.current;
        if (!element) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        element.srcObject = acquired;
        await element.play();
        if (controller.signal.aborted) return;
        const videoTrack = acquired.getVideoTracks?.()?.[0];
        lightKnown.current = hasTorch(videoTrack);
        setLight({ available: lightKnown.current, on: false });
        move('aim');
        let last = -Infinity;
        let lastMediaTime = -Infinity;
        let lastPresented = -1;
        /** A repeated frame (a frozen video) is never analysed twice. Either clock moving means a
         * new frame: a browser may hold one of them still for a live camera. */
        const newFrame = (mediaTime: number, presented = -1) => {
          const fresh = mediaTime !== lastMediaTime || presented !== lastPresented;
          lastMediaTime = mediaTime;
          lastPresented = presented;
          log.current.callback(fresh);
          return fresh;
        };
        const schedule = () => {
          if (controller.signal.aborted) return;
          if (typeof element.requestVideoFrameCallback === 'function') {
            const id = element.requestVideoFrameCallback((now, metadata) => {
              if (newFrame(metadata.mediaTime, metadata.presentedFrames)) tick(now);
              else schedule();
            });
            cancelVideoFrame.current = () => element.cancelVideoFrameCallback(id);
          } else {
            frameId.current = requestAnimationFrame((now) => {
              if (newFrame(element.currentTime)) tick(now);
              else schedule();
            });
          }
        };
        const tick = (now: number) => {
          if (controller.signal.aborted) return;
          schedule();
          // Every new picture during a press counts, analysed or not: a press that saw none met
          // a stopped camera; one whose pictures were all skipped met a busy analysis.
          if (burst.current) burst.current.seen += 1;
          if (now - last < 120 || !element.videoWidth || !element.videoHeight) return;
          // One question at a time: while the last frame is being analysed, this one is skipped,
          // and the next video frame is tried as soon as the answer is in.
          if (analysis.busy || capturing.current) return;
          last = now;
          const intrinsic = { width: element.videoWidth, height: element.videoHeight };
          if (
            geometry.current &&
            (geometry.current.width !== intrinsic.width ||
              geometry.current.height !== intrinsic.height)
          ) {
            // A turned phone, not a broken camera: follow the new shape, and restart a page whose
            // photographs were taken in the old one.
            geometry.current = intrinsic;
            setSize(intrinsic);
            if (stageRef.current === 'track' || burst.current) actions.current.turned();
            return;
          }
          if (!geometry.current) {
            geometry.current = intrinsic;
            setSize(intrinsic);
          }
          // Chrome learns the light from an asynchronous query, so ask again until it is known.
          if (videoTrack && !lightKnown.current && hasTorch(videoTrack)) {
            lightKnown.current = true;
            setLight((value) => (value.available ? value : { available: true, on: false }));
          }
          if (stageRef.current !== 'aim' && stageRef.current !== 'track') return;
          const token = epoch.current;
          const current = (answer: { frame: Frame } | undefined, stage: Stage) =>
            !!answer &&
            token === epoch.current &&
            stageRef.current === stage &&
            !controller.signal.aborted;
          /** Each update re-arms the watch for the next; past the window the picture is stale. */
          const fresh = () => {
            updated(now);
            lastSample.current = now;
            clearTimeout(freshnessExpiry.current);
            freshnessExpiry.current = setTimeout(() => {
              hold.current = initialAlignment();
              setHoldSince(null);
              setQuality('lost');
            }, continuity());
          };
          try {
            if (stageRef.current === 'aim') {
              const bounds = dimensions(intrinsic.width, intrinsic.height, 360);
              const pending = burst.current;
              // During a press, the full picture waits on the GPU in case this frame is the best.
              const size = dimensions(intrinsic.width, intrinsic.height, 2560);
              const drawn = pending?.scratch;
              const full = drawn && holdFrame(drawn, element, size.width, size.height);
              const small = full
                ? full.small(bounds)
                : videoFrame(element, bounds.width, bounds.height);
              const asked = analysis.measure(small, (answer) => {
                log.current.answer(!!answer);
                if (!current(answer, 'aim')) return;
                aimed(answer!, now, intrinsic, pending, drawn);
                fresh();
              });
              if (asked) log.current.asked();
              if (asked && pending) pending.asked += 1;
              return;
            }
            const base = reference.current;
            if (!base) return;
            const asked = analysis.track(videoFrame(element, base.width, base.height), (answer) => {
              log.current.answer(!!answer);
              if (!current(answer, 'track')) return;
              fresh();
              tracked(answer!, now, intrinsic, base);
            });
            if (asked) log.current.asked();
          } catch (cause) {
            log.current.error(stageRef.current, cause);
            hold.current = initialAlignment();
            setHoldSince(null);
            setQuality('lost');
          }
        };
        /** What a measured frame tells the reader, and whether a press has found its photograph. */
        const aimed = (
          answer: Measured,
          now: number,
          intrinsic: { width: number; height: number },
          pending: typeof burst.current,
          drawn: HTMLCanvasElement | undefined,
        ) => {
          const { frame: small, quality: measured, sharp } = answer;
          recent.current = [...recent.current.slice(-3), measured];
          const next = advise(recent.current);
          setAdvice(next);
          // A notice stays long enough to be read, then yields to what the picture needs now.
          if (next !== 'blurry' && now - noticeAt.current > 2500) setNotice(undefined);
          setOutline(
            measured.page &&
              scalePoints(
                measured.page,
                intrinsic.width / small.width,
                intrinsic.height / small.height,
              ),
          );
          if (!pending || !drawn || burst.current !== pending || pending.scratch !== drawn) return;
          const candidate = { small, quality: measured, sharp };
          if (!better(candidate, pending.best)) return;
          // The better frame's canvas is kept and the old best's is drawn over next: no read-back
          // until the press settles.
          pending.scratch = pending.keep;
          pending.keep = drawn;
          pending.best = candidate;
          if (photographable(measured) && sharp >= TRACKABLE) actions.current.settleBurst();
        };
        /** Where the page is now: the dots follow it, and a steady hold takes the view. */
        const tracked = (
          answer: Tracked,
          now: number,
          intrinsic: { width: number; height: number },
          base: Frame,
        ) => {
          const { registration, frame: small } = answer;
          const sharp = answer.sharp >= TRACKABLE;
          const first = captures.current[0]!.frame;
          const points = registration
            ? targetPoints(cornersRef.current, { x: first.width / 2, y: first.height / 2 }).map(
                (point) =>
                  project(registration.matrix, {
                    x: (point.x * base.width) / first.width,
                    y: (point.y * base.height) / first.height,
                  }),
              )
            : [];
          // Lost frames keep the last dots, dimmed, so the way back to the red one stays shown.
          if (registration)
            setProjected(
              points.map((point) => ({
                x: (point.x * intrinsic.width) / small.width,
                y: (point.y * intrinsic.height) / small.height,
              })),
            );
          const index = captures.current.length - 1;
          hold.current = alignmentStep(hold.current, {
            now,
            point: points[index] ?? null,
            anchors: points,
            center: { x: small.width / 2, y: small.height / 2 },
            sharp,
            window: continuity(),
          });
          setHoldSince(hold.current.aligned ? hold.current.since : null);
          setQuality(
            !registration ? 'lost' : !sharp ? 'blurry' : hold.current.aligned ? 'hold' : 'align',
          );
          if (hold.current.ready) actions.current.captureView();
        };
        schedule();
      } catch (cause) {
        if (!controller.signal.aborted)
          actions.current.fail(
            cause instanceof DOMException &&
              ['NotAllowedError', 'SecurityError'].includes(cause.name)
              ? 'denied'
              : 'unavailable',
          );
      }
    };
    void run();
    return () => {
      controller.abort();
      session.current?.abort();
      cleanupTracks();
      stop();
      analysis.dispose();
      if (tracker.current === analysis) tracker.current = undefined;
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', interrupted);
      window.removeEventListener('popstate', interrupted);
    };
    // A new request explicitly starts a fresh camera session. No render may re-request permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // The camera moves on by itself (a burst settles, a view is taken): when the focused control
  // goes with the old stage, focus would fall to the page and Escape and Tab would stop working.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.contains(document.activeElement)) element.focus();
  }, [stage]);
  useEffect(() => {
    const element = dialog.current;
    element?.focus();
    const focus = (event: FocusEvent) => {
      if (element && !element.contains(event.target as Node)) element.focus();
    };
    document.addEventListener('focusin', focus);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('focusin', focus);
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    const frame = editing ? captures.current[0]?.frame : preview;
    if (frame && still.current) drawFrame(still.current, frame);
  }, [preview, editing]);
  useEffect(() => {
    if (!reviewFile || preview) {
      setNativePreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(reviewFile);
    setNativePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reviewFile, preview]);

  const updateCorner = (index: number, point: Point) => {
    const frame = captures.current[0]?.frame;
    if (!frame) return;
    const next = cornersRef.current.map((previous, i) =>
      i === index
        ? {
            x: Math.max(0, Math.min(frame.width - 1, point.x)),
            y: Math.max(0, Math.min(frame.height - 1, point.y)),
          }
        : previous,
    );
    cornersRef.current = next;
    setCorners(next);
    setReviewFile(undefined);
  };
  const cornerPointer = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    const frame = captures.current[0]!.frame;
    updateCorner(index, {
      x: ((event.clientX - bounds.left) / bounds.width) * frame.width,
      y: ((event.clientY - bounds.top) / bounds.height) * frame.height,
    });
  };
  const cornerKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const point = cornersRef.current[index]!;
    const step = event.shiftKey ? 20 : 2;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (delta) {
      event.preventDefault();
      updateCorner(index, { x: point.x + delta[0]!, y: point.y + delta[1]! });
    }
  };
  const keep = () => {
    if (!reviewFile || session.current?.signal.aborted) return;
    if (keptRef.current.length >= capacity) {
      setError('tooMany');
      return;
    }
    const next = [...keptRef.current, reviewFile];
    keptRef.current = next;
    setKept(next);
    captures.current = [];
    reference.current = undefined;
    move('kept');
  };
  const nativeCapture = async (files: File[]) => {
    const signal = session.current?.signal;
    if (!files.length) return;
    if (files.length + keptRef.current.length > capacity) {
      setError('tooMany');
      return;
    }
    try {
      const validated = await validateScanImages(files.map((file) => namedCapture(file)));
      if (signal?.aborted || signal !== session.current?.signal) return;
      const next = [...keptRef.current, ...validated];
      if (next.length > capacity) {
        setError('tooMany');
        return;
      }
      keptRef.current = next;
      setKept(next);
      setPreview(undefined);
      setReviewFile(validated.at(-1));
      setError(undefined);
      move('kept');
    } catch {
      if (!signal?.aborted) setError('processingFailed');
    }
  };
  const live = stage === 'aim' || stage === 'track';
  const showStill = stage === 'review' || stage === 'kept' || stage === 'processing';
  const displayFrame = editing ? captures.current[0]?.frame : preview;
  const ratio = displayFrame ? displayFrame.width / displayFrame.height : size.width / size.height;
  const cornerFrame = captures.current[0]?.frame;
  const cornersValid =
    !!cornerFrame && validCorners(corners, cornerFrame.width, cornerFrame.height);
  const reticle = Math.min(size.width, size.height) * 0.045;
  /** Too dark and the light is off: the light is the next step, so it carries the red. */
  const lightFirst = stage === 'aim' && advice === 'dark' && light.available && !light.on;
  const deviceCameraFirst = error === 'denied' || error === 'insecure';
  const status =
    stage === 'starting'
      ? t.starting
      : stage === 'aim'
        ? shooting
          ? t.hold
          : notice
            ? t[notice]
            : advice === 'dark'
              ? light.available
                ? t.dark
                : t.darkNoLight
              : advice === 'blurry'
                ? t.blurry
                : t.aim
        : stage === 'track'
          ? notice
            ? t[notice]
            : { align: t.align, hold: t.hold, lost: t.lost, blurry: t.moving }[quality]
          : stage === 'processing'
            ? t.processing
            : stage === 'review'
              ? editing
                ? t.corners
                : t.review
              : stage === 'kept'
                ? t.ready
                : t.title;
  // Each hint lasts only until the reader has done the thing it explains.
  const hint =
    stage === 'aim' && !kept.length && !pressed
      ? t.intro
      : stage === 'track' && target === 0 && !kept.length
        ? t.auto
        : stage === 'review' && editing
          ? t.cornerHint
          : stage === 'review' && blurryResult
            ? t.blurryResult
            : undefined;
  return createPortal(
    <div className="guided-camera-backdrop">
      <div
        ref={dialog}
        className="guided-camera"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key !== 'Tab') return;
          const items = Array.from(
            dialog.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
            ),
          ).filter((element) => !element.closest('[hidden]'));
          const first = items[0];
          const last = items.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="guided-camera-bar">
          <button className="camera-icon-button" onClick={close} aria-label={t.close}>
            <Icon name="close" />
          </button>
          <h2 id="camera-title" className="visually-hidden">
            {t.title}
          </h2>
          {live && (
            <p className="camera-step">
              {t.step(stage === 'aim' ? 1 : Math.min(PHOTOS, target + 2), PHOTOS)}
            </p>
          )}
          {live && light.available ? (
            <button
              className={`camera-icon-button${lightFirst ? ' is-red' : ''}`}
              aria-pressed={light.on}
              aria-label={t.light}
              data-attention={lightFirst}
              onClick={toggleLight}
            >
              <Icon name={light.on ? 'lightOn' : 'light'} />
            </button>
          ) : (
            <span className="camera-icon-space" aria-hidden="true" />
          )}
        </header>
        <div className="guided-camera-stage" hidden={stage === 'error' && !preview}>
          <div
            className="guided-camera-surface"
            style={{ '--ratio': ratio, aspectRatio: ratio } as CSSProperties}
          >
            <video
              ref={video}
              muted
              playsInline
              aria-hidden="true"
              className={showStill || stage === 'error' ? 'camera-video-concealed' : ''}
            />
            {showStill && preview && (
              <canvas
                ref={still}
                className={`camera-still${stage === 'processing' ? ' is-processing' : ''}`}
                aria-label={t.review}
              />
            )}
            {stage === 'kept' && nativePreviewUrl && (
              <img
                src={nativePreviewUrl}
                alt={t.review}
                onLoad={(event) =>
                  setSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
            )}
            {stage === 'aim' && outline && (
              <svg
                viewBox={`0 0 ${size.width} ${size.height}`}
                className="camera-tracking"
                aria-hidden="true"
              >
                <polygon
                  data-camera-page="true"
                  points={outline.map((point) => `${point.x},${point.y}`).join(' ')}
                />
              </svg>
            )}
            {stage === 'track' && (
              <svg
                viewBox={`0 0 ${size.width} ${size.height}`}
                className={`camera-tracking${quality === 'lost' ? ' is-lost' : ''}`}
                aria-hidden="true"
              >
                {projected[target] && (
                  <line
                    className="camera-guide"
                    x1={size.width / 2}
                    y1={size.height / 2}
                    x2={projected[target].x}
                    y2={projected[target].y}
                  />
                )}
                {projected.map((point, index) => (
                  <circle
                    key={index}
                    data-camera-target={index + 1}
                    data-complete={index < target}
                    cx={point.x}
                    cy={point.y}
                    r={Math.min(size.width, size.height) * (index === target ? 0.035 : 0.025)}
                    className={
                      index === target
                        ? 'is-red'
                        : index < target
                          ? 'camera-target-complete'
                          : 'camera-target'
                    }
                  />
                ))}
                <circle
                  data-camera-reticle="true"
                  data-holding={holdSince !== null}
                  cx={size.width / 2}
                  cy={size.height / 2}
                  r={reticle}
                />
                {holdSince !== null && (
                  <circle
                    key={holdSince}
                    className="camera-hold"
                    pathLength={1}
                    cx={size.width / 2}
                    cy={size.height / 2}
                    r={reticle * 1.45}
                    transform={`rotate(-90 ${size.width / 2} ${size.height / 2})`}
                    style={{ animationDuration: `${HOLD_MS}ms` }}
                  />
                )}
              </svg>
            )}
            {editing && displayFrame && (
              <div className="camera-corner-layer">
                <svg
                  viewBox={`0 0 ${displayFrame.width} ${displayFrame.height}`}
                  aria-hidden="true"
                >
                  <polygon points={corners.map((point) => `${point.x},${point.y}`).join(' ')} />
                </svg>
                {corners.map((point, index) => (
                  <button
                    key={index}
                    className="camera-corner"
                    style={{
                      left: `${(point.x / displayFrame.width) * 100}%`,
                      top: `${(point.y / displayFrame.height) * 100}%`,
                    }}
                    aria-label={t.cornerLabel(index + 1)}
                    aria-describedby="camera-corner-hint"
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => cornerPointer(event, index)}
                    onPointerUp={(event) => {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    onKeyDown={(event) => cornerKey(event, index)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            )}
            {flash > 0 && <div key={flash} className="camera-flash" aria-hidden="true" />}
          </div>
        </div>
        <div className="guided-camera-copy">
          <p role="status" aria-live="polite">
            {status}
          </p>
          {hint && (
            <p id={editing ? 'camera-corner-hint' : undefined} className="small">
              {hint}
            </p>
          )}
          {editing && !cornersValid && (
            <p role="alert" key={invalidPresses} className={invalidPresses ? 'is-repeated' : ''}>
              {t.invalidCorners}
            </p>
          )}
          {kept.length > 0 && <p className="small">{t.pageCount(kept.length)}</p>}
          {error && <p role="alert">{t[error]}</p>}
          {diagnosis && (
            <pre className="camera-debug">
              {diagnosisLines(diagnosis, video.current, stream.current?.getVideoTracks?.()[0]).join(
                '\n',
              )}
            </pre>
          )}
        </div>
        <div className="guided-camera-actions">
          {stage === 'starting' && (
            <button className="is-red" onClick={close}>
              {t.cancel}
            </button>
          )}
          {stage === 'aim' && (
            <button
              className={`camera-shutter${lightFirst ? '' : ' is-red'}${shooting ? ' is-shooting' : ''}`}
              aria-label={t.capture}
              aria-busy={shooting}
              onClick={shoot}
            />
          )}
          {stage === 'track' && (
            <>
              <button className="text-button" onClick={resetPage}>
                {t.startOver}
              </button>
              {canSkip && (
                <button className="text-button" onClick={() => void process()}>
                  {t.skip}
                </button>
              )}
            </>
          )}
          {stage === 'processing' && (
            <button className="is-red" onClick={resetPage}>
              {t.cancel}
            </button>
          )}
          {stage === 'review' && (
            <>
              <button className={blurryResult && !editing ? 'is-red' : ''} onClick={resetPage}>
                {t.retake}
              </button>
              {!editing && <button onClick={() => setEditing(true)}>{t.adjust}</button>}
              {/* The red button is never disabled: invalid corners are explained in the alert above. */}
              {editing ? (
                <button
                  className="is-red"
                  onClick={() => {
                    if (cornersValid) {
                      void process();
                      return;
                    }
                    // Answer the press: the alert is said again and the first corner takes focus.
                    setInvalidPresses((value) => value + 1);
                    dialog.current?.querySelector<HTMLButtonElement>('.camera-corner')?.focus();
                  }}
                >
                  {t.useCorners}
                </button>
              ) : (
                <button className={blurryResult ? '' : 'is-red'} onClick={keep}>
                  {t.keep}
                </button>
              )}
            </>
          )}
          {stage === 'kept' && (
            <>
              {kept.length < capacity && (
                <button
                  onClick={() => {
                    if (stream.current) resetPage();
                    else setRequest((value) => value + 1);
                  }}
                >
                  {t.nextPage}
                </button>
              )}
              <button className="is-red" onClick={finish}>
                {t.finish(kept.length)}
              </button>
            </>
          )}
          {stage === 'error' &&
            (kept.length < capacity ? (
              <>
                {/* A refused or insecure camera refuses again at once: then the device camera
                    is the way on, and the red. */}
                {deviceCameraFirst ? (
                  <button className="is-red" onClick={() => fallbackInput.current?.click()}>
                    {t.fallback}
                  </button>
                ) : (
                  <button className="is-red" onClick={() => setRequest((value) => value + 1)}>
                    {t.restart}
                  </button>
                )}
                <label className="text-button own-file" hidden={deviceCameraFirst}>
                  {t.fallback}
                  <input
                    ref={fallbackInput}
                    type="file"
                    className="visually-hidden"
                    capture="environment"
                    accept="image/jpeg,image/png"
                    aria-label={t.fallback}
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = '';
                      void nativeCapture(files);
                    }}
                  />
                </label>
                {kept.length > 0 && <button onClick={finish}>{t.finish(kept.length)}</button>}
              </>
            ) : (
              // Every page the batch can hold is kept: finishing is the one way on, and the red.
              kept.length > 0 && (
                <button className="is-red" onClick={finish}>
                  {t.finish(kept.length)}
                </button>
              )
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
