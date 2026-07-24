'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink, Send } from 'lucide-react';
import { markSent, regenerateProposal } from '@/lib/proposals/actions';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

/** Secure share link with copy + preview (raw token comes from the version's event). */
export function CopyProposalLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/proposal/${token}`;
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="flex-1 truncate rounded-md border bg-secondary/50 px-3 py-2 text-xs">
        {url}
      </code>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
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

/** Mark the proposal sent (sets an expiry) — the client link becomes live. */
export function MarkSentForm({ proposalId }: { proposalId: string }) {
  return (
    <form action={markSent} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="proposalId" value={proposalId} />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Valid for</label>
        <Select name="expiresInDays" defaultValue="30" className="w-auto">
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </Select>
      </div>
      <Button type="submit" size="sm">
        <Send className="h-4 w-4" />
        Mark as sent
      </Button>
    </form>
  );
}

export function RegenerateButton({ proposalId }: { proposalId: string }) {
  return (
    <form action={regenerateProposal}>
      <input type="hidden" name="proposalId" value={proposalId} />
      <Button type="submit" variant="outline" size="sm">
        Regenerate from estimate
      </Button>
    </form>
  );
}
