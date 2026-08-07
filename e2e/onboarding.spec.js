import { test, expect } from './fixtures.js'

// Onboarding flow for a brand-new user (authenticated, no nri_setupComplete).
// Confirms the fixed behavior: a new user lands on the currency-setup wizard,
// NOT the dashboard, and is NOT shown any pre-seeded sample accounts.

test('new user lands on the currency setup wizard (not the dashboard)', async ({ freshAuthedPage: page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('/')

  // The wizard's first step is the currency setup.
  await expect(page.getByText(/set up your currencies/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Home currency \(where you're from\)/i)).toBeVisible()
  await expect(page.getByText(/Foreign currency \(where you live/i)).toBeVisible()

  // We should NOT be on the dashboard yet.
  await expect(page.getByText(/Overview of your NRI/i)).toHaveCount(0)

  expect(errors, `Uncaught page errors:\n${errors.join('\n')}`).toEqual([])
})

test('new user is NOT shown pre-seeded sample accounts (no fake Burgan/Qatar/SBI)', async ({ freshAuthedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/set up your currencies/i)).toBeVisible({ timeout: 15_000 })

  // None of the old sample account names should appear anywhere in onboarding.
  for (const name of ['Burgan Bank Savings', 'Qatar Credit Card', 'Visa Credit Card', 'SBI Savings Account']) {
    await expect(page.getByText(name, { exact: false })).toHaveCount(0)
  }
})

test('a leaked nri_setupComplete=true (without nri_onboardedAt) does NOT skip the wizard', async ({ freshAuthedPage: page }) => {
  // Reproduces the reported bug: onboarding was skipped even for a user who never
  // chose currencies, because a stray nri_setupComplete flag was trusted. The fix
  // gates onboarding on the explicit nri_onboardedAt marker instead.
  await page.addInitScript(() => {
    window.localStorage.setItem('nri_setupComplete', 'true') // leaked/stale flag
    // NOTE: no nri_onboardedAt — the user never actually completed onboarding.
  })
  await page.goto('/')
  // Must still land on the currency wizard, not the dashboard.
  await expect(page.getByText(/set up your currencies/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Overview of your NRI/i)).toHaveCount(0)
})

test('full currency list is available and Continue unlocks when home != foreign', async ({ freshAuthedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/set up your currencies/i)).toBeVisible({ timeout: 15_000 })

  // The home-currency dropdown should carry the full currency list (60+ options),
  // not a short curated country set. Pick a less-common one to prove breadth.
  const selects = page.locator('select')
  const homeOptions = selects.nth(0).locator('option')
  expect(await homeOptions.count()).toBeGreaterThan(40)

  // Choose home = NPR (Nepal) and foreign = a far-flung currency to prove any
  // country works, not just the old presets.
  await selects.nth(0).selectOption('NPR')
  await selects.nth(1).selectOption('ZAR') // South African Rand — not in old presets

  const cont = page.getByRole('button', { name: /Continue/i })
  await expect(cont).toBeEnabled()
})

test('foreign-currency dropdown excludes the chosen home currency', async ({ freshAuthedPage: page }) => {
  // The UI prevents picking the same currency for both by excluding the home
  // currency from the foreign dropdown's options.
  await page.goto('/')
  await expect(page.getByText(/set up your currencies/i)).toBeVisible({ timeout: 15_000 })

  const selects = page.locator('select')
  await selects.nth(0).selectOption('USD') // home = USD
  // The foreign dropdown should no longer offer USD.
  const foreignHasUsd = await selects.nth(1).locator('option[value="USD"]').count()
  expect(foreignHasUsd).toBe(0)
})
