# Authentication Setup — Google Sign-In

The code for Google sign-in is built and wired. To make it actually work you
need to do three one-time setup steps that only you can do (they involve your
Google and Supabase accounts). Follow these in order.

---

## Step 1 — Run the database security migration (Supabase)

This is the **most important** step. It enforces that each user can only read
and write their own financial data.

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/migrations/0001_rls.sql`](supabase/migrations/0001_rls.sql).
3. Click **Run**.

You should see "Success. No rows returned." This:
- creates / confirms the `nri_finance_data` table,
- turns on Row-Level Security,
- adds policies so `user_id` must equal the logged-in user (`auth.uid()`),
- enables realtime sync for the table.

> ⚠️ Until this is run, two different users could see each other's data. Do this first.

---

## Step 2 — Create a Google OAuth client (Google Cloud Console)

1. Go to <https://console.cloud.google.com/> → create or select a project.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - Fill App name (e.g. "NRI's & Expat's"), your support email, developer email.
   - Scopes: the defaults (email, profile, openid) are enough. Save.
   - Add yourself as a **Test user** (while the app is in "Testing" mode) or
     hit **Publish** to allow any Google account.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add
     - `http://localhost:3000`
     - your production URL (e.g. `https://yourapp.com`)
   - **Authorized redirect URIs**: add your Supabase callback (from Step 3):
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Create. Copy the **Client ID** and **Client secret**.

---

## Step 3 — Enable Google in Supabase Auth

1. Supabase project → **Authentication → Providers → Google**.
2. Toggle **Enable**, paste the **Client ID** and **Client secret** from Step 2.
3. Copy the **Callback URL** shown here — it must match the redirect URI you
   added in Google (Step 2). Save.
4. **Authentication → URL Configuration**:
   - **Site URL**: your production URL (or `http://localhost:3000` for now).
   - **Redirect URLs**: add both
     - `http://localhost:3000`
     - your production URL.

---

## Step 4 — Test it

1. `npm run dev`, open <http://localhost:3000>.
2. You should see the **Welcome** screen with **Continue with Google**.
3. Click it → choose your Google account → you should return signed in, landing
   in the setup wizard (first time) or your dashboard.
4. Open the sidebar (bottom): you should see your name/avatar with a **Sign out**
   and **Sign out everywhere** menu.

---

## What's already built in the code

| Area | File | Notes |
|---|---|---|
| Google sign-in / out / session | `src/auth.js` | incl. `signOutEverywhere`, freshness check |
| Per-user data isolation | `src/supabase.js` | data now keyed to the logged-in user (no more `'default'`) |
| Auth gate + splash + sign-in screen | `src/App.jsx` (`AuthScreen`, `AuthSplash`) | shown before the app/wizard |
| Auto sign-out after 30 min idle | `src/App.jsx` | activity-reset timer |
| Re-auth before exporting all data | `src/App.jsx` (`exportJSON`) | confirms identity for the sensitive action |
| Cache wipe when account changes | `src/App.jsx` | prevents data bleed on shared devices |
| Database RLS | `supabase/migrations/0001_rls.sql` | run once (Step 1) |

## Still open (deliberately deferred)

- **Legacy data migration.** All data created before auth lives under the old
  `user_id = 'default'` row, which is now invisible to authenticated users.
  When you decide how to handle it (claim it into your first account vs. start
  fresh), see the `TODO(data-migration)` marker in `src/App.jsx`. I can wire
  whichever option you pick in a few lines.
