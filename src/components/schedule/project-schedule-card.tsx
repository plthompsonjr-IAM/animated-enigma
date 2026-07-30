import { CalendarRange, ListPlus } from 'lucide-react';
import {
  addDays,
  boundingRange,
  conflictsForItem,
  dependencyProblems,
  formatDay,
  scheduleHealth,
  today,
  type CrewConflict,
} from '@/lib/schedule/schedule-core';
import { seedProjectSchedule } from '@/lib/schedule/actions';
import type { ScheduleItemRow, CrewMember } from '@/lib/schedule/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScheduleTimeline } from './schedule-timeline';
import { ScheduleItemList } from './schedule-item-list';
import { ScheduleItemForm } from './schedule-item-form';
import { CrewConflictNotice, DependencyNotice } from './conflict-notices';

/**
 * The schedule section on a project. Shows the timeline, the work-item list with
 * one-tap status changes, any crew or sequencing problems, and the add/edit form.
 *
 * Conflicts are passed in from the org-wide set rather than computed from this
 * project's items alone — the expensive double-booking is the one where a person
 * is on two different jobs the same week, which is invisible from inside either.
 */
export function ProjectScheduleCard({
  projectId,
  items,
  crew,
  conflicts,
  mayWrite,
}: {
  projectId: string;
  items: ScheduleItemRow[];
  crew: CrewMember[];
  conflicts: CrewConflict[];
  mayWrite: boolean;
}) {
  const health = scheduleHealth(items);
  const problems = dependencyProblems(
    items.map((i) => ({
      id: i.id,
      name: i.name,
      startDate: i.startDate,
      endDate: i.endDate,
      dependsOnId: i.dependsOnId,
    })),
  );
  const nameById = new Map(items.map((i) => [i.id, i.name]));
  const bounds = boundingRange(items);
  // Adding usually means "the day after everything else ends".
  const defaultStart = bounds ? (addDays(bounds.endDate, 1) ?? today()) : today();

  const listItems = items.map((item) => ({
    ...item,
    dependsOnName: item.dependsOnId ? (nameById.get(item.dependsOnId) ?? null) : null,
    conflictCount: conflictsForItem(conflicts, item.id).length,
  }));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Schedule</CardTitle>
          {items.length > 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {health.percentComplete ?? 0}% complete
              {bounds ? ` · ${formatDay(bounds.startDate)} – ${formatDay(bounds.endDate)}` : ''}
              {health.overdue > 0
                ? ` · ${health.overdue} ${health.overdue === 1 ? 'item' : 'items'} late`
                : ''}
            </p>
          ) : null}
        </div>
        <CalendarRange className="h-5 w-5 flex-none text-muted-foreground" />
      </CardHeader>

      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No schedule yet. Start from the standard trade sequence and adjust it, or add work
              items one at a time.
            </p>
            {mayWrite ? (
              <div className="flex flex-wrap gap-2">
                <form action={seedProjectSchedule}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <Button type="submit" size="sm" className="w-auto">
                    <ListPlus className="h-4 w-4" />
                    Build standard schedule
                  </Button>
                </form>
                <ScheduleItemForm
                  projectId={projectId}
                  crew={crew}
                  siblings={[]}
                  defaultStart={defaultStart}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <ScheduleTimeline
              rows={items.map((item) => ({
                id: item.id,
                name: item.name,
                startDate: item.startDate,
                endDate: item.endDate,
                status: item.status,
                percentComplete: item.percentComplete,
                projectId: item.projectId,
                crewNames: item.crew.map((c) => c.name ?? c.email),
                hasConflict: conflictsForItem(conflicts, item.id).length > 0,
              }))}
            />

            <CrewConflictNotice conflicts={conflicts} />
            <DependencyNotice problems={problems} />

            <ScheduleItemList items={listItems} mayWrite={mayWrite} />

            {mayWrite ? (
              <ScheduleItemForm
                projectId={projectId}
                crew={crew}
                siblings={items.map((i) => ({ id: i.id, name: i.name }))}
                defaultStart={defaultStart}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
