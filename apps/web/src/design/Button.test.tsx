import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.js';

describe('Button', () => {
  it('adds the red class only when primary', () => {
    render(
      <>
        <Button primary>Start</Button>
        <Button>Other</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('is-red');
    expect(screen.getByRole('button', { name: 'Other' })).not.toHaveClass('is-red');
  });
  it('passes through type, disabled and aria attributes', () => {
    render(
      <Button type="submit" disabled aria-label="Go">
        x
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('type', 'submit');
  });
});
