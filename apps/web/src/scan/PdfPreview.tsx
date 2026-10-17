import { useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { messageOf } from '../app/errors.js';
import { useT } from '../i18n/i18n.js';
import type { Phrase } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Local preview only. Recognition always receives the unchanged original File. */
export function PdfPreview({ file }: { file: File }) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [pageNumber, setPageNumber] = useState(1);
  const t = useT();
  const [error, setErrorPhrase] = useState<Phrase | null>(null);
  // A phrase is a function, which useState would call as an update.
  const setError = (phrase: Phrase | null) => {
    setErrorPhrase(() => phrase);
  };
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let current = true;
    let task: ReturnType<typeof getDocument> | undefined;
    setError(null);
    setReady(false);
    void file
      .arrayBuffer()
      .then(async (bytes) => {
        if (!current) return;
        // No URL loading, scripting, remote fonts or external decoder resources.
        task = getDocument({
          data: new Uint8Array(bytes),
          isEvalSupported: false,
          useSystemFonts: true,
          useWasm: false,
        });
        const pdf = await task.promise;
        if (current) setDocument(pdf);
      })
      .catch((cause: unknown) => {
        if (current) setError((tt) => tt.scan.preview.unavailable(messageOf(cause, tt)));
      });
    return () => {
      current = false;
      void task?.destroy();
    };
  }, [file]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let current = true;
    let render: RenderTask | undefined;
    setReady(false);
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (!current || !canvas.current) return;
      const viewport = page.getViewport({ scale: 1 });
      const scaled = page.getViewport({
        scale: Math.min(2, 1200 / viewport.width, 2400 / viewport.height),
      });
      const target = canvas.current;
      target.width = Math.ceil(scaled.width);
      target.height = Math.ceil(scaled.height);
      const context = target.getContext('2d');
      if (!context) throw new PhraseError((tt) => tt.scan.preview.canvasMissing);
      render = page.render({ canvas: target, canvasContext: context, viewport: scaled });
      await render.promise;
      if (current) setReady(true);
    })().catch((cause: unknown) => {
      if (current) setError((tt) => tt.scan.preview.unavailable(messageOf(cause, tt)));
    });
    return () => {
      current = false;
      render?.cancel();
    };
  }, [document, pageNumber]);
  return (
    <div className="stack pdf-preview">
      {document && document.numPages > 1 && (
        <div className="row">
          <button
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((page) => page - 1)}
            aria-label={t.scan.pager.previousLabel}
          >
            {t.scan.pager.previous}
          </button>
          <span>{t.scan.pager.pageOf(pageNumber, document.numPages)}</span>
          <button
            disabled={pageNumber >= document.numPages}
            onClick={() => setPageNumber((page) => page + 1)}
            aria-label={t.scan.pager.nextLabel}
          >
            {t.scan.pager.next}
          </button>
        </div>
      )}
      {!ready && <p role="status">{error ? error(t) : t.scan.view.preparingPdf}</p>}
      <canvas
        ref={canvas}
        role="img"
        aria-label={t.scan.preview.pageLabel(pageNumber)}
        hidden={!ready}
      />
      {error && <p className="small">{t.scan.preview.openToCompare}</p>}
    </div>
  );
}
