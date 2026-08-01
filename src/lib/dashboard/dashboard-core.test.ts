import { describe, it, expect } from 'vitest';
import {
  EMPTY_SIGNALS,
  SEVERITIES,
  buildAttentionList,
  buildKpis,
  countBySeverity,
  headline,
  sortAttention,
  type AttentionItem,
  type DashboardSignals,
} from './dashboard-core';

const signals = (over: Partial<DashboardSignals> = {}): DashboardSignals => ({
  ...EMPTY_SIGNALS,
  ...over,
});

describe('catalogs', () => {
  it('has three severities, worst first', () => {
    expect(SEVERITIES).toEqual(['critical', 'warning', 'info']);
  });
});

describe('buildAttentionList', () => {
  it('says nothing when nothing is wrong', () => {
    expect(buildAttentionList(EMPTY_SIGNALS)).toEqual([]);
  });

  it('leads with money past due', () => {
    const items = buildAttentionList(
      signals({ overdueInvoiceAmount: 12_500, overdueInvoiceCount: 3, overdueTasks: 4 }),
    );
    expect(items[0]!.id).toBe('overdue-invoices');
    expect(items[0]!.severity).toBe('critical');
    expect(items[0]!.title).toContain('$12,500.00');
    expect(items[0]!.href).toBe('/invoices');
  });

  it('speaks in singular when there is one of something', () => {
    const [item] = buildAttentionList(
      signals({ overdueInvoiceAmount: 500, overdueInvoiceCount: 1 }),
    );
    expect(item!.detail).toContain('One invoice');
  });

  it('treats a cross-project crew clash as critical, not a warning', () => {
    const items = buildAttentionList(signals({ crewConflicts: 1, crossProjectConflicts: 1 }));
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('cross-project-conflicts');
    expect(items[0]!.severity).toBe('critical');
    expect(items[0]!.detail).toContain('Nobody looking at one job can see this');
  });

  it('separates same-job clashes from cross-job ones without double counting', () => {
    const items = buildAttentionList(signals({ crewConflicts: 3, crossProjectConflicts: 1 }));
    const cross = items.find((i) => i.id === 'cross-project-conflicts');
    const same = items.find((i) => i.id === 'crew-conflicts');
    expect(cross!.count).toBe(1);
    expect(same!.count).toBe(2);
    expect(same!.severity).toBe('warning');
  });

  it('does not invent a same-job clash when every conflict is cross-job', () => {
    const items = buildAttentionList(signals({ crewConflicts: 2, crossProjectConflicts: 2 }));
    expect(items.find((i) => i.id === 'crew-conflicts')).toBeUndefined();
  });

  it('never produces a negative count from inconsistent inputs', () => {
    // crossProject can't exceed the total, but if it ever did, don't show "-1".
    const items = buildAttentionList(signals({ crewConflicts: 1, crossProjectConflicts: 3 }));
    expect(items.find((i) => i.id === 'crew-conflicts')).toBeUndefined();
  });

  it('flags approved change orders that were never invoiced', () => {
    const [item] = buildAttentionList(signals({ unbilledApprovedChangeOrders: 2 }));
    expect(item!.title).toContain('2 approved change orders not billed');
    expect(item!.detail).toContain('Invoice it');
  });

  it('flags missing daily logs with the reason they matter', () => {
    const [item] = buildAttentionList(signals({ projectsMissingTodaysLog: 1 }));
    expect(item!.title).toContain('1 active job with no log today');
    expect(item!.detail).toContain('delay claim');
  });

  it('flags a live contract with no signature as a real risk, not a note', () => {
    const [item] = buildAttentionList(signals({ unsignedActiveContracts: 1 }));
    expect(item!.severity).toBe('warning');
    expect(item!.title).toContain('1 live contract with no signature on file');
    expect(item!.detail).toContain('dispute');
  });

  it('orders worst first, then by size', () => {
    const items = buildAttentionList(
      signals({
        overdueInvoiceAmount: 100,
        overdueInvoiceCount: 1,
        overdueTasks: 9,
        overdueScheduleItems: 2,
        blockedTasks: 5,
        proposalsAwaitingResponse: 1,
      }),
    );
    expect(items.map((i) => i.severity)).toEqual([
      'critical',
      'warning',
      'warning',
      'info',
      'info',
    ]);
    // Within the warnings, nine late tasks outrank two late phases.
    const warnings = items.filter((i) => i.severity === 'warning');
    expect(warnings[0]!.id).toBe('overdue-tasks');
  });

  it('gives every item somewhere to go', () => {
    const items = buildAttentionList(
      signals({
        overdueInvoiceAmount: 1,
        overdueInvoiceCount: 1,
        crewConflicts: 2,
        crossProjectConflicts: 1,
        overdueScheduleItems: 1,
        overdueTasks: 1,
        unbilledApprovedChangeOrders: 1,
        overdueLeadFollowUps: 1,
        projectsMissingTodaysLog: 1,
        blockedTasks: 1,
        proposalsAwaitingResponse: 1,
        unsignedActiveContracts: 1,
      }),
    );
    expect(items).toHaveLength(11);
    for (const item of items) {
      expect(item.href.startsWith('/')).toBe(true);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
    }
    // Ids are unique, so React keys are safe.
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('ignores signals that are only ever informational counts', () => {
    // Upcoming visits and outstanding money alone are not problems.
    expect(buildAttentionList(signals({ upcomingVisits: 5, outstandingAmount: 40_000 }))).toEqual(
      [],
    );
  });
});

describe('sortAttention & counts', () => {
  const item = (over: Partial<AttentionItem> & { id: string }): AttentionItem => ({
    severity: 'info',
    title: over.id,
    detail: 'x',
    href: '/x',
    count: 1,
    ...over,
  });

  it('does not mutate the input', () => {
    const input = [item({ id: 'b' }), item({ id: 'a', severity: 'critical' })];
    sortAttention(input);
    expect(input.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('breaks a full tie on the title so the order is stable', () => {
    const sorted = sortAttention([item({ id: 'z', title: 'Zebra' }), item({ id: 'a', title: 'Apple' })]);
    expect(sorted.map((i) => i.title)).toEqual(['Apple', 'Zebra']);
  });

  it('counts by severity', () => {
    expect(
      countBySeverity([
        item({ id: '1', severity: 'critical' }),
        item({ id: '2', severity: 'warning' }),
        item({ id: '3', severity: 'warning' }),
      ]),
    ).toEqual({ critical: 1, warning: 2, info: 0 });
  });
});

describe('headline', () => {
  const item = (severity: AttentionItem['severity'], id: string): AttentionItem => ({
    id,
    severity,
    title: id,
    detail: 'x',
    href: '/x',
    count: 1,
  });

  it('says so plainly when nothing is wrong', () => {
    expect(headline([])).toBe('Nothing needs attention. Everything is on track.');
  });

  it('leads on the critical count when there is one', () => {
    expect(headline([item('critical', 'a'), item('warning', 'b')])).toBe(
      'One thing needs dealing with today.',
    );
    expect(headline([item('critical', 'a'), item('critical', 'b')])).toBe(
      '2 things need dealing with today.',
    );
  });

  it('falls back to warnings, then to a calm note', () => {
    expect(headline([item('warning', 'a')])).toBe('One thing worth a look.');
    expect(headline([item('warning', 'a'), item('warning', 'b')])).toBe(
      '2 things worth a look.',
    );
    expect(headline([item('info', 'a')])).toBe('Nothing urgent — a few things to keep an eye on.');
  });
});

describe('buildKpis', () => {
  const base = { openProjects: 4, openTasks: 12, newLeads: 3 };

  it('shows the operational tiles to everyone', () => {
    const tiles = buildKpis({ ...base, signals: EMPTY_SIGNALS, showMoney: false });
    expect(tiles.map((t) => t.label)).toEqual(['Active jobs', 'Open tasks', 'New leads']);
  });

  it('adds the money tile only for someone allowed to see money', () => {
    const tiles = buildKpis({
      ...base,
      signals: signals({ outstandingAmount: 40_000, overdueInvoiceAmount: 12_500 }),
      showMoney: true,
    });
    const money = tiles.find((t) => t.label === 'Outstanding');
    expect(money!.value).toBe('$40,000.00');
    expect(money!.note).toContain('$12,500.00 past due');
    expect(money!.tone).toBe('bad');
  });

  it('marks a tile bad only when there is something bad about it', () => {
    const clean = buildKpis({ ...base, signals: EMPTY_SIGNALS, showMoney: true });
    for (const tile of clean) {
      expect(tile.tone).toBeUndefined();
      expect(tile.note).toBeUndefined();
    }
    const dirty = buildKpis({ ...base, signals: signals({ overdueTasks: 2 }), showMoney: true });
    expect(dirty.find((t) => t.label === 'Open tasks')!.tone).toBe('bad');
    expect(dirty.find((t) => t.label === 'Open tasks')!.note).toBe('2 late');
  });
});
