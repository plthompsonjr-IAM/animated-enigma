import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { today } from '@/lib/schedule/schedule-core';
import { assignmentsForConflicts } from '@/lib/schedule/queries';
import { findCrewConflicts } from '@/lib/schedule/schedule-core';
import { summarizeReceivables } from '@/lib/invoices/invoices-core';
import { EMPTY_SIGNALS, type DashboardSignals } from './dashboard-core';

/**
 * Gathers every dashboard signal in one pass. Each piece is a narrow aggregate
 * rather than a full list — the dashboard needs counts, not rows, and a
 * contractor with four hundred tasks shouldn't pay to load them.
 *
 * `showMoney` gates the financial queries entirely: someone without
 * `financials:read` never has the amounts fetched, let alone rendered.
 */
export async function dashboardSignals(
  organizationId: string,
  showMoney: boolean,
): Promise<DashboardSignals> {
  const db = getDb();
  const day = today();

  const [
    taskCounts,
    scheduleOverdue,
    assignments,
    missingLogs,
    leadFollowUps,
    proposalsOut,
    unsignedContracts,
    receivables,
    unbilledChangeOrders,
  ] = await Promise.all([
    // Overdue and blocked in one pass over project_tasks.
    db
      .select({
        overdue: sql<number>`count(*) filter (
          where ${schema.projectTasks.dueDate} < current_date
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
          sql`${schema.projectTasks.deletedAt} is null`,
          sql`${schema.projectTasks.status} <> 'completed'`,
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.scheduleItems)
      .where(
        and(
          eq(schema.scheduleItems.organizationId, organizationId),
          sql`${schema.scheduleItems.status} not in ('complete','canceled')`,
          sql`${schema.scheduleItems.endDate} < current_date`,
        ),
      ),

    assignmentsForConflicts(organizationId, day),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, organizationId),
          sql`${schema.projects.deletedAt} is null`,
          sql`${schema.projects.status} in ('in_progress','punch_list')`,
          sql`not exists (
            select 1 from daily_logs l
            where l.project_id = ${schema.projects.id} and l.log_date = ${day}
          )`,
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.organizationId, organizationId),
          sql`${schema.leads.deletedAt} is null`,
          sql`${schema.leads.nextFollowUpDate} < current_date`,
          sql`${schema.leads.status} not in ('won','lost')`,
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.proposals)
      .where(
        and(
          eq(schema.proposals.organizationId, organizationId),
          sql`${schema.proposals.status} in ('sent','viewed')`,
        ),
      ),

    // A live contract with no signature on file: the job is running against
    // something nobody signed, which is the first thing asked for in a dispute.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.contracts)
      .where(
        and(
          eq(schema.contracts.organizationId, organizationId),
          sql`${schema.contracts.status} = 'active'`,
          sql`${schema.contracts.signedSignatureId} is null`,
        ),
      ),

    showMoney
      ? db
          .select({
            status: schema.invoices.status,
            total: schema.invoices.total,
            amountPaid: schema.invoices.amountPaid,
            dueDate: schema.invoices.dueDate,
          })
          .from(schema.invoices)
          .where(eq(schema.invoices.organizationId, organizationId))
      : Promise.resolve([]),

    showMoney
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.changeOrders)
          .where(
            and(
              eq(schema.changeOrders.organizationId, organizationId),
              sql`${schema.changeOrders.status} in ('approved','incorporated')`,
              sql`not exists (
                select 1 from invoices i where i.change_order_id = ${schema.changeOrders.id}
              )`,
            ),
          )
      : Promise.resolve([{ count: 0 }]),
  ]);

  const conflicts = findCrewConflicts(assignments);
  const money = summarizeReceivables(receivables);
  const overdueInvoiceCount = receivables.filter(
    (i) =>
      i.status !== 'void' &&
      i.status !== 'draft' &&
      Number(i.total) - Number(i.amountPaid) > 0 &&
      i.dueDate !== null &&
      i.dueDate < day,
  ).length;

  return {
    ...EMPTY_SIGNALS,
    overdueInvoiceAmount: money.overdue,
    overdueInvoiceCount,
    outstandingAmount: money.outstanding,
    overdueTasks: taskCounts[0]?.overdue ?? 0,
    blockedTasks: taskCounts[0]?.blocked ?? 0,
    overdueScheduleItems: scheduleOverdue[0]?.count ?? 0,
    crewConflicts: conflicts.length,
    crossProjectConflicts: conflicts.filter((c) => c.crossProject).length,
    projectsMissingTodaysLog: missingLogs[0]?.count ?? 0,
    overdueLeadFollowUps: leadFollowUps[0]?.count ?? 0,
    proposalsAwaitingResponse: proposalsOut[0]?.count ?? 0,
    unbilledApprovedChangeOrders: unbilledChangeOrders[0]?.count ?? 0,
    unsignedActiveContracts: unsignedContracts[0]?.count ?? 0,
  };
}

/** The plain counts behind the KPI tiles. */
export async function dashboardCounts(organizationId: string) {
  const db = getDb();
  const [projects, tasks, leads] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, organizationId),
          sql`${schema.projects.deletedAt} is null`,
          sql`${schema.projects.status} not in ('completed','warranty','closed','cancelled')`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.projectTasks)
      .where(
        and(
          eq(schema.projectTasks.organizationId, organizationId),
          sql`${schema.projectTasks.deletedAt} is null`,
          sql`${schema.projectTasks.status} <> 'completed'`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.organizationId, organizationId),
          sql`${schema.leads.deletedAt} is null`,
          sql`${schema.leads.status} = 'new'`,
        ),
      ),
  ]);

  return {
    openProjects: projects[0]?.count ?? 0,
    openTasks: tasks[0]?.count ?? 0,
    newLeads: leads[0]?.count ?? 0,
  };
}
