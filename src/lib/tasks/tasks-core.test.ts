import { describe, it, expect } from 'vitest';
import {
  MAX_TASK_HOURS,
  PUNCH_LIST_STARTERS,
  TASK_STATUSES,
  allowedTransitions,
  blockedBy,
  checklistProgress,
  describeTaskTiming,
  effectiveStatus,
  groupByAssignee,
  hasUnfinishedChecklist,
  hoursValue,
  hoursVariance,
  isActive,
  isDone,
  isOpen,
  isPriority,
  isTaskStatus,
  parseChecklist,
  partitionPunchList,
  primaryNextStatus,
  sortForField,
  summarizeTasks,
  validateTask,
  wouldCycle,
  type Priority,
  type TaskStatus,
} from './tasks-core';

describe('catalogs', () => {
  it('has the seven documented task statuses', () => {
    expect(TASK_STATUSES).toHaveLength(7);
  });
  it('guards form input', () => {
    expect(isTaskStatus('awaiting_inspection')).toBe(true);
    expect(isTaskStatus('nearly_done')).toBe(false);
    expect(isPriority('high')).toBe(true);
    expect(isPriority('urgent')).toBe(false);
  });
  it('classifies work as done, open, or actively held', () => {
    expect(isDone('completed')).toBe(true);
    expect(isDone('rework_required')).toBe(false);
    expect(isOpen('rework_required')).toBe(true);
    expect(isOpen('completed')).toBe(false);
    expect(isActive('in_progress')).toBe(true);
    expect(isActive('awaiting_inspection')).toBe(true);
    expect(isActive('ready')).toBe(false);
  });
});

describe('transitions', () => {
  it('never offers the status a task is already in', () => {
    for (const status of TASK_STATUSES) {
      expect(allowedTransitions(status)).not.toContain(status);
    }
  });
  it('never offers blocked, which is computed rather than chosen', () => {
    for (const status of TASK_STATUSES) {
      expect(allowedTransitions(status)).not.toContain('blocked');
    }
  });
  it('offers the obvious next step as the primary action', () => {
    expect(primaryNextStatus('not_started')).toBe('in_progress');
    expect(primaryNextStatus('ready')).toBe('in_progress');
    expect(primaryNextStatus('in_progress')).toBe('completed');
    expect(primaryNextStatus('awaiting_inspection')).toBe('completed');
    expect(primaryNextStatus('rework_required')).toBe('in_progress');
    expect(primaryNextStatus('blocked')).toBe('in_progress');
    expect(primaryNextStatus('completed')).toBeNull();
  });
});

describe('blockedBy', () => {
  const tasks = [
    { id: 'demo', title: 'Demo', status: 'completed' as TaskStatus },
    { id: 'rough', title: 'Rough-in', status: 'in_progress' as TaskStatus },
    { id: 'drywall', title: 'Drywall', status: 'not_started' as TaskStatus },
  ];

  it('names the unfinished predecessors holding a task up', () => {
    const blockers = blockedBy(tasks, [{ taskId: 'drywall', dependsOnTaskId: 'rough' }]);
    expect(blockers.get('drywall')?.map((t) => t.title)).toEqual(['Rough-in']);
  });

  it('does not count a finished predecessor', () => {
    const blockers = blockedBy(tasks, [{ taskId: 'rough', dependsOnTaskId: 'demo' }]);
    expect(blockers.has('rough')).toBe(false);
  });

  it('collects every blocker when there are several', () => {
    const blockers = blockedBy(tasks, [
      { taskId: 'drywall', dependsOnTaskId: 'rough' },
      { taskId: 'drywall', dependsOnTaskId: 'demo' },
    ]);
    expect(blockers.get('drywall')).toHaveLength(1); // demo is done
    const both = blockedBy(
      [...tasks, { id: 'insp', title: 'Inspection', status: 'awaiting_inspection' as TaskStatus }],
      [
        { taskId: 'drywall', dependsOnTaskId: 'rough' },
        { taskId: 'drywall', dependsOnTaskId: 'insp' },
      ],
    );
    expect(both.get('drywall')).toHaveLength(2);
  });

  it('ignores a dependency on a task it cannot see rather than wedging the work', () => {
    const blockers = blockedBy(tasks, [{ taskId: 'drywall', dependsOnTaskId: 'deleted' }]);
    expect(blockers.has('drywall')).toBe(false);
  });
});

describe('effectiveStatus', () => {
  it('derives blocked from unfinished dependencies', () => {
    expect(effectiveStatus('not_started', 1)).toBe('blocked');
    expect(effectiveStatus('ready', 2)).toBe('blocked');
  });
  it('promotes an unblocked not-started task to ready', () => {
    expect(effectiveStatus('not_started', 0)).toBe('ready');
    expect(effectiveStatus('blocked', 0)).toBe('ready');
  });
  it('leaves a foreman’s explicit statement about the real world alone', () => {
    expect(effectiveStatus('in_progress', 3)).toBe('in_progress');
    expect(effectiveStatus('awaiting_inspection', 3)).toBe('awaiting_inspection');
    expect(effectiveStatus('rework_required', 3)).toBe('rework_required');
    expect(effectiveStatus('completed', 3)).toBe('completed');
  });
});

describe('wouldCycle', () => {
  // a ← b ← c: c waits on b, b waits on a.
  const deps = [
    { taskId: 'b', dependsOnTaskId: 'a' },
    { taskId: 'c', dependsOnTaskId: 'b' },
  ];

  it('refuses a self-dependency', () => {
    expect(wouldCycle(deps, 'a', 'a')).toBe(true);
  });
  it('refuses an edge that closes a loop, however long the chain', () => {
    expect(wouldCycle(deps, 'a', 'c')).toBe(true);
    expect(wouldCycle(deps, 'a', 'b')).toBe(true);
  });
  it('allows an edge that does not', () => {
    expect(wouldCycle(deps, 'c', 'a')).toBe(false);
    expect(wouldCycle(deps, 'd', 'c')).toBe(false);
    expect(wouldCycle([], 'x', 'y')).toBe(false);
  });
  it('follows every branch of a many-to-many graph', () => {
    const diamond = [
      { taskId: 'b', dependsOnTaskId: 'a' },
      { taskId: 'c', dependsOnTaskId: 'a' },
      { taskId: 'd', dependsOnTaskId: 'b' },
      { taskId: 'd', dependsOnTaskId: 'c' },
    ];
    expect(wouldCycle(diamond, 'a', 'd')).toBe(true);
    expect(wouldCycle(diamond, 'b', 'c')).toBe(false);
  });
  it('terminates on a cycle already present in the data', () => {
    const bad = [
      { taskId: 'a', dependsOnTaskId: 'b' },
      { taskId: 'b', dependsOnTaskId: 'a' },
    ];
    expect(wouldCycle(bad, 'z', 'a')).toBe(false);
    expect(wouldCycle(bad, 'a', 'b')).toBe(true);
  });
});

describe('checklists', () => {
  it('measures progress', () => {
    expect(checklistProgress([])).toEqual({
      total: 0,
      done: 0,
      percent: null,
      complete: false,
    });
    expect(checklistProgress([{ isDone: true }, { isDone: false }])).toEqual({
      total: 2,
      done: 1,
      percent: 50,
      complete: false,
    });
    expect(checklistProgress([{ isDone: true }]).complete).toBe(true);
  });

  it('flags an unfinished checklist without blocking anything', () => {
    expect(hasUnfinishedChecklist([])).toBe(false);
    expect(hasUnfinishedChecklist([{ isDone: true }])).toBe(false);
    expect(hasUnfinishedChecklist([{ isDone: true }, { isDone: false }])).toBe(true);
  });

  it('parses a pasted list, tolerating bullets and numbering', () => {
    expect(
      parseChecklist('- Set the vanity\n* Caulk the base\n1. Test the drain\n\n  \n2) Photograph it'),
    ).toEqual(['Set the vanity', 'Caulk the base', 'Test the drain', 'Photograph it']);
  });

  it('drops duplicates case-insensitively and caps the length', () => {
    expect(parseChecklist('Paint\npaint\nPAINT')).toEqual(['Paint']);
    expect(parseChecklist(Array.from({ length: 80 }, (_, i) => `Item ${i}`).join('\n'))).toHaveLength(
      50,
    );
    expect(parseChecklist(`ok\n${'x'.repeat(201)}`)).toEqual(['ok']);
    expect(parseChecklist('')).toEqual([]);
  });
});

describe('validateTask', () => {
  const good = { title: 'Set the vanity' };

  it('accepts a bare title', () => {
    expect(validateTask(good).error).toBeUndefined();
  });
  it('requires a title', () => {
    expect(validateTask({ title: '  ' }).error).toContain('title');
    expect(validateTask({ title: 'x'.repeat(201) }).error).toContain('200');
  });
  it('accepts a task with no dates at all', () => {
    expect(validateTask({ ...good, startDate: null, dueDate: null }).error).toBeUndefined();
    expect(validateTask({ ...good, startDate: '', dueDate: '' }).error).toBeUndefined();
  });
  it('rejects unreal dates and a backwards range', () => {
    expect(validateTask({ ...good, dueDate: '2026-02-30' }).error).toContain('due date');
    expect(validateTask({ ...good, startDate: 'soon' }).error).toContain('start date');
    expect(
      validateTask({ ...good, startDate: '2026-08-10', dueDate: '2026-08-03' }).error,
    ).toContain('before the start date');
  });
  it('bounds the hours fields', () => {
    expect(validateTask({ ...good, estimatedHours: '8' }).error).toBeUndefined();
    expect(validateTask({ ...good, estimatedHours: '2.5' }).error).toBeUndefined();
    expect(validateTask({ ...good, estimatedHours: 'lots' }).error).toContain('must be a number');
    expect(validateTask({ ...good, actualHours: -1 }).error).toContain('negative');
    expect(validateTask({ ...good, actualHours: MAX_TASK_HOURS + 1 }).error).toContain('looks wrong');
  });
});

describe('hours', () => {
  it('treats empty as zero and rejects nonsense', () => {
    expect(hoursValue('')).toBe(0);
    expect(hoursValue(null)).toBe(0);
    expect(hoursValue('7.25')).toBe(7.25);
    expect(hoursValue('abc')).toBeNull();
  });
  it('reports variance against the estimate, and stays quiet without one', () => {
    expect(hoursVariance(8, 10)).toBe(2);
    expect(hoursVariance(8, 6)).toBe(-2);
    expect(hoursVariance(8, 8)).toBe(0);
    expect(hoursVariance(null, 10)).toBeNull();
    expect(hoursVariance(0, 10)).toBeNull();
    expect(hoursVariance('8.5', '9.25')).toBe(0.75);
  });
});

describe('timing', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  const t = (dueDate: string | null, status: TaskStatus = 'in_progress') => ({ status, dueDate });

  it('reads a task against today, forgiving through the due day', () => {
    expect(describeTaskTiming(t('2026-08-03'), now)).toBe('2 days late');
    expect(describeTaskTiming(t('2026-08-04'), now)).toBe('1 day late');
    expect(describeTaskTiming(t('2026-08-05'), now)).toBe('Due today');
    expect(describeTaskTiming(t('2026-08-06'), now)).toBe('Due tomorrow');
    expect(describeTaskTiming(t('2026-08-09'), now)).toBe('Due in 4 days');
    expect(describeTaskTiming(t(null), now)).toBe('No due date');
  });

  it('never calls completed work late', () => {
    expect(describeTaskTiming(t('2026-01-01', 'completed'), now)).toBe('Completed');
  });
});

describe('summarizeTasks', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('counts the effective status, so a held-up task reads as blocked', () => {
    const summary = summarizeTasks(
      [
        { status: 'not_started', blockerCount: 1, dueDate: '2026-08-10' },
        { status: 'in_progress', dueDate: '2026-08-01' }, // overdue
        { status: 'awaiting_inspection', dueDate: '2026-08-20' },
        { status: 'completed', dueDate: '2026-07-01' },
        { status: 'rework_required', dueDate: '2026-08-04', isPunchList: true },
      ],
      now,
    );
    expect(summary.total).toBe(5);
    expect(summary.completed).toBe(1);
    expect(summary.open).toBe(4);
    expect(summary.blocked).toBe(1);
    expect(summary.active).toBe(2); // in_progress + awaiting_inspection
    expect(summary.overdue).toBe(2); // the in_progress one and the rework one
    expect(summary.punchListOpen).toBe(1);
    expect(summary.percentComplete).toBe(20);
  });

  it('never counts finished work as overdue or punch-list-outstanding', () => {
    const summary = summarizeTasks(
      [{ status: 'completed', dueDate: '2020-01-01', isPunchList: true }],
      now,
    );
    expect(summary.overdue).toBe(0);
    expect(summary.punchListOpen).toBe(0);
    expect(summary.percentComplete).toBe(100);
  });

  it('has no opinion on an empty list', () => {
    expect(summarizeTasks([], now).percentComplete).toBeNull();
  });
});

describe('sortForField', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  const task = (
    id: string,
    dueDate: string | null,
    priority: Priority = 'medium',
    status: TaskStatus = 'ready',
    sortOrder = 0,
  ) => ({ id, title: id, status, priority, dueDate, sortOrder });

  it('puts what is late first, then due soonest, then priority', () => {
    const sorted = sortForField(
      [
        task('scheduled', '2026-09-01'),
        task('late', '2026-08-01'),
        task('today', '2026-08-05'),
        task('soon', '2026-08-07'),
        task('undated', null),
      ],
      now,
    );
    expect(sorted.map((t) => t.id)).toEqual(['late', 'today', 'soon', 'scheduled', 'undated']);
  });

  it('breaks ties on priority, then manual order, then title', () => {
    const sorted = sortForField(
      [
        task('b-medium', '2026-08-20', 'medium', 'ready', 1),
        task('a-high', '2026-08-20', 'high'),
        task('c-medium', '2026-08-20', 'medium', 'ready', 0),
      ],
      now,
    );
    expect(sorted.map((t) => t.id)).toEqual(['a-high', 'c-medium', 'b-medium']);
  });

  it('sinks completed work to the bottom even when it was overdue', () => {
    const sorted = sortForField(
      [task('done', '2026-01-01', 'high', 'completed'), task('open', '2026-09-01')],
      now,
    );
    expect(sorted.map((t) => t.id)).toEqual(['open', 'done']);
  });

  it('does not mutate the input', () => {
    const input = [task('b', '2026-09-01'), task('a', '2026-08-01')];
    sortForField(input, now);
    expect(input.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('grouping', () => {
  it('separates the punch list from the build', () => {
    const { work, punchList } = partitionPunchList([
      { id: 'a' },
      { id: 'b', isPunchList: true },
      { id: 'c', isPunchList: false },
    ]);
    expect(work.map((t) => t.id)).toEqual(['a', 'c']);
    expect(punchList.map((t) => t.id)).toEqual(['b']);
  });

  it('groups by assignee with the unassigned pile last', () => {
    const groups = groupByAssignee([
      { assigneeId: null, assigneeName: null },
      { assigneeId: 'u2', assigneeName: 'Mike' },
      { assigneeId: 'u1', assigneeName: 'Dave' },
      { assigneeId: 'u2', assigneeName: 'Mike' },
    ]);
    expect(groups.map((g) => g.assigneeName)).toEqual(['Dave', 'Mike', null]);
    expect(groups[1]!.tasks).toHaveLength(2);
  });
});

describe('punch-list starters', () => {
  it('offers a generic starting point that needs no trade knowledge', () => {
    expect(PUNCH_LIST_STARTERS.length).toBeGreaterThan(5);
    expect(PUNCH_LIST_STARTERS).toContain('Final client walkthrough');
  });
});
