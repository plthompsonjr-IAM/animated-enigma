'use client';

import { useFormState } from 'react-dom';
import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { createDailyLog, updateDailyLog } from '@/lib/daily-logs/actions';
import {
  DAILY_LOG_FIELDS,
  WEATHER_PRESETS,
  type DailyLogContent,
} from '@/lib/daily-logs/daily-logs-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial = {} as { error?: string; message?: string };

/**
 * Writing or correcting a daily log. Every field is optional individually — the
 * only rule is that the log isn't empty — because a log that demands twelve
 * boxes at 6pm is a log that doesn't get written.
 *
 * The core fields come first and the rest sit behind "More detail", so the
 * common case on a phone is three boxes and a save.
 */
export function DailyLogForm({
  projectId,
  logId,
  logDate,
  content,
  defaultDate,
  maxDate,
}: {
  projectId?: string;
  /** Present when editing an existing log inside its window. */
  logId?: string;
  logDate?: string;
  content?: DailyLogContent;
  defaultDate?: string;
  /** Today — a log can't be dated ahead. */
  maxDate?: string;
}) {
  const editing = Boolean(logId);
  const [open, setOpen] = useState(editing);
  const [showAll, setShowAll] = useState(editing);
  const [state, formAction] = useFormState(editing ? updateDailyLog : createDailyLog, initial);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-auto"
        onClick={() => setOpen(true)}
      >
        <NotebookPen className="h-4 w-4" />
        Write today’s log
      </Button>
    );
  }

  const core = DAILY_LOG_FIELDS.filter((f) => f.core);
  const rest = DAILY_LOG_FIELDS.filter((f) => !f.core);
  const suffix = logId ?? 'new';

  return (
    <form action={formAction} className="space-y-4 rounded-md border p-3">
      {editing ? (
        <input type="hidden" name="logId" value={logId} />
      ) : (
        <input type="hidden" name="projectId" value={projectId} />
      )}

      {editing ? (
        <p className="text-sm text-muted-foreground">
          Editing the log for {logDate}. The previous version is kept in the history — the record
          shows what changed and when.
        </p>
      ) : (
        <div>
          <Label htmlFor={`logDate-${suffix}`} className="mb-1.5 block">
            Date
          </Label>
          <Input
            id={`logDate-${suffix}`}
            name="logDate"
            type="date"
            defaultValue={defaultDate}
            max={maxDate}
            required
            className="sm:w-56"
          />
        </div>
      )}

      {core.map((field) => (
        <Field key={field.key} field={field} suffix={suffix} content={content} />
      ))}

      {showAll ? (
        rest.map((field) => (
          <Field key={field.key} field={field} suffix={suffix} content={content} />
        ))
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-auto"
          onClick={() => setShowAll(true)}
        >
          More detail — delays, materials, client conversations…
        </Button>
      )}

      <FormNotice error={state.error} message={state.message} />

      <div className="flex flex-wrap gap-2">
        <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
          {editing ? 'Save changes' : 'Save log'}
        </SubmitButton>
        {!editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-auto"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  field,
  suffix,
  content,
}: {
  field: (typeof DAILY_LOG_FIELDS)[number];
  suffix: string;
  content?: DailyLogContent;
}) {
  const id = `${field.key}-${suffix}`;
  const defaultValue = content?.[field.key] ?? '';

  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block">
        {field.label}
      </Label>
      <Textarea id={id} name={field.key} rows={field.rows} defaultValue={defaultValue} />
      <p className="mt-1 text-xs text-muted-foreground">{field.prompt}</p>
      {field.key === 'weather' ? <WeatherPresets targetId={id} /> : null}
    </div>
  );
}

/**
 * One-tap weather. Typing conditions into a phone in the rain is exactly the
 * friction that stops logs being written.
 */
function WeatherPresets({ targetId }: { targetId: string }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {WEATHER_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => {
            const target = document.getElementById(targetId) as HTMLTextAreaElement | null;
            if (target) {
              target.value = preset;
              target.focus();
            }
          }}
        >
          {preset}
        </button>
      ))}
    </div>
  );
}
