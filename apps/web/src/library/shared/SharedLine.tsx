import { lazy, Suspense, useState } from 'react';
import { useT } from '../../i18n/i18n.js';

const ReportSheet = lazy(() => import('./ReportSheet.js'));

/** Under a shared score's title: whose it is, in gray, and Report. */
export function SharedLine({ id }: { id: string }) {
  const t = useT().library.shared;
  const [reporting, setReporting] = useState(false);
  return (
    <>
      <p className="shared-line no-print">
        <span className="muted small">{t.byReader}</span>
        <button type="button" className="text-button small" onClick={() => setReporting(true)}>
          {t.report}
        </button>
      </p>
      {reporting && (
        <Suspense fallback={null}>
          <ReportSheet id={id} onClose={() => setReporting(false)} />
        </Suspense>
      )}
    </>
  );
}
