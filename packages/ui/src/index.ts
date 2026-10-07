import { createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}

export const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-slate-900 text-white hover:bg-slate-700 focus-visible:ring-slate-700',
        secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-slate-500',
        danger: 'bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-700',
        link: 'text-slate-900 underline-offset-4 hover:underline focus-visible:ring-slate-500',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  children?: ReactNode;
}

/** Native button semantics with shared accessible focus and disabled treatments. */
export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return createElement('button', {
    ...props,
    type,
    className: buttonVariants({ variant, size, className }),
  });
}
