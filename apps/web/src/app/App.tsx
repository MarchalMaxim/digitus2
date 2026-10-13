import { useAppStore } from './store.js';
import { Notice } from './Notice.js';
import { LibraryView } from '../library/LibraryView.js';

export function App() {
  const view = useAppStore((s) => s.view);
  return (
    <>
      <Notice />
      {view.name === 'library' && <LibraryView />}
      {view.name === 'score' && <p className="page">Score view arrives in Task 6.</p>}
      {view.name === 'about' && <p className="page">About arrives in Task 9.</p>}
    </>
  );
}
