import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean | undefined;
}

export function Button({ primary, className, type = 'button', ...rest }: ButtonProps) {
  const cls = [primary ? 'is-red' : '', className ?? ''].filter(Boolean).join(' ');
  return <button type={type} className={cls || undefined} {...rest} />;
}
