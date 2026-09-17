'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Submit button that reflects pending form state. Optional name/value let a
 * form carry two submit paths (e.g. "save & add another" vs "save & open"). */
export function SubmitButton({
  children,
  className,
  pendingLabel = 'Working…',
  name,
  value,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  name?: string;
  value?: string;
  variant?: 'default' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      name={name}
      value={value}
      variant={variant}
      className={cn('w-full', className)}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Inline error/success feedback for form states. */
export function FormNotice({ error, message }: { error?: string; message?: string }) {
  if (error) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (message) {
    return <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-foreground">{message}</p>;
  }
  return null;
}
