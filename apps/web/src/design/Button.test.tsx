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
  it('never submits a form unless asked: type defaults to button, an explicit type wins', () => {
    render(
      <>
        <Button>Plain</Button>
        <Button type="submit">Send</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
  });
  it('keeps the caller classes beside the red one, and adds none when there are none', () => {
    render(
      <>
        <Button primary className="wide">
          Both
        </Button>
        <Button className="wide">Caller</Button>
        <Button>Bare</Button>
      </>,
    );
    const both = screen.getByRole('button', { name: 'Both' });
    expect(both).toHaveClass('is-red', 'wide');
    expect(screen.getByRole('button', { name: 'Caller' })).toHaveAttribute('class', 'wide');
    expect(screen.getByRole('button', { name: 'Bare' })).not.toHaveAttribute('class');
  });
});
