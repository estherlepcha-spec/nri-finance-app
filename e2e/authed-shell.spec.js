import { test, expect } from './fixtures.js'

// Authenticated-shell smoke tests using an INJECTED session (no real account).
// These render the app past the login gate and assert the authenticated UI
// mounts without crashing. NOTE: Supabase data calls 401 with the fake token,
// so these check UI structure/rendering, not real data. For real-data E2E,
// switch to a dedicated test user (see e2e/README.md).

test('authenticated app shell renders (not the sign-in gate)', async ({ authedPage: page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('/')

  // We should NOT see the sign-in screen anymore.
  await expect(page.getByText('Continue with Google')).toHaveCount(0, { timeout: 15_000 })

  // The authenticated shell shows finance UI. The dashboard subtitle is stable.
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  // The shell mounted without throwing.
  expect(errors, `Uncaught page errors:\n${errors.join('\n')}`).toEqual([])
})

test('main navigation sections are present', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  // A few core sections from features.md should appear as nav items.
  for (const label of ['Dashboard', 'Accounts', 'Transactions']) {
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible()
  }
})
