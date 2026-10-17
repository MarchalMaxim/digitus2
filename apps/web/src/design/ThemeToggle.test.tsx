import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLocale, resetLocaleForTests } from '../i18n/i18n.js';
import { THEME_STORAGE_KEY } from './theme.js';
import { ThemeToggle } from './ThemeToggle.js';

function systemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: dark,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  resetLocaleForTests();
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('is one button named "Dark theme", pressed while the page is dark', async () => {
    systemPrefersDark(false);
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Dark theme' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('starts pressed when the system is dark', () => {
    systemPrefersDark(true);
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Dark theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('draws the sun to crescent icon, hidden from screen readers, and stays off paper', () => {
    systemPrefersDark(false);
    const { container } = render(<ThemeToggle />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelector('.theme-rays')).not.toBeNull();
    expect(svg.querySelector('.theme-core')).not.toBeNull();
    // The bite is a mask: it cuts the crescent whatever lies behind the button (its hover fill).
    expect(svg.querySelector('mask .theme-bite')).not.toBeNull();
    expect(screen.getByRole('button')).toHaveClass('no-print');
    expect(screen.getByRole('button')).not.toHaveClass('is-red');
  });

  it('is named in the language on screen', async () => {
    systemPrefersDark(false);
    await act(async () => {
      await chooseLocale('nl');
    });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Donker thema' })).toBeInTheDocument();
  });
});
