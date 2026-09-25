/**
 * Live Lowe's material lookup. Not part of `pnpm test`.
 *
 *   pnpm exec tsx --conditions=react-server scripts/quote-job.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  loadEnvFile('.env.local');

  const { sourceLowesMaterial } = await import('../src/lib/quoting/lowes-material');

  const materials = await sourceLowesMaterial({
    scope: '60-inch interior prehung door',
  });

  console.log(JSON.stringify(materials, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

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
