'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A block of generated text with a one-tap copy.
 *
 * Editable on purpose. Everything the AI Foreman produces is a draft, and a
 * read-only panel invites sending it as-is — which is exactly what shouldn't
 * happen with a client update. Edits are local and deliberately not saved: this
 * is a scratchpad on the way to a text message, not a record.
 */
export function CopyableText({
  value,
  label,
  rows = 12,
}: {
  value: string;
  label: string;
  rows?: number;
}) {
  const [text, setText] = useState(value);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context) — the text is still selectable.
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={rows}
        spellCheck={false}
        className="w-full resize-y rounded-md border bg-secondary/30 p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Edit it here before you send it. Changes are not saved to the job.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
