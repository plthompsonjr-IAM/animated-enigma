import { ShieldCheck } from 'lucide-react';
import type { Signature } from '@/db/schema';
import { formatSignedAt } from '@/lib/signatures/signature-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The internal, non-editable record of a client's e-signature (Task 19): who
 * signed, when, from where, and the exact disclosure they agreed to. This is
 * the evidence you would produce if an approval were ever disputed, so it
 * renders verbatim and is never editable in the UI (the DB is append-only too).
 */
export function ApprovalRecord({ signature }: { signature: Signature }) {
  return (
    <Card className="border-emerald-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Signed approval
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Signed by" value={signature.signerName} />
          <Field label="Signed at" value={formatSignedAt(signature.signedAt)} />
          {signature.signerEmail ? <Field label="Email" value={signature.signerEmail} /> : null}
          {signature.ipAddress ? <Field label="IP address" value={signature.ipAddress} /> : null}
        </dl>

        {signature.userAgent ? (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Device
            </dt>
            <dd className="break-words text-xs text-muted-foreground">{signature.userAgent}</dd>
          </div>
        ) : null}

        {signature.disclosureText ? (
          <details className="rounded-md border bg-secondary/40 p-3">
            <summary className="cursor-pointer text-xs font-medium">
              Disclosure shown at signing
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {signature.disclosureText}
            </p>
          </details>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          This record is permanent and cannot be edited or deleted.
        </p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
