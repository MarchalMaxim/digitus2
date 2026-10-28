import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './shared.css';

/**
 * A modal sheet: a card in the middle of the window, a sheet from the bottom edge under 600 px.
 * The page behind is inert and its one red goes out (shared.css, `has-sheet`), so the sheet's
 * own action is the screen's one red. Escape closes it; the focus stays inside and returns to
 * where it was when the sheet closes, if that control is still there.
 */
export function Sheet({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.getElementById('root');
    const wasInert = root?.inert;
    const before = document.activeElement as HTMLElement | null;
    if (root) root.inert = true;
    document.documentElement.classList.add('has-sheet');
    (dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.current)?.focus();
    return () => {
      document.documentElement.classList.remove('has-sheet');
      if (root) root.inert = wasInert ?? false;
      if (before?.isConnected) before.focus();
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]',
      ),
    );
    const first = items[0];
    const last = items.at(-1);
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === dialog.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return createPortal(
    <div className="sheet-backdrop">
      <div
        ref={dialog}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
