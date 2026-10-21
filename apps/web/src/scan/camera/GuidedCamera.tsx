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
  HOLD_MS,
  initialAlignment,
  scaledMatrix,
  targetPoints,
  validView,
  validCorners,
} from './captureState.js';
import {
  CAMERA_CONSTRAINTS,
  focusContinuously,
  hasTorch,
  releaseCamera,
  setTorch,
  tick as haptic,
} from './device.js';
import { advise, measureFrame, photographable, type Advice, type FrameQuality } from './quality.js';
import {
  project,
  reconstructPage,
  registerFrame,
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
function videoFrame(video: HTMLVideoElement, width: number, height: number): Frame {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(video, 0, 0, width, height);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    canvas.width = canvas.height = 0;
  }
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
function trackingFrame(frame: Frame): Frame {
  const full = document.createElement('canvas');
  const small = document.createElement('canvas');
  try {
    drawFrame(full, frame);
    const size = dimensions(frame.width, frame.height, 360);
    small.width = size.width;
    small.height = size.height;
    const context = small.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(full, 0, 0, size.width, size.height);
    return { ...size, data: context.getImageData(0, 0, size.width, size.height).data };
  } finally {
    full.width = full.height = small.width = small.height = 0;
  }
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

interface Candidate {
  frame: Frame;
  small: Frame;
  quality: FrameQuality;
  sharp: number;
}
/** A frame registration can track beats one it cannot; then the crisper one wins. */
function better(a: Omit<Candidate, 'frame'>, b: Candidate | undefined) {
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
  const [notice, setNotice] = useState<'retryBlurry'>();
  const [blurryResult, setBlurryResult] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [flash, setFlash] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const [light, setLight] = useState({ available: false, on: false });
  const lightRef = useRef(false);
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
  const burst = useRef<{ best?: Candidate; timer: ReturnType<typeof setTimeout> } | undefined>(
    undefined,
  );
  const blurryAttempts = useRef(0);
  const noticeAt = useRef(-Infinity);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frameId = useRef(0);
  const cancelVideoFrame = useRef<(() => void) | undefined>(undefined);
  const freshnessExpiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSample = useRef(-Infinity);
  const capacity = Math.max(0, Math.min(20, Math.floor(maxPages)));

  const endBurst = () => {
    clearTimeout(burst.current?.timer);
    burst.current = undefined;
    setShooting(false);
  };
  const stop = () => {
    releaseCamera(stream.current, lightRef.current);
    stream.current = undefined;
    lightRef.current = false;
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
  const fail = (reason: CameraError) => {
    stop();
    setError(reason);
    setHoldSince(null);
    setPreview(undefined);
    setReviewFile(undefined);
    setNotice(undefined);
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
    clearTimeout(skipTimer.current);
    endBurst();
    captures.current = [];
    reference.current = undefined;
    hold.current = initialAlignment();
    recent.current = [];
    blurryAttempts.current = 0;
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
    setError(undefined);
    move(stream.current ? 'aim' : 'error');
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
  const captureView = () => {
    const element = video.current;
    const base = reference.current;
    if (
      stageRef.current !== 'track' ||
      !element ||
      !base ||
      !hold.current.aligned ||
      session.current?.signal.aborted
    )
      return;
    if (performance.now() - lastSample.current > 350) {
      hold.current = initialAlignment();
      setHoldSince(null);
      return;
    }
    if (
      element.videoWidth !== geometry.current?.width ||
      element.videoHeight !== geometry.current?.height
    ) {
      fail('interrupted');
      return;
    }
    try {
      const first = captures.current[0]!.frame;
      const frame = videoFrame(element, first.width, first.height);
      const small = trackingFrame(frame);
      const region = cornersRef.current.map((point) => ({
        x: (point.x * base.width) / first.width,
        y: (point.y * base.height) / first.height,
      }));
      const registration = registerFrame(base, small, region);
      const index = captures.current.length - 1;
      const point = targetPoints(cornersRef.current, { x: first.width / 2, y: first.height / 2 })[
        index
      ]!;
      const matrix =
        registration &&
        scaledMatrix(registration.matrix, first.width / base.width, first.height / base.height);
      const valid = validView({
        matrix,
        previous: captures.current.map((capture) => capture.matrix),
        target: point,
        center: { x: first.width / 2, y: first.height / 2 },
        sharp: sharpness(small) >= TRACKABLE,
      });
      hold.current = initialAlignment();
      setHoldSince(null);
      if (!valid || !matrix) {
        setQuality('lost');
        return;
      }
      captures.current.push({ frame, matrix });
      captured();
      if (captures.current.length === PHOTOS) void process();
      else {
        setTarget(index + 1);
        setQuality('align');
        armSkip();
      }
    } catch {
      hold.current = initialAlignment();
      setHoldSince(null);
      setQuality('lost');
    }
  };
  /** The sharpest frame of the burst becomes the page's reference, or the reader is told why not. */
  const settleBurst = () => {
    const element = video.current;
    let best = burst.current?.best;
    endBurst();
    if (stageRef.current !== 'aim' || session.current?.signal.aborted || !element) return;
    try {
      if (!best) {
        // No new frame reached the page during the burst: photograph what the camera shows now.
        const bounds = dimensions(element.videoWidth, element.videoHeight, 2560);
        const frame = videoFrame(element, bounds.width, bounds.height);
        const small = trackingFrame(frame);
        best = { frame, small, quality: measureFrame(small), sharp: sharpness(small) };
      }
    } catch {
      fail('unavailable');
      return;
    }
    const { frame, small, quality: q } = best;
    const page =
      q.page && scalePoints(q.page, frame.width / small.width, frame.height / small.height);
    const quad =
      page && validCorners(page, frame.width, frame.height)
        ? page
        : insetCorners(frame.width, frame.height);
    cornersRef.current = quad;
    setCorners(quad);
    captured();
    if (best.sharp < TRACKABLE) {
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
      void process();
      return;
    }
    blurryAttempts.current = 0;
    reference.current = small;
    captures.current = [{ frame, matrix: IDENTITY }];
    hold.current = initialAlignment();
    setNotice(undefined);
    setTarget(0);
    setProjected([]);
    setQuality('align');
    move('track');
    armSkip();
  };
  const shoot = () => {
    if (stageRef.current !== 'aim' || burst.current || session.current?.signal.aborted) return;
    setNotice(undefined);
    setShooting(true);
    burst.current = { timer: setTimeout(() => actions.current.settleBurst(), BURST_MS) };
  };
  const toggleLight = () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !lightRef.current;
    void setTorch(track, on).then((ok) => {
      if (!ok || stream.current?.getVideoTracks()[0] !== track) return;
      lightRef.current = on;
      setLight({ available: true, on });
    });
  };

  const actions = useRef({ captureView, fail, settleBurst });
  useEffect(() => {
    actions.current = { captureView, fail, settleBurst };
  });
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    operation.current = new AbortController();
    move('starting');
    setError(undefined);
    geometry.current = undefined;
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
    window.addEventListener('orientationchange', interrupted);
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
        if (videoTrack) focusContinuously(videoTrack);
        setLight({ available: hasTorch(videoTrack), on: false });
        move('aim');
        let last = -Infinity;
        let lastMediaTime = -Infinity;
        const schedule = () => {
          if (controller.signal.aborted) return;
          if (typeof element.requestVideoFrameCallback === 'function') {
            const id = element.requestVideoFrameCallback((now, metadata) => {
              if (metadata.mediaTime === lastMediaTime) {
                schedule();
                return;
              }
              lastMediaTime = metadata.mediaTime;
              tick(now);
            });
            cancelVideoFrame.current = () => element.cancelVideoFrameCallback(id);
          } else {
            frameId.current = requestAnimationFrame((now) => {
              if (element.currentTime === lastMediaTime) {
                schedule();
                return;
              }
              lastMediaTime = element.currentTime;
              tick(now);
            });
          }
        };
        const tick = (now: number) => {
          if (controller.signal.aborted) return;
          schedule();
          if (now - last < 120 || !element.videoWidth || !element.videoHeight) return;
          last = now;
          const intrinsic = { width: element.videoWidth, height: element.videoHeight };
          if (
            geometry.current &&
            (geometry.current.width !== intrinsic.width ||
              geometry.current.height !== intrinsic.height)
          ) {
            interrupted();
            return;
          }
          if (!geometry.current) {
            geometry.current = intrinsic;
            setSize(intrinsic);
            // Some phones report the light only once frames flow.
            if (videoTrack && hasTorch(videoTrack))
              setLight((value) => (value.available ? value : { available: true, on: false }));
          }
          if (stageRef.current !== 'aim' && stageRef.current !== 'track') return;
          lastSample.current = performance.now();
          clearTimeout(freshnessExpiry.current);
          freshnessExpiry.current = setTimeout(() => {
            hold.current = initialAlignment();
            setHoldSince(null);
            setQuality('lost');
          }, 350);
          try {
            const base = reference.current;
            if (stageRef.current === 'aim') {
              const bounds = dimensions(intrinsic.width, intrinsic.height, 360);
              const current = videoFrame(element, bounds.width, bounds.height);
              const measured = measureFrame(current);
              recent.current = [...recent.current.slice(-3), measured];
              const next = advise(recent.current);
              setAdvice(next);
              // A notice stays long enough to be read, then yields to what the picture needs now.
              if (next !== 'blurry' && now - noticeAt.current > 2500) setNotice(undefined);
              setOutline(
                measured.page &&
                  scalePoints(
                    measured.page,
                    intrinsic.width / current.width,
                    intrinsic.height / current.height,
                  ),
              );
              const pending = burst.current;
              if (!pending) return;
              const candidate = { small: current, quality: measured, sharp: sharpness(current) };
              if (!better(candidate, pending.best)) return;
              const full = dimensions(intrinsic.width, intrinsic.height, 2560);
              const frame = videoFrame(element, full.width, full.height);
              const small = trackingFrame(frame);
              pending.best = { frame, small, quality: measured, sharp: sharpness(small) };
              if (photographable(measured) && pending.best.sharp >= TRACKABLE)
                actions.current.settleBurst();
              return;
            }
            if (!base) return;
            const current = videoFrame(element, base.width, base.height);
            const sharp = sharpness(current) >= TRACKABLE;
            const first = captures.current[0]!.frame;
            const region = cornersRef.current.map((point) => ({
              x: (point.x * base.width) / first.width,
              y: (point.y * base.height) / first.height,
            }));
            const registration = registerFrame(base, current, region);
            const points = registration
              ? targetPoints(cornersRef.current, { x: first.width / 2, y: first.height / 2 }).map(
                  (point) =>
                    project(registration.matrix, {
                      x: (point.x * base.width) / first.width,
                      y: (point.y * base.height) / first.height,
                    }),
                )
              : [];
            setProjected(
              points.map((point) => ({
                x: (point.x * intrinsic.width) / current.width,
                y: (point.y * intrinsic.height) / current.height,
              })),
            );
            const index = captures.current.length - 1;
            hold.current = alignmentStep(hold.current, {
              now,
              point: points[index] ?? null,
              anchors: points,
              center: { x: current.width / 2, y: current.height / 2 },
              sharp,
            });
            setHoldSince(hold.current.aligned ? hold.current.since : null);
            setQuality(
              !registration ? 'lost' : !sharp ? 'blurry' : hold.current.aligned ? 'hold' : 'align',
            );
            if (hold.current.ready) actions.current.captureView();
          } catch {
            hold.current = initialAlignment();
            setHoldSince(null);
            setQuality('lost');
          }
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
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', interrupted);
      window.removeEventListener('popstate', interrupted);
      window.removeEventListener('orientationchange', interrupted);
    };
    // A new request explicitly starts a fresh camera session. No render may re-request permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

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
    if (!reviewFile || keptRef.current.length >= capacity || session.current?.signal.aborted)
      return;
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
          ? { align: t.align, hold: t.hold, lost: t.lost, blurry: t.moving }[quality]
          : stage === 'processing'
            ? t.processing
            : stage === 'review'
              ? editing
                ? t.corners
                : t.review
              : stage === 'kept'
                ? t.ready
                : t.title;
  const hint =
    stage === 'aim' && !kept.length
      ? t.intro
      : stage === 'track'
        ? t.keepFlat
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
              className="camera-icon-button"
              aria-pressed={light.on}
              aria-label={t.light}
              data-attention={advice === 'dark' && !light.on && stage === 'aim'}
              onClick={toggleLight}
            >
              <Icon name={light.on ? 'lightOn' : 'light'} />
            </button>
          ) : (
            <span className="camera-icon-space" aria-hidden="true" />
          )}
        </header>
        <div className="guided-camera-stage">
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
              <canvas ref={still} className="camera-still" aria-label={t.review} />
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
                className="camera-tracking"
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
                    r={reticle}
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
          {editing && !cornersValid && <p role="alert">{t.invalidCorners}</p>}
          {kept.length > 0 && <p className="small">{t.pageCount(kept.length)}</p>}
          {error && <p role="alert">{t[error]}</p>}
        </div>
        <div className="guided-camera-actions">
          {stage === 'starting' && (
            <button className="is-red" onClick={close}>
              {t.cancel}
            </button>
          )}
          {stage === 'aim' && (
            <button
              className={`camera-shutter is-red${shooting ? ' is-shooting' : ''}`}
              aria-label={t.capture}
              aria-busy={shooting}
              onClick={shoot}
            />
          )}
          {stage === 'track' && (
            <>
              <button className="text-button" onClick={resetPage}>
                {t.retake}
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
              <button onClick={resetPage}>{t.retake}</button>
              {!editing && <button onClick={() => setEditing(true)}>{t.adjust}</button>}
              {/* The red button is never disabled: invalid corners are explained in the alert above. */}
              {editing ? (
                <button
                  className="is-red"
                  onClick={() => {
                    if (cornersValid) void process();
                  }}
                >
                  {t.useCorners}
                </button>
              ) : (
                <button className="is-red" onClick={keep}>
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
          {stage === 'error' && (
            <>
              {capacity > 0 && (
                <button className="is-red" onClick={() => setRequest((value) => value + 1)}>
                  {t.restart}
                </button>
              )}
              <label className="text-button own-file">
                {t.fallback}
                <input
                  type="file"
                  className="visually-hidden"
                  capture="environment"
                  accept="image/jpeg,image/png"
                  disabled={kept.length >= capacity}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    void nativeCapture(files);
                  }}
                />
              </label>
              {kept.length > 0 && <button onClick={finish}>{t.finish(kept.length)}</button>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
