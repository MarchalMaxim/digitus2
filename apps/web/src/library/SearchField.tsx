import { useRef } from 'react';

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
  const input = useRef<HTMLInputElement>(null);
  return (
    <div role="search" className="library-search">
      <input
        ref={input}
        type="search"
        aria-label="Search the library"
        placeholder="Search pieces and composers"
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
          aria-label="Clear the search"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
