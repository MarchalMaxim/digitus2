import { useRef } from 'react';
import { useT } from '../i18n/i18n.js';

export interface SearchFieldProps {
  query: string;
  onChange(query: string): void;
}

/**
 * The search field (spec 6.3, 11): in the start row after the red button, from 100 pieces. Escape
 * empties it; "Clear", a text button, shows only while there is text. The native clear glyph is
 * hidden (library.css), so there is one clear control and no icon to learn.
 */
export function SearchField({ query, onChange }: SearchFieldProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div role="search" className="library-search">
      <input
        ref={input}
        type="search"
        aria-label={t.library.search.label}
        placeholder={t.library.search.placeholder}
        value={query}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query !== '') {
            e.preventDefault();
            onChange('');
          }
        }}
      />
      {query !== '' && (
        <button
          type="button"
          className="text-button search-clear"
          aria-label={t.library.search.clearLabel}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          {t.library.search.clear}
        </button>
      )}
    </div>
  );
}
