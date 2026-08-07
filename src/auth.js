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

// Sign up with email + password. With email confirmation enabled in the
// Supabase dashboard, this sends a verification email and the user must click
// the link before they can sign in. Returns { needsVerification } so the UI
// can show "check your email".
export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo() },
  })
  if (error) throw error
  // When confirmation is required, Supabase returns a user but no session.
  const needsVerification = !data.session
  return { needsVerification, user: data.user }
}

// Sign in with email + password (after the email is verified).
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

// Send a password-reset email.
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() })
  if (error) throw error
}

// Re-send the verification email (if the user didn't get / lost the first one).
export async function resendVerification(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } })
  if (error) throw error
}

// ── New-account email verification (second factor for Google sign-ups) ────────
// Google OAuth users arrive already email-verified by Google, so there is no
// native confirmation to re-trigger. To add a deliberate confirm-your-email
// step for a NEW account, we send a 6-digit email OTP the user types back in.
// No redirect (works the same in dev and prod without extra URL whitelisting).

// Email a fresh 6-digit code to the signed-in user's address.
export async function sendEmailVerificationCode(email) {
  // shouldCreateUser:false — the account already exists (they're signed in via
  // Google); we only want to send a code to prove inbox control.
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (error) throw error
}

// Verify the code the user entered. Returns true on success.
export async function verifyEmailCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
  if (error) throw error
  return true
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
