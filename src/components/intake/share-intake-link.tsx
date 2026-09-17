'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shows the public intake URL with a one-tap copy button. The absolute URL is
 * resolved on the client so it matches whatever host the app is served from. */
export function ShareIntakeLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/intake/${slug}`;
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the field is still selectable.
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="flex-1 truncate rounded-md border bg-secondary/50 px-3 py-2 text-xs">
        {url}
      </code>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy} className="sm:w-auto">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent"
        >
          <ExternalLink className="h-4 w-4" />
          Preview
        </a>
      </div>
    </div>
  );
}
