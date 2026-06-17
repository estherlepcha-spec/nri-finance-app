// Supabase Edge Function: create Stripe Checkout session (14-day trial)
// ---------------------------------------------------------------------------
// Auth-gated (same pattern as the anthropic function). Creates/reuses a Stripe
// customer for the signed-in user and returns a Checkout URL the frontend
// redirects to. The subscription is created with a 14-day trial, card required.
//
// Deploy: supabase functions deploy create-checkout
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL

import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID')!       // your monthly price (price_...)
const APP_URL = Deno.env.get('APP_URL')!                // e.g. https://nri-finance-app.vercel.app
const TRIAL_DAYS = 14

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // 1. Authenticate the caller.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
    )
    const { data: { user }, error: authErr } = await authClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // 2. Reuse an existing Stripe customer for this user, else create one.
    const { data: existing } = await admin.from('subscriptions')
      .select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    let customerId = existing?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email, metadata: { user_id: user.id },
      })
      customerId = customer.id
    }

    // 3. Create the Checkout session (subscription mode, 14-day trial).
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { user_id: user.id },
      },
      // user_id on the session too, so the webhook can link it on completion.
      metadata: { user_id: user.id },
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url: `${APP_URL}/?checkout=cancel`,
      allow_promotion_codes: true,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
