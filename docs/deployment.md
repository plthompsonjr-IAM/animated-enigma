# Deploying PT's Tactical Foreman

Written for the first deployment, which has not happened yet. Nothing in this
document has been executed — it is the plan, not a record. Once a deploy has
actually run, correct anything here that turned out to be wrong.

The live Supabase project is **`zhlkfuvscnblkkyfticz`** (Tactical-Foreman,
`ca-central-1`). It carries migrations through `0043` and all 47 tables have
forced row-level security.

---

## Before you start

You need three things that do not exist yet:

1. **A hosting account** connected to the GitHub repository.
2. **The Supabase database password.** Not the anon key, not the service-role
   key — the Postgres password. If nobody knows it, reset it in the Supabase
   dashboard under Settings → Database. Resetting it invalidates any existing
   connection string, so do it before you set the variables below, not after.
3. **The service-role key**, from Settings → API. This one is a real secret: it
   bypasses row-level security entirely. It is server-only and must never be
   given a `NEXT_PUBLIC_` prefix.

---

## The part that will bite you: two different connection strings

Supabase gives you more than one way to connect, and **the app and the
migrations need different ones.** Getting this wrong is the most likely cause of
a deploy that builds fine and then fails under real traffic.

| Use | Which string | Port |
|---|---|---|
| The running app | **Transaction pooler** | 6543 |
| `drizzle-kit migrate` | **Direct connection** (or session pooler) | 5432 |

**Why the app needs the pooler.** Every serverless function instance opens its
own database connections. A few dozen concurrent instances against a direct
connection will exhaust Postgres's connection limit, and the failure arrives
under load — precisely when you least want it. The pooler exists to absorb that.

**Why migrations can't use the transaction pooler.** Transaction mode
multiplexes statements across backends, so it cannot hold session state or
prepared statements. Migrations need both. Use the direct connection, or the
session pooler if your network has no IPv6.

The application code already accounts for this: `src/db/index.ts` sets
`prepare: false`, which the transaction pooler requires, and caps the pool at one
connection per instance in production.

Copy both strings from the Supabase dashboard (Connect → Connection string)
rather than assembling them by hand — the host format has changed before.

---

## Environment variables

Set these in the hosting platform's project settings, for the Production
environment. None of them belong in the repository.

### Required — the app will not work without these

| Variable | Where it comes from | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase → Connect | **Transaction pooler string, port 6543.** See above. |
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API | Safe to expose; it is in the browser bundle. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API | Safe to expose. Row-level security is what protects the data, not this key's secrecy. |
| `NEXT_PUBLIC_APP_URL` | The deployed URL | Used to build client-facing links. Set it to the real domain, not the preview URL, or proposal links will point at a deployment that gets replaced. |

### Required for file uploads

| Variable | Notes |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses row-level security.** Server-only. Without it, the app disables uploads and says so on screen rather than failing at the moment someone tries. |

### Optional — features stay off and say so

| Variable | Turns on |
|---|---|
| `ANTHROPIC_API_KEY` | Model-assisted drafting in the AI Foreman. Without it the briefing still works; it is assembled from the job record by fixed rules. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Sending client links. No sending module is written yet, so setting these alone does nothing today. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sending email as, and syncing calendar to, a connected Google account. See **Google Workspace** below. Off until all four Google variables exist; the Settings card names which are missing. |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://<deployed host>/api/auth/google/callback`. Must match the OAuth client to the character. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored refresh tokens app-side; the database never holds one in the clear. |
| `DB_POOL_MAX` | Overrides the connection cap. Leave unset — production defaults to 1, which is what serverless wants. |

---

## Deploying

1. **Import the repository** into the hosting platform. The framework should be
   detected as Next.js; `vercel.json` pins the build and install commands, and
   `packageManager` in `package.json` pins pnpm 10.33.0.
2. **Set the environment variables** above, for Production.
3. **Deploy the branch.** Currently `claude/tactical-foreman-build-m7i3ng`.
   Point production at `main` once the tracking PR merges.
4. **Run migrations separately.** They do not run during the build, deliberately
   — a failed migration mid-build leaves the schema half-applied with no clean
   rollback. Run them from a machine with the **direct** connection string:

   ```bash
   DATABASE_URL="<direct connection string>" pnpm db:migrate
   ```

   The live project is already current through `0043`, so this is a no-op today.
   It matters for the next migration.

---

## After it deploys: verify the three untested paths

These have never been exercised by a human. The deployment is not finished until
they have been, and none of them can be checked from a developer machine.

- [ ] **Sign up and log in.** Confirm you land on a dashboard with an
      organization. Supabase Auth must have the deployed URL in its redirect
      allow-list — Authentication → URL Configuration — or the confirmation link
      will bounce.
- [ ] **Upload a photo** to a project and confirm it renders. This is the single
      most likely place a latent bug is sitting. Signed URLs expire in five
      minutes by design; a photo that appears and then breaks on reload is a
      different bug from one that never appears.
- [ ] **Open a client link and sign.** Generate a proposal, open its public link
      in a private window, and sign it. Confirm the signature is recorded and
      the document freezes afterward.

Also worth a look on day one:

- [ ] Clock in and out on a phone. This is the most-used screen in the field.
- [ ] Confirm the AI Foreman says no model is connected, rather than implying one
      is thinking.
- [ ] Check that money is hidden for a role without `financials:read`.

---

## Google Workspace (optional)

Lets the app send email as a connected Google account and place site visits on
its calendar. Entirely off until all four `GOOGLE_*` variables exist, and the
Settings card says which are missing rather than failing quietly.

This is the one piece of Google Cloud Console this deployment cannot avoid. It
is a one-time click-through, about fifteen minutes.

1. **Create a project and enable two APIs** — APIs & Services → Library →
   enable **Gmail API** and **Google Calendar API**. Without both, the consent
   screen refuses the scopes and the callback lands on `noscopes`.
2. **Configure the consent screen.** The app asks for exactly `gmail.send` and
   `calendar.events` — nothing that reads mail. While the screen is in
   *Testing*, add every Google account that will connect as a test user; move
   it to *Production* before the crew needs it.
3. **Create an OAuth client** — Credentials → Create credentials → OAuth client
   ID → *Web application*. Under Authorised redirect URIs add, exactly:

   ```
   https://<your deployed host>/api/auth/google/callback
   ```

   Scheme and host to the character. This is the Google-side twin of the
   Supabase redirect allow-list, with the same failure when it's wrong:
   Google shows `redirect_uri_mismatch` and nothing reaches the app.
4. **Generate the token key:** `openssl rand -base64 32`. Rotating it later
   invalidates every stored connection; people reconnect once.
5. **Set the four variables** on the host and redeploy. Then, signed in as the
   owner: Settings → Google Workspace → **Connect Google**. The consent screen
   should list two permissions and no more.

Each member connects their own account; nobody's token is shared, and an owner
can see who is connected but cannot use or alter anyone else's connection. That
rule is enforced by row-level security, not just by the interface.

## If it goes wrong

**Roll back** to the previous deployment in the hosting dashboard. It is instant
and does not touch the database.

**A rolled-back deploy does not roll back a migration.** This is the asymmetry to
respect: code reverts in seconds, schema does not. Write migrations so the
previous version of the app still runs against the new schema — add columns,
don't rename them in place — and there is nothing to undo.

**Common failures, in the order you should suspect them:**

| Symptom | Likely cause |
|---|---|
| Works, then fails under load | `DATABASE_URL` is the direct connection, not the pooler |
| Every query fails immediately | Wrong password, or the pooler string used with `prepare: true` |
| Login redirects to localhost | `NEXT_PUBLIC_APP_URL` unset, or the redirect allow-list is missing the domain |
| Uploads disabled with a message | `SUPABASE_SERVICE_ROLE_KEY` not set — this is the intended behaviour, not a crash |
| Intermittent timeouts, nothing in the logs | The Supabase free tier auto-paused. `INACTIVE` status is the tell. |

---

## Known gaps this deployment does not close

Stated so nobody reads a green deploy as a finished product:

- **No email is sent.** Every client link is still copy-and-paste.
- **No payment processing.** Payments are recorded by hand.
- **The contract terms have not had attorney review.** The Ohio right-to-cancel
  wording is a placeholder and the app warns while bracketed blanks remain.
- **No end-to-end browser test exists.** The checklist above is manual, and it
  stays manual until an automated suite is written.
