# PT's Tactical Foreman — Product Requirements Document

| | |
|---|---|
| **Product** | PT's Tactical Foreman |
| **Company** | PT's Tactical Renovations (PTTR) |
| **Tagline** | "Your Home, Our Mission." |
| **Document version** | 1.0 |
| **Date** | 2026-07-18 |
| **Status** | Draft — pending owner approval |
| **Task** | Phase 1, Task 1 of the PT's Tactical Foreman build series |

---

## 1. Purpose

### 1.1 Problem statement

Small and mid-size renovation contractors run their business across phone calls, text messages, paper notes, spreadsheets, and memory. Critical information — what the client asked for, what was measured, what was promised, what was approved, what changed — is scattered or lost. The result is slow estimates, missed follow-ups, unpriced change orders, disputes over scope, and profit leakage that is invisible until the job is over.

### 1.2 Product purpose

PT's Tactical Foreman is an AI-powered general contractor command system. It moves a contractor from the first client conversation through organized job intake, estimating, scope of work, proposal, approval, job execution, documentation, invoicing, follow-up, and long-term project memory — in one system, operable from a phone on a jobsite.

The application must function as an **operational contractor platform**, not a demonstration dashboard. Every feature exists to shorten the path from "client called" to "job closed out profitably and documented."

### 1.3 Product goals

1. Capture every lead and never miss a follow-up.
2. Convert intake conversations, photos, and dictated notes into structured scopes and estimates faster than manual methods.
3. Produce professional, branded proposals and contracts with electronic approval.
4. Keep field execution documented daily (logs, photos, time) with minimal typing.
5. Formalize change orders so no work is performed unpriced.
6. Track invoicing, payments, and real-time job profitability.
7. Preserve a permanent, searchable memory of every project decision.
8. Keep AI assistance useful but controlled: AI drafts, humans approve.

### 1.4 Non-goals (for the MVP)

- Full double-entry accounting (integrates with, does not replace, accounting software).
- Payroll processing (tracks time and labor cost; does not run payroll).
- Native iOS/Android apps (mobile-responsive web first; architecture must not preclude native apps later).
- Multi-language support.
- Automated legal advice; the system stores configurable legal language but does not generate binding legal opinions.

---

## 2. Primary Users

| User | Context | Primary needs |
|---|---|---|
| Owner / Administrator (Patrick) | Runs the business; often in the field | Total visibility, pipeline, profitability, final approvals, settings |
| Office Manager | Desk-based | Client records, scheduling, invoicing, document handling, communications |
| Estimator | Office + site visits | Intake data, measurements, cost catalog, estimate versions, margin tools |
| Project Manager | Office + field | Schedules, tasks, budgets, change orders, subcontractor coordination |
| Field Foreman | Jobsite, phone-first | Daily logs, tasks, photos, time, material needs, one-handed operation |
| Technician / Laborer | Jobsite, phone-first | Clock in/out, assigned tasks, photo upload |
| Sales Representative | Mobile | Leads, follow-ups, site visits, proposal status |
| Client | External, occasional | Proposals, approvals, schedule, progress photos, invoices, payments, messages |
| Subcontractor | External, mobile | Assignments, scope, schedule, document uploads, invoices, progress reporting |

A single small organization may have one person filling several internal roles (at PTTR, the Owner may initially act as Estimator, PM, and Foreman). Role design must allow one user to hold multiple roles.

---

## 3. User Roles and Permissions

### 3.1 Role definitions

| Role | Description |
|---|---|
| **Owner / Administrator** | Full access to all data and settings within the organization. Manages users, roles, branding, financial settings, integrations, and AI configuration. Only role that can change permissions, void finalized financial documents (via formal correction), or export/delete organization data. |
| **Office Manager** | Full access to clients, leads, scheduling, documents, communications, invoicing, and payments. No access to organization settings, user management, or internal margin configuration unless granted. |
| **Estimator** | Full access to intake data, scopes, estimates, cost catalog, and proposals. Sees internal costs and margins. Cannot finalize contracts or issue invoices unless also granted those permissions. |
| **Project Manager** | Full access to assigned projects: schedule, tasks, team, daily logs, photos, documents, change orders, budgets. Sees project financials for assigned projects. Can draft change orders and invoices for approval. |
| **Field Foreman** | Access to assigned projects: tasks, daily logs, photos, time entries, material requests, schedule. Sees scope and schedule but **not** internal costs, margins, or estimate details. |
| **Technician / Laborer** | Access limited to own time entries, assigned tasks, and photo/log uploads on assigned projects. No financial visibility. |
| **Sales Representative** | Full access to leads and clients they own or are assigned; site visit scheduling; proposal status visibility. Sees selling prices but not internal cost breakdowns unless granted. |
| **Client (portal)** | External role scoped to their own projects only: approved scope, proposals, change orders, schedule summary, approved photos, invoices, payments, messages, warranty requests. |
| **Subcontractor (portal)** | External role scoped to assigned projects only: assigned scope, schedule, document upload, sub invoices, progress reporting, messaging with PM. |

### 3.2 Permission model requirements

- **Role-based access control (RBAC)** with organization-level scoping: no user may ever read or write another organization's data.
- Permissions are enforced **server-side** on every API request and at the database layer (row-level security) — never by UI hiding alone.
- A user may hold **multiple roles**; effective permissions are the union of granted roles.
- The Owner/Administrator can grant **additional granular permissions** to a role or an individual (e.g., give the Office Manager invoice-finalization rights).
- **Sensitive-field restrictions**: internal cost, margin, employee notes, and internal AI analysis are field-level restricted, not just record-level (a Foreman can open a project but not see its margin).
- Clients and Subcontractors authenticate through **separate portal contexts** and can never enumerate internal users, other clients, or other projects.
- All permission changes are audit-logged (who, what, when, before/after).

### 3.3 Permission matrix (summary — full matrix maintained alongside the authorization model in the architecture doc)

| Capability | Owner | Office | Estimator | PM | Foreman | Tech | Sales | Client | Sub |
|---|---|---|---|---|---|---|---|---|---|
| Organization settings / users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Leads & clients (CRUD) | ✅ | ✅ | View | View | ❌ | ❌ | Own/assigned | ❌ | ❌ |
| Intake forms | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Scopes & estimates (with costs) | ✅ | View | ✅ | Assigned | ❌ | ❌ | Price-only | ❌ | ❌ |
| Proposals & contracts | ✅ | ✅ | Draft | Assigned | ❌ | ❌ | Send/track | Own: view/sign | ❌ |
| Schedule | ✅ | ✅ | ✅ | Assigned | Assigned (view) | Own (view) | Own | Own (summary) | Assigned (view) |
| Tasks | ✅ | ✅ | ❌ | Assigned | Assigned | Own | ❌ | ❌ | Assigned |
| Daily logs / photos / time | ✅ | View | View | Assigned | Assigned | Own entries | ❌ | Approved photos only | Own uploads |
| Change orders | ✅ | ✅ | Draft | Draft/manage | Request | ❌ | ❌ | Own: view/approve | ❌ |
| Invoices & payments | ✅ | ✅ | ❌ | Draft (assigned) | ❌ | ❌ | ❌ | Own: view/pay | Own sub-invoices |
| Project profitability | ✅ | View | View | Assigned | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI Foreman | ✅ | ✅ | ✅ | ✅ | ✅ (field scope) | ❌ | ✅ | ❌ | ❌ |
| Audit logs | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 4. Core Contractor Workflows

### 4.1 Primary pipeline (the spine of the product)

```
Lead → Client Intake → Site Visit → Scope Development → Estimate → Proposal
     → Approval → Deposit → Scheduling → Project Execution → Change Orders
     → Progress Documentation → Final Invoice → Warranty and Follow-Up
```

Each stage must record who advanced it, when, and with what artifacts, so the full history of a job is reconstructable.

### 4.2 Workflow details

1. **Lead capture** — A lead arrives (call, referral, web, walk-up). Anyone with lead permission records it in under 60 seconds on a phone: name, contact, address, project type, source. The lead gets a status, an owner, and a follow-up date. Nothing falls through: overdue follow-ups surface on the dashboard and in notifications.
2. **Client intake** — A guided, mobile-first, template-driven questionnaire (per project type: bathroom, kitchen, roofing, etc.) captures goals, existing conditions, finishes, budget, timeline, occupancy, access, permit concerns, financing needs, plus photos, video, and voice notes. Autosaves; supports incomplete drafts finished later.
3. **Site visit** — Scheduled from the lead; appears on calendar (later synced to Google Calendar). On site: measurements, condition photos, voice notes attach to the intake record. Confirmed measurements are flagged as **verified** vs. client-reported.
4. **Scope development** — Structured scope-of-work builder (categories → sections → items; inclusions, exclusions, assumptions, allowances, alternates, responsibilities). AI drafts a scope from intake data; user reviews, edits, approves a version. Versions are compared and approved versions locked.
5. **Estimate** — Line-item estimating (material, labor, equipment, subcontractor, waste, tax, overhead, profit) built from a reusable cost catalog. AI suggests items and flags omissions; user controls all pricing. Versioned, with margin visibility and Good/Better/Best options.
6. **Proposal** — Branded PDF proposal generated from approved scope + estimate: pricing summary, allowances, exclusions, payment schedule, terms, signature lines. Internal notes and costs never leak into the client document.
7. **Approval** — Proposal delivered by email/secure link. Tracked: viewed, accepted, declined, changes requested. Electronic signature with timestamp and audit metadata; configurable legal disclosures.
8. **Deposit** — Approval generates contract + deposit invoice per the configured payment structure (fixed, percentage, 75/25, milestone draws, T&M). Deposit tracked; project cannot move to Scheduled until deposit rules are met (configurable).
9. **Scheduling** — Project phases, crew and subcontractor assignments, inspections, deliveries, client meetings. Calendar/agenda/timeline views; conflict detection.
10. **Project execution** — Project workspace: tasks with statuses and dependencies, team, daily logs, time tracking (clock in/out), photo documentation, material needs, messages.
11. **Change orders** — Formal draft → review → send → client approval flow. Approved change orders automatically update contract value, budget, payment schedule, scope history, and timeline.
12. **Progress documentation** — Daily logs (crew, work done, weather, delays, safety, inspections), categorized photos (before/progress/completion), documents (permits, receipts, reports). Edit windows with revision history.
13. **Final invoice** — Progress and final invoicing against the payment schedule; payments recorded and allocated; A/R visibility; overdue tracking.
14. **Warranty and follow-up** — Warranty terms recorded at completion; claim intake; follow-up and review-request reminders; recurring maintenance scheduling. Project memory remains queryable forever.

### 4.3 Supporting workflows

- **Time & labor**: clock in/out with project/task selection; supervisor corrections with approval; weekly timesheets feeding labor cost to project budgets.
- **Budget vs. actual**: live comparison of estimated vs. actual material/labor/sub costs, with overrun warnings.
- **Communication**: templated, AI-drafted client messages (follow-ups, updates, delay notices, payment reminders) — always human-approved before sending.
- **AI Foreman**: conversational workspace scoped to the user's permissions; drafts scopes, estimates, tasks, logs, messages; converts responses into structured records after user review; answers project-memory questions with source citations.

---

## 5. MVP Features

The MVP is the smallest system that runs a real PTTR job end-to-end. Grouped by build phase:

**Foundation**
- [ ] Authentication (register, login, password reset, email verification, logout)
- [ ] Organizations with member invitations and role assignment; RBAC on every route
- [ ] Responsive application shell: desktop sidebar, mobile nav, quick-create, search placeholder, loading/empty/error states

**CRM & intake**
- [ ] Lead management (fields, statuses, assignment, activity timeline, follow-up reminders, convert to client/project)
- [ ] Client & property management (multi-property, contact/project/financial history, duplicate detection)
- [ ] Guided client intake with per-project-type templates, media upload, autosave drafts

**Scope & estimating**
- [ ] Scope-of-work builder (sections, inclusions/exclusions, assumptions, allowances, alternates, versions, templates, locking)
- [ ] AI-assisted scope generation (draft → review → approve; audit trail of original AI output)
- [ ] Estimating engine (versioned line items; material/labor/equipment/sub; waste, tax, overhead, profit; tested calculations)
- [ ] Cost catalog (org-specific, CSV import/export, price history, material tiers; Lowe's as default preferred retail vendor, configurable)
- [ ] AI estimate drafting with assumption/confidence labeling
- [ ] Estimate comparison & profitability tools (versions, Good/Better/Best, margin alerts)

**Proposals & money**
- [ ] Proposal generation (branded PDF, versioning, preview)
- [ ] Proposal delivery & e-approval (secure link, viewed status, signature, audit metadata, configurable disclosures)
- [ ] Contract & payment schedule creation (immutable after finalization except formal revision)
- [ ] Change-order management with automatic contract/budget/schedule updates
- [ ] Invoicing and payment tracking (provider-independent model; Stripe-ready)
- [ ] Project budget & profitability dashboard with warning indicators

**Field operations**
- [ ] Scheduling (calendar/agenda/timeline, conflict detection, Google Calendar-ready architecture)
- [ ] Task management (statuses, dependencies, checklists, verification)
- [ ] Daily job logs (field-friendly, media, controlled edit window, revision history)
- [ ] Time tracking (clock in/out, corrections, approvals, labor-cost allocation)
- [ ] Photo & document management (categories, captions, markup, before/after, client visibility controls)

**AI Foreman**
- [ ] Conversational AI workspace with project context, attachments, history
- [ ] AI permission & safety layer (org boundaries, role filtering, prompt-injection protections, human approval gates, activity logs)
- [ ] Structured AI actions (drafts validated against schemas; user review required)
- [ ] Job memory with source-cited answers

**Communication & admin**
- [ ] Client communication templates & AI drafting (approval-gated sending)
- [ ] Gmail/Google Workspace email integration (OAuth)
- [ ] Google Calendar integration (OAuth)
- [ ] Notifications & reminders with user preferences
- [ ] Client portal and subcontractor portal (strict data boundaries)
- [ ] Dashboards & reports (pipeline, A/R, revenue, margin; CSV/PDF export)
- [ ] Organization settings (branding, defaults, terms; PTTR preconfigured, not hard-coded)
- [ ] Audit logs and data history
- [ ] Security review, automated test suite, production deployment, launch checklist

## 6. Future Features (post-MVP)

- Voice-driven field operation (dictated logs, tasks, measurements, change orders) — Task 47
- Photo-based AI field analysis with explicit "not an inspection" disclaimers — Task 48
- Permit & inspection tracking with jurisdiction checklists — Task 49
- Maintenance & warranty management with recurring service plans — Task 50
- Native mobile apps (offline-capable field mode)
- Accounting integration (QuickBooks or similar) beyond payment tracking
- Material supplier pricing feeds / live vendor pricing
- Crew GPS/geofenced clock-in
- Client financing partner integrations
- Multi-organization franchising / white-label support
- Bid comparison against subcontractor quotes
- Inventory and tool tracking

---

## 7. Data That Must Be Stored

Full schema design is Task 4; this section defines the required domains.

| Domain | Data |
|---|---|
| **Identity & tenancy** | Organizations, users, role assignments, invitations, sessions, application settings |
| **CRM** | Leads (source, status, priority, follow-ups), clients (individual/company, contacts, tags), client contacts, properties (address, type, sq ft, access, utilities, permit jurisdiction) |
| **Intake** | Intake forms, template definitions, answers, attached media, draft state |
| **Projects** | Projects (status, type, dates, contract value, budget, team), project team members, site visits |
| **Scope** | Scopes of work, scope sections/items, versions, templates, approval/lock state |
| **Estimating** | Estimate versions, line items (labor, material, equipment, subcontractor), cost catalog items, price history, markup/tax/overhead/profit settings |
| **Sales documents** | Proposals (versions, delivery, view/approval events, signatures), contracts, payment schedules |
| **Financial** | Change orders, invoices, invoice line items, payments, allocations, credits/refunds, fees |
| **Field operations** | Project tasks, schedules/events, daily logs (with revision history), time entries, material requests |
| **Media & documents** | Photos (category, caption, geolocation, timestamp, visibility), documents (permits, receipts, plans, contracts), markup annotations |
| **Communication** | Messages, notes, email metadata, notification records, communication templates |
| **External parties** | Vendors, subcontractors (credentials, insurance/W-9 expiration), portal accounts |
| **Post-project** | Warranty records, claims, follow-up records, maintenance plans |
| **AI** | AI conversations, AI-generated documents/drafts (original output preserved), approval states, AI activity logs |
| **Compliance** | Audit logs (user, timestamp, action, record, before/after, session metadata) |

**Data rules** (binding on Task 4):
- UUID primary keys; created/updated timestamps everywhere.
- Soft delete where business history matters; hard delete only by Owner via governed process.
- Organization-scoped separation on every tenant table; referential integrity enforced.
- Versioning for scopes and estimates; immutability for finalized financial documents (corrections create new records, never rewrite history).
- Auditability for all financial and approval events.

---

## 8. Security Requirements

1. **Authentication**: email/password with strong hashing (argon2/bcrypt), email verification, secure password reset, session expiry, optional 2FA (post-MVP), account lockout/rate limiting on auth endpoints.
2. **Authorization**: server-side RBAC on every endpoint; row-level security for tenant isolation; field-level restrictions for cost/margin data; portal users structurally isolated.
3. **Tenant isolation**: organization ID scoping enforced at the database layer; cross-tenant access is a critical defect, tested explicitly.
4. **Transport & storage**: TLS everywhere; secrets in environment/secret manager, never in the repo; encrypted at rest (managed by cloud provider); signed, expiring URLs for file access — no public buckets.
5. **Input safety**: validation on all inputs (client and server); parameterized queries/ORM against SQL injection; output encoding against XSS; CSRF protection; upload type/size validation and malware-safe handling.
6. **AI safety**: AI reads only data the requesting user can access; prompt-injection defenses (treat retrieved/user content as data, not instructions); AI cannot send, sign, approve, pay, delete, or change permissions; all AI actions logged; human approval gates on financial and client-facing outputs.
7. **Financial integrity**: finalized invoices, contracts, and signed proposals are immutable; corrections are new, linked records; payment data handled by the payment provider (no raw card data stored).
8. **Audit**: append-only audit log covering logins, record changes, status changes, financial events, signatures, permission changes, AI actions, email/calendar sync; not editable by normal users.
9. **Signatures & legal**: e-signature records capture signer identity, timestamp, and IP/session metadata where legally appropriate; configurable jurisdiction disclosures; no assumption that e-signature satisfies every jurisdiction.
10. **Operational**: dependency vulnerability scanning, rate limiting, backups with tested restore, least-privilege service credentials, error monitoring without leaking sensitive data.

---

## 9. Mobile Requirements

The system will frequently be operated one-handed, outdoors, on a phone, with dirty gloves and spotty coverage. Mobile is not a nice-to-have; it is the primary field interface.

1. **Mobile-first responsive design** for all field-facing screens (intake, leads, tasks, daily logs, time, photos, AI Foreman).
2. **One-handed operation**: primary actions reachable in the thumb zone; bottom navigation on mobile; large tap targets (≥44px).
3. **Fast capture**: new lead in under 60 seconds; daily log and clock-in optimized for minimal typing; camera/gallery upload in ≤2 taps from a project.
4. **Autosave** on intake and long forms; no data loss on interruption (call comes in, screen locks).
5. **Media-first input**: photo, video, and voice-note capture as first-class inputs throughout.
6. **Degraded-network tolerance**: small payloads, optimistic UI where safe, clear retry states, resumable uploads for media. (Full offline mode is post-MVP; the architecture must not preclude it.)
7. **Readability outdoors**: high-contrast UI, legible type sizes.
8. **Desktop parity** for office roles: estimating, proposals, reporting, and settings are optimized for desktop but must remain usable on tablet.

---

## 10. AI-Assisted Functions

AI is a drafting and analysis layer, never an autonomous actor.

| Function | Behavior |
|---|---|
| Scope generation | Converts intake data, notes, photos, dictation into a draft scope; separates facts from assumptions; flags missing info, code/permit concerns, likely trades, sequencing; generates clarification questions. |
| Estimate drafting | Suggests categories, line items, omissions, waste factors, catalog matches; flags price uncertainty and abnormal margins; shows source, assumption status, and confidence per item. |
| AI Foreman chat | Permission-scoped conversational assistant with project context, attachments, and history; assists with intake, troubleshooting, task breakdown, material lists, summaries, risk identification, scheduling, follow-ups. |
| Structured actions | Produces schema-validated drafts (lead, note, scope section, estimate item, task, log entry, change order, invoice description, email, summary) that always require user review before saving. |
| Job memory | Answers questions about decisions, selections, measurements, changes, and outstanding items — always citing the source records. |
| Communication drafting | Drafts templated client messages; nothing sends without configured human approval. |
| (Post-MVP) Voice & photo analysis | Reviewable voice transcription workflows; photo analysis with explicit non-inspection disclaimers. |

**Hard rules**
- AI never presents unverified measurements as confirmed.
- AI never auto-publishes, auto-approves, auto-sends, auto-signs, auto-pays, or auto-deletes.
- AI-generated content is always labeled as such; original AI output is preserved for audit even after human edits.
- AI access is filtered through the requesting user's permissions — the AI can never see more than its user.

---

## 11. Integrations

| Integration | Purpose | MVP? |
|---|---|---|
| AI model API (provider selected in Task 2) | Scope/estimate drafting, AI Foreman, memory Q&A | ✅ |
| Google Workspace — Gmail | OAuth; send approved emails, log metadata, attachments, CC/BCC rules | ✅ |
| Google Workspace — Calendar | OAuth; create/update/cancel events, sync status, duplicate prevention, timezones | ✅ |
| Payment processing (Stripe planned) | Client payments on invoices; accounting model stays provider-independent | ✅ (architecture) — live processing may follow launch checklist |
| Email delivery service (transactional) | Verification, notifications, proposal links | ✅ |
| File/photo storage (cloud object storage) | Secure media and document storage with signed URLs | ✅ |
| PDF generation | Proposals, contracts, invoices, reports | ✅ |
| E-signature | Built-in signature capture with audit metadata; configurable legal disclosures | ✅ |
| Accounting (QuickBooks etc.) | Ledger sync | Post-MVP |
| Vendor pricing feeds (Lowe's preferred vendor default) | Catalog price assistance | Post-MVP (manual/CSV in MVP) |

All integrations must: use OAuth or scoped API keys, handle expired/revoked credentials gracefully, log failures, respect user permissions, and be replaceable behind an internal service interface (modularity requirement).

---

## 12. Reporting Requirements

**Dashboards** (role-appropriate):
- Sales pipeline and lead conversion
- Estimate volume and proposal approval rate
- Active projects and upcoming work
- Outstanding tasks and overdue follow-ups
- Accounts receivable and overdue invoices
- Revenue, gross profit, gross margin
- Labor performance and hour overruns
- Project overruns and budget warnings
- Change-order volume
- Warranty issues and client follow-ups

**Report capabilities**:
- Filter by date range, project, employee/salesperson, client, status
- Export to CSV and PDF
- Financial reports reconcile exactly with underlying invoice/payment records
- Internal cost/margin reports restricted by role

---

## 13. Acceptance Criteria (MVP)

The MVP is accepted when all of the following pass:

**Pipeline integrity**
1. A lead can be captured on a phone in under 60 seconds and carries through intake → scope → estimate → proposal → approval → contract → scheduling → execution → invoicing → warranty without re-entering data.
2. Every stage transition is recorded with actor and timestamp and visible in the project activity history.

**Security & isolation**
3. A user can never read or modify another organization's data (verified by automated tests).
4. Unauthorized roles cannot access restricted routes, records, or restricted fields (cost/margin hidden from Foreman/Tech/Client/Sub) — verified by automated tests.
5. Clients and subcontractors see only their own scoped data through their portals.
6. All financial and approval events appear in the audit log; audit logs are not editable by normal users.

**Financial correctness**
7. Estimate calculations (quantities, waste, markup, tax, overhead, profit, margin) are covered by unit tests and produce correct totals for defined test cases.
8. Approved change orders update contract value, budget, payment schedule, and history — automatically and correctly.
9. Invoice, payment, and A/R figures reconcile: invoiced − payments = balance for every project and in aggregate.
10. Finalized financial documents cannot be silently edited; corrections create linked revision records.

**Documents & approval**
11. Generated proposals contain the approved scope and pricing, PTTR branding, and no internal notes, costs, or margins.
12. Proposal delivery records viewed/accepted/declined events; e-signature captures signer, timestamp, and audit metadata; configured legal disclosures appear.

**AI safety**
13. AI output is always labeled, always requires review before saving, validates against schemas, and never triggers a send/approve/sign/pay/delete.
14. AI answers about a project cite source records; AI cannot retrieve data the requesting user cannot access (verified by tests).

**Mobile & field**
15. Intake, lead capture, daily logs, time tracking, and photo upload are fully usable on a 375px-wide phone screen, one-handed; long forms autosave.

**Operations**
16. The application runs in production with SSL, backups, error monitoring, migrations, and a documented rollback procedure; the Task 46 launch checklist has no failing critical items.

---

## 14. Assumptions, Constraints, and Open Decisions

**Assumptions**
- Initial deployment serves PT's Tactical Renovations as the first organization, but the platform is multi-tenant by design and PTTR branding is configured, not hard-coded.
- English-only at launch; US-based tax and jurisdiction assumptions, configurable per organization.
- Users have modern smartphones/browsers; no legacy browser support.

**Constraints**
- Build proceeds in the controlled task order defined in the master instruction; each task preserves prior working functionality.
- No integration, credential, or test result is ever reported as complete unless actually implemented and verified.

**Open decisions for Patrick (to be settled in Tasks 2–4)**
1. Technical stack approval (Task 2 will recommend).
2. Payment structures to enable at launch and whether live Stripe processing is in MVP scope or immediately post-launch.
3. Jurisdictions where e-signature disclosures are required (initial operating area).
4. Which existing repository code (the prior ContractorAds FastAPI app) is retained, archived, or removed when scaffolding begins in Task 5.

---

## 15. Repository Note

This repository currently contains a small, unrelated FastAPI application ("ContractorAds", an ad-copy generator). It is untouched by this task. Its disposition is Open Decision #4 above and must be resolved before Task 5 (application scaffold).
