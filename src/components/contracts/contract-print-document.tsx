import {
  formatMoney,
  MILESTONE_TRIGGER_LABELS,
  milestoneAmount,
} from '@/lib/contracts/contracts-core';
import type { MilestoneInput, PaymentStructure } from '@/lib/contracts/contracts-core';
import { PAYMENT_STRUCTURE_LABELS } from '@/lib/contracts/contracts-core';
import { renderSections, type TermsSection, type TermsVariables } from '@/lib/contracts/terms-core';
import { formatSignedAt } from '@/lib/signatures/signature-core';

export interface ContractPrintProps {
  org: { name: string; tagline: string | null };
  client: { name: string };
  project: { name: string; number: string | null; address: string | null };
  contractNumber: string;
  contractValue: number;
  scopeSummary: string | null;
  structure: PaymentStructure;
  milestones: MilestoneInput[];
  terms: TermsSection[];
  variables: TermsVariables;
  /** The client's e-signature carried over from the accepted proposal, if any. */
  signature?: {
    signerName: string;
    signerEmail: string | null;
    signedAt: string | Date;
    ipAddress: string | null;
  } | null;
}

/**
 * The printable contract. Same approach as the proposal PDF: a self-contained,
 * theme-independent document the browser turns into a PDF, so there is no
 * server-side PDF dependency and it looks identical for everyone.
 *
 * Layout follows how a construction contract is normally read: who, what, how
 * much, how it gets paid, the terms, then signatures.
 */
export function ContractPrintDocument({
  org,
  client,
  project,
  contractNumber,
  contractValue,
  scopeSummary,
  structure,
  milestones,
  terms,
  variables,
  signature,
}: ContractPrintProps) {
  const rendered = renderSections(terms, variables);
  const fixedSchedule = structure !== 'time_materials' && structure !== 'maintenance';

  return (
    <div className="ptcc">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <header className="ptcc-header">
        <div className="ptcc-brand">
          <span className="ptcc-mark">PT</span>
          <span className="ptcc-orgname">{org.name}</span>
        </div>
        {org.tagline ? <p className="ptcc-tagline">{org.tagline}</p> : null}
        <h1 className="ptcc-title">Construction Contract</h1>
        <p className="ptcc-number">{contractNumber}</p>
      </header>

      <section className="ptcc-meta">
        <Field label="Owner" value={client.name} />
        <Field
          label="Project"
          value={project.number ? `${project.number} · ${project.name}` : project.name}
        />
        {project.address ? <Field label="Property" value={project.address} /> : null}
        <Field label="Contract price" value={formatMoney(contractValue)} />
      </section>

      {scopeSummary ? (
        <section className="ptcc-block">
          <h2 className="ptcc-h2">Scope of work</h2>
          <p className="ptcc-p">{scopeSummary}</p>
        </section>
      ) : null}

      <section className="ptcc-block">
        <h2 className="ptcc-h2">Payment schedule</h2>
        <p className="ptcc-p ptcc-muted">{PAYMENT_STRUCTURE_LABELS[structure]}</p>
        {fixedSchedule && milestones.length > 0 ? (
          <table className="ptcc-table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Due</th>
                <th className="ptcc-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m, i) => (
                <tr key={i}>
                  <td>{m.name}</td>
                  <td>{m.triggerType ? MILESTONE_TRIGGER_LABELS[m.triggerType] : '—'}</td>
                  <td className="ptcc-right">{formatMoney(milestoneAmount(m, contractValue))}</td>
                </tr>
              ))}
              <tr className="ptcc-total-row">
                <td colSpan={2}>Total</td>
                <td className="ptcc-right">{formatMoney(contractValue)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="ptcc-p">
            Billed as work proceeds; no fixed draw schedule applies to this agreement.
          </p>
        )}
      </section>

      <section className="ptcc-block">
        <h2 className="ptcc-h2">Terms and conditions</h2>
        <ol className="ptcc-terms">
          {rendered.map((section, i) => (
            <li key={i} className="ptcc-term">
              {section.heading ? <span className="ptcc-term-h">{section.heading}. </span> : null}
              <span>{section.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="ptcc-signatures">
        <h2 className="ptcc-h2">Signatures</h2>
        <div className="ptcc-sig-grid">
          <div className="ptcc-sig">
            <div className="ptcc-sig-label">Owner</div>
            {signature ? (
              <>
                <div className="ptcc-sig-name">{signature.signerName}</div>
                <div className="ptcc-sig-meta">
                  Electronically signed {formatSignedAt(signature.signedAt)}
                  {signature.signerEmail ? ` · ${signature.signerEmail}` : ''}
                  {signature.ipAddress ? ` · IP ${signature.ipAddress}` : ''}
                </div>
              </>
            ) : (
              <>
                <div className="ptcc-sig-line" />
                <div className="ptcc-sig-meta">{client.name} — signature and date</div>
              </>
            )}
          </div>

          <div className="ptcc-sig">
            <div className="ptcc-sig-label">Contractor</div>
            <div className="ptcc-sig-line" />
            <div className="ptcc-sig-meta">{org.name} — signature and date</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ptcc-field-label">{label}</div>
      <div className="ptcc-field-value">{value}</div>
    </div>
  );
}

const PRINT_CSS = `
.ptcc {
  color: hsl(20 14% 10%);
  background: #fff;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  max-width: 760px;
  margin: 0 auto;
  padding: 40px 32px;
  line-height: 1.55;
}
.ptcc * { box-sizing: border-box; }
.ptcc-header { text-align: center; border-bottom: 2px solid hsl(20 6% 88%); padding-bottom: 16px; margin-bottom: 20px; }
.ptcc-brand { display: flex; align-items: center; justify-content: center; gap: 8px; }
.ptcc-mark { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 6px; background: hsl(24 94% 50%); color: #fff; font-weight: 800; font-size: 13px; }
.ptcc-orgname { font-size: 19px; font-weight: 800; }
.ptcc-tagline { color: hsl(20 6% 45%); font-size: 12px; margin: 2px 0 0; }
.ptcc-title { font-size: 21px; font-weight: 800; margin: 10px 0 0; }
.ptcc-number { color: hsl(20 6% 45%); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; margin: 4px 0 0; }
.ptcc-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
.ptcc-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 600; }
.ptcc-field-value { font-size: 14px; font-weight: 500; margin-top: 2px; }
.ptcc-block { margin-bottom: 20px; break-inside: avoid; }
.ptcc-h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 700; margin: 0 0 8px; border-bottom: 1px solid hsl(20 6% 88%); padding-bottom: 4px; }
.ptcc-p { font-size: 13px; margin: 0 0 8px; }
.ptcc-muted { color: hsl(20 6% 45%); }
.ptcc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ptcc-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); border-bottom: 1px solid hsl(20 6% 88%); padding: 6px 4px; }
.ptcc-table td { padding: 6px 4px; border-bottom: 1px solid hsl(20 6% 92%); }
.ptcc-right { text-align: right; font-variant-numeric: tabular-nums; }
.ptcc-total-row td { font-weight: 700; border-top: 2px solid hsl(20 6% 80%); border-bottom: none; }
.ptcc-terms { font-size: 12px; padding-left: 18px; margin: 0; }
.ptcc-term { margin-bottom: 8px; break-inside: avoid; }
.ptcc-term-h { font-weight: 700; }
.ptcc-signatures { margin-top: 28px; break-inside: avoid; }
.ptcc-sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.ptcc-sig-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 600; margin-bottom: 18px; }
.ptcc-sig-name { font-size: 20px; font-family: 'Segoe Script', 'Snell Roundhand', 'Brush Script MT', cursive; border-bottom: 1px solid hsl(20 6% 60%); padding-bottom: 4px; }
.ptcc-sig-line { border-bottom: 1px solid hsl(20 6% 60%); height: 26px; }
.ptcc-sig-meta { font-size: 10px; color: hsl(20 6% 45%); margin-top: 4px; }

@page { margin: 16mm; }
@media print {
  html, body { background: #fff !important; }
  .ptcc { max-width: none; margin: 0; padding: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;
