// Supabase Edge Function: Stripe webhook
// ---------------------------------------------------------------------------
// Stripe calls this on subscription lifecycle events. It is the ONLY writer of
// the public.subscriptions table — using the service-role key (bypasses RLS) —
// so a user can never self-grant access.
//
// Security:
//  - Deploy with --no-verify-jwt (Stripe is not a logged-in Supabase user).
//  - We verify Stripe's signature with STRIPE_WEBHOOK_SECRET; unsigned/forged
//    requests are rejected.
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// Then register the function URL in the Stripe dashboard (Developers → Webhooks).
//
// (Full steps in STRIPE_SETUP.md.)

import Stripe from 'https://esm.sh/stripe@16?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

// Service-role client: bypasses RLS so the webhook can write any user's row.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Upsert a subscription row keyed by the user_id we stashed in Stripe metadata.
async function upsertFromSubscription(sub: Stripe.Subscription) {
  const userId = sub.metadata?.user_id
  if (!userId) { console.error('subscription missing user_id metadata', sub.id); return }
  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: sub.customer as string,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: sub.items.data[0]?.price?.id ?? null,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) console.error('upsert error', error)
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret)
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // The checkout created a subscription — fetch it (with metadata) and store.
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          // Carry the user_id from the session into the subscription metadata once.
          if (!sub.metadata?.user_id && session.metadata?.user_id) {
            await stripe.subscriptions.update(sub.id, { metadata: { user_id: session.metadata.user_id } })
            sub.metadata = { ...sub.metadata, user_id: session.metadata.user_id }
          }
          await upsertFromSubscription(sub)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(event.data.object as Stripe.Subscription)
        break
      }
      default:
        // ignore other event types
        break
    }
  } catch (err) {
    console.error('handler error', err)
    return new Response(`Handler error: ${err.message}`, { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
