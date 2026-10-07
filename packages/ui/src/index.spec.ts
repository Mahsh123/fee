import { describe, expect, it } from 'vitest';
import { Button, buttonVariants, cn } from './index';

describe('shared UI primitives', () => {
  it('combines class names and resolves conflicting utility classes', () => {
    expect(cn('px-2 text-sm', false && 'hidden', 'px-4')).toBe('text-sm px-4');
  });

  it('supports explicit semantic button variants and sizes', () => {
    expect(buttonVariants({ variant: 'danger', size: 'lg' })).toContain('bg-red-700');
    expect(buttonVariants({ variant: 'danger', size: 'lg' })).toContain('h-12');
  });

  it('defaults to a non-submitting native button and preserves accessible disabled state', () => {
    const element = Button({ children: 'Save', disabled: true });
    expect(element.type).toBe('button');
    expect(element.props.type).toBe('button');
    expect(element.props.disabled).toBe(true);
    expect(element.props.className).toContain('disabled:opacity-50');
  });
});
