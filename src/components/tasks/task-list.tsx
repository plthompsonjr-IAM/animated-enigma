import Link from 'next/link';
import { CalendarClock, Check, Lock, User } from 'lucide-react';
import {
  TASK_STATUS_LABELS,
  checklistProgress,
  describeTaskTiming,
  effectiveStatus,
  hoursVariance,
  isDone,
  primaryNextStatus,
  taskUrgency,
  type Priority,
  type TaskStatus,
} from '@/lib/tasks/tasks-core';
import {
  pushTaskDueDate,
  setTaskStatus,
  toggleChecklistItem,
} from '@/lib/tasks/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PriorityBadge, TaskStatusBadge } from './task-status-badge';

export interface TaskListEntry {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  isPunchList: boolean;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  estimatedHours: string | null;
  actualHours: string | null;
  projectId: string;
  projectName?: string | null;
  projectNumber?: string | null;
  scheduleItemName?: string | null;
  checklist: { id: string; label: string; isDone: boolean }[];
  /** Unfinished predecessors, named so the row can say why it's held up. */
  blockers: { id: string; title: string }[];
}

/**
 * The task list. Built for a phone on a jobsite: the primary action is one tap,
 * checklist steps tick without leaving the page, and a blocked task says what
 * it's waiting on rather than just showing a red badge.
 */
export function TaskList({
  tasks,
  mayWrite,
  showProject = false,
  now,
}: {
  tasks: TaskListEntry[];
  mayWrite: boolean;
  showProject?: boolean;
  now?: Date;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks.</p>;
  }

  return (
    <ul className="divide-y rounded-md border">
      {tasks.map((task) => {
        const status = effectiveStatus(task.status, task.blockers.length);
        const urgency = taskUrgency(task, now);
        const progress = checklistProgress(task.checklist);
        const variance = hoursVariance(task.estimatedHours, task.actualHours);
        const next = primaryNextStatus(status);
        const done = isDone(status);

        return (
          <li key={task.id} className={cn('space-y-2 p-3', done && 'opacity-70')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('font-medium', done && 'line-through')}>{task.title}</span>
                  <TaskStatusBadge status={status} />
                  <PriorityBadge priority={task.priority} />
                  {task.isPunchList ? (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-inset ring-border">
                      Punch list
                    </span>
                  ) : null}
                </div>
                {task.description ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">{task.description}</p>
                ) : null}
                {showProject && task.projectName ? (
                  <Link
                    href={`/projects/${task.projectId}`}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {task.projectNumber ? `${task.projectNumber} · ` : ''}
                    {task.projectName}
                  </Link>
                ) : null}
              </div>
              <span
                className={cn(
                  'text-xs',
                  urgency === 'overdue'
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : urgency === 'due_today'
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground',
                )}
              >
                {describeTaskTiming(task, now)}
              </span>
            </div>

            {status === 'blocked' ? (
              <p className="flex items-start gap-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-xs">
                <Lock className="mt-0.5 h-3 w-3 flex-none text-red-600 dark:text-red-400" />
                <span>
                  Waiting on {task.blockers.map((b) => b.title).join(', ')}.
                </span>
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" />
                {task.assigneeName ?? task.assigneeEmail ?? 'Unassigned'}
              </span>
              {task.scheduleItemName ? <span>Phase: {task.scheduleItemName}</span> : null}
              {progress.total > 0 ? (
                <span>
                  Checklist {progress.done}/{progress.total}
                </span>
              ) : null}
              {variance !== null && variance !== 0 ? (
                <span className={variance > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
                  {variance > 0 ? `${variance}h over` : `${Math.abs(variance)}h under`} estimate
                </span>
              ) : null}
            </div>

            {task.checklist.length > 0 ? (
              <ul className="space-y-0.5">
                {task.checklist.map((item) => (
                  <li key={item.id}>
                    {mayWrite ? (
                      <form action={toggleChecklistItem}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="isDone" value={String(!item.isDone)} />
                        <button
                          type="submit"
                          className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-accent/50"
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 flex-none items-center justify-center rounded border',
                              item.isDone
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input',
                            )}
                          >
                            {item.isDone ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className={item.isDone ? 'text-muted-foreground line-through' : ''}>
                            {item.label}
                          </span>
                        </button>
                      </form>
                    ) : (
                      <span className="flex items-center gap-2 px-1 py-1 text-sm">
                        <span
                          className={cn(
                            'flex h-4 w-4 flex-none items-center justify-center rounded border',
                            item.isDone
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input',
                          )}
                        >
                          {item.isDone ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className={item.isDone ? 'text-muted-foreground line-through' : ''}>
                          {item.label}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            {mayWrite ? (
              <div className="flex flex-wrap gap-1.5">
                {next ? (
                  <form action={setTaskStatus}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="status" value={next} />
                    <Button type="submit" size="sm" className="h-7 w-auto px-2 text-xs">
                      {next === 'completed' ? 'Mark done' : TASK_STATUS_LABELS[next]}
                    </Button>
                  </form>
                ) : (
                  <form action={setTaskStatus}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="status" value="in_progress" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-7 w-auto px-2 text-xs"
                    >
                      Reopen
                    </Button>
                  </form>
                )}
                {!done && status !== 'awaiting_inspection' ? (
                  <form action={setTaskStatus}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="status" value="awaiting_inspection" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-7 w-auto px-2 text-xs"
                    >
                      Needs inspection
                    </Button>
                  </form>
                ) : null}
                {!done ? (
                  <form action={pushTaskDueDate}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="days" value="1" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-7 w-auto px-2 text-xs"
                      title="Move the due date out one day"
                    >
                      <CalendarClock className="h-3 w-3" />
                      +1 day
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
