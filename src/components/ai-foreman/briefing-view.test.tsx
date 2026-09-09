import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BriefingView } from './briefing-view';
import { buildBriefing, EMPTY_INPUT, type BriefingInput } from '@/lib/ai-foreman/ai-foreman-core';

afterEach(cleanup);

const NOW = new Date('2026-08-11T14:00:00Z');

function briefing(overrides: Partial<BriefingInput> = {}) {
  return buildBriefing(
    { ...EMPTY_INPUT, projectName: 'Henderson kitchen', ...overrides },
    NOW,
  );
}

describe('BriefingView', () => {
  it('shows every claim with the evidence directly under it', () => {
    render(
      <BriefingView
        briefing={briefing({
          contractValue: 50000,
          invoiced: 28000,
          costToDate: 41200,
          scheduleItems: 3,
        })}
      />,
    );

    expect(screen.getByText('You are spending faster than you are billing.')).toBeTruthy();
    expect(
      screen.getByText('$41,200.00 of cost against $28,000.00 invoiced.'),
    ).toBeTruthy();
    expect(screen.getByText('You are financing the client. Raise the next draw.')).toBeTruthy();
  });

  it('renders the headline and the risk count', () => {
    render(
      <BriefingView
        briefing={briefing({
          contractValue: 50000,
          invoiced: 1000,
          overdueAmount: 1000,
          overdueCount: 1,
          scheduleItems: 2,
        })}
      />,
    );
    expect(screen.getByText('One thing on this job needs dealing with today.')).toBeTruthy();
    expect(screen.getByText(/1 risk,/)).toBeTruthy();
  });

  it('says the briefing is partial rather than implying everything is fine', () => {
    render(<BriefingView briefing={briefing({ contractValue: null, invoiced: null })} />);
    const note = screen.getByText(/This briefing is partial/);
    expect(note.textContent).toContain('money and cost');
    expect(note.textContent).toContain('your role does not have access');
  });

  it('does not show a partial notice when everything was visible', () => {
    render(
      <BriefingView
        briefing={briefing({ contractValue: 50000, invoiced: 50000, costToDate: 10000 })}
      />,
    );
    expect(screen.queryByText(/This briefing is partial/)).toBeNull();
  });

  it('links a finding to where it can be acted on', () => {
    render(
      <BriefingView
        briefing={briefing({
          contractValue: 50000,
          invoiced: 1000,
          unbilledChangeOrderCount: 1,
          unbilledChangeOrderValue: 4000,
          scheduleItems: 2,
        })}
      />,
    );
    const links = screen.getAllByRole('link', { name: /Go there/ });
    expect(links.some((a) => a.getAttribute('href') === '/change-orders')).toBe(true);
  });

  it('renders a job with nothing wrong without crashing or inventing findings', () => {
    render(
      <BriefingView
        briefing={briefing({
          contractValue: 50000,
          invoiced: 50000,
          paid: 50000,
          costToDate: 30000,
          scheduleItems: 4,
          logCoveragePercent: 100,
          lastLogDay: '2026-08-10',
        })}
      />,
    );
    expect(screen.getByText('This job is clean — nothing needs attention today.')).toBeTruthy();
  });
});
