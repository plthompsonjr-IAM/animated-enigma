import 'server-only';

import ContextDev, { APIConnectionError, APIError } from 'context.dev';

import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 250;
const RETRY_AFTER_FALLBACK_MS = 1000;
const MAX_RETRY_AFTER_MS = 60_000;

let client: ContextDev | null = null;

export type RetryOptions = {
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  now?: () => number;
};

/** The only place that constructs the Context.dev SDK client. */
export function getContextDevClient(): ContextDev {
  if (client) return client;
  const apiKey = serverEnv().CONTEXT_DEV_API_KEY;
  if (!apiKey) {
    throw new Error('CONTEXT_DEV_API_KEY is not set');
  }
  client = new ContextDev({ apiKey, maxRetries: 0 });
  return client;
}

/**
 * Retry busy (429) and unavailable (408, 5xx, connection) calls.
 * Validation and auth errors propagate immediately.
 */
export async function withContextDevRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const now = options.now ?? Date.now;
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const waitMs = retryWaitMs(error, attempt, now);
      if (waitMs === null || attempt >= maxRetries) throw error;
      attempt += 1;
      logger.warn('Context.dev request retrying', { attempt, waitMs, status: statusOf(error) });
      await sleep(waitMs);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof APIError && typeof error.status === 'number') return error.status;
  return undefined;
}

function retryWaitMs(error: unknown, attempt: number, now: () => number): number | null {
  if (error instanceof APIConnectionError) {
    return BACKOFF_BASE_MS * 2 ** attempt;
  }
  if (!(error instanceof APIError) || typeof error.status !== 'number') return null;
  if (error.status === 429) return parseRetryAfter(error.headers, now);
  if (error.status === 408 || (error.status >= 500 && error.status <= 599)) {
    return BACKOFF_BASE_MS * 2 ** attempt;
  }
  return null;
}

function parseRetryAfter(headers: Headers | undefined, now: () => number): number {
  if (!headers) return RETRY_AFTER_FALLBACK_MS;

  const millisHeader = headers.get('retry-after-ms');
  if (millisHeader) {
    const millis = Number(millisHeader);
    if (Number.isFinite(millis) && millis >= 0) return Math.min(millis, MAX_RETRY_AFTER_MS);
  }

  const header = headers.get('retry-after');
  if (!header) return RETRY_AFTER_FALLBACK_MS;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - now()), MAX_RETRY_AFTER_MS);
  }

  return RETRY_AFTER_FALLBACK_MS;
}
