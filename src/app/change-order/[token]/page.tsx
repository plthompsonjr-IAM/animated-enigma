import { CheckCircle2, XCircle, Clock, Printer } from 'lucide-react';
import { publicEnv } from '@/lib/env';
import { getChangeOrderByToken, signatureForChangeOrder } from '@/lib/change-orders/queries';
import { recordChangeOrderView } from '@/lib/change-orders/actions';
import {
  costChange,
  isAwaitingClient,
  isItemDirection,
  revisedContractValue,
  type ChangeOrderItemInput,
} from '@/lib/change-orders/change-orders-core';
import { resolveDisclosure } from '@/lib/signatures/signature-core';
import { ChangeOrderDocument } from '@/components/change-orders/change-order-document';
import { ChangeOrderRespondForm } from './respond-form';
import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { toNum } from '@/lib/catalog/catalog-core';

export const metadata = {
  title: 'Change order',
  robots: { index: false, follow: false },
};

export default async function PublicChangeOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!publicEnv.supabaseUrl || !process.env.DATABASE_URL) return <Unavailable />;

  const co = await getChangeOrderByToken(token);
  if (!co) return <Unavailable />;

  // Log the view (bumps sent → viewed). Best-effort; never blocks the render.
  await recordChangeOrderView(token).catch(() => {});

  const items: ChangeOrderItemInput[] = co.items.map((i) => ({
    direction: isItemDirection(i.direction) ? i.direction : 'added',
    description: i.description,
    amount: i.amount,
  }));
  const net = costChange(items);

  // Show the client what their contract total becomes if they approve.
  let revised: number | null = null;
  if (co.contractId) {
    const [contract] = await getDb()
      .select({ contractValue: schema.contracts.contractValue })
      .from(schema.contracts)
      .where(eq(schema.contracts.id, co.contractId));
    if (contract) {
      revised = revisedContractValue(toNum(contract.contractValue), [
        { status: 'approved', costChange: net },
      ]);
    }
  }

  const signature = await signatureForChangeOrder(co.organizationId, co.changeOrderId);
  const [org] = await getDb()
    .select({ disclosure: schema.organizations.signatureDisclosure })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, co.organizationId));

  const respondable = isAwaitingClient(co.status);

  return (
    <div className="min-h-dvh bg-secondary/40 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <ChangeOrderDocument
          org={{ name: co.orgName, tagline: co.orgTagline }}
          client={{ name: co.clientName ?? 'Client' }}
          project={{ name: co.projectName ?? 'Project', number: co.projectNumber }}
          changeOrderNumber={co.changeOrderNumber}
          reason={co.reason}
          clientExplanation={co.clientExplanation}
          items={items}
          netChange={net}
          scheduleChangeDays={co.scheduleChangeDays ?? 0}
          revisedContractValue={revised}
          signature={
            signature
              ? {
                  signerName: signature.signerName,
                  signerEmail: signature.signerEmail,
                  signedAt: signature.signedAt,
                  ipAddress: signature.ipAddress,
                }
              : null
          }
        />

        {respondable ? (
          <ChangeOrderRespondForm
            token={token}
            orgName={co.orgName}
            disclosure={resolveDisclosure(org?.disclosure)}
          />
        ) : (
          <StatusBanner status={co.status} orgName={co.orgName} />
        )}

        <div className="text-center">
          <a
            href={`/change-order/${token}/print`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Printer className="h-4 w-4" />
            Download PDF
          </a>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Sent by {co.orgName}. Questions? Reply to the message that shared this link.
        </p>
      </div>
    </div>
  );
}

function StatusBanner({ status, orgName }: { status: string; orgName: string }) {
  const map: Record<
    string,
    { icon: typeof CheckCircle2; title: string; body: string; tone: string }
  > = {
    approved: {
      icon: CheckCircle2,
      title: 'You approved this change order',
      body: `${orgName} has been notified and will proceed with the change.`,
      tone: 'text-emerald-600',
    },
    incorporated: {
      icon: CheckCircle2,
      title: 'This change order is in effect',
      body: `The change has been folded into your project by ${orgName}.`,
      tone: 'text-emerald-600',
    },
    declined: {
      icon: XCircle,
      title: 'You declined this change order',
      body: `${orgName} will follow up with you.`,
      tone: 'text-muted-foreground',
    },
    canceled: {
      icon: XCircle,
      title: 'This change order was withdrawn',
      body: `Please contact ${orgName} with any questions.`,
      tone: 'text-muted-foreground',
    },
    draft: {
      icon: Clock,
      title: 'This change order isn’t ready yet',
      body: `Please contact ${orgName}.`,
      tone: 'text-muted-foreground',
    },
  };
  const cfg = map[status] ?? map.draft!;
  const Icon = cfg.icon;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-6 text-center">
      <Icon className={`mx-auto h-8 w-8 ${cfg.tone}`} />
      <h2 className="text-lg font-bold">{cfg.title}</h2>
      <p className="text-sm text-muted-foreground">{cfg.body}</p>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
        <h1 className="text-lg font-bold">Change order not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This link is invalid or has been replaced. Please contact the sender for an up-to-date
          link.
        </p>
      </div>
    </div>
  );
}
