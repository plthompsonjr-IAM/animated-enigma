import { formatMoney } from '@/lib/invoices/invoices-core';
import {
  ITEM_DIRECTION_LABELS,
  formatScheduleChange,
  itemDelta,
  type ChangeOrderItemInput,
} from '@/lib/change-orders/change-orders-core';
import { formatSignedAt } from '@/lib/signatures/signature-core';

export interface ChangeOrderDocumentProps {
  org: { name: string; tagline: string | null };
  client: { name: string };
  project: { name: string; number: string | null };
  changeOrderNumber: string;
  reason: string | null;
  clientExplanation: string | null;
  items: ChangeOrderItemInput[];
  netChange: number;
  scheduleChangeDays: number;
  revisedContractValue?: number | null;
  signature?: {
    signerName: string;
    signerEmail: string | null;
    signedAt: string | Date;
    ipAddress: string | null;
  } | null;
}

/**
 * The client-facing change-order document, shared by the public approval page
 * and the printable version. Client-safe by construction: it shows only the
 * itemisation the client is being asked to approve — never internal notes,
 * costs, or margins.
 */
export function ChangeOrderDocument({
  org,
  client,
  project,
  changeOrderNumber,
  reason,
  clientExplanation,
  items,
  netChange,
  scheduleChangeDays,
  revisedContractValue,
  signature,
}: ChangeOrderDocumentProps) {
  return (
    <div className="ptco">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <header className="ptco-header">
        <div className="ptco-brand">
          <span className="ptco-mark">PT</span>
          <span className="ptco-orgname">{org.name}</span>
        </div>
        {org.tagline ? <p className="ptco-tagline">{org.tagline}</p> : null}
        <h1 className="ptco-title">Change Order</h1>
        <p className="ptco-number">{changeOrderNumber}</p>
      </header>

      <section className="ptco-meta">
        <Field label="Prepared for" value={client.name} />
        <Field
          label="Project"
          value={project.number ? `${project.number} · ${project.name}` : project.name}
        />
      </section>

      {clientExplanation || reason ? (
        <section className="ptco-block">
          <h2 className="ptco-h2">What’s changing and why</h2>
          <p className="ptco-p">{clientExplanation || reason}</p>
        </section>
      ) : null}

      <section className="ptco-block">
        <h2 className="ptco-h2">Details</h2>
        <table className="ptco-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th className="ptco-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td>{item.description}</td>
                <td>{ITEM_DIRECTION_LABELS[item.direction]}</td>
                <td className="ptco-right">{formatMoney(itemDelta(item))}</td>
              </tr>
            ))}
            <tr className="ptco-total-row">
              <td colSpan={2}>Net change</td>
              <td className="ptco-right">{formatMoney(netChange)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="ptco-summary">
        <div className="ptco-summary-row">
          <span>Change to your price</span>
          <strong>{formatMoney(netChange)}</strong>
        </div>
        <div className="ptco-summary-row">
          <span>Change to the schedule</span>
          <strong>{formatScheduleChange(scheduleChangeDays)}</strong>
        </div>
        {revisedContractValue != null ? (
          <div className="ptco-summary-row ptco-summary-total">
            <span>Revised contract total</span>
            <strong>{formatMoney(revisedContractValue)}</strong>
          </div>
        ) : null}
      </section>

      {signature ? (
        <section className="ptco-signature">
          <h2 className="ptco-h2">Approved &amp; signed</h2>
          <div className="ptco-sig-name">{signature.signerName}</div>
          <div className="ptco-sig-meta">
            Electronically signed {formatSignedAt(signature.signedAt)}
            {signature.signerEmail ? ` · ${signature.signerEmail}` : ''}
            {signature.ipAddress ? ` · IP ${signature.ipAddress}` : ''}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ptco-field-label">{label}</div>
      <div className="ptco-field-value">{value}</div>
    </div>
  );
}

const PRINT_CSS = `
.ptco {
  color: hsl(20 14% 10%);
  background: #fff;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 28px;
  line-height: 1.55;
  border-radius: 8px;
}
.ptco * { box-sizing: border-box; }
.ptco-header { text-align: center; border-bottom: 2px solid hsl(20 6% 88%); padding-bottom: 16px; margin-bottom: 20px; }
.ptco-brand { display: flex; align-items: center; justify-content: center; gap: 8px; }
.ptco-mark { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 6px; background: hsl(24 94% 50%); color: #fff; font-weight: 800; font-size: 13px; }
.ptco-orgname { font-size: 19px; font-weight: 800; }
.ptco-tagline { color: hsl(20 6% 45%); font-size: 12px; margin: 2px 0 0; }
.ptco-title { font-size: 21px; font-weight: 800; margin: 10px 0 0; }
.ptco-number { color: hsl(20 6% 45%); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; margin: 4px 0 0; }
.ptco-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
.ptco-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 600; }
.ptco-field-value { font-size: 14px; font-weight: 500; margin-top: 2px; }
.ptco-block { margin-bottom: 20px; break-inside: avoid; }
.ptco-h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 700; margin: 0 0 8px; border-bottom: 1px solid hsl(20 6% 88%); padding-bottom: 4px; }
.ptco-p { font-size: 14px; margin: 0; }
.ptco-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ptco-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); border-bottom: 1px solid hsl(20 6% 88%); padding: 6px 4px; }
.ptco-table td { padding: 6px 4px; border-bottom: 1px solid hsl(20 6% 92%); }
.ptco-right { text-align: right; font-variant-numeric: tabular-nums; }
.ptco-total-row td { font-weight: 700; border-top: 2px solid hsl(20 6% 80%); border-bottom: none; }
.ptco-summary { border: 2px solid hsl(24 94% 50% / 0.35); background: hsl(24 94% 50% / 0.06); border-radius: 8px; padding: 14px 16px; break-inside: avoid; }
.ptco-summary-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; padding: 3px 0; }
.ptco-summary-row strong { font-variant-numeric: tabular-nums; }
.ptco-summary-total { border-top: 1px solid hsl(24 94% 50% / 0.25); margin-top: 4px; padding-top: 7px; font-size: 16px; }
.ptco-signature { margin-top: 24px; break-inside: avoid; }
.ptco-sig-name { font-size: 20px; font-family: 'Segoe Script', 'Snell Roundhand', 'Brush Script MT', cursive; border-bottom: 1px solid hsl(20 6% 60%); padding-bottom: 4px; display: inline-block; min-width: 220px; }
.ptco-sig-meta { font-size: 10px; color: hsl(20 6% 45%); margin-top: 4px; }

@page { margin: 16mm; }
@media print {
  html, body { background: #fff !important; }
  .ptco { max-width: none; margin: 0; padding: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;
