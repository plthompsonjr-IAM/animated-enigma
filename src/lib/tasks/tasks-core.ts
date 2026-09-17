/**
 * Pure field-task logic (Task 24): lifecycle, dependency blocking, checklist
 * progress, punch-list handling, and the sorting a foreman actually wants. No
 * I/O, so all of it is unit-testable.
 *
 * Dates here are calendar days (`YYYY-MM-DD`), same as the schedule — a task is
 * due Thursday, not at an instant that shifts with the reader's timezone. The
 * day helpers are shared with the schedule module rather than duplicated.
 */

import { addDays, dayDiff, isDay, today } from '@/lib/schedule/schedule-core';

export const TASK_STATUSES = [
  'not_started',
  'ready',
  'in_progress',
  'blocked',
  'awaiting_inspection',
  'completed',
  'rework_required',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not started',
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  awaiting_inspection: 'Awaiting inspection',
  completed: 'Completed',
  rework_required: 'Rework required',
};

export const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  not_started: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  ready: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  in_progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  blocked: 'bg-red-500/15 text-red-700 dark:text-red-300',
  awaiting_inspection: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rework_required: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
};

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

/** Finished work. Nothing here counts as open, blocks anything, or goes overdue. */
export function isDone(status: TaskStatus): boolean {
  return status === 'completed';
}

/** Work still owed — what a foreman means by "what's left". */
export function isOpen(status: TaskStatus): boolean {
  return !isDone(status);
}

/** Work someone is actively holding. */
export function isActive(status: TaskStatus): boolean {
  return status === 'in_progress' || status === 'awaiting_inspection';
}

/**
 * Where a task can go next. Deliberately permissive — a jobsite is not a state
 * machine, and a foreman correcting a mistap must not be fought. The only thing
 * ruled out is a no-op.
 *
 * `blocked` is omitted everywhere because it is *computed* from unfinished
 * dependencies, not chosen: see `effectiveStatus`.
 */
export function allowedTransitions(status: TaskStatus): TaskStatus[] {
  const all: TaskStatus[] = [
    'not_started',
    'ready',
    'in_progress',
    'awaiting_inspection',
    'completed',
    'rework_required',
  ];
  return all.filter((next) => next !== status);
}

/** The next status the primary button should offer — the common path. */
export function primaryNextStatus(status: TaskStatus): TaskStatus | null {
  switch (status) {
    case 'not_started':
    case 'ready':
      return 'in_progress';
    case 'in_progress':
      return 'completed';
    case 'awaiting_inspection':
      return 'completed';
    case 'rework_required':
      return 'in_progress';
    case 'blocked':
      return 'in_progress';
    case 'completed':
      return null;
  }
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
}

export interface DependencyAwareTask {
  id: string;
  title: string;
  status: TaskStatus;
}

/**
 * Which tasks are held up, and by what. A task is blocked when anything it
 * depends on is unfinished; the blockers are named so the UI can say *why*
 * rather than just showing a red badge.
 */
export function blockedBy(
  tasks: DependencyAwareTask[],
  dependencies: TaskDependency[],
): Map<string, DependencyAwareTask[]> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blockers = new Map<string, DependencyAwareTask[]>();

  for (const dep of dependencies) {
    const predecessor = byId.get(dep.dependsOnTaskId);
    // A dependency on a task we can't see (deleted, or another project) is not
    // treated as a blocker — better to let work proceed than to wedge it.
    if (!predecessor || isDone(predecessor.status)) continue;
    const list = blockers.get(dep.taskId);
    if (list) list.push(predecessor);
    else blockers.set(dep.taskId, [predecessor]);
  }
  return blockers;
}

/**
 * The status to display. `blocked` is derived from unfinished dependencies
 * rather than stored, so it can never go stale: finishing the predecessor
 * unblocks the successor with no second write.
 *
 * Only statuses nobody has acted on yet get overridden. If a foreman has marked
 * a task in progress, awaiting inspection, needing rework, or done, that is a
 * statement about the real world and the dependency graph doesn't get to argue.
 */
export function effectiveStatus(stored: TaskStatus, blockerCount: number): TaskStatus {
  if (stored !== 'not_started' && stored !== 'ready' && stored !== 'blocked') return stored;
  if (blockerCount > 0) return 'blocked';
  // Every prerequisite met, so it's ready to pick up.
  return 'ready';
}

/**
 * Would adding `taskId depends on dependsOnTaskId` create a cycle? Walks the
 * whole many-to-many graph breadth-first; a cycle already in the data
 * terminates the walk rather than hanging.
 */
export function wouldCycle(
  dependencies: TaskDependency[],
  taskId: string,
  dependsOnTaskId: string,
): boolean {
  if (taskId === dependsOnTaskId) return true;

  // predecessors[x] = everything x waits on.
  const predecessors = new Map<string, string[]>();
  for (const dep of dependencies) {
    const list = predecessors.get(dep.taskId);
    if (list) list.push(dep.dependsOnTaskId);
    else predecessors.set(dep.taskId, [dep.dependsOnTaskId]);
  }

  // If taskId is already somewhere upstream of dependsOnTaskId, the new edge
  // would close a loop.
  const seen = new Set<string>();
  const queue = [dependsOnTaskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of predecessors.get(current) ?? []) queue.push(next);
  }
  return false;
}

// ── Checklists ───────────────────────────────────────────────────────────────

export interface ChecklistItemInput {
  label: string;
  isDone?: boolean;
}

export interface ChecklistProgress {
  total: number;
  done: number;
  /** 0–100, or null when there's no checklist to measure. */
  percent: number | null;
  complete: boolean;
}

export function checklistProgress(items: { isDone: boolean }[]): ChecklistProgress {
  const total = items.length;
  const done = items.filter((i) => i.isDone).length;
  return {
    total,
    done,
    percent: total > 0 ? Math.round((done / total) * 100) : null,
    complete: total > 0 && done === total,
  };
}

/**
 * Whether completing a task should be questioned: its checklist isn't finished.
 * A warning, not a block — the checklist is the foreman's own aide-mémoire, and
 * the app has no business refusing to close out work he says is done.
 */
export function hasUnfinishedChecklist(items: { isDone: boolean }[]): boolean {
  return items.length > 0 && items.some((i) => !i.isDone);
}

/** Splits a pasted block of lines into checklist labels, trimmed and de-duped. */
export function parseChecklist(text: string, limit = 50): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of text.split('\n')) {
    // Tolerate pasted bullets and numbering.
    const label = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (label.length === 0 || label.length > 200) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface TaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | string | null;
  actualHours?: number | string | null;
}

export const MAX_TASK_HOURS = 10_000;

export function validateTask(input: TaskInput): { error?: string } {
  const title = input.title?.trim() ?? '';
  if (title.length === 0) return { error: 'Give this task a title.' };
  if (title.length > 200) return { error: 'Keep the title under 200 characters.' };

  if (input.startDate && !isDay(input.startDate)) return { error: 'Pick a valid start date.' };
  if (input.dueDate && !isDay(input.dueDate)) return { error: 'Pick a valid due date.' };
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
    return { error: 'The due date can’t be before the start date.' };
  }

  for (const [label, value] of [
    ['Estimated hours', input.estimatedHours],
    ['Actual hours', input.actualHours],
  ] as const) {
    const hours = hoursValue(value);
    if (hours === null) return { error: `${label} must be a number.` };
    if (hours < 0) return { error: `${label} can’t be negative.` };
    if (hours > MAX_TASK_HOURS) return { error: `${label} looks wrong — over ${MAX_TASK_HOURS}.` };
  }

  if (input.status && !isTaskStatus(input.status)) return { error: 'Unrecognised status.' };
  if (input.priority && !isPriority(input.priority)) return { error: 'Unrecognised priority.' };
  return {};
}

/** Normalises an hours field; null means "not a number". Empty is 0. */
export function hoursValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Hours over (positive) or under (negative) estimate. Null without both. */
export function hoursVariance(
  estimated: number | string | null | undefined,
  actual: number | string | null | undefined,
): number | null {
  const est = hoursValue(estimated);
  const act = hoursValue(actual);
  if (est === null || act === null || est === 0) return null;
  return Math.round((act - est) * 100) / 100;
}

// ── Timing ───────────────────────────────────────────────────────────────────

export type TaskUrgency = 'overdue' | 'due_today' | 'due_soon' | 'scheduled' | 'undated' | 'done';

/**
 * How a task stands against today. End of the due day is still on time — a task
 * due Thursday is not late at 9am Thursday.
 */
export function taskUrgency(
  task: { status: TaskStatus; dueDate?: string | null },
  now: Date = new Date(),
): TaskUrgency {
  if (isDone(task.status)) return 'done';
  if (!task.dueDate || !isDay(task.dueDate)) return 'undated';
  const day = today(now);
  if (task.dueDate < day) return 'overdue';
  if (task.dueDate === day) return 'due_today';
  const soon = addDays(day, 3);
  if (soon && task.dueDate <= soon) return 'due_soon';
  return 'scheduled';
}

/** "2 days late" / "due Thursday" — the human read on a task's timing. */
export function describeTaskTiming(
  task: { status: TaskStatus; dueDate?: string | null },
  now: Date = new Date(),
): string {
  const urgency = taskUrgency(task, now);
  if (urgency === 'done') return 'Completed';
  if (urgency === 'undated') return 'No due date';
  const day = today(now);
  const dueDate = task.dueDate!;
  if (urgency === 'overdue') {
    const late = dayDiff(dueDate, day) ?? 0;
    return late === 1 ? '1 day late' : `${late} days late`;
  }
  if (urgency === 'due_today') return 'Due today';
  const until = dayDiff(day, dueDate) ?? 0;
  if (until === 1) return 'Due tomorrow';
  return `Due in ${until} days`;
}

// ── Rollups ──────────────────────────────────────────────────────────────────

export interface TaskSummary {
  total: number;
  open: number;
  active: number;
  blocked: number;
  overdue: number;
  completed: number;
  punchListOpen: number;
  /** 0–100 by task count, or null when there are no tasks. */
  percentComplete: number | null;
}

export interface SummarizableTask {
  status: TaskStatus;
  dueDate?: string | null;
  isPunchList?: boolean;
  blockerCount?: number;
}

/**
 * The at-a-glance numbers. Counts the *effective* status, so a task held up by
 * an unfinished predecessor shows as blocked here too.
 */
export function summarizeTasks(tasks: SummarizableTask[], now: Date = new Date()): TaskSummary {
  let open = 0;
  let active = 0;
  let blocked = 0;
  let overdue = 0;
  let completed = 0;
  let punchListOpen = 0;

  for (const task of tasks) {
    const status = effectiveStatus(task.status, task.blockerCount ?? 0);
    if (isDone(status)) {
      completed++;
      continue;
    }
    open++;
    if (isActive(status)) active++;
    if (status === 'blocked') blocked++;
    if (taskUrgency(task, now) === 'overdue') overdue++;
    if (task.isPunchList) punchListOpen++;
  }

  return {
    total: tasks.length,
    open,
    active,
    blocked,
    overdue,
    completed,
    punchListOpen,
    percentComplete: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : null,
  };
}

// ── Sorting & grouping ───────────────────────────────────────────────────────

const URGENCY_RANK: Record<TaskUrgency, number> = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
  scheduled: 3,
  undated: 4,
  done: 5,
};

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export interface SortableTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueDate?: string | null;
  sortOrder?: number;
}

/**
 * Field order: what's late first, then what's due soonest, then priority, then
 * the manual order. Completed work sinks to the bottom. This is the order a
 * foreman would read the list in, not creation order.
 */
export function sortForField<T extends SortableTask>(tasks: T[], now: Date = new Date()): T[] {
  return [...tasks].sort((a, b) => {
    const rank = URGENCY_RANK[taskUrgency(a, now)] - URGENCY_RANK[taskUrgency(b, now)];
    if (rank !== 0) return rank;
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priority !== 0) return priority;
    const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (order !== 0) return order;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Separates the punch list from the main task list. Punch-list items are the
 * end-of-job snags: they belong together, not scattered through the build.
 */
export function partitionPunchList<T extends { isPunchList?: boolean }>(
  tasks: T[],
): { work: T[]; punchList: T[] } {
  const work: T[] = [];
  const punchList: T[] = [];
  for (const task of tasks) (task.isPunchList ? punchList : work).push(task);
  return { work, punchList };
}

/** Groups by assignee for a "who's got what" view. Unassigned sorts last. */
export function groupByAssignee<T extends { assigneeId?: string | null; assigneeName?: string | null }>(
  tasks: T[],
): { assigneeId: string | null; assigneeName: string | null; tasks: T[] }[] {
  const groups = new Map<string, { assigneeId: string | null; assigneeName: string | null; tasks: T[] }>();
  for (const task of tasks) {
    const key = task.assigneeId ?? '';
    const group = groups.get(key);
    if (group) group.tasks.push(task);
    else
      groups.set(key, {
        assigneeId: task.assigneeId ?? null,
        assigneeName: task.assigneeName ?? null,
        tasks: [task],
      });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.assigneeId === null) return 1;
    if (b.assigneeId === null) return -1;
    return (a.assigneeName ?? '').localeCompare(b.assigneeName ?? '');
  });
}

/**
 * The standard punch-list starting point. Generic on purpose — these are the
 * snags that come up on every job regardless of trade.
 */
export const PUNCH_LIST_STARTERS = [
  'Touch-up paint',
  'Caulk and seal',
  'Adjust doors and drawers',
  'Clean fixtures and glass',
  'Replace filters',
  'Test every outlet and switch',
  'Confirm all fixtures drain and vent',
  'Remove debris and protect surfaces',
  'Final client walkthrough',
] as const;
