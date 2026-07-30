import { publicEnv } from '@/lib/env';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getChangeOrderByToken, signatureForChangeOrder } from '@/lib/change-orders/queries';
import {
  costChange,
  isItemDirection,
  revisedContractValue,
  type ChangeOrderItemInput,
} from '@/lib/change-orders/change-orders-core';
import { toNum } from '@/lib/catalog/catalog-core';
import { ChangeOrderDocument } from '@/components/change-orders/change-order-document';
import { PrintToolbar } from '@/components/proposals/print-toolbar';

export const metadata = {
  title: 'Change order',
  robots: { index: false, follow: false },
};

/** Public, chrome-free printable change order (client's copy). */
export default async function ChangeOrderPrintPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!publicEnv.supabaseUrl || !process.env.DATABASE_URL) return <Unavailable />;

  const co = await getChangeOrderByToken(token);
  if (!co) return <Unavailable />;

  const items: ChangeOrderItemInput[] = co.items.map((i) => ({
    direction: isItemDirection(i.direction) ? i.direction : 'added',
    description: i.description,
    amount: i.amount,
  }));
  const net = costChange(items);

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

  return (
    <div className="min-h-dvh bg-white">
      <PrintToolbar backHref={`/change-order/${token}`} title={co.changeOrderNumber} />
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
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
        <h1 className="text-lg font-bold">Change order not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">This link is invalid or has expired.</p>
      </div>
    </div>
  );
}
