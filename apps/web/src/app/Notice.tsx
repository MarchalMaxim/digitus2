import { useAppStore } from './store.js';

/** One dismissible line for refusals and warnings. Gray, never red; nothing when there is none. */
export function Notice() {
  const notice = useAppStore((s) => s.notice);
  const setNotice = useAppStore((s) => s.setNotice);
  if (notice === null) return null;
  return (
    <div className="page notice-wrap no-print">
      <div role="status" className="notice">
        <span>{notice}</span>
        <button type="button" onClick={() => setNotice(null)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
