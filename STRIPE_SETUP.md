# Stripe Subscription Setup (14-day free trial → monthly)

The code is built but **dormant** — the paywall only activates when you set
`VITE_ENABLE_BILLING=true` in Vercel. Do these steps, test in Stripe **test
mode**, then flip the flag.

Architecture: 1 table + 3 Edge Functions + a frontend gate.
- `subscriptions` table — who's entitled (written only by the webhook).
- `stripe-webhook` — Stripe → updates the table (service-role, signature-verified).
- `create-checkout` — starts the trial checkout (auth-gated).
- `create-portal` — manage/cancel (auth-gated).

---

## Step 1 — Create a Stripe account + product
1. Sign up at <https://stripe.com> → stay in **Test mode** (toggle, top-right).
2. **Products → Add product**: name it (e.g. "NRI Finance — Monthly"), set a
   recurring **monthly** price. Save.
3. Copy the **Price ID** (`price_...`).
4. **Developers → API keys**: copy the **Secret key** (`sk_test_...`).

## Step 2 — Run the database migration
Supabase → SQL editor → paste & run
[`supabase/migrations/0004_subscriptions.sql`](supabase/migrations/0004_subscriptions.sql).

## Step 3 — Set Edge Function secrets
```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
npx supabase secrets set STRIPE_PRICE_ID=price_...
npx supabase secrets set APP_URL=https://nri-finance-app.vercel.app
# STRIPE_WEBHOOK_SECRET is set in Step 5 after you create the webhook.
```

## Step 4 — Deploy the functions
```bash
npx supabase functions deploy create-checkout
npx supabase functions deploy create-portal
npx supabase functions deploy stripe-webhook --no-verify-jwt
```
(The webhook MUST use `--no-verify-jwt` — Stripe is not a logged-in user.)

## Step 5 — Register the webhook in Stripe
1. Stripe → **Developers → Webhooks → Add endpoint**.
2. URL: `https://wtwfzcugrmlbceqazptg.supabase.co/functions/v1/stripe-webhook`
3. Events to send: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
4. Save → copy the **Signing secret** (`whsec_...`) → set it:
   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   Then redeploy the webhook: `npx supabase functions deploy stripe-webhook --no-verify-jwt`

## Step 6 — Enable the Customer Portal
Stripe → **Settings → Billing → Customer portal** → activate it (lets users
cancel / update cards).

## Step 7 — Turn the gate on
In Vercel → project → Settings → Environment Variables, add:
```
VITE_ENABLE_BILLING = true
```
Redeploy. Now new sign-ins hit the paywall → "Start free trial".

## Step 8 — Test (test mode)
1. Sign up / sign in → you should see the paywall.
2. Click **Start free trial** → Stripe Checkout.
3. Use test card `4242 4242 4242 4242`, any future expiry, any CVC.
4. Complete → you return to the app, now entitled (status `trialing`).
5. Settings → **Subscription** card shows the trial + **Manage subscription**.
6. In Stripe test dashboard, confirm the customer + subscription exist and the
   webhook delivered (Developers → Webhooks → your endpoint → recent deliveries).

## Step 9 — Go live
When happy: switch Stripe to **Live mode**, recreate the product/price, and swap
all `sk_test_`/`whsec_test_`/`price_` secrets for the live ones. Re-register the
webhook in live mode.

---

## Security notes
- The `subscriptions` table is **read-only** for users (RLS). Only the webhook
  (service-role key) writes it — a user can't self-grant access.
- The webhook verifies Stripe's signature; forged calls are rejected.
- Entitlement = status `trialing` or `active` and not past `current_period_end`.
  This rule lives in both `subscription.js` (frontend) and the `my_entitlement`
  SQL view.
- `VITE_ENABLE_BILLING` defaults off, so a misconfiguration never locks you out
  before Stripe is ready.
