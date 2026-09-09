import type { ProposalSnapshot } from '@/lib/proposals/proposal-core';
import { formatMoney } from '@/lib/proposals/proposal-core';
import { SECTION_TYPE_LABELS, isSectionType } from '@/lib/scopes/scopes-core';
import { formatSignedAt } from '@/lib/signatures/signature-core';

/**
 * Print-optimized, client-safe proposal document (Task 18). This is the source
 * for the downloadable PDF: the client (or the office) opens the print route and
 * uses the browser's native "Save as PDF".
 *
 * Deliberately self-contained and theme-independent — a proposal PDF must always
 * render light and branded regardless of the viewer's dark/light preference, so
 * it uses fixed brand colors (not the app's CSS variables, which flip with the
 * theme). Like {@link ProposalDocument} it exposes only org/project/scope and the
 * single client total — never costs or margins.
 */
export function ProposalPrintDocument({
  snapshot,
  proposalNumber,
  signature,
}: {
  snapshot: ProposalSnapshot;
  proposalNumber: string;
  /** Present once the client has e-signed (Task 19) — printed as the record. */
  signature?: SignatureBlock | null;
}) {
  const { org, client, project, scope, pricing } = snapshot;
  return (
    <div className="ptpp">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <header className="ptpp-header">
        <div className="ptpp-brand">
          <span className="ptpp-mark">PT</span>
          <span className="ptpp-orgname">{org.name}</span>
        </div>
        {org.tagline ? <p className="ptpp-tagline">{org.tagline}</p> : null}
        <h1 className="ptpp-title">Project Proposal</h1>
        <p className="ptpp-number">{proposalNumber}</p>
      </header>

      <section className="ptpp-meta">
        <Field label="Prepared for" value={client.name} />
        <Field label="Project" value={`${project.number} · ${project.name}`} />
        {project.type ? <Field label="Type" value={project.type} /> : null}
        {project.address ? <Field label="Location" value={project.address} /> : null}
      </section>

      {scope.sections.length > 0 ? (
        <section>
          <h2 className="ptpp-section-title">Scope of work</h2>
          <div className="ptpp-scope">
            {scope.sections.map((s, i) => (
              <div key={i} className="ptpp-scope-group">
                <div className="ptpp-scope-head">
                  {isSectionType(s.sectionType) ? SECTION_TYPE_LABELS[s.sectionType] : s.title}
                </div>
                {s.items.length > 0 ? (
                  <ul className="ptpp-items">
                    {s.items.map((item, j) => (
                      <li key={j} className="ptpp-item">
                        <span className="ptpp-bullet" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ptpp-item ptpp-item-empty">{s.title}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="ptpp-total">
        <span className="ptpp-total-label">Total investment</span>
        <span className="ptpp-total-value">{formatMoney(pricing.total)}</span>
      </section>
      {pricing.expiresAt ? (
        <p className="ptpp-valid">
          Valid through{' '}
          {new Date(pricing.expiresAt).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      ) : null}

      {signature ? (
        <section className="ptpp-signature">
          <h2 className="ptpp-section-title">Accepted &amp; signed</h2>
          <div className="ptpp-sig-name">{signature.signerName}</div>
          <div className="ptpp-sig-meta">
            Electronically signed {formatSignedAt(signature.signedAt)}
            {signature.signerEmail ? ` · ${signature.signerEmail}` : ''}
            {signature.ipAddress ? ` · IP ${signature.ipAddress}` : ''}
          </div>
        </section>
      ) : null}

      {snapshot.preparedBy ? (
        <footer className="ptpp-footer">
          Prepared by {snapshot.preparedBy} ·{' '}
          {new Date(snapshot.preparedAt).toLocaleDateString('en-US')}
        </footer>
      ) : null}
    </div>
  );
}

export interface SignatureBlock {
  signerName: string;
  signerEmail: string | null;
  signedAt: string | Date;
  ipAddress: string | null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ptpp-field-label">{label}</div>
      <div className="ptpp-field-value">{value}</div>
    </div>
  );
}

/**
 * Scoped styles for the document plus the global print rules (page margins,
 * color fidelity, white paper). Colors are the fixed PTTR brand values so the
 * PDF is identical for every viewer.
 */
const PRINT_CSS = `
.ptpp {
  color: hsl(20 14% 10%);
  background: #fff;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 32px;
  line-height: 1.5;
}
.ptpp * { box-sizing: border-box; }
.ptpp-header { text-align: center; border-bottom: 2px solid hsl(20 6% 88%); padding-bottom: 16px; margin-bottom: 24px; }
.ptpp-brand { display: flex; align-items: center; justify-content: center; gap: 8px; }
.ptpp-mark { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 6px; background: hsl(24 94% 50%); color: #fff; font-weight: 800; font-size: 14px; }
.ptpp-orgname { font-size: 20px; font-weight: 800; }
.ptpp-tagline { color: hsl(20 6% 45%); font-size: 13px; margin: 2px 0 0; }
.ptpp-title { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; margin: 10px 0 0; }
.ptpp-number { color: hsl(20 6% 45%); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; margin: 4px 0 0; }
.ptpp-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
.ptpp-field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 600; }
.ptpp-field-value { font-size: 14px; font-weight: 500; margin-top: 2px; }
.ptpp-section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 700; margin: 0 0 8px; }
.ptpp-scope { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.ptpp-scope-group { border: 1px solid hsl(20 6% 88%); border-radius: 8px; overflow: hidden; break-inside: avoid; }
.ptpp-scope-head { background: hsl(30 8% 95%); padding: 6px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 40%); border-bottom: 1px solid hsl(20 6% 88%); }
.ptpp-items { list-style: none; margin: 0; padding: 0; }
.ptpp-item { display: flex; gap: 8px; padding: 8px 12px; font-size: 14px; border-top: 1px solid hsl(20 6% 92%); }
.ptpp-items .ptpp-item:first-child { border-top: none; }
.ptpp-item-empty { color: hsl(20 6% 45%); }
.ptpp-bullet { flex: none; width: 6px; height: 6px; margin-top: 7px; border-radius: 9999px; background: hsl(24 94% 50%); }
.ptpp-total { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 2px solid hsl(24 94% 50% / 0.35); background: hsl(24 94% 50% / 0.06); border-radius: 8px; padding: 16px; break-inside: avoid; }
.ptpp-total-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 40%); font-weight: 700; }
.ptpp-total-value { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }
.ptpp-valid { font-size: 12px; color: hsl(20 6% 45%); margin: 6px 0 0; }
.ptpp-footer { border-top: 1px solid hsl(20 6% 88%); margin-top: 24px; padding-top: 12px; font-size: 12px; color: hsl(20 6% 45%); }
.ptpp-signature { margin-top: 24px; border: 1px solid hsl(20 6% 88%); border-radius: 8px; padding: 16px; break-inside: avoid; }
.ptpp-sig-name { font-size: 22px; font-family: 'Segoe Script', 'Snell Roundhand', 'Brush Script MT', cursive; border-bottom: 1px solid hsl(20 6% 60%); padding-bottom: 6px; margin-bottom: 6px; }
.ptpp-sig-meta { font-size: 11px; color: hsl(20 6% 45%); }

@page { margin: 16mm; }
@media print {
  html, body { background: #fff !important; }
  .ptpp { max-width: none; margin: 0; padding: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;
