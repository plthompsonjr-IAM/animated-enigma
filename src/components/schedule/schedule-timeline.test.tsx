import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ScheduleTimeline, type TimelineRow } from './schedule-timeline';

afterEach(cleanup);

const now = new Date('2026-08-05T12:00:00Z'); // Wednesday

const row = (over: Partial<TimelineRow> & { id: string }): TimelineRow => ({
  name: `Phase ${over.id}`,
  status: 'not_started',
  percentComplete: 0,
  projectId: 'p1',
  startDate: '2026-08-03',
  endDate: '2026-08-07',
  ...over,
});

describe('ScheduleTimeline', () => {
  it('renders a bar per item with weekly column headings', () => {
    render(<ScheduleTimeline rows={[row({ id: 'a' }), row({ id: 'b' })]} now={now} />);
    expect(screen.getByText('Phase a')).toBeInTheDocument();
    expect(screen.getByText('Phase b')).toBeInTheDocument();
    // The window is snapped to whole weeks starting the Sunday of today's week.
    expect(screen.getByText('Aug 2')).toBeInTheDocument();
  });

  it('links each row to its project', () => {
    render(<ScheduleTimeline rows={[row({ id: 'a', projectId: 'proj-9' })]} now={now} />);
    expect(screen.getByRole('link', { name: 'Phase a' })).toHaveAttribute(
      'href',
      '/projects/proj-9',
    );
  });

  it('caps the window so one stray far-future date cannot flatten every bar', () => {
    render(
      <ScheduleTimeline
        rows={[row({ id: 'a' }), row({ id: 'b', startDate: '2029-01-01', endDate: '2029-01-05' })]}
        now={now}
      />,
    );
    // The real item still has a readable bar; the 2029 one falls outside the
    // capped window and is left to the work-item list below the chart.
    expect(screen.getByText('Phase a')).toBeInTheDocument();
    expect(screen.queryByText('Phase b')).not.toBeInTheDocument();
    const bar = document.querySelector('div[title^="Phase a ·"]') as HTMLElement;
    expect(parseFloat(bar.style.width)).toBeGreaterThan(2);
  });

  it('says so plainly when nothing falls in the window', () => {
    render(
      <ScheduleTimeline
        rows={[row({ id: 'a', startDate: '2029-01-01', endDate: '2029-01-05' })]}
        now={now}
      />,
    );
    expect(screen.getByText(/nothing scheduled in this window/i)).toBeInTheDocument();
  });

  it('renders nothing but the empty note for an empty schedule', () => {
    render(<ScheduleTimeline rows={[]} now={now} />);
    expect(screen.getByText(/nothing scheduled in this window/i)).toBeInTheDocument();
  });

  it('shows crew and, when asked, the project on each row', () => {
    render(
      <ScheduleTimeline
        rows={[row({ id: 'a', projectName: 'Hall bath', crewNames: ['Mike', 'Dave'] })]}
        showProject
        now={now}
      />,
    );
    expect(screen.getByText(/Hall bath · Mike, Dave/)).toBeInTheDocument();
  });

  it('leaves the project name off when not asked for it', () => {
    render(
      <ScheduleTimeline
        rows={[row({ id: 'a', projectName: 'Hall bath', crewNames: ['Mike'] })]}
        now={now}
      />,
    );
    expect(screen.queryByText(/Hall bath/)).not.toBeInTheDocument();
    expect(screen.getByText('Mike')).toBeInTheDocument();
  });

  it('gives a one-day item a visible bar rather than a hairline', () => {
    const { container } = render(
      <ScheduleTimeline
        rows={[row({ id: 'a', startDate: '2026-08-05', endDate: '2026-08-05' })]}
        now={now}
      />,
    );
    // The label link also carries a title, so target the bar itself.
    const bar = container.querySelector('div[title^="Phase a ·"]') as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(parseFloat(bar!.style.width)).toBeGreaterThanOrEqual(1.2);
  });

  it('marks a conflicting item so it can be spotted at a glance', () => {
    const { container } = render(
      <ScheduleTimeline rows={[row({ id: 'a', hasConflict: true })]} now={now} />,
    );
    expect(container.querySelector('.ring-amber-500')).not.toBeNull();
  });
});
