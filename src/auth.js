// Authentication layer — Google OAuth via Supabase Auth.
// Pairs with supabase.js (data) and the AuthGate in App.jsx.
//
// SECURITY NOTE: signing in here only identifies the user. The actual
// per-user data isolation is enforced by Row-Level Security in the
// database (see supabase/migrations/0001_rls.sql). Never rely on the
// client alone to keep one user's financial data away from another.

import { supabase } from './supabase.js'

// Where Google redirects back to after the consent screen.
// Uses the current origin so it works in dev (localhost) and prod alike.
// Each of these origins must also be registered in the Supabase dashboard
// (Auth → URL Configuration → Redirect URLs) and in the Google OAuth client.
const redirectTo = () => `${window.location.origin}${window.location.pathname}`

// Start the Google OAuth flow. The browser navigates away to Google's
// consent screen and returns to redirectTo() with a session.
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo(),
      // Always show the account chooser so users on shared devices don't
      // get silently logged into the last account.
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw error
  return data
}

// Sign out of this device only.
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Sign out of EVERY device — revokes all active sessions for this user.
// Use when a user suspects their account is compromised.
export async function signOutEverywhere() {
  const { error } = await supabase.auth.signOut({ scope: 'global' })
  if (error) throw error
}

// Current session (or null). Reads from Supabase's local storage of the JWT.
export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) { console.error('getSession error:', error); return null }
  return data.session
}

// Subscribe to auth changes (sign-in, sign-out, token refresh).
// Returns an unsubscribe function.
export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

// Re-verify the user right before a sensitive action (export-all / delete).
// We can't force Google to re-prompt without a full redirect, so we take a
// pragmatic middle ground: confirm the session is still live and unexpired.
// For a hard re-auth (redirect to Google again) call signInWithGoogle().
export async function assertFreshSession(maxAgeSeconds = 60 * 30) {
  const session = await getSession()
  if (!session) return false
  // supabase sessions carry an expiry; treat a session issued/refreshed
  // within maxAge as "fresh enough" for sensitive actions.
  const issuedAt = session.user?.last_sign_in_at ? Date.parse(session.user.last_sign_in_at) : 0
  if (!issuedAt) return true // can't tell — don't block, but caller may re-prompt
  return (Date.now() - issuedAt) <= maxAgeSeconds * 1000
}
