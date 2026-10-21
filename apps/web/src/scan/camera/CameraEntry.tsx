import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/i18n.js';
import { SCAN_PAGE_LIMIT } from '../model.js';
import { namedCapture } from '../phone.js';
import './entry.css';

const Camera = lazy(() => import('./GuidedCamera.js').then((m) => ({ default: m.GuidedCamera })));

class CameraLoadBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function LoadingCamera({
  failed = false,
  onClose,
  onFiles,
}: {
  failed?: boolean;
  onClose(): void;
  onFiles(files: File[]): void;
}) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return createPortal(
    <dialog
      open
      aria-modal="true"
      className="camera-loading stack"
      aria-label={t.scan.camera.title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Tab' && !failed) {
          e.preventDefault();
          cancel.current?.focus();
        }
      }}
    >
      <p role={failed ? 'alert' : 'status'}>
        {failed ? t.scan.camera.unavailable : t.scan.camera.starting}
      </p>
      {failed && (
        <label className="text-button own-file">
          {t.scan.camera.fallback}
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []).map((f) => namedCapture(f));
              e.currentTarget.value = '';
              if (files.length) onFiles(files);
            }}
          />
        </label>
      )}
      <button ref={cancel} className="is-red" onClick={onClose}>
        {t.scan.camera.cancel}
      </button>
    </dialog>,
    document.body,
  );
}

/** The camera runtime is downloaded only after the reader asks to photograph a page. */
export function CameraEntry({
  label,
  onFiles,
  maxPages = SCAN_PAGE_LIMIT,
  disabled = false,
}: {
  label: string;
  onFiles(files: File[]): void;
  maxPages?: number;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [overLimit, setOverLimit] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const latest = useRef({ onFiles, disabled, maxPages });
  latest.current = { onFiles, disabled, maxPages };
  const active = open && !disabled && maxPages > 0;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const root = document.getElementById('root');
    const previousFocus = trigger.current;
    const wasInert = root?.inert;
    if (root) root.inert = true;
    document.documentElement.classList.add('has-guided-camera');
    return () => {
      document.documentElement.classList.remove('has-guided-camera');
      if (root) root.inert = wasInert ?? false;
      previousFocus?.focus();
    };
  }, [active]);
  useEffect(() => {
    if (disabled || maxPages < 1) setOpen(false);
  }, [disabled, maxPages]);
  const close = () => setOpen(false);
  const complete = (files: File[]) => {
    const current = latest.current;
    if (!alive.current || current.disabled) return;
    if (files.length > current.maxPages) {
      setOverLimit(true);
      close();
      return;
    }
    close();
    if (files.length) current.onFiles(files);
  };
  return (
    <>
      <button
        ref={trigger}
        className="text-button own-file"
        disabled={disabled || maxPages < 1}
        onClick={() => {
          setOverLimit(false);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {/* Native capture remains an available fallback, including older mobile browsers. */}
      <input
        hidden
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        aria-label={t.scan.camera.fallback}
        disabled={disabled || maxPages < 1}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []).map((f) => namedCapture(f));
          e.currentTarget.value = '';
          complete(files);
        }}
      />
      {overLimit && <span role="alert">{t.scan.files.pageLimit}</span>}
      {active && (
        <CameraLoadBoundary fallback={<LoadingCamera failed onClose={close} onFiles={complete} />}>
          <Suspense fallback={<LoadingCamera onClose={close} onFiles={complete} />}>
            <Camera maxPages={maxPages} onClose={close} onComplete={complete} />
          </Suspense>
        </CameraLoadBoundary>
      )}
    </>
  );
}
