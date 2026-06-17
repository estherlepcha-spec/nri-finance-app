// Subscription layer — reads the user's Stripe subscription status and starts
// Stripe Checkout / Billing Portal via Edge Functions. Mirrors auth.js.
//
// Entitlement rule (must match the my_entitlement SQL view): a user is allowed
// in while status is 'trialing' or 'active' and the period hasn't ended.

import { supabase } from './supabase.js'

const FN = (name) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`

async function authedPost(name) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in first.')
  const res = await fetch(FN(name), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
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

// Start Stripe Checkout (14-day trial). Redirects the browser to Stripe.
export async function startCheckout() {
  const { url } = await authedPost('create-checkout')
  window.location.href = url
}

// Open the Stripe Billing Portal (manage card / cancel). Redirects.
export async function openPortal() {
  const { url } = await authedPost('create-portal')
  window.location.href = url
}
