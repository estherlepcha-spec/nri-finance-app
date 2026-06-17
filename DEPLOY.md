# Deploying to the Web (so it works on your phone)

This makes the app available at a real HTTPS URL, where Google sign-in works
and you can install it on your phone (Add to Home Screen).

Architecture after this:
- **Frontend** → hosted on Vercel (static site).
- **Anthropic API key** → lives server-side in a **Supabase Edge Function**;
  the browser never sees it. The frontend calls the function, which calls
  Claude. (Verified: the key is not in the production bundle.)

Do the steps in order.

---

## Step A — Deploy the Anthropic proxy (Supabase Edge Function)

You need the Supabase CLI once.

```bash
# 1. Install the CLI (pick one)
npm install -g supabase            # or: scoop install supabase (Windows)

# 2. Log in (opens a browser)
supabase login

# 3. Link this project to your Supabase project
supabase link --project-ref wtwfzcugrmlbceqazptg

# 4. Set the Anthropic key as a server-side secret (NOT a VITE_ var)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...your-key...

# 5. Deploy the function
supabase functions deploy anthropic
```

The function lives at:
`https://wtwfzcugrmlbceqazptg.supabase.co/functions/v1/anthropic`

> It requires a signed-in Supabase user, so only your authenticated users can
> spend your Anthropic budget.

---

## Step B — Deploy the frontend to Vercel

1. Go to <https://vercel.com>, sign in **with GitHub**.
2. **Add New → Project** → import `estherlepcha-spec/nri-finance-app`.
3. Framework preset: **Vite** (auto-detected). Build/output already set in
   `vercel.json`.
4. **Environment Variables** — add these three (from your local `.env`):
   - `VITE_SUPABASE_URL` = `https://wtwfzcugrmlbceqazptg.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (your anon key)
   - **Do NOT add `VITE_ANTHROPIC_API_KEY`** — it's server-side now.
5. **Deploy.** You'll get a URL like `https://nri-finance-app.vercel.app`.

> Every future `git push` to `master` auto-deploys.

---

## Step C — Tell Google + Supabase about the new URL

Sign-in will fail until the production URL is whitelisted (same as we did for
localhost).

**Google Cloud** (<https://console.cloud.google.com/apis/credentials> → your
OAuth client):
- **Authorized JavaScript origins** → add `https://your-app.vercel.app`
- (redirect URI stays the Supabase callback — already set)

**Supabase** (Auth → URL Configuration):
- **Site URL** → `https://your-app.vercel.app`
- **Redirect URLs** → add `https://your-app.vercel.app` (and `/**`)

---

## Step D — Test

1. Open the Vercel URL on your computer → sign in with Google → should work.
2. Try an AI feature (scan a receipt / ask Estelle) → confirms the Edge
   Function proxy works.
3. Open the URL on your **phone** (any network, not just home Wi-Fi now):
   - **iOS Safari**: Share → **Add to Home Screen**
   - **Android Chrome**: menu → **Install app / Add to Home Screen**
4. Launch from the home-screen icon — it opens fullscreen like a native app.

---

## Notes

- `.env` stays local and gitignored; production secrets live in Vercel +
  Supabase, never in the repo.
- If AI features return "Please sign in", the session token isn't reaching the
  function — make sure you're signed in and the function deployed without
  `--no-verify-jwt`.
- The legacy-data claim (`0003_claim_legacy_data.sql`) is still pending and
  independent of deployment.

