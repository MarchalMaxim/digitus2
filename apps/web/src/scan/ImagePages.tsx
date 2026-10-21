import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { messageOf } from '../app/errors.js';
import { useT } from '../i18n/i18n.js';
import type { Phrase } from '../i18n/messages.js';
import { SCAN_PAGE_LIMIT, validateScanImages, type ScanPage } from './model.js';
import { CameraEntry } from './camera/CameraEntry.js';
import { rotateScanPage } from './rotation.js';

export function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
/** The page tools' symbols, drawn in the text colour. */
function ToolIcon({ name }: { name: 'rotate' | 'earlier' | 'later' | 'remove' }) {
  const paths = {
    rotate: 'M17 4v4.5h-4.5M16.6 8.4A7 7 0 1 0 17 13',
    earlier: 'M15 5l-7 7 7 7',
    later: 'M9 5l7 7-7 7',
    remove: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5',
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Thumbnail({ file }: { file: File }) {
  const url = useBlobUrl(file);
  return <img src={url} alt="" />;
}

/** Original bytes stay in memory; arranging pages never resubmits a successful recognition. */
export function ImagePages({
  pages,
  editable,
  busy,
  selected,
  onSelect,
  onChange,
  onRotating,
  camera = false,
}: {
  pages: ScanPage[];
  editable: boolean;
  busy: boolean;
  /** A touch-only device: adding a page opens the camera first. */
  camera?: boolean;
  selected: number;
  onSelect(index: number): void;
  onChange(pages: ScanPage[]): void;
  onRotating?(value: boolean): void;
}) {
  const t = useT();
  const [error, setErrorPhrase] = useState<Phrase | null>(null);
  // A phrase is a function, which useState would call as an update.
  const setError = (phrase: Phrase | null) => {
    setErrorPhrase(() => phrase);
  };
  const [rotating, setRotating] = useState(false);
  const rotation = useRef<AbortController | undefined>(undefined);
  const dragged = useRef<string | undefined>(undefined);
  const latest = useRef({ pages, busy, editable, onChange, onRotating });
  const alive = useRef(true);
  useLayoutEffect(() => {
    latest.current = { pages, busy, editable, onChange, onRotating };
    if (rotation.current && (!editable || busy)) rotation.current.abort();
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      rotation.current?.abort();
      latest.current.onRotating?.(false);
    };
  }, []);
  const selectedPage = pages[selected] ?? pages[0]!;
  const url = useBlobUrl(selectedPage.file);
  const rotate = async () => {
    if (busy || rotation.current || !editable) return;
    const controller = new AbortController();
    rotation.current = controller;
    setRotating(true);
    onRotating?.(true);
    setError(null);
    try {
      const next = await rotateScanPage(selectedPage, controller.signal);
      const current = latest.current;
      if (!alive.current || controller.signal.aborted || current.busy || !current.editable) return;
      const index = current.pages.findIndex((page) => page.id === selectedPage.id);
      // A removal or replacement must not resurrect a page or overwrite newer edits.
      if (index < 0 || current.pages[index]!.file !== selectedPage.file) return;
      current.onChange(current.pages.map((page, i) => (i === index ? next : page)));
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError((tt) => messageOf(cause, tt));
    } finally {
      rotation.current = undefined;
      if (alive.current) {
        setRotating(false);
        latest.current.onRotating?.(false);
      }
    }
  };
  const move = (from: number, to: number) => {
    if (busy || rotating || from < 0 || to < 0 || to >= pages.length || from === to) return;
    const reordered = [...pages];
    const [item] = reordered.splice(from, 1);
    reordered.splice(to, 0, item!);
    onChange(reordered);
    onSelect(to);
  };
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    appendFiles(files);
  };
  const appendFiles = (files: File[]) => {
    if (!files.length) return;
    void validateScanImages(files).then(
      (validated) => {
        if (!alive.current) return;
        const current = latest.current;
        if (current.busy || !current.editable) {
          setError((tt) => tt.scan.pages.finishFirst);
          return;
        }
        if (current.pages.length + validated.length > SCAN_PAGE_LIMIT) {
          setError((tt) => tt.scan.files.pageLimit);
          return;
        }
        setError(null);
        current.onChange([
          ...current.pages,
          ...validated.map((file) => ({ id: crypto.randomUUID(), file })),
        ]);
      },
      (cause: unknown) => {
        if (alive.current) setError((tt) => messageOf(cause, tt));
      },
    );
  };
  return (
    <div className="stack image-pages">
      {pages.length > 1 && (
        <>
          <p className="small muted">
            {editable
              ? camera
                ? t.scan.pages.arrangeTouch
                : t.scan.pages.arrange
              : t.scan.pages.originalCount(pages.length)}
          </p>
          <ol className="scan-page-list" aria-label={t.scan.pages.listLabel}>
            {pages.map((page, index) => (
              <li
                key={page.id}
                draggable={editable && !busy && !rotating}
                onDragStart={(event) => {
                  dragged.current = page.id;
                  event.dataTransfer.setData('text/plain', page.id);
                }}
                onDragOver={(event) => {
                  if (editable && !busy && dragged.current) event.preventDefault();
                }}
                onDragEnd={() => {
                  dragged.current = undefined;
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged.current && editable)
                    move(
                      pages.findIndex((p) => p.id === dragged.current),
                      index,
                    );
                  dragged.current = undefined;
                }}
              >
                <button
                  className="scan-thumbnail"
                  aria-pressed={selected === index}
                  onClick={() => onSelect(index)}
                  aria-label={t.scan.pages.select(index + 1, (page.originalFile ?? page.file).name)}
                >
                  <Thumbnail file={page.file} />
                  <span>{index + 1}</span>
                </button>
                <span className="scan-page-caption">
                  {(page.originalFile ?? page.file).name}
                  {/* A phone cannot scan, so it never says a page is ready to. */}
                  {!camera && (
                    <small>
                      {page.error
                        ? t.scan.pages.needsRetry
                        : page.xml
                          ? t.scan.pages.recognized
                          : t.scan.pages.ready}
                    </small>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {editable && (
        <div className="stack scan-page-edit">
          {/* One row of tools for the selected page: universal symbols, each named for screen
              readers, so the row fits a phone held in one hand. */}
          <div className="row scan-page-tools">
            <button
              className="scan-tool"
              disabled={busy || rotating}
              aria-label={t.scan.pages.rotate}
              title={t.scan.pages.rotate}
              onClick={() => {
                void rotate();
              }}
            >
              <ToolIcon name="rotate" />
            </button>
            {pages.length > 1 && (
              <>
                <button
                  className="scan-tool"
                  disabled={busy || rotating || selected === 0}
                  onClick={() => move(selected, selected - 1)}
                  aria-label={t.scan.pages.moveEarlierLabel(selected + 1)}
                  title={t.scan.pages.moveEarlier}
                >
                  <ToolIcon name="earlier" />
                </button>
                <button
                  className="scan-tool"
                  disabled={busy || rotating || selected === pages.length - 1}
                  onClick={() => move(selected, selected + 1)}
                  aria-label={t.scan.pages.moveLaterLabel(selected + 1)}
                  title={t.scan.pages.moveLater}
                >
                  <ToolIcon name="later" />
                </button>
                <button
                  className="scan-tool"
                  disabled={busy}
                  onClick={() => {
                    onChange(pages.filter((p) => p.id !== selectedPage.id));
                    onSelect(Math.max(0, selected - 1));
                  }}
                  aria-label={t.scan.pages.removeLabel(selected + 1)}
                  title={t.scan.pages.remove}
                >
                  <ToolIcon name="remove" />
                </button>
              </>
            )}
            {rotating && (
              <button onClick={() => rotation.current?.abort()}>
                {t.scan.pages.cancelRotation}
              </button>
            )}
          </div>
          {rotating && <p role="status">{t.scan.pages.rotating}</p>}
          <div className="row">
            {camera && (
              <CameraEntry
                label={t.scan.phone.takeAnother}
                disabled={busy || rotating}
                maxPages={SCAN_PAGE_LIMIT - pages.length}
                onFiles={appendFiles}
              />
            )}
            <label className={`text-button own-file${busy ? ' is-disabled' : ''}`}>
              {t.scan.pages.addImages}
              <input
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,image/jpeg,image/png"
                className="visually-hidden"
                disabled={busy}
                onChange={(event) => addFiles(event)}
              />
            </label>
          </div>
          {error && <p role="alert">{error(t)}</p>}
        </div>
      )}
      {selectedPage.error && (
        <p role="status">{t.scan.pages.pageError(selected + 1, selectedPage.error)}</p>
      )}
      <img
        className="scan-original-image"
        src={url}
        alt={pages.length > 1 ? t.scan.pages.altPage(selected + 1) : t.scan.pages.alt}
      />
      {!!selectedPage.quarterTurns && (
        <p className="small muted">{t.scan.pages.rotated(selectedPage.quarterTurns * 90)}</p>
      )}
    </div>
  );
}
