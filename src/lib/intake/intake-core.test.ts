import { describe, it, expect } from 'vitest';
import { screenForSpam, composeIntakeDescription } from './intake-core';

describe('screenForSpam', () => {
  it('passes a normal human submission', () => {
    expect(
      screenForSpam({ honeypot: '', elapsedSeconds: 25, text: 'I need my bathroom redone.' }),
    ).toEqual({ spam: false, reason: null });
  });

  it('flags a filled honeypot', () => {
    const v = screenForSpam({ honeypot: 'http://spam.example', elapsedSeconds: 40, text: 'hi' });
    expect(v).toEqual({ spam: true, reason: 'honeypot' });
  });

  it('flags an instant (bot) submission', () => {
    expect(screenForSpam({ honeypot: '', elapsedSeconds: 1, text: 'hi' }).reason).toBe('too_fast');
    expect(screenForSpam({ honeypot: '', elapsedSeconds: 0, text: 'hi' }).spam).toBe(true);
  });

  it('does not flag when timing is unknown', () => {
    expect(screenForSpam({ honeypot: '', elapsedSeconds: null, text: 'hi' }).spam).toBe(false);
  });

  it('allows a slightly-slow submit at the threshold', () => {
    expect(screenForSpam({ honeypot: '', elapsedSeconds: 3, text: 'hi' }).spam).toBe(false);
  });

  it('flags link-stuffed text', () => {
    const text = 'buy http://a.com http://b.com http://c.com now';
    expect(screenForSpam({ honeypot: '', elapsedSeconds: 30, text }).reason).toBe('link_stuffing');
  });

  it('permits a couple of links in a genuine message', () => {
    const text = 'Here is the product I want: https://store.example/item';
    expect(screenForSpam({ honeypot: '', elapsedSeconds: 30, text }).spam).toBe(false);
  });
});

describe('composeIntakeDescription', () => {
  it('combines free text with structured facts', () => {
    expect(
      composeIntakeDescription({
        description: 'Full gut of the hall bath.',
        timeline: 'Within 1 month',
        budgetRange: '$15,000 – $50,000',
      }),
    ).toBe('Full gut of the hall bath.\n\nTimeline: Within 1 month · Budget: $15,000 – $50,000');
  });

  it('handles description only', () => {
    expect(composeIntakeDescription({ description: 'Just a quote please.' })).toBe(
      'Just a quote please.',
    );
  });

  it('handles facts only', () => {
    expect(composeIntakeDescription({ timeline: 'ASAP' })).toBe('Timeline: ASAP');
  });

  it('returns empty string when nothing provided', () => {
    expect(composeIntakeDescription({})).toBe('');
  });
});
