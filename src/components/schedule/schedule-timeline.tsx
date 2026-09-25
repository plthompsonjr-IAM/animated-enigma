import Link from 'next/link';
import {
  SCHEDULE_BAR_STYLES,
  displayPercent,
  formatDay,
  timelineBars,
  timelineWindow,
  todayMarker,
  weeksInWindow,
  type DayRange,
  type ScheduleItemStatus,
} from '@/lib/schedule/schedule-core';
import { cn } from '@/lib/utils';

export interface TimelineRow extends DayRange {
  id: string;
  name: string;
  status: ScheduleItemStatus;
  percentComplete: number;
  projectId: string;
  projectName?: string | null;
  crewNames?: string[];
  hasConflict?: boolean;
}

/**
 * A Gantt-style timeline. Bars are positioned as percentages by
 * `timelineBars`, so nothing needs measuring in the browser and the whole thing
 * renders correctly server-side.
 *
 * Mobile-first: the chart area has a minimum width and lives in a horizontal
 * scroller, with the item labels in a sticky left column so a foreman can swipe
 * through the weeks without losing track of which row is which.
 */
export function ScheduleTimeline({
  rows,
  showProject = false,
  now,
}: {
  rows: TimelineRow[];
  showProject?: boolean;
  now?: Date;
}) {
  const window = timelineWindow(rows, now);
  const weeks = weeksInWindow(window);
  const bars = timelineBars(rows, window);
  const marker = todayMarker(window, now);

  if (bars.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing scheduled in this window. Add a work item to see it here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[640px]">
        <div className="flex border-b pb-1">
          <div className="w-40 flex-none pr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-56">
            Work item
          </div>
          <div className="relative flex-1">
            <div className="flex">
              {weeks.map((week) => (
                <div
                  key={week}
                  className="flex-1 border-l pl-1 text-[10px] text-muted-foreground"
                  style={{ minWidth: 0 }}
                >
                  {formatDay(week)}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative divide-y">
          {/* Today line, drawn behind the bars across every row. */}
          {marker !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 top-0 z-0 w-px bg-primary/50"
              style={{ left: `calc(10rem + (100% - 10rem) * ${marker / 100})` }}
            />
          ) : null}

          {bars.map(({ item, offset, width, clippedStart, clippedEnd }) => {
            const pct = displayPercent(item.status, item.percentComplete);
            return (
              <div key={item.id} className="relative z-10 flex items-center py-1.5">
                <div className="w-40 flex-none pr-2 sm:w-56">
                  <Link
                    href={`/projects/${item.projectId}`}
                    className="block truncate text-xs font-medium hover:underline"
                    title={item.name}
                  >
                    {item.name}
                  </Link>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {showProject && item.projectName ? item.projectName : null}
                    {showProject && item.projectName && item.crewNames?.length ? ' · ' : null}
                    {item.crewNames?.length ? item.crewNames.join(', ') : null}
                  </div>
                </div>

                <div className="relative h-6 flex-1">
                  <div
                    className={cn(
                      'absolute top-1 flex h-4 items-center overflow-hidden rounded-sm',
                      SCHEDULE_BAR_STYLES[item.status],
                      clippedStart && 'rounded-l-none',
                      clippedEnd && 'rounded-r-none',
                      item.hasConflict && 'ring-2 ring-amber-500 ring-offset-1',
                    )}
                    style={{ left: `${offset}%`, width: `${Math.max(width, 1.2)}%` }}
                    title={`${item.name} · ${formatDay(item.startDate)} – ${formatDay(item.endDate)}`}
                  >
                    {/* Progress fill, so a bar shows both plan and actual. */}
                    {pct > 0 && pct < 100 ? (
                      <div
                        className="h-full bg-black/25 dark:bg-white/25"
                        style={{ width: `${pct}%` }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-2 text-[10px] text-muted-foreground">
          {formatDay(window.startDate)} – {formatDay(window.endDate)}. Darker fill is reported
          progress; an amber outline is a crew double-booking.
        </p>
      </div>
    </div>
  );
}
