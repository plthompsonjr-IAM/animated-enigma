'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import {
  QUESTION_TOPICS,
  answerQuestion,
  AREA_LABELS,
  LEVEL_LABELS,
  LEVEL_STYLES,
  LEVEL_TEXT_STYLES,
  type Briefing,
} from '@/lib/ai-foreman/ai-foreman-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Ask a question about the job.
 *
 * The whole briefing is already on the client, and the routing is a pure
 * function, so answering happens without a round trip. That is not a
 * micro-optimisation: this gets used standing in a half-built kitchen on one bar
 * of signal, and an answer that needs the network is an answer you don't get.
 *
 * The answerable questions are listed as buttons rather than left to be
 * discovered. A free-text box that silently fails to understand teaches people
 * the feature is broken; showing the four things it can answer is honest and
 * faster to tap.
 */
export function AskPanel({ briefing }: { briefing: Briefing }) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);

  const answer = asked === null ? null : answerQuestion(briefing, asked);

  function ask(value: string) {
    setQuestion(value);
    setAsked(value);
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex gap-2"
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this job…"
          aria-label="Ask about this job"
        />
        <Button type="submit" variant="outline" size="sm">
          <Search className="h-4 w-4" />
          Ask
        </Button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {QUESTION_TOPICS.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => ask(topic.question)}
            className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
          >
            {topic.question}
          </button>
        ))}
      </div>

      {answer && (
        <div className="space-y-2 rounded-lg border bg-secondary/30 p-3">
          {answer.topic && <p className="text-sm font-medium">{answer.topic.question}</p>}
          {answer.message && <p className="text-sm text-muted-foreground">{answer.message}</p>}
          {answer.findings.map((finding) => (
            <div key={finding.id} className={cn('rounded-md border p-2', LEVEL_STYLES[finding.level])}>
              <span
                className={cn(
                  'text-[11px] font-semibold uppercase',
                  LEVEL_TEXT_STYLES[finding.level],
                )}
              >
                {LEVEL_LABELS[finding.level]} · {AREA_LABELS[finding.area]}
              </span>
              <p className="mt-0.5 text-sm font-medium">{finding.statement}</p>
              <p className="text-xs text-muted-foreground">{finding.evidence}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
