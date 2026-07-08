// Subscription layer — reads the user's Stripe subscription status and starts
// Stripe Checkout / Billing Portal via Edge Functions. Mirrors auth.js.
//
// Entitlement rule (must match the my_entitlement SQL view): a user is allowed
// in while status is 'trialing' or 'active' and the period hasn't ended.

import { supabase } from './supabase.js'

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
// appears. We record the first-seen timestamp per user in local storage.
const FREE_TRIAL_DAYS = 14
const TRIAL_KEY = (userId) => `nri_freeTrialStart_${userId}`

// Returns whether the user is still inside their 14-day free window, seeding
// the start timestamp on first call. `userId` scopes it so switching accounts
// doesn't leak one user's trial to another.
export function inFreeTrial(userId) {
  if (!userId) return false
  try {
    const key = TRIAL_KEY(userId)
    let start = localStorage.getItem(key)
    if (!start) { start = String(Date.now()); localStorage.setItem(key, start) }
    const elapsedDays = (Date.now() - Number(start)) / 86400000
    return elapsedDays < FREE_TRIAL_DAYS
  } catch { return false }
}

// Whole days remaining in the free window (0 if elapsed / unknown). For display.
export function freeTrialDaysLeft(userId) {
  if (!userId) return 0
  try {
    const start = localStorage.getItem(TRIAL_KEY(userId))
    if (!start) return FREE_TRIAL_DAYS
    const left = FREE_TRIAL_DAYS - (Date.now() - Number(start)) / 86400000
    return Math.max(0, Math.ceil(left))
  } catch { return 0 }
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
