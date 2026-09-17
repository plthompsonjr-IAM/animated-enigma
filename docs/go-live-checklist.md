# Go-live checklist

The clicks that only the account owner can make, in order, with the exact
values. Everything else is already done in code. Written on 2026-09-17; if a
dashboard has moved a button, the words to look for are the same.

Nothing here has been executed yet. Tick the boxes as you go and, when a step
does not behave as described, say so in `docs/agent-log.md` so the next reader
knows.

## The two facts you need

| | Value |
|---|---|
| Vercel team / project | **Tac System** (`tac-system`) → **tactical-foreman** |
| Supabase project | **Tactical-Foreman**, ref `zhlkfuvscnblkkyfticz`, region ca-central-1 |
| The URL people use today | `https://tactical-foreman-git-claude-tactical-foreman-3ee022-tac-system.vercel.app` |

That URL is the stable preview address for the build branch. It stays the same
across pushes. Production (`main`) still serves Task 7 until PR #6 merges, so
use the preview URL everywhere below until then.

---

## Part A — Vercel: link Supabase (about five minutes)

- [ ] **A1.** In Vercel, open the **tactical-foreman** project → **Storage** tab
      (or **Integrations** → Browse Marketplace → search *Supabase*). Choose
      **Connect** / **Add Integration**.
- [ ] **A2.** When asked which Supabase project to link, pick the existing
      **Tactical-Foreman** project. Do **not** create a new database — the
      schema, migrations, and storage bucket already live in the existing one.
- [ ] **A3.** Choose environments: **Production, Preview, Development** (all).
      The preview URL above is a Preview deployment, so Preview matters today.
- [ ] **A4.** Confirm. Vercel writes the variables itself. In **Settings →
      Environment Variables** you should now see, among others, `POSTGRES_URL`,
      `NEXT_PUBLIC_SUPABASE_URL`, and either `SUPABASE_SECRET_KEY` or
      `SUPABASE_SERVICE_ROLE_KEY`. The app accepts either generation of names.
- [ ] **A5.** **Deployments → ⋯ on the latest → Redeploy.** Variables only reach
      a deployment that was built after they were set.

**If the integration will not link an existing project** (it insists on
creating a new one): stop, and instead add these four by hand under Settings →
Environment Variables, for Production and Preview:

| Name | From |
|---|---|
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler** string, port 6543, with the database password filled in |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://zhlkfuvscnblkkyfticz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service role / secret key (**server-only**) |

`NEXT_PUBLIC_APP_URL` is not needed either way — the app takes it from Vercel.

---

## Part B — Supabase: allow the app's URL for login (two minutes)

Without this, the confirmation link in the signup email bounces to localhost.

- [ ] **B1.** Supabase dashboard → project **Tactical-Foreman** →
      **Authentication → URL Configuration**.
- [ ] **B2.** **Site URL:** the preview URL above (swap to the production
      domain when PR #6 merges).
- [ ] **B3.** **Redirect URLs — add both:**
      ```
      https://*-tac-system.vercel.app/**
      http://localhost:3000/**
      ```
      The wildcard covers every preview deployment of this team.
- [ ] **B4.** If the project shows **Paused** at the top, click **Restore**.
      The free tier pauses after a week idle; it takes a few minutes to come
      back and the app shows timeouts meanwhile.

---

## Part C — First walk-through (ten minutes, on your phone)

Do these on the preview URL. They are the three paths no human has exercised.

- [ ] **C1.** Sign up, confirm the email, land on the dashboard, create the
      organisation. Set the timezone in Settings.
- [ ] **C2.** Create a project and upload one photo. Reload the page: the photo
      should still render.
- [ ] **C3.** Make a proposal, generate its client link, open it in a private
      window, sign it. Back in the app the proposal should be frozen and the
      signature recorded.
- [ ] **C4.** Clock in and out. Confirm money is hidden when you view as a role
      without financials.

If any of these fails, note exactly what the screen said. That message is the
bug report.

---

## Part D — Google Cloud: the OAuth client (about fifteen minutes)

This is the only Google Cloud Console work the app ever needs. It unlocks email
sending from your own address and calendar sync together.

- [ ] **D1.** https://console.cloud.google.com → project picker → **New
      project** → name it `PT Tactical Foreman` → Create → select it.
- [ ] **D2.** **APIs & Services → Library.** Enable **Gmail API**. Then enable
      **Google Calendar API**. Both, or the consent screen refuses a scope and
      the app reports `noscopes`.
- [ ] **D3.** **APIs & Services → OAuth consent screen** (may be labelled
      *Google Auth Platform → Branding / Audience*). User type **Internal** if
      the option is offered (Workspace accounts only, no verification review);
      otherwise **External**. App name `PT's Tactical Foreman`, support email
      your address. Save.
- [ ] **D4.** **Audience / Test users** (External only): add every Google
      account that will connect, starting with yours. While the app is in
      *Testing*, only listed users can consent.
- [ ] **D5.** **Data access / Scopes → Add or remove scopes.** Tick exactly:
      ```
      https://www.googleapis.com/auth/gmail.send
      https://www.googleapis.com/auth/calendar.events
      ```
      Nothing that reads mail. Save.
- [ ] **D6.** **Credentials → Create credentials → OAuth client ID.**
      Application type **Web application**. Name `Tactical Foreman (Vercel)`.
      Under **Authorised redirect URIs** add, character for character:
      ```
      https://tactical-foreman-git-claude-tactical-foreman-3ee022-tac-system.vercel.app/api/auth/google/callback
      ```
      The app's **Settings → Google Workspace** card shows this same value, so
      you can copy it from there instead of typing it. Add a second entry for
      the production domain when it exists. Create.
- [ ] **D7.** Google shows a **Client ID** and **Client secret**. Keep the
      dialog open; you set them in the next step. Do not paste them into chat.
- [ ] **D8.** Generate the token key on your own machine:
      ```
      openssl rand -base64 32
      ```
      (On Windows without OpenSSL, PowerShell:
      `[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }) -as [byte[]])`.)
- [ ] **D9.** Vercel → tactical-foreman → **Settings → Environment Variables**,
      for Production and Preview, add:

      | Name | Value |
      |---|---|
      | `GOOGLE_CLIENT_ID` | from D7 |
      | `GOOGLE_CLIENT_SECRET` | from D7 — mark **Sensitive** |
      | `GOOGLE_TOKEN_ENCRYPTION_KEY` | from D8 — mark **Sensitive** |

      `GOOGLE_OAUTH_REDIRECT_URI` is not needed; the app derives it.
- [ ] **D10.** **Redeploy** (as in A5).
- [ ] **D11.** In the app, signed in as owner: **Settings → Google Workspace →
      Connect Google.** The consent screen must list two permissions — send
      email, manage calendar events — and nothing else. Approve. The card
      should read *Connected as …*.
- [ ] **D12.** Prove it: invite yourself at a second address (Settings → Team)
      and confirm the mail arrives **from your own address**. Schedule a site
      visit for tomorrow and confirm it appears on your Google Calendar at the
      right time. Reschedule it: it should move, not duplicate. Cancel it: it
      should disappear.

---

## What "done" looks like

Every box above ticked, and one line in `docs/agent-log.md` saying which day it
happened and anything that did not match this page. From that point the
open items are the ones that were always yours: cost rates per person, the
attorney review of contract terms, and the payment-processing decision.
