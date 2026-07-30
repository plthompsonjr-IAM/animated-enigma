import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getInvoice } from '@/lib/invoices/queries';
import {
  balanceOf,
  type InvoiceLineInput,
  type InvoiceType,
} from '@/lib/invoices/invoices-core';
import { toNum } from '@/lib/catalog/catalog-core';
import { formatAddress } from '@/lib/clients/clients-core';
import { InvoicePrintDocument } from '@/components/invoices/invoice-print-document';
import { PrintToolbar } from '@/components/proposals/print-toolbar';

export const metadata = { title: 'Invoice', robots: { index: false, follow: false } };

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/invoices');
  if (!can(ctx.activeOrg.roles, 'financials:read', ctx.activeOrg.extraPermissions)) {
    redirect('/invoices');
  }

  const orgId = ctx.activeOrg.organizationId;
  const row = await getInvoice(orgId, id);
  if (!row) notFound();

  const invoice = row.invoice;
  const db = getDb();

  const [org] = await db
    .select({ name: schema.organizations.name, tagline: schema.organizations.tagline })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));

  // Bill-to address comes from the project's property, same as the contract.
  const [projectRow] = await db
    .select({ propertyId: schema.projects.propertyId })
    .from(schema.projects)
    .where(eq(schema.projects.id, invoice.projectId));
  let projectAddress: string | null = null;
  if (projectRow?.propertyId) {
    const [property] = await db
      .select({ address: schema.properties.address })
      .from(schema.properties)
      .where(eq(schema.properties.id, projectRow.propertyId));
    projectAddress = property ? formatAddress(property.address) || null : null;
  }

  const lines: InvoiceLineInput[] = row.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxable: l.taxable,
  }));

  // Print the stored amounts, not recomputed ones — an issued invoice is frozen,
  // and the client's copy has to match what the ledger says they owe.
  const total = toNum(invoice.total);
  const amountPaid = toNum(invoice.amountPaid);

  return (
    <>
      <PrintToolbar backHref={`/invoices/${invoice.id}`} title={invoice.invoiceNumber} />
      <InvoicePrintDocument
        org={{ name: org?.name ?? 'Our Company', tagline: org?.tagline ?? null }}
        client={{ name: row.clientName ?? 'Client' }}
        project={{
          name: row.projectName ?? 'Project',
          number: row.projectNumber ?? null,
          address: projectAddress,
        }}
        invoiceNumber={invoice.invoiceNumber}
        invoiceType={invoice.invoiceType as InvoiceType}
        issuedAt={invoice.issuedAt}
        dueDate={invoice.dueDate}
        lines={lines}
        subtotal={toNum(invoice.subtotal)}
        taxAmount={toNum(invoice.taxAmount)}
        credits={toNum(invoice.credits)}
        total={total}
        amountPaid={amountPaid}
        balance={balanceOf(total, amountPaid)}
        paymentInstructions={invoice.paymentInstructions}
        notes={invoice.notes}
      />
    </>
  );
}
