import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { today, findCrewConflicts } from '@/lib/schedule/schedule-core';
import { assignmentsForConflicts } from '@/lib/schedule/queries';
import { costBreakdown, type JobPhase } from '@/lib/costing/costing-core';
import { toNum } from '@/lib/catalog/catalog-core';
import { logCoverage } from '@/lib/daily-logs/daily-logs-core';
import { EMPTY_INPUT, type BriefingInput } from './ai-foreman-core';

/** Which projects can be briefed, newest first. */
export async function briefableProjects(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      projectNumber: schema.projects.projectNumber,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.organizationId, organizationId),
        sql`${schema.projects.deletedAt} is null`,
      ),
    )
    .orderBy(sql`${schema.projects.createdAt} desc`)
    .limit(200);
}

export interface BriefingAccess {
  /** `financials:read` — what the client is billed. */
  money: boolean;
  /** `costs:read` — internal cost and margin. Stricter than money. */
  cost: boolean;
}

/**
 * Everything a briefing reads for one job.
 *
 * The gating is done here rather than in the render: someone without
 * `costs:read` never has the cost rows fetched, and the nulls that come back are
 * what make the briefing say "you can't see this" instead of implying all-clear.
 *
 * Counts, not rows, wherever a count is what gets used — a job with three
 * hundred tasks shouldn't be loaded to find out how many are blocked.
 */
export async function briefingInput(
  organizationId: string,
  projectId: string,
  access: BriefingAccess,
  now: Date = new Date(),
): Promise<BriefingInput | null> {
  const db = getDb();
  const day = today(now);

  const projectRows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      projectNumber: schema.projects.projectNumber,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.organizationId, organizationId),
        sql`${schema.projects.deletedAt} is null`,
      ),
    )
    .limit(1);

  const project = projectRows[0];
  if (!project) return null;

  const [
    scheduleRows,
    taskRows,
    loggedRows,
    assignments,
    moneyRows,
    changeOrderRows,
    costRows,
    uncostedRows,
  ] = await Promise.all([
    // Schedule position: the span, how much is overdue, and earned progress
    // weighted by span so a three-week phase counts for more than a one-day one.
    db
      .select({
        items: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) filter (
          where ${schema.scheduleItems.status} not in ('complete','canceled')
            and ${schema.scheduleItems.endDate} < ${day}
        )::int`,
        startDate: sql<string | null>`min(${schema.scheduleItems.startDate})::text`,
        endDate: sql<string | null>`max(${schema.scheduleItems.endDate})::text`,
        weight: sql<string>`coalesce(sum(
          (${schema.scheduleItems.endDate} - ${schema.scheduleItems.startDate} + 1)
        ) filter (where ${schema.scheduleItems.status} <> 'canceled'), 0)`,
        earned: sql<string>`coalesce(sum(
          (${schema.scheduleItems.endDate} - ${schema.scheduleItems.startDate} + 1)
          * case
              when ${schema.scheduleItems.status} = 'complete' then 100
              else coalesce(${schema.scheduleItems.percentComplete}, 0)
            end / 100.0
        ) filter (where ${schema.scheduleItems.status} <> 'canceled'), 0)`,
      })
      .from(schema.scheduleItems)
      .where(
        and(
          eq(schema.scheduleItems.organizationId, organizationId),
          eq(schema.scheduleItems.projectId, projectId),
        ),
      ),

    // Open, overdue and blocked in one pass. `blocked` is derived from
    // unfinished predecessors rather than stored, so it is always current.
    db
      .select({
        open: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) filter (
          where ${schema.projectTasks.dueDate} < ${day}
        )::int`,
        blocked: sql<number>`count(*) filter (
          where exists (
            select 1 from task_dependencies d
            join project_tasks p on p.id = d.depends_on_task_id
            where d.task_id = ${schema.projectTasks.id}
              and p.status <> 'completed'
              and p.deleted_at is null
          )
        )::int`,
      })
      .from(schema.projectTasks)
      .where(
        and(
          eq(schema.projectTasks.organizationId, organizationId),
          eq(schema.projectTasks.projectId, projectId),
          sql`${schema.projectTasks.deletedAt} is null`,
          sql`${schema.projectTasks.status} <> 'completed'`,
        ),
      ),

    db
      .select({ logDate: sql<string>`${schema.dailyLogs.logDate}::text` })
      .from(schema.dailyLogs)
      .where(
        and(
          eq(schema.dailyLogs.organizationId, organizationId),
          eq(schema.dailyLogs.projectId, projectId),
        ),
      ),

    assignmentsForConflicts(organizationId, day),

    // Money the client is billed. Not fetched at all without financials:read.
    access.money
      ? db
          .select({
            invoiced: sql<string>`coalesce(sum(${schema.invoices.total}) filter (
              where ${schema.invoices.status} <> 'draft'
            ), 0)`,
            paid: sql<string>`coalesce(sum(${schema.invoices.amountPaid}) filter (
              where ${schema.invoices.status} <> 'draft'
            ), 0)`,
            overdue: sql<string>`coalesce(sum(${schema.invoices.balance}) filter (
              where ${schema.invoices.status} not in ('draft','paid','void')
                and ${schema.invoices.dueDate} < ${day}
            ), 0)`,
            overdueCount: sql<number>`count(*) filter (
              where ${schema.invoices.status} not in ('draft','paid','void')
                and ${schema.invoices.dueDate} < ${day}
            )::int`,
          })
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.organizationId, organizationId),
              eq(schema.invoices.projectId, projectId),
            ),
          )
      : Promise.resolve([]),

    // Contract value and approved extras. The revised value is derived —
    // original plus approved change orders — never mutated on the contract.
    access.money
      ? db
          .select({
            contractValue: sql<string | null>`(
              select c.contract_value from contracts c
              where c.project_id = ${projectId}
                and c.organization_id = ${organizationId}
                and c.status = 'active'
              order by c.created_at desc
              limit 1
            )`,
            // Approved *and* incorporated both count toward the revised sum —
            // `countsTowardContract` is the authority and this must not drift
            // from it, or the briefing quietly undervalues the job.
            approved: sql<string>`coalesce(sum(${schema.changeOrders.costChange}) filter (
              where ${schema.changeOrders.status} in ('approved','incorporated')
            ), 0)`,
            unbilled: sql<string>`coalesce(sum(${schema.changeOrders.costChange}) filter (
              where ${schema.changeOrders.status} in ('approved','incorporated')
                and not exists (
                  select 1 from invoices i
                  where i.change_order_id = ${schema.changeOrders.id}
                    and i.status <> 'draft'
                )
            ), 0)`,
            unbilledCount: sql<number>`count(*) filter (
              where ${schema.changeOrders.status} in ('approved','incorporated')
                and not exists (
                  select 1 from invoices i
                  where i.change_order_id = ${schema.changeOrders.id}
                    and i.status <> 'draft'
                )
            )::int`,
          })
          .from(schema.changeOrders)
          .where(
            and(
              eq(schema.changeOrders.organizationId, organizationId),
              eq(schema.changeOrders.projectId, projectId),
            ),
          )
      : Promise.resolve([]),

    // Internal cost. Stricter gate than money — absent from sales_rep and
    // field_foreman, so this stays unfetched for them.
    access.cost
      ? db
          .select({
            hours: sql<string>`coalesce(sum(${schema.timeEntries.hours}), 0)`,
            status: schema.timeEntries.status,
            hourlyCostRate: sql<string | null>`(
              select m.hourly_cost_rate from organization_members m
              where m.user_id = ${schema.timeEntries.userId}
                and m.organization_id = ${schema.timeEntries.organizationId}
            )`,
          })
          .from(schema.timeEntries)
          .where(
            and(
              eq(schema.timeEntries.organizationId, organizationId),
              eq(schema.timeEntries.projectId, projectId),
            ),
          )
          .groupBy(
            schema.timeEntries.status,
            schema.timeEntries.userId,
            schema.timeEntries.organizationId,
          )
      : Promise.resolve([]),

    // People who logged time on this job with no rate set. Their hours are real
    // and their cost is zero, which makes every margin on the job look better
    // than it is — so the briefing says so rather than quietly averaging.
    access.cost
      ? db
          .select({ count: sql<number>`count(distinct ${schema.timeEntries.userId})::int` })
          .from(schema.timeEntries)
          .where(
            and(
              eq(schema.timeEntries.organizationId, organizationId),
              eq(schema.timeEntries.projectId, projectId),
              sql`not exists (
                select 1 from organization_members m
                where m.user_id = ${schema.timeEntries.userId}
                  and m.organization_id = ${schema.timeEntries.organizationId}
                  and m.hourly_cost_rate is not null
              )`,
            ),
          )
      : Promise.resolve([]),
  ]);

  const expenseRows = access.cost
    ? await getDb()
        .select({
          category: schema.expenses.category,
          amount: sql<string>`coalesce(sum(${schema.expenses.amount}), 0)`,
        })
        .from(schema.expenses)
        .where(
          and(
            eq(schema.expenses.organizationId, organizationId),
            eq(schema.expenses.projectId, projectId),
            sql`${schema.expenses.deletedAt} is null`,
          ),
        )
        .groupBy(schema.expenses.category)
    : [];

  const sched = scheduleRows[0];
  const tasks = taskRows[0];
  const money = moneyRows[0];
  const co = changeOrderRows[0];

  const weight = toNum(sched?.weight ?? 0);
  const earned = toNum(sched?.earned ?? 0);
  const earnedPercent = weight > 0 ? Math.round((earned / weight) * 100) : null;

  const startDate = sched?.startDate ?? null;
  const endDate = sched?.endDate ?? null;

  // Coverage is measured over the scheduled span only. A job with no dates has
  // no window to be missing days from, and inventing one would manufacture gaps.
  const loggedDates = loggedRows.map((r) => r.logDate);
  const coverage =
    startDate && endDate
      ? logCoverage(loggedDates, startDate, endDate, now)
      : { workingDays: 0, logged: 0, missing: [] as string[], percent: null };

  // Org-wide conflicts, narrowed to the ones this job is party to. The detection
  // has to run across every project — a clash is invisible from inside one job.
  const conflicts = findCrewConflicts(assignments).filter(
    (c) => c.a.projectId === projectId || c.b.projectId === projectId,
  );

  // Contract value plus approved change orders, matching how it is derived
  // everywhere else. Null stays null: a job with no contract is not worth zero.
  const baseValue = co?.contractValue == null ? null : toNum(co.contractValue);
  const approved = toNum(co?.approved ?? 0);
  const contractValue = baseValue === null ? null : round2(baseValue + approved);

  const cost = access.cost
    ? costBreakdown(
        costRows.map((r) => ({
          hours: toNum(r.hours),
          hourlyCostRate: r.hourlyCostRate,
          status: r.status as Parameters<typeof costBreakdown>[0][number]['status'],
        })),
        expenseRows.map((r) => ({
          amount: toNum(r.amount),
          category: r.category as Parameters<typeof costBreakdown>[1][number]['category'],
        })),
      )
    : null;

  const phase: JobPhase = project.status === 'completed' ? 'complete' : 'in_progress';

  return {
    ...EMPTY_INPUT,
    projectName: project.name,
    projectNumber: project.projectNumber,
    status: project.status,
    phase,

    startDate,
    endDate,

    contractValue,
    invoiced: access.money ? toNum(money?.invoiced ?? 0) : null,
    paid: access.money ? toNum(money?.paid ?? 0) : null,
    overdueAmount: access.money ? toNum(money?.overdue ?? 0) : null,
    overdueCount: money?.overdueCount ?? 0,
    approvedChangeOrderValue: access.money ? approved : null,
    unbilledChangeOrderValue: access.money ? toNum(co?.unbilled ?? 0) : null,
    unbilledChangeOrderCount: co?.unbilledCount ?? 0,

    costToDate: cost ? cost.total : null,
    labourHours: cost ? cost.labourHours : null,
    uncostedMembers: uncostedRows[0]?.count ?? 0,

    scheduleItems: sched?.items ?? 0,
    overdueScheduleItems: sched?.overdue ?? 0,
    earnedPercent,
    crewConflicts: conflicts.length,

    openTasks: tasks?.open ?? 0,
    overdueTasks: tasks?.overdue ?? 0,
    blockedTasks: tasks?.blocked ?? 0,

    logCoveragePercent: coverage.percent,
    missingLogDays: coverage.missing.length,
    lastLogDay: loggedDates.length > 0 ? loggedDates.slice().sort().at(-1)! : null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
