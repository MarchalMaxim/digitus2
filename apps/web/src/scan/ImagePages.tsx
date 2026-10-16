import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { SCAN_PAGE_LIMIT, validateScanImages, type ScanPage } from './model.js';

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
}: {
  pages: ScanPage[];
  editable: boolean;
  busy: boolean;
  selected: number;
  onSelect(index: number): void;
  onChange(pages: ScanPage[]): void;
}) {
  const [error, setError] = useState('');
  const dragged = useRef<string | undefined>(undefined);
  const latest = useRef({ pages, busy, onChange });
  const alive = useRef(true);
  useLayoutEffect(() => {
    latest.current = { pages, busy, onChange };
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const selectedPage = pages[selected] ?? pages[0]!;
  const url = useBlobUrl(selectedPage.file);
  const move = (from: number, to: number) => {
    if (busy || from < 0 || to < 0 || to >= pages.length || from === to) return;
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
            {editable
              ? 'Arrange pages in reading order. Drag a thumbnail or select a page to move it.'
              : `${pages.length} original pages, in reading order.`}
          </p>
          <ol className="scan-page-list" aria-label="Score pages">
            {pages.map((page, index) => (
              <li
                key={page.id}
                draggable={editable && !busy}
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
                  aria-label={`Select page ${index + 1}: ${page.file.name}`}
                >
                  <Thumbnail file={page.file} />
                  <span>{index + 1}</span>
                </button>
                <span className="scan-page-caption">
                  {page.file.name}
                  <small>
                    {page.error ? 'Needs retry' : page.xml ? 'Recognized' : 'Ready to scan'}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {editable && (
        <div className="stack scan-page-edit">
          {pages.length > 1 && (
            <div className="row">
              <button
                disabled={busy || selected === 0}
                onClick={() => move(selected, selected - 1)}
                aria-label={`Move page ${selected + 1} earlier`}
              >
                Move earlier
              </button>
              <button
                disabled={busy || selected === pages.length - 1}
                onClick={() => move(selected, selected + 1)}
                aria-label={`Move page ${selected + 1} later`}
              >
                Move later
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  onChange(pages.filter((p) => p.id !== selectedPage.id));
                  onSelect(Math.max(0, selected - 1));
                }}
                aria-label={`Remove page ${selected + 1}`}
              >
                Remove page
              </button>
            </div>
          )}
          <label className={`text-button own-file${busy ? ' is-disabled' : ''}`}>
            Add page images
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
                      setError('Finish this scan before adding more pages.');
                      return;
                    }
                    if (current.pages.length + validated.length > SCAN_PAGE_LIMIT) {
                      setError('Choose up to 20 page images at a time.');
                      return;
                    }
                    setError('');
                    current.onChange([
                      ...current.pages,
                      ...validated.map((file) => ({ id: crypto.randomUUID(), file })),
                    ]);
                  },
                  (cause: unknown) => {
                    if (alive.current) setError(messageOf(cause));
                  },
                );
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      {pages.length > 1 && (
        <div className="row scan-source-pagination" aria-label="Original page navigation">
          <button
            disabled={selected === 0}
            onClick={() => onSelect(selected - 1)}
            aria-label="Previous original page"
          >
            Previous
          </button>
          <span>
            Page {selected + 1} of {pages.length}
          </span>
          <button
            disabled={selected === pages.length - 1}
            onClick={() => onSelect(selected + 1)}
            aria-label="Next original page"
          >
            Next
          </button>
        </div>
      )}
      {selectedPage.error && (
        <p role="status">
          Page {selected + 1}: {selectedPage.error}
        </p>
      )}
      <img
        className="scan-original-image"
        src={url}
        alt={
          pages.length > 1
            ? `Original printed score, page ${selected + 1}`
            : 'Original printed score'
        }
      />
    </div>
  );
}
