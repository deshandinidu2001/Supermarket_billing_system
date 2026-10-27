import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
export const buttonVariants = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      destructive: 'button-danger',
      outline: 'button-outline',
    },
    size: { default: '', sm: 'button-small', icon: 'button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
