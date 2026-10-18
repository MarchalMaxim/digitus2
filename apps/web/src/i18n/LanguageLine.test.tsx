import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLocaleForTests } from './i18n.js';
import { LanguageLine } from './LanguageLine.js';
import { LOCALE_STORAGE_KEY } from './locales.js';

afterEach(() => {
  cleanup();
  resetLocaleForTests();
});

describe('LanguageLine', () => {
  it('names every language in its own language and marks the one on screen', () => {
    render(<LanguageLine />);
    const line = screen.getByRole('navigation', { name: 'Language' });
    const names = ['English', 'Nederlands', 'Français', 'Español', 'Português'];
    for (const name of names) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(line).toHaveTextContent(names.join(' · '));
    // Exactly, so no dot trails the last name: a separator only between neighbours.
    expect(line.textContent).toBe(names.join(' · '));
    expect(line.querySelectorAll('[aria-hidden="true"]')).toHaveLength(names.length - 1);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('lang', 'fr');
  });

  it('switches the page and keeps the pick', async () => {
    render(<LanguageLine />);
    await userEvent.click(screen.getByRole('button', { name: 'Nederlands' }));
    expect(await screen.findByRole('navigation', { name: 'Taal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nederlands' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'English' })).not.toHaveAttribute('aria-current');
    expect(document.documentElement.lang).toBe('nl');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('nl');
  });
});
