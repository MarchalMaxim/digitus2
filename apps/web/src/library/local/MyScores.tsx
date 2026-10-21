import { useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../../app/store.js';
import { useT } from '../../i18n/i18n.js';
import { useLocalLibrary } from './state.js';

export function MyScores({ onOpen, onFocusFallback }: { onOpen(): void; onFocusFallback(): void }) {
  const t = useT();
  const items = useLocalLibrary((s) => s.items);
  const failed = useLocalLibrary((s) => s.failed);
  const say = t.library.myScores;
  const rows = useRef<HTMLDetailsElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ button: HTMLButtonElement; index: number } | null>(null);
  const removing = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState({ name: '', count: 0 });
  useLayoutEffect(() => {
    const wanted = pending.current;
    if (!wanted || wanted.button.isConnected) return;
    pending.current = null;
    // The reader may have moved elsewhere while the module was loading.
    if (document.activeElement !== document.body) return;
    // Resume at the primary action; another removal requires a deliberate Tab.
    const remaining = rows.current?.querySelectorAll<HTMLButtonElement>('.piece-row');
    const next = remaining?.[Math.min(wanted.index, remaining.length - 1)];
    if (next) next.focus();
    else onFocusFallback();
  }, [items, onFocusFallback]);
  const allSaved = items.every((item) => item.saved);
  const storageLabel = allSaved ? say.saved : failed ? say.thisVisitOnly : say.saving;
  return (
    <>
      {items.length > 0 && (
        <details ref={rows} className="local-scores">
          <summary>{say.heading}</summary>
          <p className="small muted">{storageLabel}</p>
          <ul className="piece-list">
            {items.map((item) => (
              <li key={item.id} className="local-score-row">
                <button
                  className="piece-row"
                  aria-label={say.open(item.name)}
                  onClick={() => {
                    const view = useAppStore.getState().view;
                    onOpen();
                    void import('./library.js').then((m) => m.openLocalScore(item.id, view));
                  }}
                >
                  <span className="title">{item.name}</span>
                  <span className="composer small muted">
                    {!failed && !item.saved ? say.saving : say.detail[item.detail]}
                  </span>
                </button>
                <button
                  className="text-button small"
                  aria-label={say.removeLabel(item.name)}
                  onClick={(event) => {
                    if (removing.current.has(item.id)) return;
                    removing.current.add(item.id);
                    const button = event.currentTarget;
                    void import('./library.js')
                      .then((m) => {
                        if (button === document.activeElement && button.isConnected) {
                          pending.current = {
                            button,
                            index: useLocalLibrary
                              .getState()
                              .items.findIndex((row) => row.id === item.id),
                          };
                        }
                        m.removeLocalScore(item.id);
                        if (live.current?.isConnected)
                          setAnnouncement((previous) => ({
                            name: item.name,
                            count: previous.count + 1,
                          }));
                      })
                      .catch(() => {
                        pending.current = null;
                        useAppStore
                          .getState()
                          .setNotice((texts) => texts.library.myScores.removeFailed);
                      })
                      .finally(() => removing.current.delete(item.id));
                  }}
                >
                  {say.remove}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p
        ref={live}
        className="visually-hidden"
        aria-live="polite"
        aria-atomic="true"
        data-testid="local-score-announcement"
      >
        {announcement.count > 0 && (
          <span key={announcement.count}>{say.removed(announcement.name)}</span>
        )}
      </p>
    </>
  );
}
