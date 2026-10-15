// Free-trial window, derived from the account's server-side creation date
// (Supabase auth `user.created_at`). Unlike a localStorage timestamp, this is
// identical in every browser/device and cannot be reset by clearing site data.
// Kept dependency-free so it can be unit-tested and mirrored by the Edge Function.

export const FREE_TRIAL_DAYS = 14
const DAY_MS = 86_400_000

function startMs(createdAt) {
  const t = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt)
  return Number.isFinite(t) ? t : null
}

// True while the account is inside its 14-day window. Unknown/invalid
// creation date => false (fail closed).
export function isInFreeTrial(createdAt, now = Date.now()) {
  const start = startMs(createdAt)
  if (start === null) return false
  return (now - start) / DAY_MS < FREE_TRIAL_DAYS
}

// Whole days remaining (0 once elapsed or if the date is unknown).
export function trialDaysLeft(createdAt, now = Date.now()) {
  const start = startMs(createdAt)
  if (start === null) return 0
  return Math.max(0, Math.ceil(FREE_TRIAL_DAYS - (now - start) / DAY_MS))
}
