import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/i18n.js';
import { SCAN_LIMIT, validateScanImages } from '../model.js';
import { namedCapture } from '../phone.js';
import {
  alignmentStep,
  initialAlignment,
  scaledMatrix,
  targetPoints,
  validView,
  validCorners,
} from './captureState.js';
import {
  mergeCaptures,
  project,
  registerFrame,
  sharpness,
  type Capture,
  type Frame,
  type Matrix,
  type Point,
} from './vision.js';
import './camera.css';

type Stage =
  'starting' | 'frame' | 'reference' | 'track' | 'processing' | 'review' | 'kept' | 'error';
type CameraError =
  'denied' | 'insecure' | 'unavailable' | 'interrupted' | 'processingFailed' | 'tooMany';
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

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

/** The live video and its SVG share the same contained aspect ratio, including letterboxing. */
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
  const [aligned, setAligned] = useState(false);
  const [quality, setQuality] = useState<'align' | 'hold' | 'lost' | 'blurry'>('align');
  const [referenceReady, setReferenceReady] = useState(false);
  const [referenceSampled, setReferenceSampled] = useState(false);
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
  const frameId = useRef(0);
  const cancelVideoFrame = useRef<(() => void) | undefined>(undefined);
  const freshnessExpiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSample = useRef(-Infinity);
  const capacity = Math.max(0, Math.min(20, Math.floor(maxPages)));

  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    if (video.current) video.current.srcObject = null;
    cancelAnimationFrame(frameId.current);
    cancelVideoFrame.current?.();
    cancelVideoFrame.current = undefined;
    clearTimeout(freshnessExpiry.current);
    operation.current?.abort();
    hold.current = initialAlignment();
    captures.current = [];
    reference.current = undefined;
  };
  const fail = (reason: CameraError) => {
    stop();
    setError(reason);
    setAligned(false);
    setPreview(undefined);
    setReviewFile(undefined);
    setReferenceSampled(false);
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
    captures.current = [];
    reference.current = undefined;
    hold.current = initialAlignment();
    setTarget(0);
    setAligned(false);
    setEditing(false);
    setPreview(undefined);
    setReviewFile(undefined);
    setReferenceReady(false);
    setReferenceSampled(false);
    setProjected([]);
    setError(undefined);
    move(stream.current ? 'frame' : 'error');
  };
  const process = async () => {
    if (captures.current.length !== 5 || session.current?.signal.aborted) return;
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    move('processing');
    setEditing(false);
    setError(undefined);
    try {
      const result = await mergeCaptures(captures.current, cornersRef.current, controller.signal);
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
      setAligned(false);
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
      const registration = registerFrame(base, small);
      const index = captures.current.length - 1;
      const point = targetPoints(cornersRef.current)[index]!;
      const matrix =
        registration &&
        scaledMatrix(registration.matrix, first.width / base.width, first.height / base.height);
      const valid = validView({
        matrix,
        previous: captures.current.map((capture) => capture.matrix),
        target: point,
        center: { x: first.width / 2, y: first.height / 2 },
        sharp: sharpness(small) >= 80,
      });
      hold.current = initialAlignment();
      setAligned(false);
      if (!valid || !matrix) {
        setQuality('lost');
        return;
      }
      captures.current.push({ frame, matrix });
      if (captures.current.length === 5) void process();
      else {
        setTarget(index + 1);
        setQuality('align');
      }
    } catch {
      hold.current = initialAlignment();
      setAligned(false);
      setQuality('lost');
    }
  };
  const captureReference = () => {
    const element = video.current;
    if (!element || !referenceReady || stageRef.current !== 'frame') return;
    if (performance.now() - lastSample.current > 350) {
      setReferenceReady(false);
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
      const bounds = dimensions(element.videoWidth, element.videoHeight, 2560);
      const frame = videoFrame(element, bounds.width, bounds.height);
      const low = trackingFrame(frame);
      if (sharpness(low) < 80) {
        setReferenceReady(false);
        return;
      }
      reference.current = low;
      captures.current = [{ frame, matrix: IDENTITY }];
      hold.current = initialAlignment();
      setTarget(0);
      setProjected([]);
      const quad = [
        { x: bounds.width * 0.05, y: bounds.height * 0.05 },
        { x: bounds.width * 0.95, y: bounds.height * 0.05 },
        { x: bounds.width * 0.95, y: bounds.height * 0.95 },
        { x: bounds.width * 0.05, y: bounds.height * 0.95 },
      ];
      cornersRef.current = quad;
      setCorners(quad);
      setPreview(frame);
      setEditing(true);
      move('reference');
    } catch {
      fail('unavailable');
    }
  };

  const actions = useRef({ captureView, fail });
  useEffect(() => {
    actions.current = { captureView, fail };
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
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
        });
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
        move('frame');
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
          }
          if (stageRef.current !== 'frame' && stageRef.current !== 'track') return;
          lastSample.current = performance.now();
          clearTimeout(freshnessExpiry.current);
          freshnessExpiry.current = setTimeout(() => {
            hold.current = initialAlignment();
            setAligned(false);
            setReferenceReady(false);
            setQuality('lost');
          }, 350);
          try {
            const base = reference.current;
            const bounds = base
              ? { width: base.width, height: base.height }
              : dimensions(intrinsic.width, intrinsic.height, 360);
            const current = videoFrame(element, bounds.width, bounds.height);
            const sharp = sharpness(current) >= 80;
            if (stageRef.current === 'frame') {
              setReferenceReady(sharp);
              setReferenceSampled(true);
              setQuality(sharp ? 'align' : 'blurry');
              return;
            }
            if (!base) return;
            const registration = registerFrame(base, current);
            const first = captures.current[0]!.frame;
            const points = registration
              ? targetPoints(cornersRef.current).map((point) =>
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
            setAligned(hold.current.aligned);
            setQuality(
              !registration ? 'lost' : !sharp ? 'blurry' : hold.current.aligned ? 'hold' : 'align',
            );
            if (hold.current.ready) actions.current.captureView();
          } catch {
            hold.current = initialAlignment();
            setAligned(false);
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
  const showStill =
    stage === 'reference' || stage === 'review' || stage === 'kept' || stage === 'processing';
  const displayFrame = editing ? captures.current[0]?.frame : preview;
  const ratio = displayFrame ? displayFrame.width / displayFrame.height : size.width / size.height;
  const cornerFrame = captures.current[0]?.frame;
  const cornersValid =
    !!cornerFrame && validCorners(corners, cornerFrame.width, cornerFrame.height);
  const heading =
    stage === 'reference'
      ? t.corners
      : stage === 'review'
        ? t.review
        : stage === 'processing'
          ? t.processing
          : stage === 'kept'
            ? t.ready
            : t.title;
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
        <header className="guided-camera-header">
          <h2 id="camera-title">{t.title}</h2>
          <button className="text-button" onClick={close} aria-label={t.close}>
            ×
          </button>
        </header>
        <div
          className="guided-camera-surface"
          style={{ aspectRatio: ratio, width: `min(100%, ${60 * ratio}dvh)` }}
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
          {stage === 'track' && (
            <svg
              viewBox={`0 0 ${size.width} ${size.height}`}
              className="camera-tracking"
              aria-hidden="true"
            >
              {projected.map((point, index) => (
                <circle
                  key={index}
                  data-camera-target={index + 1}
                  data-complete={index < target}
                  cx={point.x}
                  cy={point.y}
                  r={Math.min(size.width, size.height) * 0.035}
                  className={
                    index === target
                      ? 'camera-target-current'
                      : index < target
                        ? 'camera-target-complete'
                        : 'camera-target'
                  }
                />
              ))}
              <circle
                data-camera-reticle="true"
                cx={size.width / 2}
                cy={size.height / 2}
                r={Math.min(size.width, size.height) * 0.045}
              />
            </svg>
          )}
          {editing && displayFrame && (
            <div className="camera-corner-layer">
              <svg viewBox={`0 0 ${displayFrame.width} ${displayFrame.height}`} aria-hidden="true">
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
        </div>
        <div className="guided-camera-copy">
          <p role="status" aria-live="polite">
            {stage === 'track'
              ? `${t.progress(target + 1)} · ${t[quality]}`
              : stage === 'frame'
                ? referenceSampled && !referenceReady
                  ? t[quality === 'lost' ? 'lost' : 'blurry']
                  : t.frame
                : stage === 'starting'
                  ? t.starting
                  : heading}
          </p>
          {editing && (
            <p id="camera-corner-hint" className="small muted">
              {t.cornerHint}
            </p>
          )}
          {editing && !cornersValid && <p role="alert">{t.invalidCorners}</p>}
          {(stage === 'frame' || stage === 'track') && <p className="small muted">{t.keepFlat}</p>}
          {kept.length > 0 && <p className="small muted">{t.pageCount(kept.length)}</p>}
          {error && <p role="alert">{t[error]}</p>}
        </div>
        <div className="guided-camera-actions">
          {stage === 'starting' && (
            <button className="is-red" onClick={close}>
              {t.cancel}
            </button>
          )}
          {stage === 'frame' && (
            <button className="is-red" onClick={captureReference} disabled={!referenceReady}>
              {t.reference}
            </button>
          )}
          {stage === 'reference' && (
            <>
              <button onClick={resetPage}>{t.retake}</button>
              <button
                className="is-red"
                disabled={!cornersValid}
                onClick={() => {
                  setEditing(false);
                  hold.current = initialAlignment();
                  move('track');
                }}
              >
                {t.useCorners}
              </button>
            </>
          )}
          {stage === 'track' && (
            <>
              <button className="text-button" onClick={resetPage}>
                {t.retake}
              </button>
              <button className="is-red" disabled={!aligned} onClick={captureView}>
                {t.capture}
              </button>
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
              {!editing && <button onClick={() => setEditing(true)}>{t.corners}</button>}
              {editing ? (
                <button className="is-red" disabled={!cornersValid} onClick={() => void process()}>
                  {t.useCorners}
                </button>
              ) : (
                <button className="is-red" onClick={keep} disabled={!reviewFile}>
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
              <button
                className="is-red"
                onClick={() => setRequest((value) => value + 1)}
                disabled={!capacity}
              >
                {t.restart}
              </button>
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
