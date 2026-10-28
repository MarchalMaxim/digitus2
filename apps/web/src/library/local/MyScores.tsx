import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../../app/store.js';
import { useT } from '../../i18n/i18n.js';
import { useLocalLibrary } from './state.js';

const ShareSheet = lazy(() => import('../shared/ShareSheet.js'));

export function MyScores({ onOpen, onFocusFallback }: { onOpen(): void; onFocusFallback(): void }) {
  const t = useT();
  const items = useLocalLibrary((s) => s.items);
  const failed = useLocalLibrary((s) => s.failed);
  const say = { ...t.library.myScores, shared: t.library.shared };
  const rows = useRef<HTMLDetailsElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ button: HTMLButtonElement; index: number } | null>(null);
  const removing = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState({ name: '', count: 0 });
  // Sharing (issue 132): the sheet being filled in, and whether a score was just sent for review.
  const [sheet, setSheet] = useState<{
    id: string;
    initial: { title: string; composer: string };
  } | null>(null);
  const [sent, setSent] = useState(false);
  const share = say.shared;
  const fail = (phrase: (texts: typeof t) => string) => useAppStore.getState().setNotice(phrase);
  const send = async (id: string, title: string, composer: string) => {
    try {
      await import('./library.js').then((m) => m.shareLocalScore(id, title, composer));
      setSent(true);
    } catch (cause) {
      fail((texts) =>
        cause instanceof Error && cause.name === 'ScoreTooLarge'
          ? texts.library.shared.tooLarge
          : texts.library.shared.unavailable,
      );
    }
    setSheet(null);
  };
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
        <details
          ref={rows}
          className="local-scores"
          onToggle={(event) => {
            // Opening My scores asks what became of each upload and which rows can be shared.
            if (event.currentTarget.open)
              void import('./library.js').then((m) => m.checkSharing()).catch(() => {});
          }}
        >
          <summary>{say.heading}</summary>
          <p className="small muted">{storageLabel}</p>
          {sent && (
            <p className="small muted sharing-status" role="status">
              {share.sent}
            </p>
          )}
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
                    {!failed && !item.saved
                      ? say.saving
                      : item.sharing === 'waiting'
                        ? share.detail.waiting
                        : item.sharing === 'shared'
                          ? share.detail.shared
                          : item.sharing === 'again'
                            ? share.detail.notShared
                            : say.detail[item.detail]}
                  </span>
                </button>
                {item.sharing && item.sharing !== 'shared' && (
                  <button
                    className="text-button small"
                    aria-label={
                      item.sharing === 'waiting'
                        ? share.withdrawLabel(item.name)
                        : share.shareLabel(item.name)
                    }
                    onClick={() => {
                      if (item.sharing === 'waiting') {
                        setSent(false);
                        void import('./library.js')
                          .then((m) => m.withdrawLocalScore(item.id))
                          .catch(() => fail((texts) => texts.library.shared.withdrawFailed));
                      } else
                        void import('./library.js')
                          .then((m) => m.shareDraft(item.id))
                          .then((initial) => initial && setSheet({ id: item.id, initial }));
                    }}
                  >
                    {item.sharing === 'waiting' ? share.withdraw : share.share}
                  </button>
                )}
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
      {sheet && (
        <Suspense fallback={null}>
          <ShareSheet
            initial={sheet.initial}
            onShare={(title, composer) => send(sheet.id, title, composer)}
            onClose={() => setSheet(null)}
          />
        </Suspense>
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
