// Subscription layer — reads the user's Stripe subscription status and starts
// Stripe Checkout / Billing Portal via Edge Functions. Mirrors auth.js.
//
// Entitlement rule (must match the my_entitlement SQL view): a user is allowed
// in while status is 'trialing' or 'active' and the period hasn't ended.

import { supabase } from './supabase.js'
import { isInFreeTrial, trialDaysLeft, FREE_TRIAL_DAYS } from './trial.js'

const FN = (name) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`

async function authedPost(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in first.')
  const res = await fetch(FN(name), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

// Read this user's subscription row (RLS lets them read only their own).
// Returns null if they've never subscribed.
export async function getSubscription() {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end, cancel_at_period_end, price_id')
    .maybeSingle()
  if (error) { console.error('getSubscription error', error); return null }
  return data
}

// Is the user entitled to use the app right now?
export function isEntitled(sub) {
  if (!sub) return false
  const active = sub.status === 'trialing' || sub.status === 'active'
  const notExpired = !sub.current_period_end || new Date(sub.current_period_end) > new Date()
  return active && notExpired
}

// A Stripe subscription that has definitively ended (trial done, not renewed).
// These users must be sent straight to the paywall — no free grace window.
export function isExpired(sub) {
  return !!sub && (sub.status === 'past_due' || sub.status === 'canceled' || sub.status === 'unpaid' ||
    (sub.current_period_end && new Date(sub.current_period_end) <= new Date()))
}

// Free-trial window for users who have NOT started a Stripe subscription yet.
// Every user gets 14 days of full access from first sign-in before the paywall
// appears. The window runs from ACCOUNT CREATION (server-side `user.created_at`),
// not first sign-in in this browser, so clearing site data or switching
// browsers/devices can't restart it. See trial.js.
export function inFreeTrial(createdAt) { return bypassTrial() || isInFreeTrial(createdAt) }

// Whole days remaining in the free window (0 if elapsed / unknown). For display.
export function freeTrialDaysLeft(createdAt) { return bypassTrial() ? FREE_TRIAL_DAYS : trialDaysLeft(createdAt) }

// Local-testing switch: VITE_BYPASS_TRIAL=true in .env skips the trial-date
// check so an old test account can keep exploring the app. Honoured ONLY by the
// Vite dev server (import.meta.env.DEV) — a production build ignores it, so it
// can't unlock the paywall for real users.
function bypassTrial() {
  return import.meta.env.DEV && import.meta.env.VITE_BYPASS_TRIAL === 'true'
}

// Start Stripe Checkout (14-day trial). Redirects the browser to Stripe.
export async function startCheckout(priceKey = 'pro_usd_monthly') {
  const { url } = await authedPost('create-checkout', { priceKey })
  window.location.href = url
}

// Open the Stripe Billing Portal (manage card / cancel). Redirects.
export async function openPortal() {
  const { url } = await authedPost('create-portal')
  window.location.href = url
}
