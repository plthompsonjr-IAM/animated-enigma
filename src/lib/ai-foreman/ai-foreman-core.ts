/**
 * AI Foreman (Task 30): the per-job briefing.
 *
 * The dashboard answers "what across the whole company needs attention today".
 * This answers a different and more common question — "what is actually going on
 * with the Henderson job, and what do I say about it" — and it answers it from
 * the record rather than from memory.
 *
 * Two decisions shape this module.
 *
 * **Every finding carries its evidence.** A briefing that says "you're behind on
 * billing" is an opinion. One that says "$41,200 of cost against $28,000 invoiced
 * — 3 approved change orders totalling $12,400 have never been billed" is a fact
 * with a next action attached. Findings that can't cite anything don't get made.
 *
 * **This is deterministic, and that is the point.** No language model is involved
 * in producing a briefing. The same job on the same day produces the same words,
 * which is what makes it safe to read to a client. When a model is connected it
 * gets pointed at this output — `briefingText` is the context packet — and its
 * job is phrasing and open questions, never the numbers.
 *
 * Pure. No I/O.
 */

import { formatMoney } from '@/lib/invoices/invoices-core';
import { formatHours, type JobPhase } from '@/lib/costing/costing-core';
import { today, isDay, dayDiff } from '@/lib/schedule/schedule-core';

// ── Provider status ──────────────────────────────────────────────────────────

/**
 * Whether a language model is reachable.
 *
 * This exists so the screen can tell the truth. There is no key in this
 * deployment, and a workspace that implies otherwise — a chat box that silently
 * does nothing, a "thinking" spinner over a canned string — is worse than one
 * that says plainly what it is.
 */
export interface ProviderStatus {
  configured: boolean;
  /** What the user is told, in one sentence. */
  message: string;
}

export function providerStatus(apiKey: string | null | undefined): ProviderStatus {
  const key = (apiKey ?? '').trim();
  if (key.length === 0) {
    return {
      configured: false,
      message:
        'No language model is connected, so every briefing below is assembled directly from the job record. The numbers are read, not generated.',
    };
  }
  return {
    configured: true,
    message:
      'A language model is connected. It only ever drafts — nothing it produces is saved to a job until you approve it.',
  };
}

// ── Findings ─────────────────────────────────────────────────────────────────

export const BRIEFING_AREAS = ['money', 'schedule', 'work', 'record', 'cost'] as const;
export type BriefingArea = (typeof BRIEFING_AREAS)[number];

export const AREA_LABELS: Record<BriefingArea, string> = {
  money: 'Money',
  schedule: 'Schedule',
  work: 'Work',
  record: 'Record',
  cost: 'Cost',
};

export const FINDING_LEVELS = ['risk', 'watch', 'good'] as const;
export type FindingLevel = (typeof FINDING_LEVELS)[number];

const LEVEL_RANK: Record<FindingLevel, number> = { risk: 0, watch: 1, good: 2 };

export const LEVEL_STYLES: Record<FindingLevel, string> = {
  risk: 'border-red-500/40 bg-red-500/10',
  watch: 'border-amber-500/40 bg-amber-500/10',
  good: 'border-emerald-500/40 bg-emerald-500/10',
};

export const LEVEL_TEXT_STYLES: Record<FindingLevel, string> = {
  risk: 'text-red-600 dark:text-red-400',
  watch: 'text-amber-600 dark:text-amber-400',
  good: 'text-emerald-600 dark:text-emerald-400',
};

export const LEVEL_LABELS: Record<FindingLevel, string> = {
  risk: 'Risk',
  watch: 'Watch',
  good: 'On track',
};

export interface Finding {
  id: string;
  area: BriefingArea;
  level: FindingLevel;
  /** The claim, stated as a fact. */
  statement: string;
  /** Where the claim comes from — a count, an amount, a date from the record. */
  evidence: string;
  /** What to do about it. Omitted when there is nothing to do. */
  action?: string;
  /** Where to go to act on it, relative to the project page. */
  href?: string;
}

// ── Input ────────────────────────────────────────────────────────────────────

/**
 * Everything the briefing reads, as plain values.
 *
 * Deliberately flat: the queries do the loading and the shaping, and this module
 * never learns what a Drizzle row looks like. Nullable fields mean "not known"
 * and are treated as such — a job with no contract is not a job worth $0.
 */
export interface BriefingInput {
  projectName: string;
  projectNumber: string | null;
  status: string;
  phase: JobPhase;

  /** Planned start and end from the schedule, if any work has been scheduled. */
  startDate: string | null;
  endDate: string | null;

  // Money the client is billed. Null when the caller can't see money at all.
  contractValue: number | null;
  invoiced: number | null;
  paid: number | null;
  overdueAmount: number | null;
  overdueCount: number;
  approvedChangeOrderValue: number | null;
  unbilledChangeOrderValue: number | null;
  unbilledChangeOrderCount: number;

  // Internal cost. Null when the caller lacks costs:read.
  costToDate: number | null;
  labourHours: number | null;
  uncostedMembers: number;

  // Schedule.
  scheduleItems: number;
  overdueScheduleItems: number;
  earnedPercent: number | null;
  crewConflicts: number;

  // Field work.
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;

  // Daily record.
  logCoveragePercent: number | null;
  missingLogDays: number;
  lastLogDay: string | null;
}

/** A briefing for a job nobody has touched yet — used as the shape reference. */
export const EMPTY_INPUT: BriefingInput = {
  projectName: '',
  projectNumber: null,
  status: 'planning',
  phase: 'in_progress',
  startDate: null,
  endDate: null,
  contractValue: null,
  invoiced: null,
  paid: null,
  overdueAmount: null,
  overdueCount: 0,
  approvedChangeOrderValue: null,
  unbilledChangeOrderValue: null,
  unbilledChangeOrderCount: 0,
  costToDate: null,
  labourHours: null,
  uncostedMembers: 0,
  scheduleItems: 0,
  overdueScheduleItems: 0,
  earnedPercent: null,
  crewConflicts: 0,
  openTasks: 0,
  overdueTasks: 0,
  blockedTasks: 0,
  logCoveragePercent: null,
  missingLogDays: 0,
  lastLogDay: null,
};

// ── The briefing ─────────────────────────────────────────────────────────────

export interface Briefing {
  title: string;
  /** One sentence a person can read out. */
  headline: string;
  findings: Finding[];
  /** Areas the caller couldn't see, so the briefing can say so instead of implying all-clear. */
  withheld: BriefingArea[];
  day: string;
}

/**
 * Build the briefing.
 *
 * Ordering is by consequence, not by area: money you have spent and not billed
 * outranks a task running two days late, because one is recoverable this
 * afternoon and the other is a loan you didn't agree to make.
 */
export function buildBriefing(input: BriefingInput, now: Date = new Date()): Briefing {
  const day = today(now);
  const findings: Finding[] = [];
  const withheld: BriefingArea[] = [];

  const seesMoney = input.contractValue !== null || input.invoiced !== null;
  const seesCost = input.costToDate !== null;

  if (!seesMoney) withheld.push('money');
  if (!seesCost) withheld.push('cost');

  // ── Money ──
  if (seesMoney) {
    const invoiced = input.invoiced ?? 0;
    const paid = input.paid ?? 0;

    if ((input.overdueAmount ?? 0) > 0) {
      findings.push({
        id: 'overdue',
        area: 'money',
        level: 'risk',
        statement: `${formatMoney(input.overdueAmount)} is past due on this job.`,
        evidence:
          input.overdueCount === 1
            ? 'One invoice is past its due date.'
            : `${input.overdueCount} invoices are past their due dates.`,
        action: 'Chase it before it ages another bracket.',
        href: '/invoices',
      });
    }

    // The classic contractor money leak: work authorised, work performed, work
    // never billed. It is invisible on the invoice list because nothing is wrong
    // there — the invoice simply doesn't exist.
    if (input.unbilledChangeOrderCount > 0) {
      findings.push({
        id: 'unbilled-change-orders',
        area: 'money',
        level: 'risk',
        statement: `${formatMoney(input.unbilledChangeOrderValue)} of approved extra work has never been invoiced.`,
        evidence:
          input.unbilledChangeOrderCount === 1
            ? 'One approved change order has no invoice against it.'
            : `${input.unbilledChangeOrderCount} approved change orders have no invoice against them.`,
        action: 'Bill it now — approval is the hard part and it is already done.',
        href: '/change-orders',
      });
    }

    if (input.contractValue === null) {
      findings.push({
        id: 'no-contract',
        area: 'money',
        level: 'watch',
        statement: 'This job has no signed contract value.',
        evidence: 'No active contract is attached to the project.',
        action: 'Everything billed here is unsecured until one is signed.',
        href: '/contracts',
      });
    } else if (invoiced > 0 && paid < invoiced) {
      const outstanding = round2(invoiced - paid);
      findings.push({
        id: 'outstanding',
        area: 'money',
        level: 'watch',
        statement: `${formatMoney(outstanding)} is invoiced and not yet paid.`,
        evidence: `${formatMoney(invoiced)} invoiced, ${formatMoney(paid)} received.`,
        href: '/invoices',
      });
    }
  }

  // ── Cost ──
  // Only stated where it means something. Cost-to-date on a running job is not
  // margin — a job 30% built and 50% billed looks wonderful and isn't — so the
  // comparison made here is spend against billing, which is true at any phase.
  if (seesCost) {
    const cost = input.costToDate ?? 0;
    const invoiced = input.invoiced ?? 0;

    if (cost > 0 && input.invoiced !== null && cost > invoiced) {
      const hours = hoursPhrase(input.labourHours);
      findings.push({
        id: 'spending-ahead',
        area: 'cost',
        level: 'risk',
        statement: 'You are spending faster than you are billing.',
        evidence:
          `${formatMoney(cost)} of cost against ${formatMoney(invoiced)} invoiced` +
          (hours ? `, ${hours}.` : '.'),
        action: 'You are financing the client. Raise the next draw.',
        href: '/invoices',
      });
    }

    if (input.uncostedMembers > 0) {
      findings.push({
        id: 'uncosted-labour',
        area: 'cost',
        level: 'watch',
        statement:
          input.uncostedMembers === 1
            ? 'One person on this job has no cost rate, so their hours are not costed.'
            : `${input.uncostedMembers} people on this job have no cost rate, so their hours are not costed.`,
        evidence: 'Every margin shown for this job is better than the real one.',
        action: 'Set burdened cost rates in Settings → Team.',
        href: '/settings/team',
      });
    }

    if (input.phase === 'complete' && cost > 0 && input.contractValue !== null) {
      const profit = round2(input.contractValue - cost);
      findings.push({
        id: 'final-margin',
        area: 'cost',
        level: profit >= 0 ? 'good' : 'risk',
        statement:
          profit >= 0
            ? `This job finished ${formatMoney(profit)} ahead.`
            : `This job finished ${formatMoney(Math.abs(profit))} down.`,
        evidence: `${formatMoney(input.contractValue)} contract value against ${formatMoney(cost)} of cost.`,
      });
    }
  }

  // ── Schedule ──
  if (input.crewConflicts > 0) {
    findings.push({
      id: 'crew-conflicts',
      area: 'schedule',
      level: 'risk',
      statement:
        input.crewConflicts === 1
          ? 'Someone is booked on this job and another at the same time.'
          : `${input.crewConflicts} crew clashes involve this job.`,
      evidence: 'Nobody looking at one job alone can see this.',
      action: 'Move the work or move the person before the day arrives.',
      href: '/schedule',
    });
  }

  if (input.overdueScheduleItems > 0) {
    findings.push({
      id: 'overdue-schedule',
      area: 'schedule',
      level: 'watch',
      statement:
        input.overdueScheduleItems === 1
          ? 'One scheduled item is past its end date and not complete.'
          : `${input.overdueScheduleItems} scheduled items are past their end dates and not complete.`,
      evidence: 'Either the work slipped or the dates were never updated.',
      action: 'Whichever it is, the client is working from the old date.',
      href: '/schedule',
    });
  }

  if (input.scheduleItems === 0) {
    findings.push({
      id: 'nothing-scheduled',
      area: 'schedule',
      level: 'watch',
      statement: 'No work is scheduled on this job.',
      evidence: 'The schedule has no items for this project.',
      action: 'Nothing here can run late, because nothing here has a date.',
      href: '/schedule',
    });
  } else if (input.endDate !== null && isDay(input.endDate)) {
    // Days remaining, not days spanned. `spanDays` is inclusive of both ends —
    // right for "how long is this item", wrong here, where a finish date of
    // tomorrow means one day left rather than two.
    const left = dayDiff(day, input.endDate);
    if (left !== null && left >= 0) {
      const earned = input.earnedPercent;
      // Days left against work done. The comparison only holds where both are
      // known, and only where the job is genuinely running.
      if (earned !== null && input.phase === 'in_progress') {
        const behind = earned < 50 && left <= 14;
        const when = left === 0 ? 'Due to finish today' : `${left} ${left === 1 ? 'day' : 'days'} left`;
        findings.push({
          id: 'time-remaining',
          area: 'schedule',
          level: behind ? 'risk' : 'good',
          statement: behind
            ? `${when} and the job is ${earned}% done.`
            : `${when}, ${earned}% of the work complete.`,
          evidence: `Scheduled to finish ${input.endDate}.`,
          action: behind ? 'Re-forecast the finish date and tell the client today.' : undefined,
          href: '/schedule',
        });
      }
    } else if (input.phase === 'in_progress') {
      findings.push({
        id: 'past-end-date',
        area: 'schedule',
        level: 'risk',
        statement: 'This job is past its scheduled finish date and still running.',
        evidence: `Scheduled to finish ${input.endDate}; today is ${day}.`,
        action: 'Set a new date the crew can hit, and send it before you are asked for it.',
        href: '/schedule',
      });
    }
  }

  // ── Work ──
  if (input.blockedTasks > 0) {
    findings.push({
      id: 'blocked-tasks',
      area: 'work',
      level: 'watch',
      statement:
        input.blockedTasks === 1
          ? 'One task is blocked by unfinished work ahead of it.'
          : `${input.blockedTasks} tasks are blocked by unfinished work ahead of them.`,
      evidence: 'Each is waiting on a predecessor, not on the crew.',
      action: 'Finishing the predecessor clears them with no second step.',
      href: '/tasks',
    });
  }

  if (input.overdueTasks > 0) {
    findings.push({
      id: 'overdue-tasks',
      area: 'work',
      level: 'watch',
      statement:
        input.overdueTasks === 1
          ? 'One task is past its due date.'
          : `${input.overdueTasks} tasks are past their due dates.`,
      evidence: `${input.openTasks} ${input.openTasks === 1 ? 'task is' : 'tasks are'} open on this job.`,
      href: '/tasks',
    });
  }

  // ── Record ──
  // An empty log is worse than no log — it looks like a day where nothing
  // happened. Gaps in the daily record are what undermine a delay claim later,
  // which is why this is stated even on a job that is otherwise fine.
  if (input.missingLogDays > 0) {
    const severe = input.logCoveragePercent !== null && input.logCoveragePercent < 60;
    findings.push({
      id: 'log-gaps',
      area: 'record',
      level: severe ? 'risk' : 'watch',
      statement:
        input.missingLogDays === 1
          ? 'One working day has no daily log.'
          : `${input.missingLogDays} working days have no daily log.`,
      evidence:
        input.logCoveragePercent !== null
          ? `${input.logCoveragePercent}% of working days on this job are logged.`
          : 'Coverage could not be measured for this range.',
      action: 'Gaps in the daily record are what undermine a delay claim later.',
      href: '/daily-logs',
    });
  } else if (input.logCoveragePercent === 100) {
    findings.push({
      id: 'log-complete',
      area: 'record',
      level: 'good',
      statement: 'Every working day on this job is logged.',
      evidence: `Last log ${input.lastLogDay ?? day}.`,
    });
  }

  const sorted = sortFindings(findings);

  return {
    title: briefingTitle(input),
    headline: headline(sorted, input),
    findings: sorted,
    withheld,
    day,
  };
}

/** Worst first, then by area so related findings sit together. */
export function sortFindings(findings: Finding[]): Finding[] {
  const areaRank = (a: BriefingArea) => BRIEFING_AREAS.indexOf(a);
  return [...findings].sort(
    (a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || areaRank(a.area) - areaRank(b.area),
  );
}

export function countByLevel(findings: Finding[]): Record<FindingLevel, number> {
  const counts: Record<FindingLevel, number> = { risk: 0, watch: 0, good: 0 };
  for (const f of findings) counts[f.level]++;
  return counts;
}

export function briefingTitle(input: BriefingInput): string {
  const name = input.projectName.trim() || 'Untitled job';
  return input.projectNumber ? `${input.projectNumber} — ${name}` : name;
}

/**
 * One sentence, and it has to survive being read aloud.
 *
 * "Nothing needs attention" is only said when the briefing could actually see
 * everything. A technician who can't read money isn't told the job is fine — it
 * might not be, and they have no way to know.
 */
export function headline(findings: Finding[], input: BriefingInput): string {
  const counts = countByLevel(findings);
  const partial = input.contractValue === null && input.invoiced === null;

  if (counts.risk > 0) {
    return counts.risk === 1
      ? 'One thing on this job needs dealing with today.'
      : `${counts.risk} things on this job need dealing with today.`;
  }
  if (counts.watch > 0) {
    return counts.watch === 1
      ? 'One thing is worth a look, but nothing is on fire.'
      : `${counts.watch} things are worth a look, but nothing is on fire.`;
  }
  if (partial) {
    return 'Nothing needs attention in what you can see here.';
  }
  return 'This job is clean — nothing needs attention today.';
}

// ── Text rendering ───────────────────────────────────────────────────────────

/**
 * The briefing as plain text.
 *
 * Two uses, and they pull in the same direction. A contractor copies this into a
 * text message to a client or a note to a PM. A language model, once one is
 * connected, receives exactly this as its context — so if it ever contradicts a
 * number, the number it was given is right here to check against.
 */
export function briefingText(briefing: Briefing): string {
  const lines: string[] = [];
  lines.push(briefing.title);
  lines.push(`Briefing for ${briefing.day}`);
  lines.push('');
  lines.push(briefing.headline);

  if (briefing.findings.length > 0) {
    lines.push('');
    for (const f of briefing.findings) {
      lines.push(`[${LEVEL_LABELS[f.level]}] ${AREA_LABELS[f.area]}: ${f.statement}`);
      lines.push(`  ${f.evidence}`);
      if (f.action) lines.push(`  → ${f.action}`);
    }
  }

  if (briefing.withheld.length > 0) {
    lines.push('');
    lines.push(
      `Not included: ${briefing.withheld.map((a) => AREA_LABELS[a].toLowerCase()).join(' and ')}. You do not have permission to see it, so this briefing is partial.`,
    );
  }

  lines.push('');
  lines.push('Assembled from the job record. Figures are read, not generated.');
  return lines.join('\n');
}

// ── Questions ────────────────────────────────────────────────────────────────

/**
 * What can honestly be answered without a language model.
 *
 * A free-text box that quietly fails to understand is the worst version of this
 * feature. Instead the questions that the record can answer are stated up front,
 * a typed question is matched against them, and anything unmatched gets told so
 * — rather than a confident answer to a question that wasn't asked.
 */
export interface QuestionTopic {
  id: string;
  /** How the question gets asked out loud. */
  question: string;
  /** Which findings answer it. */
  areas: BriefingArea[];
  keywords: string[];
  /**
   * Multi-word cues, worth more than a single keyword.
   *
   * "Am I making money on this job" is a margin question, but it contains the
   * word "money", which on keywords alone ties it with billing and resolves to
   * whichever topic is declared first. Two words agreeing is stronger evidence
   * than one, so phrases outscore keywords rather than tie-breaking against them.
   */
  phrases?: string[];
}

export const QUESTION_TOPICS: QuestionTopic[] = [
  {
    id: 'money',
    question: 'Where does this job stand on money?',
    areas: ['money'],
    keywords: ['money', 'paid', 'owe', 'owed', 'invoice', 'invoiced', 'billing', 'bill', 'due', 'payment'],
    phrases: ['stand on money', 'how much am i owed', 'been paid'],
  },
  {
    id: 'margin',
    question: 'Am I making money on this job?',
    areas: ['cost', 'money'],
    keywords: ['margin', 'profit', 'cost', 'costs', 'losing', 'spend', 'spent', 'labour', 'labor'],
    phrases: ['making money', 'making any money', 'losing money', 'come out ahead'],
  },
  {
    id: 'schedule',
    question: 'Is this job on time?',
    areas: ['schedule'],
    keywords: ['time', 'late', 'behind', 'schedule', 'finish', 'done', 'when', 'date', 'deadline', 'delay'],
    phrases: ['on time', 'on schedule', 'running late'],
  },
  {
    id: 'work',
    question: 'What is holding up the crew?',
    areas: ['work', 'schedule'],
    keywords: ['crew', 'blocked', 'holding', 'task', 'tasks', 'stuck', 'waiting', 'punch'],
    phrases: ['holding up', 'held up', 'waiting on'],
  },
  {
    id: 'record',
    question: 'Is the paperwork in order?',
    areas: ['record'],
    keywords: ['log', 'logs', 'record', 'paperwork', 'documented', 'documentation', 'daily'],
    phrases: ['paperwork in order', 'daily log'],
  },
];

export interface Answer {
  topic: QuestionTopic | null;
  findings: Finding[];
  /** What is said when there is nothing to say — never left to the caller. */
  message: string;
}

/**
 * Match a typed question to a topic and answer it from the briefing.
 *
 * Word-boundary matching, not substring: "bill" must not match inside "billet",
 * and more importantly a two-letter fragment must not match half the dictionary.
 */
export function answerQuestion(briefing: Briefing, question: string): Answer {
  const normalised = question.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const words = new Set(normalised.split(' ').filter(Boolean));

  let best: QuestionTopic | null = null;
  let bestScore = 0;
  for (const topic of QUESTION_TOPICS) {
    const keywordScore = topic.keywords.reduce((n, k) => n + (words.has(k) ? 1 : 0), 0);
    // Phrases are matched against the normalised string, so they are still
    // word-boundary safe: punctuation and casing have already been flattened.
    const phraseScore = (topic.phrases ?? []).reduce(
      (n, p) => n + (normalised.includes(p) ? 2 : 0),
      0,
    );
    const score = keywordScore + phraseScore;
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }

  if (!best) {
    return {
      topic: null,
      findings: [],
      message:
        'That is not something the job record can answer on its own. Pick one of the questions above, or read the full briefing.',
    };
  }

  const findings = briefing.findings.filter((f) => best!.areas.includes(f.area));
  if (findings.length === 0) {
    const withheldHere = briefing.withheld.filter((a) => best!.areas.includes(a));
    if (withheldHere.length > 0) {
      return {
        topic: best,
        findings: [],
        message: `You do not have permission to see ${withheldHere.map((a) => AREA_LABELS[a].toLowerCase()).join(' or ')} on this job, so there is no honest answer to give.`,
      };
    }
    return {
      topic: best,
      findings: [],
      message: 'Nothing on this job stands out there.',
    };
  }

  return { topic: best, findings, message: '' };
}

// ── Client update draft ──────────────────────────────────────────────────────

/**
 * A draft of the update a client actually wants.
 *
 * Deliberately narrower than the briefing: a client is not shown cost, margin,
 * crew conflicts, or that their invoice is overdue — the first two are nobody's
 * business, the third is an internal failure, and the fourth belongs in a
 * different conversation than a progress update.
 *
 * It is a draft. It goes into a text field the contractor edits before sending,
 * because the one sentence that matters on any given week is one no rule can
 * generate.
 */
export function clientUpdateDraft(
  input: BriefingInput,
  briefing: Briefing,
  now: Date = new Date(),
): string {
  const day = today(now);
  const lines: string[] = [];
  const name = input.projectName.trim() || 'your project';

  lines.push(`Update on ${name} — ${day}`);
  lines.push('');

  if (input.earnedPercent !== null) {
    lines.push(`We're about ${input.earnedPercent}% through the scheduled work.`);
  } else {
    lines.push("Here's where things stand.");
  }

  if (input.lastLogDay) {
    lines.push(`The most recent day on site was ${input.lastLogDay}.`);
  }

  const late = briefing.findings.find((f) => f.id === 'past-end-date' || f.id === 'time-remaining');
  if (late && late.level === 'risk') {
    // Said plainly and first. A client who finds out late from a missed date
    // trusts nothing else in the update.
    lines.push('');
    lines.push(
      "We're running behind the date we gave you. I'd rather tell you now than let it arrive — here's the new date and what changed: [FILL IN].",
    );
  } else if (input.endDate) {
    lines.push(`We're still working to a finish of ${input.endDate}.`);
  }

  if (input.unbilledChangeOrderCount > 0) {
    lines.push('');
    lines.push(
      `You approved ${input.unbilledChangeOrderCount === 1 ? 'an extra' : `${input.unbilledChangeOrderCount} extras`} on this job; ${input.unbilledChangeOrderCount === 1 ? 'it' : 'they'} will appear on the next invoice so nothing arrives as a surprise.`,
    );
  }

  lines.push('');
  lines.push('[Anything the client asked about last week goes here.]');
  lines.push('');
  lines.push('— PT\'s Tactical Renovations');

  return lines.join('\n');
}

// ── Small helpers ────────────────────────────────────────────────────────────

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Hours phrased for a briefing line rather than a table cell. */
export function hoursPhrase(hours: number | null): string | null {
  if (hours === null || hours <= 0) return null;
  return `${formatHours(hours)} logged`;
}
