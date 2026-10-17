import { useAppStore } from '../../app/store.js';
import { useT } from '../../i18n/i18n.js';
import { useLocalLibrary } from './state.js';

export function MyScores({ onOpen }: { onOpen(): void }) {
  const t = useT();
  const items = useLocalLibrary((s) => s.items);
  const failed = useLocalLibrary((s) => s.failed);
  if (!items.length) return null;
  const say = t.library.myScores;
  const allSaved = items.every((item) => item.saved);
  const storageLabel = allSaved ? say.saved : failed ? say.thisVisitOnly : say.saving;
  return (
    <details className="local-scores">
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
              onClick={() => {
                void import('./library.js')
                  .then((m) => m.removeLocalScore(item.id))
                  .catch(() =>
                    useAppStore
                      .getState()
                      .setNotice((texts) => texts.library.myScores.removeFailed),
                  );
              }}
            >
              {say.remove}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
