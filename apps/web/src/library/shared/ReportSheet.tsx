import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../design/Button.js';
import { useT } from '../../i18n/i18n.js';
import { Sheet } from './Sheet.js';
import { createReport, REMOVAL_REQUEST_URL, type ReportFields } from './store.js';

const REASONS: ReportFields['reason'][] = ['copyright', 'abuse', 'broken'];

/**
 * "Report this score": a reason, a way to reply for a copyright claim, an optional note. Send
 * report is the sheet's one red; when it has gone, Back to the score. A report that cannot be
 * sent leads to a removal request on GitHub.
 */
export default function ReportSheet({ id, onClose }: { id: string; onClose(): void }) {
  const t = useT().library.shared;
  const heading = useId();
  const [reason, setReason] = useState<ReportFields['reason'] | null>(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<'form' | 'sent' | 'failed'>('form');
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const firstReason = useRef<HTMLInputElement>(null);
  const replyField = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    if (!reason) {
      setError(t.chooseReason);
      firstReason.current?.focus();
      return;
    }
    if (reason === 'copyright' && !reply.trim()) {
      setError(t.replyNeeded);
      replyField.current?.focus();
      return;
    }
    setError(null);
    sending.current = true;
    createReport({
      score: id,
      reason,
      note: note.trim(),
      reply: reason === 'copyright' ? reply.trim() : '',
    })
      .then(
        () => setStage('sent'),
        () => setStage('failed'),
      )
      .finally(() => {
        sending.current = false;
      });
  };
  if (stage === 'sent')
    return (
      <Sheet key="sent" labelledBy={heading} onClose={onClose}>
        <h2 id={heading}>{t.sentHeading}</h2>
        <p>{t.sentLine}</p>
        <div className="sheet-actions">
          <Button primary data-autofocus onClick={onClose}>
            {t.backToScore}
          </Button>
        </div>
      </Sheet>
    );
  return (
    <Sheet key="form" labelledBy={heading} onClose={onClose}>
      <h2 id={heading}>{t.reportHeading}</h2>
      <form noValidate onSubmit={submit}>
        <fieldset className="reasons" aria-labelledby={heading}>
          {REASONS.map((value, index) => (
            <label key={value} className="check">
              <input
                ref={index === 0 ? firstReason : undefined}
                data-autofocus={index === 0 ? true : undefined}
                type="radio"
                name="reason"
                checked={reason === value}
                onChange={() => {
                  setReason(value);
                  setError(null);
                }}
              />
              <span>{t.reasons[value]}</span>
            </label>
          ))}
        </fieldset>
        {reason === 'copyright' && (
          <label className="field">
            <span>{t.reply}</span>
            <input
              ref={replyField}
              value={reply}
              maxLength={200}
              onChange={(e) => setReply(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>{t.note}</span>
          <textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="small">
            {error}
          </p>
        )}
        {stage === 'failed' && (
          <p role="alert" className="small">
            {t.failed}{' '}
            <a href={REMOVAL_REQUEST_URL} target="_blank" rel="noreferrer">
              {t.askRemoval}
            </a>
          </p>
        )}
        <div className="sheet-actions">
          <Button primary type="submit">
            {t.send}
          </Button>
          <button type="button" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
