import test from 'node:test'
import assert from 'node:assert/strict'

// User-data isolation on a shared device.
// ---------------------------------------------------------------------------
// These tests lock in the security rule that a newly signed-in user must NEVER
// inherit another user's cached data. They model the two decision points in
// App.jsx that enforce it:
//   1. shouldWipeCache()  — the account-switch guard (App.jsx auth effect)
//   2. shouldSeedFromCache() — the "seed a new account from localStorage" gate
// Kept as pure functions here so the security contract is tested deterministically
// without a browser/Supabase. If you change the logic in App.jsx, mirror it here.

// Mirror of the wipe decision: wipe the local cache (and reload) when the cache
// belongs to a different user than the one now signed in.
function shouldWipeCache({ prevUserId, currentUserId, taggedOwner }) {
  const switchedInPage = prevUserId !== undefined && prevUserId !== currentUserId
  const foreignCache = !!currentUserId && !!taggedOwner && taggedOwner !== currentUserId
  return switchedInPage || foreignCache
}

// Mirror of the seed gate: only seed Supabase from localStorage when the cache
// provably belongs to THIS user.
function shouldSeedFromCache({ currentUserId, taggedOwner }) {
  return !!currentUserId && taggedOwner === currentUserId
}

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

test('LEAK GUARD: user B does NOT seed from user A cached data', () => {
  // A signed in earlier (cache tagged to A); now B signs in fresh (no cloud rows).
  assert.equal(
    shouldSeedFromCache({ currentUserId: USER_B, taggedOwner: USER_A }),
    false,
    'B must never upload A’s cached data into B’s account',
  )
})

test('same user CAN seed their own pre-sign-in cache', () => {
  assert.equal(
    shouldSeedFromCache({ currentUserId: USER_A, taggedOwner: USER_A }),
    true,
  )
})

test('untagged cache is NOT seeded (unknown owner => treat as foreign)', () => {
  assert.equal(
    shouldSeedFromCache({ currentUserId: USER_A, taggedOwner: null }),
    false,
  )
})

test('WIPE: switching users on the same page wipes the cache', () => {
  assert.equal(
    shouldWipeCache({ prevUserId: USER_A, currentUserId: USER_B, taggedOwner: USER_A }),
    true,
  )
})

test('WIPE: sign-in after reload with a foreign owner tag wipes the cache', () => {
  // prevUserId resets to undefined after a full reload; the owner tag catches it.
  assert.equal(
    shouldWipeCache({ prevUserId: undefined, currentUserId: USER_B, taggedOwner: USER_A }),
    true,
  )
})

test('WIPE: same user signing back in does NOT wipe (keeps their cache)', () => {
  assert.equal(
    shouldWipeCache({ prevUserId: undefined, currentUserId: USER_A, taggedOwner: USER_A }),
    false,
  )
})

test('WIPE: sign-out (user -> null) wipes the cache', () => {
  assert.equal(
    shouldWipeCache({ prevUserId: USER_A, currentUserId: null, taggedOwner: USER_A }),
    true,
  )
})

test('end-to-end scenario: A creates data, signs out, B signs in => B sees nothing of A', () => {
  // 1. A is signed in, cache tagged to A.
  let taggedOwner = USER_A
  // 2. A signs out: wipe fires (prev A -> null).
  assert.equal(shouldWipeCache({ prevUserId: USER_A, currentUserId: null, taggedOwner }), true)
  taggedOwner = null // wipe cleared nri_cacheOwner along with nri_* keys
  // 3. B signs in fresh. Even if some stale A cache lingered (taggedOwner=A),
  //    neither wipe-suppression nor seeding would leak it:
  assert.equal(shouldWipeCache({ prevUserId: undefined, currentUserId: USER_B, taggedOwner: USER_A }), true,
    'a lingering A-tagged cache must trigger a wipe for B')
  assert.equal(shouldSeedFromCache({ currentUserId: USER_B, taggedOwner: USER_A }), false,
    'and must never be seeded into B')
})
