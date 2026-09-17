---
name: db-change
description: Use when adding or altering any database table, column, enum, constraint, trigger, or RLS policy in PT's Tactical Foreman. Covers the two-file migration pattern, registering the migration in the Drizzle journal, mirroring into supabase-setup.sql, and verifying RLS on the live project. Trigger on any schema.ts edit or when the user asks for a schema change, migration, or new table.
---

# Database changes

A schema change here is a security change. The app connects as `postgres`,
which has **BYPASSRLS** — so `ENABLE ROW LEVEL SECURITY` alone does nothing.
`FORCE` is what actually holds the tenant boundary. Getting that wrong leaks one
contractor's jobs into another's account, silently, with no error.

Work through this in order. Do not skip the verification at the end.

## 1. Edit `src/db/schema.ts`

Every tenant table carries:

```ts
organizationId: uuid('organization_id')
  .notNull()
  .references(() => organizations.id, { onDelete: 'restrict' }),
```

`restrict`, not `cascade` — deleting an organization should fail loudly, not
quietly erase its records.

Conventions already in the file, follow them:
- Money is `numeric(14, 2)`. Hours are `numeric(12, 4)`. Never floats.
- A calendar day is `date`, not `timestamptz`. A crew frames Tuesday through
  Friday; storing that as an instant makes the day shift with the reader.
- Soft-delete (`deletedAt`) for anything with evidentiary or historical value —
  photos, tasks, expenses, logs. Hard-delete for scratch records.
- Add the `$inferSelect` / `$inferInsert` type exports at the bottom.
- Write the doc comment explaining *why* the table is shaped this way, not what
  the columns are. The columns are self-evident.

## 2. Generate the table DDL

```bash
pnpm drizzle-kit generate
```

This produces `drizzle/NNNN_<random>.sql` with tables, FKs, indexes. That file is
machine-generated — do not hand-edit it.

## 3. Hand-write the RLS/integrity migration

Create `drizzle/NNNN+1_<domain>_rls.sql`. This is where the actual thinking goes:
CHECK constraints, triggers, and policies. Open the previous one
(`0042_costing_rls.sql` is a good model) and match its shape.

**Every tenant table needs all four lines:**

```sql
alter table <t> enable row level security;
alter table <t> force row level security;
create policy <t>_tenant on <t>
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));
```

The loop idiom used throughout keeps this honest across several tables at once:

```sql
do $$
declare t text;
begin
  foreach t in array array['table_a','table_b']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;
```

**Every trigger function must pin an empty search path:**

```sql
create or replace function foo() returns trigger
  language plpgsql
  set search_path = ''          -- ← the Supabase advisor flags this if missing
as $$ ... $$;
```

Reference other tables fully qualified inside such a function (`public.invoices`).

**Push invariants into the database when they are things a query would otherwise
have to defend against.** Precedents worth copying:
- Derived values maintained by trigger, never supplied by a caller
  (`time_entries.hours`, `daily_logs.editable_until`, `project_tasks.completed_at`).
- Freeze triggers raising `errcode = 'restrict_violation'` once a record is
  issued/signed/approved.
- Append-only triggers that reject `UPDATE`/`DELETE` for *every* role, including
  the app's — used for signatures and daily-log revisions.
- Exclusion constraints for overlap (`time_entries` uses `btree_gist`).

**Constraints on the drizzle/ files:** the RLS harness replays every
`drizzle/*.sql` against a plain Postgres. Nothing Supabase-specific
(`storage.buckets`, `auth.users`) may go in there.

## 4. Register the hand-written migration

`drizzle-kit` doesn't know about it. Register it, keeping the snapshot chain
intact — a fresh uuid whose `prevId` is the previous snapshot's `id`:

```bash
python3 - <<'PY'
import json, uuid, shutil
TAG = '00NN_<domain>_rls'      # ← set this
PREV = '00NN-1'                # ← previous snapshot number, e.g. '0041'
NEW  = '00NN'                  # ← this snapshot number,     e.g. '0042'

jp = 'drizzle/meta/_journal.json'
d = json.load(open(jp)); last = d['entries'][-1]
if last['tag'] != TAG:
    d['entries'].append({"idx": last['idx']+1, "version": last['version'],
                         "when": last['when']+1000, "tag": TAG, "breakpoints": True})
    json.dump(d, open(jp, 'w'), indent=2); print('journal appended')

shutil.copy(f'drizzle/meta/{PREV}_snapshot.json', f'drizzle/meta/{NEW}_snapshot.json')
prev = json.load(open(f'drizzle/meta/{PREV}_snapshot.json'))
snap = json.load(open(f'drizzle/meta/{NEW}_snapshot.json'))
snap['prevId'] = prev['id']; snap['id'] = str(uuid.uuid4())
json.dump(snap, open(f'drizzle/meta/{NEW}_snapshot.json', 'w'), indent=2)
print('snapshot chained')
PY
```

## 5. Prove it with real Postgres

```bash
bash scripts/test-rls.sh
```

This spins a throwaway cluster, replays every migration, and runs
`scripts/rls-assertions.sql`. **Add assertions for what you just built** — not
just "cross-org select is isolated", but the actual rules:

- cross-org SELECT isolation and INSERT rejection (`insufficient_privilege`)
- each CHECK constraint (`check_violation`)
- each trigger's refusal (`restrict_violation`)
- each exclusion constraint (`exclusion_violation`)
- the *permitted* path too — that a legitimate write still succeeds. A rule that
  blocks everything passes a one-sided test.

Follow the existing `do $$ ... exception when <errcode> then raise notice 'PASS: …'`
shape so a regression fails the suite rather than printing a warning.

## 6. Mirror into `scripts/supabase-setup.sql`

Append a new `-- ═══ Part NN — Task NN: <what> ═══` section reproducing the same
DDL. This file bootstraps a fresh Supabase project, so it must be guard-wrapped:

```sql
do $$ begin
  create type foo as enum (...);
exception when duplicate_object then null; end $$;

create table if not exists ...
drop trigger if exists ... ;   -- before create trigger
drop policy if exists ... ;    -- before create policy
```

Anything Supabase-only goes behind a schema check so the file still applies to
plain Postgres:

```sql
if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
```

Verify with `bash scripts/test-setup-sql.sh`, which also fails if any table ended
up without both ENABLE and FORCE.

## 7. Apply to the live project and verify

Project ref: **`zhlkfuvscnblkkyfticz`** (Tactical-Foreman).

If tools time out, check `get_project` first — the free tier auto-pauses and
reports `INACTIVE`. `restore_project` brings it back; it takes a couple of
minutes and reports `COMING_UP` meanwhile.

Apply each file with `apply_migration` (one call per migration, named to match
the repo file). Then **verify, don't assume**:

```sql
select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers,
       (select count(*) from pg_constraint k where k.conrelid = c.oid and k.contype = 'c') as checks
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('<your tables>');
```

`enabled` and `forced` must both be `true`, and the counts must match what the
migration declared. Then run `get_advisors` with `type: security`. Three
pre-existing WARNs on `has_role` / `is_member_of` / `org_has_members` are known
and unrelated; **anything else is yours and needs fixing.**

## 8. Reporting

State plainly whether migrations were applied to the live database. If they were
not — tooling down, project paused, whatever — say so in the commit message and
in the report. A migration sitting unapplied in the repo means the feature is
inert, and nobody can tell from the diff.
