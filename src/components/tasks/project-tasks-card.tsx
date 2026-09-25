import { ClipboardList, ListPlus } from 'lucide-react';
import {
  blockedBy,
  partitionPunchList,
  sortForField,
  summarizeTasks,
  type TaskDependency,
} from '@/lib/tasks/tasks-core';
import { seedPunchList } from '@/lib/tasks/actions';
import type { TaskRow } from '@/lib/tasks/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TaskList, type TaskListEntry } from './task-list';
import { TaskForm, type TaskFormMember } from './task-form';

/**
 * The tasks section on a project. The punch list is kept separate from the build
 * work — it's the end-of-job snag list, and mixing it into the main list buries
 * both.
 */
export function ProjectTasksCard({
  projectId,
  tasks,
  dependencies,
  members,
  phases,
  mayWrite,
}: {
  projectId: string;
  tasks: TaskRow[];
  dependencies: TaskDependency[];
  members: TaskFormMember[];
  phases: { id: string; name: string }[];
  mayWrite: boolean;
}) {
  const blockers = blockedBy(
    tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    dependencies,
  );

  const entries: TaskListEntry[] = tasks.map((task) => ({
    ...task,
    blockers: (blockers.get(task.id) ?? []).map((b) => ({ id: b.id, title: b.title })),
  }));

  const summary = summarizeTasks(
    entries.map((t) => ({
      status: t.status,
      dueDate: t.dueDate,
      isPunchList: t.isPunchList,
      blockerCount: t.blockers.length,
    })),
  );

  const { work, punchList } = partitionPunchList(entries);
  const sortedWork = sortForField(work);
  const sortedPunch = sortForField(punchList);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Tasks</CardTitle>
          {tasks.length > 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {summary.open} open · {summary.percentComplete ?? 0}% complete
              {summary.overdue > 0 ? ` · ${summary.overdue} late` : ''}
              {summary.blocked > 0 ? ` · ${summary.blocked} blocked` : ''}
            </p>
          ) : null}
        </div>
        <ClipboardList className="h-5 w-5 flex-none text-muted-foreground" />
      </CardHeader>

      <CardContent className="space-y-5">
        <section className="space-y-3">
          {sortedWork.length > 0 ? (
            <TaskList tasks={sortedWork} mayWrite={mayWrite} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No tasks yet. Add the work that needs doing on this job.
            </p>
          )}
          {mayWrite ? (
            <TaskForm projectId={projectId} members={members} phases={phases} />
          ) : null}
        </section>

        <section className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">Punch list</h3>
            <p className="text-xs text-muted-foreground">
              {sortedPunch.length > 0
                ? `${summary.punchListOpen} open of ${sortedPunch.length}.`
                : 'The end-of-job snag list.'}
            </p>
          </div>
          {sortedPunch.length > 0 ? (
            <TaskList tasks={sortedPunch} mayWrite={mayWrite} />
          ) : null}
          {mayWrite ? (
            <div className="flex flex-wrap gap-2">
              {sortedPunch.length === 0 ? (
                <form action={seedPunchList}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <Button type="submit" size="sm" variant="outline" className="w-auto">
                    <ListPlus className="h-4 w-4" />
                    Start standard punch list
                  </Button>
                </form>
              ) : null}
              <TaskForm projectId={projectId} members={members} phases={phases} punchList />
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
