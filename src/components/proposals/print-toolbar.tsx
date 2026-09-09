'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * Screen-only toolbar for the proposal print view (Task 18). Hidden in print
 * (`print:hidden`) so it never appears in the saved PDF. "Download PDF" triggers
 * the browser's native print-to-PDF; the document title is set to the proposal
 * number so the saved file is named sensibly.
 */
export function PrintToolbar({ backHref, title }: { backHref: string; title: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="no-print sticky top-0 z-10 mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 print:hidden">
      <Link href={backHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
      <Button type="button" size="sm" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        Download PDF
      </Button>
    </div>
  );
}
