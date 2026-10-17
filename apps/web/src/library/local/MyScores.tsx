import { useAppStore } from '../../app/store.js';
import { useLocalLibrary } from './state.js';

export function MyScores({ onOpen }: { onOpen(): void }) {
  const items = useLocalLibrary((s) => s.items);
  const failed = useLocalLibrary((s) => s.failed);
  if (!items.length) return null;
  const allSaved = items.every((item) => item.saved);
  const storageLabel = allSaved ? 'Saved' : failed ? 'Available for this visit only' : 'Saving…';
  return (
    <details className="local-scores">
      <summary>My scores</summary>
      <p className="small muted">{storageLabel}</p>
      <ul className="piece-list">
        {items.map((item) => (
          <li key={item.id} className="local-score-row">
            <button
              className="piece-row"
              aria-label={`Open saved ${item.name}`}
              onClick={() => {
                const view = useAppStore.getState().view;
                onOpen();
                void import('./library.js').then((m) => m.openLocalScore(item.id, view));
              }}
            >
              <span className="title">{item.name}</span>
              <span className="composer small muted">
                {!failed && !item.saved ? 'Saving…' : item.detail}
              </span>
            </button>
            <button
              className="text-button small"
              aria-label={`Remove saved ${item.name}`}
              onClick={() => {
                void import('./library.js')
                  .then((m) => m.removeLocalScore(item.id))
                  .catch(() =>
                    useAppStore.getState().setNotice('This score could not be removed. Try again.'),
                  );
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
