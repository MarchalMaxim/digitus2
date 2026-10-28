import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../design/Button.js';
import { useT } from '../../i18n/i18n.js';
import { COMPOSER_MAX, TITLE_MAX } from './payload.js';
import { Sheet } from './Sheet.js';

/**
 * "Share with other readers": the title and composer the MusicXML names, the one sentence about
 * what may be shared, the tick that says it is free to share, and Share, the sheet's one red.
 * `onShare` sends the score; the sheet closes itself when it resolves.
 */
export default function ShareSheet({
  initial,
  onShare,
  onClose,
}: {
  initial: { title: string; composer: string };
  onShare(title: string, composer: string): Promise<void>;
  onClose(): void;
}) {
  const t = useT().library.shared;
  const heading = useId();
  const [title, setTitle] = useState(initial.title);
  const [composer, setComposer] = useState(initial.composer);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const titleField = useRef<HTMLInputElement>(null);
  const tick = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    if (!title.trim()) {
      setError(t.titleMissing);
      titleField.current?.focus();
      return;
    }
    if (!tick.current?.checked) {
      setError(t.tick);
      tick.current?.focus();
      return;
    }
    setError(null);
    sending.current = true;
    void onShare(title, composer)
      .catch(() => {})
      .finally(() => {
        sending.current = false;
      });
  };
  return (
    <Sheet labelledBy={heading} onClose={onClose}>
      <h2 id={heading}>{t.sheetHeading}</h2>
      <form noValidate onSubmit={submit}>
        <label className="field">
          <span>{t.title}</span>
          <input
            ref={titleField}
            data-autofocus
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t.composer}</span>
          <input
            value={composer}
            maxLength={COMPOSER_MAX}
            onChange={(e) => setComposer(e.target.value)}
          />
        </label>
        <p className="muted small">{t.rule}</p>
        <label className="check">
          <input ref={tick} type="checkbox" onChange={() => setError(null)} />
          <span>{t.free}</span>
        </label>
        {error && (
          <p role="alert" className="small">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <Button primary type="submit">
            {t.share}
          </Button>
          <button type="button" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
