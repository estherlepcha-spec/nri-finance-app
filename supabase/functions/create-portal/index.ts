// Supabase Edge Function: create Stripe Customer Portal session
// ---------------------------------------------------------------------------
// Auth-gated. Returns a Stripe Billing Portal URL so the signed-in user can
// update their card, view invoices, or cancel — all handled by Stripe's hosted
// portal. Webhook events keep our subscriptions table in sync afterward.
//
// Deploy: supabase functions deploy create-portal
// Secrets: STRIPE_SECRET_KEY, APP_URL

import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const APP_URL = Deno.env.get('APP_URL')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
    )
    const { data: { user }, error: authErr } = await authClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const { data: row } = await admin.from('subscriptions')
      .select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    if (!row?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No subscription found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${APP_URL}/?tab=settings`,
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
