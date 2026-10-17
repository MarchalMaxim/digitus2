import { useT } from '../i18n/i18n.js';
import { useAppStore } from './store.js';

/** One dismissible line for refusals and warnings. Gray, never red; nothing when there is none. */
export function Notice() {
  const notice = useAppStore((s) => s.notice);
  const setNotice = useAppStore((s) => s.setNotice);
  const t = useT();
  if (notice === null) return null;
  return (
    <div className="page notice-wrap no-print">
      <div role="status" className="notice">
        <span>{typeof notice === 'function' ? notice(t) : notice}</span>
        <button type="button" onClick={() => setNotice(null)}>
          {t.common.dismiss}
        </button>
      </div>
    </div>
  );
}
