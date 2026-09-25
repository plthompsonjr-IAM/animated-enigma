/**
 * One live job-quote proof. Not part of `pnpm test`.
 *
 *   pnpm exec tsx --conditions=react-server scripts/quote-job.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadEnvFile('.env.local');

const { quoteJob } = await import('../src/lib/quoting/quote-job');

const draft = await quoteJob({
  trade: 'interior carpentry',
  location: 'United States national average',
  scope:
    'Replace one standard 60-inch interior prehung door, including removal of the existing door, a new prehung unit, basic hardware, and typical labor. Public unit-cost ranges only.',
});

console.log(JSON.stringify(draft, null, 2));

function loadEnvFile(filename: string): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), filename), 'utf8');
  } catch {
    return;
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
