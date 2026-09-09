import { Mail, CalendarCheck, Unplug } from 'lucide-react';
import type { ConnectionSummary, ProviderStatus } from '@/lib/google/google-core';
import { disconnectGoogle } from '@/lib/google/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * What the one-word `?google=` result from the OAuth routes means to a person.
 * Kept next to the card because it is the card's copy, not logic.
 */
const NOTICES: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  connected: { tone: 'ok', text: 'Google is connected. Email and calendar can use your account now.' },
  disconnected: { tone: 'ok', text: 'Disconnected. Nothing will send or sync from your account until you reconnect.' },
  denied: { tone: 'warn', text: 'You cancelled on Google’s screen, so nothing was connected.' },
  state: { tone: 'warn', text: 'That sign-in attempt didn’t match the one that started here. Try Connect again.' },
  noscopes: { tone: 'warn', text: 'Both permissions were unticked on Google’s screen, so there was nothing to connect.' },
  norefresh: { tone: 'warn', text: 'Google didn’t issue a lasting credential. Remove this app from your Google account’s third-party access, then try again.' },
  noemail: { tone: 'warn', text: 'Google didn’t say which account consented. Try again.' },
  forbidden: { tone: 'warn', text: 'Only an owner or administrator can connect Google for now.' },
  unconfigured: { tone: 'warn', text: 'Google isn’t configured on this deployment yet.' },
  failed: { tone: 'warn', text: 'Something went wrong talking to Google. Nothing was changed. Try again in a minute.' },
};

export function GoogleConnectionCard({
  status,
  connection,
  mayConnect,
  notice,
}: {
  status: ProviderStatus;
  connection: ConnectionSummary | null;
  mayConnect: boolean;
  notice?: string;
}) {
  const flash = notice ? NOTICES[notice] : undefined;
  const live = connection?.live ? connection : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Google Workspace</CardTitle>
        {live && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
            Connected
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {flash && (
          <p
            className={
              flash.tone === 'ok'
                ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm'
                : 'rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm'
            }
          >
            {flash.text}
          </p>
        )}

        {!status.configured ? (
          <p className="text-sm text-muted-foreground">{status.message}</p>
        ) : live ? (
          <>
            <p className="text-sm">
              Connected as <span className="font-medium">{live.email}</span> since {live.connectedOn}.
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                {live.canSendEmail
                  ? 'Client emails send from this address.'
                  : 'Email sending was not granted — reconnect and tick it to enable.'}
              </li>
              <li className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4" />
                {live.canSyncCalendar
                  ? 'Site visits and schedule items appear on this calendar.'
                  : 'Calendar was not granted — reconnect and tick it to enable.'}
              </li>
            </ul>
            <form action={disconnectGoogle}>
              <Button type="submit" variant="outline" size="sm">
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Connect the Google account you run the business from. Proposals, change orders and
              invoices will send from it, and site visits will land on its calendar. Google will ask
              for exactly two things — sending email and managing calendar events — and never for
              your inbox.
            </p>
            {mayConnect ? (
              <a href="/api/auth/google" className={buttonVariants({ size: 'sm' })}>
                Connect Google
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                Only an owner or administrator can connect Google for now.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
