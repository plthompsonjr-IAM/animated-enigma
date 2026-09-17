import { notFound, redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getContract, paymentScheduleFor } from '@/lib/contracts/queries';
import { signatureForVersion } from '@/lib/proposals/queries';
import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { toNum } from '@/lib/catalog/catalog-core';
import {
  formatMoney,
  isPaymentStructure,
  type MilestoneInput,
  type PaymentStructure,
} from '@/lib/contracts/contracts-core';
import { resolveTerms } from '@/lib/contracts/terms-core';
import { formatAddress } from '@/lib/clients/clients-core';
import { ContractPrintDocument } from '@/components/contracts/contract-print-document';
import { PrintToolbar } from '@/components/proposals/print-toolbar';

export const metadata = { title: 'Contract', robots: { index: false, follow: false } };

export default async function ContractPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/contracts');
  if (!can(ctx.activeOrg.roles, 'financials:read', ctx.activeOrg.extraPermissions)) {
    redirect('/contracts');
  }

  const orgId = ctx.activeOrg.organizationId;
  const row = await getContract(orgId, id);
  if (!row) notFound();

  const contract = row.contract;
  const value = toNum(contract.contractValue);

  const db = getDb();
  const [org] = await db
    .select({
      name: schema.organizations.name,
      tagline: schema.organizations.tagline,
      contractTerms: schema.organizations.contractTerms,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));

  // The property address is a placeholder in the terms, so resolve it properly
  // rather than leaving a visible {{project_address}} in a signed document.
  const [projectRow] = await db
    .select({ propertyId: schema.projects.propertyId })
    .from(schema.projects)
    .where(eq(schema.projects.id, contract.projectId));
  let projectAddress: string | null = null;
  if (projectRow?.propertyId) {
    const [property] = await db
      .select({ address: schema.properties.address })
      .from(schema.properties)
      .where(eq(schema.properties.id, projectRow.propertyId));
    projectAddress = property ? formatAddress(property.address) || null : null;
  }

  const { schedule, milestones } = await paymentScheduleFor(orgId, contract.id);
  const structure: PaymentStructure =
    schedule && isPaymentStructure(schedule.structureType)
      ? schedule.structureType
      : 'deposit_balance';
  const milestoneInputs: MilestoneInput[] = milestones.map((m) => ({
    name: m.name,
    amount: m.amount,
    percentage: m.percentage,
    triggerType: (m.triggerType as MilestoneInput['triggerType']) ?? null,
    dueDate: m.dueDate,
  }));

  // Carry the client's proposal signature onto the contract when there is one.
  let signature = null;
  if (contract.proposalId) {
    const [proposal] = await db
      .select({ currentVersionId: schema.proposals.currentVersionId })
      .from(schema.proposals)
      .where(eq(schema.proposals.id, contract.proposalId));
    if (proposal?.currentVersionId) {
      const found = await signatureForVersion(orgId, proposal.currentVersionId);
      signature = found
        ? {
            signerName: found.signerName,
            signerEmail: found.signerEmail,
            signedAt: found.signedAt,
            ipAddress: found.ipAddress,
          }
        : null;
    }
  }

  const orgName = org?.name ?? 'Our Company';
  const clientName = row.clientName ?? 'Client';
  const projectName = row.projectName ?? 'Project';

  return (
    <>
      <PrintToolbar backHref={`/contracts/${contract.id}`} title={contract.contractNumber} />
      <ContractPrintDocument
        org={{ name: orgName, tagline: org?.tagline ?? null }}
        client={{ name: clientName }}
        project={{ name: projectName, number: row.projectNumber ?? null, address: projectAddress }}
        contractNumber={contract.contractNumber}
        contractValue={value}
        scopeSummary={contract.scopeSummary}
        structure={structure}
        milestones={milestoneInputs}
        terms={resolveTerms(org?.contractTerms)}
        variables={{
          org_name: orgName,
          client_name: clientName,
          contract_number: contract.contractNumber,
          contract_value: formatMoney(value),
          project_name: projectName,
          project_address: projectAddress ?? undefined,
          today: new Date().toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
        }}
        signature={signature}
      />
    </>
  );
}
