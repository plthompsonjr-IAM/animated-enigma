/**
 * The one line an action adds after its database write commits.
 *
 * The mirror runs after the response has gone back to the phone, so a slow
 * Google never slows the tap that scheduled the visit — and on a serverless
 * host `after()` is what keeps the function alive long enough to finish. If
 * we are somehow outside a request (a script, a test), it simply runs inline
 * and is still not awaited by the caller.
 *
 * Plain module, not `'use server'`: it checks no permission, so it must not be
 * callable from a browser. The action that calls it already did the checking.
 */

import { after } from 'next/server';
import { mirrorScheduleItem, mirrorSiteVisit } from './google-calendar';
import type { CalendarSourceKind } from './calendar-core';

export function mirrorLater(
  kind: CalendarSourceKind,
  organizationId: string,
  userId: string | null | undefined,
  sourceId: string,
): void {
  if (!userId) return;
  const run = kind === 'site_visit' ? mirrorSiteVisit : mirrorScheduleItem;
  // Outcomes are logged inside the sync; nothing here can throw into the action.
  const task = () =>
    run(organizationId, userId, sourceId).then(
      () => undefined,
      () => undefined,
    );
  try {
    after(task);
  } catch {
    void task();
  }
}
