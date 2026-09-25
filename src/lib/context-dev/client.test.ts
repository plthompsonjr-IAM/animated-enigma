import { describe, expect, it, vi } from 'vitest';
import { APIConnectionError, APIError } from 'context.dev';

import { withContextDevRetry } from './client';

describe('withContextDevRetry', () => {
  it('waits for Retry-After on 429 and then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        new APIError(429, { message: 'slow down' }, 'slow down', headers({ 'retry-after': '2' })),
      )
      .mockResolvedValueOnce('ok');

    await expect(withContextDevRetry(operation, { sleep })).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('backs off on 502 and stops after two retries', async () => {
    const sleep = vi.fn(async () => {});
    const error = new APIError(502, { message: 'bad gateway' }, 'bad gateway', new Headers());
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withContextDevRetry(operation, { sleep })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it('does not retry a 400 validation error', async () => {
    const sleep = vi.fn(async () => {});
    const error = new APIError(400, { message: 'invalid' }, 'invalid', new Headers());
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withContextDevRetry(operation, { sleep })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('backs off on a dropped connection', async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new APIConnectionError({ message: 'socket hang up' }))
      .mockResolvedValueOnce('ok');

    await expect(withContextDevRetry(operation, { sleep })).resolves.toBe('ok');

    expect(sleep).toHaveBeenCalledWith(250);
  });
});

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}
