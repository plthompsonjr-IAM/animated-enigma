'use client';

import { useEffect } from 'react';

/**
 * Root-level error boundary — catches errors in the root layout itself.
 * Must render its own <html>/<body>. Wiring to Sentry lands in Task 45.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('global-error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, color: '#666' }}>
            An unexpected error occurred. Try again, and if it persists, contact support.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: '0.5rem 1rem',
              borderRadius: 6,
              border: 'none',
              background: '#f97316',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
