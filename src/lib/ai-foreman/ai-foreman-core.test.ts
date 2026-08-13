import { describe, it, expect } from 'vitest';
import {
  providerStatus,
  buildBriefing,
  briefingText,
  briefingTitle,
  headline,
  sortFindings,
  countByLevel,
  answerQuestion,
  clientUpdateDraft,
  hoursPhrase,
  EMPTY_INPUT,
  QUESTION_TOPICS,
  type BriefingInput,
  type Finding,
} from './ai-foreman-core';

/** Fixed clock so every assertion below can name exact days. */
const NOW = new Date('2026-08-11T14:00:00Z');
const TODAY = '2026-08-11';

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return { ...EMPTY_INPUT, projectName: 'Henderson kitchen', ...overrides };
}

describe('providerStatus', () => {
  it('reports not configured when there is no key', () => {
    const status = providerStatus(null);
    expect(status.configured).toBe(false);
    expect(status.message).toContain('No language model is connected');
  });

  it('treats an empty or whitespace key as no key', () => {
    expect(providerStatus('').configured).toBe(false);
    expect(providerStatus('   ').configured).toBe(false);
    expect(providerStatus(undefined).configured).toBe(false);
  });

  it('reports configured when a key is present, and still says it only drafts', () => {
    const status = providerStatus('sk-test-value');
    expect(status.configured).toBe(true);
    expect(status.message).toContain('only ever drafts');
  });
});

describe('briefingTitle', () => {
  it('puts the job number in front of the name when there is one', () => {
    expect(briefingTitle(input({ projectNumber: 'PT-1042' }))).toBe('PT-1042 — Henderson kitchen');
  });

  it('uses the name alone when there is no number', () => {
    expect(briefingTitle(input())).toBe('Henderson kitchen');
  });

  it('does not render an empty name as an empty title', () => {
    expect(briefingTitle(input({ projectName: '   ' }))).toBe('Untitled job');
  });
});

describe('buildBriefing — money', () => {
  it('leads with money past due', () => {
    const b = buildBriefing(
      input({ contractValue: 50000, invoiced: 20000, paid: 0, overdueAmount: 20000, overdueCount: 1 }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'overdue');
    expect(f).toBeDefined();
    expect(f!.level).toBe('risk');
    expect(f!.statement).toContain('$20,000.00');
    expect(f!.evidence).toBe('One invoice is past its due date.');
  });

  it('pluralises overdue invoices correctly', () => {
    const b = buildBriefing(
      input({ contractValue: 50000, invoiced: 20000, overdueAmount: 20000, overdueCount: 3 }),
      NOW,
    );
    expect(b.findings.find((x) => x.id === 'overdue')!.evidence).toBe(
      '3 invoices are past their due dates.',
    );
  });

  it('flags approved change orders that were never invoiced', () => {
    const b = buildBriefing(
      input({
        contractValue: 50000,
        invoiced: 20000,
        unbilledChangeOrderValue: 12400,
        unbilledChangeOrderCount: 3,
      }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'unbilled-change-orders');
    expect(f).toBeDefined();
    expect(f!.level).toBe('risk');
    expect(f!.statement).toContain('$12,400.00');
    expect(f!.action).toContain('Bill it now');
  });

  it('does not raise unbilled change orders when there are none', () => {
    const b = buildBriefing(input({ contractValue: 50000, invoiced: 0 }), NOW);
    expect(b.findings.some((x) => x.id === 'unbilled-change-orders')).toBe(false);
  });

  it('says a job has no contract rather than treating it as worth zero', () => {
    const b = buildBriefing(input({ contractValue: null, invoiced: 0 }), NOW);
    const f = b.findings.find((x) => x.id === 'no-contract');
    expect(f).toBeDefined();
    expect(f!.statement).toContain('no signed contract value');
    // And it must not have computed a margin against a value it does not have.
    expect(b.findings.some((x) => x.id === 'final-margin')).toBe(false);
  });

  it('reports the outstanding balance as invoiced minus paid', () => {
    const b = buildBriefing(input({ contractValue: 50000, invoiced: 20000, paid: 7500 }), NOW);
    const f = b.findings.find((x) => x.id === 'outstanding');
    expect(f!.statement).toContain('$12,500.00');
    expect(f!.evidence).toBe('$20,000.00 invoiced, $7,500.00 received.');
  });

  it('raises nothing outstanding once the invoice is fully paid', () => {
    const b = buildBriefing(input({ contractValue: 50000, invoiced: 20000, paid: 20000 }), NOW);
    expect(b.findings.some((x) => x.id === 'outstanding')).toBe(false);
  });

  it('withholds money entirely when the caller cannot see it', () => {
    const b = buildBriefing(input({ contractValue: null, invoiced: null }), NOW);
    expect(b.withheld).toContain('money');
    expect(b.findings.some((f) => f.area === 'money')).toBe(false);
  });
});

describe('buildBriefing — cost', () => {
  it('calls out spending ahead of billing as financing the client', () => {
    const b = buildBriefing(
      input({ contractValue: 50000, invoiced: 28000, costToDate: 41200 }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'spending-ahead');
    expect(f!.level).toBe('risk');
    expect(f!.evidence).toBe('$41,200.00 of cost against $28,000.00 invoiced.');
    expect(f!.action).toContain('financing the client');
  });

  it('includes logged hours in the evidence when they are known', () => {
    const b = buildBriefing(
      input({ contractValue: 50000, invoiced: 28000, costToDate: 41200, labourHours: 312 }),
      NOW,
    );
    expect(b.findings.find((x) => x.id === 'spending-ahead')!.evidence).toBe(
      '$41,200.00 of cost against $28,000.00 invoiced, 312 h logged.',
    );
  });

  it('does not call it spending ahead when billing leads cost', () => {
    const b = buildBriefing(
      input({ contractValue: 50000, invoiced: 41200, costToDate: 28000 }),
      NOW,
    );
    expect(b.findings.some((x) => x.id === 'spending-ahead')).toBe(false);
  });

  it('says margins are understated when someone has no cost rate', () => {
    const b = buildBriefing(input({ costToDate: 1000, invoiced: 5000, uncostedMembers: 2 }), NOW);
    const f = b.findings.find((x) => x.id === 'uncosted-labour');
    expect(f!.statement).toContain('2 people');
    expect(f!.evidence).toContain('better than the real one');
  });

  it('uses the singular for one uncosted person', () => {
    const b = buildBriefing(input({ costToDate: 1000, invoiced: 5000, uncostedMembers: 1 }), NOW);
    expect(b.findings.find((x) => x.id === 'uncosted-labour')!.statement).toContain('One person');
  });

  it('states a final margin only once the job is complete', () => {
    const running = buildBriefing(
      input({ phase: 'in_progress', contractValue: 50000, invoiced: 50000, costToDate: 30000 }),
      NOW,
    );
    expect(running.findings.some((x) => x.id === 'final-margin')).toBe(false);

    const done = buildBriefing(
      input({ phase: 'complete', contractValue: 50000, invoiced: 50000, costToDate: 30000 }),
      NOW,
    );
    const f = done.findings.find((x) => x.id === 'final-margin');
    expect(f!.level).toBe('good');
    expect(f!.statement).toBe('This job finished $20,000.00 ahead.');
  });

  it('reports a finished job that lost money as a risk, not a negative gain', () => {
    const b = buildBriefing(
      input({ phase: 'complete', contractValue: 30000, invoiced: 30000, costToDate: 44000 }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'final-margin');
    expect(f!.level).toBe('risk');
    expect(f!.statement).toBe('This job finished $14,000.00 down.');
  });

  it('withholds cost when the caller lacks costs:read', () => {
    const b = buildBriefing(input({ contractValue: 50000, invoiced: 20000, costToDate: null }), NOW);
    expect(b.withheld).toContain('cost');
    expect(b.findings.some((f) => f.area === 'cost')).toBe(false);
  });
});

describe('buildBriefing — schedule', () => {
  it('treats a crew booked on two jobs at once as a risk', () => {
    const b = buildBriefing(input({ scheduleItems: 4, crewConflicts: 1 }), NOW);
    const f = b.findings.find((x) => x.id === 'crew-conflicts');
    expect(f!.level).toBe('risk');
    expect(f!.statement).toContain('booked on this job and another');
  });

  it('says nothing is scheduled rather than reporting a healthy empty schedule', () => {
    const b = buildBriefing(input({ scheduleItems: 0 }), NOW);
    const f = b.findings.find((x) => x.id === 'nothing-scheduled');
    expect(f!.action).toContain('nothing here has a date');
  });

  it('flags a running job past its finish date', () => {
    const b = buildBriefing(
      input({ scheduleItems: 3, endDate: '2026-08-01', phase: 'in_progress', earnedPercent: 80 }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'past-end-date');
    expect(f!.level).toBe('risk');
    expect(f!.evidence).toBe('Scheduled to finish 2026-08-01; today is 2026-08-11.');
  });

  it('does not flag a finished job for being past its date', () => {
    const b = buildBriefing(
      input({ scheduleItems: 3, endDate: '2026-08-01', phase: 'complete' }),
      NOW,
    );
    expect(b.findings.some((x) => x.id === 'past-end-date')).toBe(false);
  });

  it('raises the alarm when little time is left and little work is done', () => {
    const b = buildBriefing(
      input({ scheduleItems: 5, endDate: '2026-08-18', earnedPercent: 20, phase: 'in_progress' }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'time-remaining');
    expect(f!.level).toBe('risk');
    expect(f!.statement).toBe('7 days left and the job is 20% done.');
    expect(f!.action).toContain('tell the client today');
  });

  it('reports comfortable progress as good, with no action', () => {
    const b = buildBriefing(
      input({ scheduleItems: 5, endDate: '2026-08-18', earnedPercent: 85, phase: 'in_progress' }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'time-remaining');
    expect(f!.level).toBe('good');
    expect(f!.action).toBeUndefined();
  });

  it('counts days remaining, not days spanned — tomorrow is one day left, not two', () => {
    const b = buildBriefing(
      input({ scheduleItems: 5, endDate: '2026-08-12', earnedPercent: 90, phase: 'in_progress' }),
      NOW,
    );
    expect(b.findings.find((x) => x.id === 'time-remaining')!.statement).toBe(
      '1 day left, 90% of the work complete.',
    );
  });

  it('says a job finishing today is due today rather than "0 days left"', () => {
    const b = buildBriefing(
      input({ scheduleItems: 5, endDate: TODAY, earnedPercent: 95, phase: 'in_progress' }),
      NOW,
    );
    expect(b.findings.find((x) => x.id === 'time-remaining')!.statement).toBe(
      'Due to finish today, 95% of the work complete.',
    );
  });

  it('says nothing about time remaining when progress is unknown', () => {
    const b = buildBriefing(
      input({ scheduleItems: 5, endDate: '2026-08-18', earnedPercent: null }),
      NOW,
    );
    expect(b.findings.some((x) => x.id === 'time-remaining')).toBe(false);
  });
});

describe('buildBriefing — work', () => {
  it('explains that blocked tasks are waiting on a predecessor, not the crew', () => {
    const b = buildBriefing(input({ blockedTasks: 4, openTasks: 12 }), NOW);
    const f = b.findings.find((x) => x.id === 'blocked-tasks');
    expect(f!.evidence).toContain('waiting on a predecessor');
    expect(f!.action).toContain('clears them with no second step');
  });

  it('counts open tasks as the evidence for overdue ones', () => {
    const b = buildBriefing(input({ overdueTasks: 2, openTasks: 9 }), NOW);
    expect(b.findings.find((x) => x.id === 'overdue-tasks')!.evidence).toBe(
      '9 tasks are open on this job.',
    );
  });

  it('uses the singular for one open task', () => {
    const b = buildBriefing(input({ overdueTasks: 1, openTasks: 1 }), NOW);
    expect(b.findings.find((x) => x.id === 'overdue-tasks')!.evidence).toBe(
      '1 task is open on this job.',
    );
  });
});

describe('buildBriefing — record', () => {
  it('treats thin log coverage as a risk, not a nag', () => {
    const b = buildBriefing(input({ missingLogDays: 9, logCoveragePercent: 40 }), NOW);
    const f = b.findings.find((x) => x.id === 'log-gaps');
    expect(f!.level).toBe('risk');
    expect(f!.action).toContain('undermine a delay claim later');
  });

  it('treats a few missing days as a watch item', () => {
    const b = buildBriefing(input({ missingLogDays: 2, logCoveragePercent: 90 }), NOW);
    expect(b.findings.find((x) => x.id === 'log-gaps')!.level).toBe('watch');
  });

  it('says so when coverage could not be measured', () => {
    const b = buildBriefing(input({ missingLogDays: 3, logCoveragePercent: null }), NOW);
    expect(b.findings.find((x) => x.id === 'log-gaps')!.evidence).toContain(
      'could not be measured',
    );
  });

  it('credits a fully logged job', () => {
    const b = buildBriefing(
      input({ missingLogDays: 0, logCoveragePercent: 100, lastLogDay: '2026-08-10' }),
      NOW,
    );
    const f = b.findings.find((x) => x.id === 'log-complete');
    expect(f!.level).toBe('good');
    expect(f!.evidence).toBe('Last log 2026-08-10.');
  });

  it('does not credit coverage that was never measured', () => {
    const b = buildBriefing(input({ missingLogDays: 0, logCoveragePercent: null }), NOW);
    expect(b.findings.some((x) => x.id === 'log-complete')).toBe(false);
  });
});

describe('sortFindings and countByLevel', () => {
  const f = (id: string, level: Finding['level'], area: Finding['area']): Finding => ({
    id,
    area,
    level,
    statement: id,
    evidence: '',
  });

  it('puts risks first and good news last', () => {
    const sorted = sortFindings([
      f('a', 'good', 'money'),
      f('b', 'watch', 'money'),
      f('c', 'risk', 'money'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('groups by area within a level, in the declared area order', () => {
    const sorted = sortFindings([
      f('record', 'risk', 'record'),
      f('money', 'risk', 'money'),
      f('work', 'risk', 'work'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['money', 'work', 'record']);
  });

  it('does not mutate the array it was given', () => {
    const original = [f('a', 'good', 'money'), f('b', 'risk', 'money')];
    sortFindings(original);
    expect(original.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('counts every level, including the ones with none', () => {
    expect(countByLevel([f('a', 'risk', 'money'), f('b', 'risk', 'work')])).toEqual({
      risk: 2,
      watch: 0,
      good: 0,
    });
  });

  it('counts an empty list as all zero', () => {
    expect(countByLevel([])).toEqual({ risk: 0, watch: 0, good: 0 });
  });
});

describe('headline', () => {
  it('counts risks, not the records behind them — two overdue invoices are one problem', () => {
    const b = buildBriefing(
      input({ contractValue: 50000, invoiced: 10000, overdueAmount: 10000, overdueCount: 2 }),
      NOW,
    );
    expect(b.headline).toBe('One thing on this job needs dealing with today.');
  });

  it('pluralises once there are genuinely separate risks', () => {
    const b = buildBriefing(
      input({
        contractValue: 50000,
        invoiced: 10000,
        overdueAmount: 10000,
        overdueCount: 2,
        unbilledChangeOrderCount: 1,
        unbilledChangeOrderValue: 3000,
        scheduleItems: 2,
      }),
      NOW,
    );
    expect(b.headline).toBe('2 things on this job need dealing with today.');
  });

  it('uses the singular for one risk', () => {
    expect(
      headline(
        [{ id: 'x', area: 'money', level: 'risk', statement: '', evidence: '' }],
        input({ contractValue: 1, invoiced: 1 }),
      ),
    ).toBe('One thing on this job needs dealing with today.');
  });

  it('falls through to watch items when there are no risks', () => {
    expect(
      headline(
        [{ id: 'x', area: 'work', level: 'watch', statement: '', evidence: '' }],
        input({ contractValue: 1, invoiced: 1 }),
      ),
    ).toBe('One thing is worth a look, but nothing is on fire.');
  });

  it('calls a clean job clean only when money was actually visible', () => {
    expect(headline([], input({ contractValue: 50000, invoiced: 50000 }))).toBe(
      'This job is clean — nothing needs attention today.',
    );
  });

  it('never tells someone who cannot see money that the job is clean', () => {
    const partial = headline([], input({ contractValue: null, invoiced: null }));
    expect(partial).toBe('Nothing needs attention in what you can see here.');
    expect(partial).not.toContain('clean');
  });
});

describe('briefingText', () => {
  it('renders the title, the day, the headline and every finding with its evidence', () => {
    const b = buildBriefing(
      input({
        projectNumber: 'PT-1042',
        contractValue: 50000,
        invoiced: 28000,
        costToDate: 41200,
      }),
      NOW,
    );
    const text = briefingText(b);
    expect(text).toContain('PT-1042 — Henderson kitchen');
    expect(text).toContain(`Briefing for ${TODAY}`);
    expect(text).toContain('[Risk] Cost: You are spending faster than you are billing.');
    expect(text).toContain('$41,200.00 of cost against $28,000.00 invoiced.');
    expect(text).toContain('→ You are financing the client. Raise the next draw.');
  });

  it('says the briefing is partial when an area was withheld', () => {
    const b = buildBriefing(input({ contractValue: null, invoiced: null, costToDate: null }), NOW);
    const text = briefingText(b);
    expect(text).toContain('Not included: money and cost.');
    expect(text).toContain('this briefing is partial');
  });

  it('always states that the figures were read rather than generated', () => {
    expect(briefingText(buildBriefing(input(), NOW))).toContain(
      'Figures are read, not generated.',
    );
  });
});

describe('answerQuestion', () => {
  const briefing = buildBriefing(
    input({
      contractValue: 50000,
      invoiced: 28000,
      paid: 10000,
      costToDate: 41200,
      blockedTasks: 3,
      scheduleItems: 4,
    }),
    NOW,
  );

  it('routes a money question to the money findings', () => {
    const answer = answerQuestion(briefing, 'how much am I owed on this?');
    expect(answer.topic!.id).toBe('money');
    expect(answer.findings.every((f) => f.area === 'money')).toBe(true);
  });

  it('routes a margin question to cost as well as money', () => {
    const answer = answerQuestion(briefing, 'am I making any profit here');
    expect(answer.topic!.id).toBe('margin');
    expect(answer.findings.some((f) => f.area === 'cost')).toBe(true);
  });

  it('routes a crew question to the blocked work', () => {
    const answer = answerQuestion(briefing, 'what is holding up the crew');
    expect(answer.topic!.id).toBe('work');
    expect(answer.findings.some((f) => f.id === 'blocked-tasks')).toBe(true);
  });

  it('says plainly when the record cannot answer, instead of guessing', () => {
    const answer = answerQuestion(briefing, 'what colour should the cabinets be');
    expect(answer.topic).toBeNull();
    expect(answer.findings).toEqual([]);
    expect(answer.message).toContain('not something the job record can answer');
  });

  it('reads "making money" as a margin question, not a billing one', () => {
    // Both topics contain "money" on keywords alone; the phrase breaks the tie.
    const answer = answerQuestion(briefing, 'am I making money on this job?');
    expect(answer.topic!.id).toBe('margin');
  });

  it('still reads a plain money question as billing', () => {
    expect(answerQuestion(briefing, 'how much money has been invoiced').topic!.id).toBe('money');
  });

  it('matches whole words only, so a fragment does not route a question', () => {
    // "billet" contains "bill"; substring matching would route this to money.
    expect(answerQuestion(briefing, 'billet steel brackets').topic).toBeNull();
  });

  it('is not confused by punctuation or capitals', () => {
    expect(answerQuestion(briefing, 'IS THIS JOB LATE?!').topic!.id).toBe('schedule');
  });

  it('returns nothing-stands-out rather than an empty silence', () => {
    const clean = buildBriefing(
      input({ contractValue: 50000, invoiced: 50000, paid: 50000, scheduleItems: 2 }),
      NOW,
    );
    const answer = answerQuestion(clean, 'is the paperwork in order');
    expect(answer.findings).toEqual([]);
    expect(answer.message).toBe('Nothing on this job stands out there.');
  });

  it('says permission is missing rather than implying the area is fine', () => {
    const partial = buildBriefing(input({ contractValue: null, invoiced: null }), NOW);
    const answer = answerQuestion(partial, 'how much has been invoiced');
    expect(answer.message).toContain('do not have permission');
    expect(answer.message).not.toContain('stands out');
  });

  it('offers a question for every topic it can route', () => {
    for (const topic of QUESTION_TOPICS) {
      const answer = answerQuestion(briefing, topic.question);
      expect(answer.topic, `topic "${topic.id}" cannot answer its own question`).not.toBeNull();
      expect(answer.topic!.id).toBe(topic.id);
    }
  });

  it('handles an empty question without throwing', () => {
    const answer = answerQuestion(briefing, '');
    expect(answer.topic).toBeNull();
  });
});

describe('clientUpdateDraft', () => {
  it('never puts cost, margin or crew conflicts in front of a client', () => {
    const i = input({
      contractValue: 50000,
      invoiced: 28000,
      costToDate: 41200,
      crewConflicts: 2,
      overdueAmount: 9000,
      overdueCount: 1,
      scheduleItems: 4,
      earnedPercent: 60,
    });
    const draft = clientUpdateDraft(i, buildBriefing(i, NOW), NOW);
    expect(draft).not.toContain('41,200');
    expect(draft).not.toContain('margin');
    expect(draft).not.toContain('conflict');
    expect(draft).not.toContain('past due');
  });

  it('states progress and the working finish date', () => {
    const i = input({ earnedPercent: 60, endDate: '2026-09-30', scheduleItems: 4 });
    const draft = clientUpdateDraft(i, buildBriefing(i, NOW), NOW);
    expect(draft).toContain("We're about 60% through the scheduled work.");
    expect(draft).toContain('finish of 2026-09-30');
  });

  it('leads with the slip when the job is late, rather than burying it', () => {
    const i = input({ endDate: '2026-07-01', phase: 'in_progress', scheduleItems: 4 });
    const draft = clientUpdateDraft(i, buildBriefing(i, NOW), NOW);
    expect(draft).toContain("running behind the date we gave you");
    expect(draft).toContain('[FILL IN]');
    // And it must not also claim the old date still holds.
    expect(draft).not.toContain('still working to a finish');
  });

  it('warns the client about approved extras before the invoice arrives', () => {
    const i = input({
      contractValue: 50000,
      invoiced: 10000,
      unbilledChangeOrderCount: 2,
      unbilledChangeOrderValue: 8000,
      scheduleItems: 2,
    });
    const draft = clientUpdateDraft(i, buildBriefing(i, NOW), NOW);
    expect(draft).toContain('You approved 2 extras');
    expect(draft).toContain('nothing arrives as a surprise');
  });

  it('leaves a blank for the sentence no rule can write', () => {
    const i = input({ scheduleItems: 1 });
    expect(clientUpdateDraft(i, buildBriefing(i, NOW), NOW)).toContain(
      '[Anything the client asked about last week goes here.]',
    );
  });

  it('falls back to a plain opening when progress is unknown', () => {
    const i = input({ earnedPercent: null });
    const draft = clientUpdateDraft(i, buildBriefing(i, NOW), NOW);
    expect(draft).toContain("Here's where things stand.");
    expect(draft).not.toContain('% through');
  });
});

describe('hoursPhrase', () => {
  it('phrases real hours', () => {
    expect(hoursPhrase(37.5)).toBe('37.5 h logged');
  });

  it('says nothing rather than zero', () => {
    expect(hoursPhrase(0)).toBeNull();
    expect(hoursPhrase(null)).toBeNull();
  });

  it('does not phrase a negative as if it were time worked', () => {
    expect(hoursPhrase(-4)).toBeNull();
  });
});

describe('a job nobody has touched', () => {
  it('produces a briefing that says what to do rather than an empty page', () => {
    const b = buildBriefing(input(), NOW);
    expect(b.findings.length).toBeGreaterThan(0);
    expect(b.findings.some((f) => f.id === 'nothing-scheduled')).toBe(true);
    expect(b.day).toBe(TODAY);
  });

  it('is stable — the same job on the same day reads the same way', () => {
    const a = briefingText(buildBriefing(input({ contractValue: 5000, invoiced: 1000 }), NOW));
    const c = briefingText(buildBriefing(input({ contractValue: 5000, invoiced: 1000 }), NOW));
    expect(a).toBe(c);
  });
});
