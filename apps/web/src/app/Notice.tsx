import { useT } from '../i18n/i18n.js';
import { useAppStore } from './store.js';

/**
 * One dismissible line for refusals and warnings. Gray, never red; nothing when there is none. A
 * waiting newer build of the app is offered on the same line once no refusal is showing, with a
 * Reload button beside Dismiss; the offer outlasts the notices that opening a piece clears.
 */
export function Notice() {
  const notice = useAppStore((s) => s.notice);
  const setNotice = useAppStore((s) => s.setNotice);
  const updateReady = useAppStore((s) => s.updateReady);
  const setUpdateReady = useAppStore((s) => s.setUpdateReady);
  const t = useT();
  if (notice === null && updateReady === null) return null;
  return (
    <div className="page notice-wrap no-print">
      <div role="status" className="notice">
        {notice === null ? (
          <>
            <span>{t.app.updateReady}</span>
            {/* The two buttons stay side by side and the sentence wraps, so the line stays short. */}
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button type="button" onClick={updateReady!}>
                {t.app.reload}
              </button>
              <button type="button" onClick={() => setUpdateReady(null)}>
                {t.common.dismiss}
              </button>
            </div>
          </>
        ) : (
          <>
            <span>{typeof notice === 'function' ? notice(t) : notice}</span>
            <button type="button" onClick={() => setNotice(null)}>
              {t.common.dismiss}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
