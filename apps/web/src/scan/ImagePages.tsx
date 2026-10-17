import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { useT } from '../i18n/i18n.js';
import type { Phrase } from '../i18n/messages.js';
import { SCAN_PAGE_LIMIT, validateScanImages, type ScanPage } from './model.js';
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
}: {
  pages: ScanPage[];
  editable: boolean;
  busy: boolean;
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
  return (
    <div className="stack image-pages">
      {pages.length > 1 && (
        <>
          <p className="small muted">
            {editable ? t.scan.pages.arrange : t.scan.pages.originalCount(pages.length)}
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
                  <small>
                    {page.error
                      ? t.scan.pages.needsRetry
                      : page.xml
                        ? t.scan.pages.recognized
                        : t.scan.pages.ready}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {editable && (
        <div className="stack scan-page-edit">
          <div className="row">
            <button
              disabled={busy || rotating}
              onClick={() => {
                void rotate();
              }}
            >
              {t.scan.pages.rotate}
            </button>
            {rotating && (
              <button onClick={() => rotation.current?.abort()}>
                {t.scan.pages.cancelRotation}
              </button>
            )}
          </div>
          {rotating && <p role="status">{t.scan.pages.rotating}</p>}
          {pages.length > 1 && (
            <div className="row">
              <button
                disabled={busy || rotating || selected === 0}
                onClick={() => move(selected, selected - 1)}
                aria-label={t.scan.pages.moveEarlierLabel(selected + 1)}
              >
                {t.scan.pages.moveEarlier}
              </button>
              <button
                disabled={busy || rotating || selected === pages.length - 1}
                onClick={() => move(selected, selected + 1)}
                aria-label={t.scan.pages.moveLaterLabel(selected + 1)}
              >
                {t.scan.pages.moveLater}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  onChange(pages.filter((p) => p.id !== selectedPage.id));
                  onSelect(Math.max(0, selected - 1));
                }}
                aria-label={t.scan.pages.removeLabel(selected + 1)}
              >
                {t.scan.pages.remove}
              </button>
            </div>
          )}
          <label className={`text-button own-file${busy ? ' is-disabled' : ''}`}>
            {t.scan.pages.addImages}
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg"
              className="visually-hidden"
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (!files.length) return;
                void validateScanImages(files).then(
                  (validated) => {
                    if (!alive.current) return;
                    const current = latest.current;
                    if (current.busy) {
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
              }}
            />
          </label>
          {error && <p role="alert">{error(t)}</p>}
        </div>
      )}
      {pages.length > 1 && (
        <div className="row scan-source-pagination" aria-label={t.scan.pager.navLabel}>
          <button
            disabled={selected === 0}
            onClick={() => onSelect(selected - 1)}
            aria-label={t.scan.pager.previousLabel}
          >
            {t.scan.pager.previous}
          </button>
          <span>{t.scan.pager.pageOf(selected + 1, pages.length)}</span>
          <button
            disabled={selected === pages.length - 1}
            onClick={() => onSelect(selected + 1)}
            aria-label={t.scan.pager.nextLabel}
          >
            {t.scan.pager.next}
          </button>
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
