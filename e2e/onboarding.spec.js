import { test, expect } from './fixtures.js'

// Onboarding flow for a brand-new user (authenticated, no nri_setupComplete).
// Confirms the fixed behavior: a new user lands on the currency-setup wizard,
// NOT the dashboard, and is NOT shown any pre-seeded sample accounts.

test('new user lands on the currency setup wizard (not the dashboard)', async ({ freshAuthedPage: page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('/')

  // The wizard's first step is about currencies / where you're from.
  await expect(page.getByText(/set up your currencies/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/originally from/i)).toBeVisible()
  await expect(page.getByText(/live \/ work in/i)).toBeVisible()

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

test('region preset picks a currency and the Continue gate unlocks', async ({ freshAuthedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/set up your currencies/i)).toBeVisible({ timeout: 15_000 })

  // Continue is disabled until both countries are chosen.
  const cont = page.getByRole('button', { name: /Continue/i })
  await expect(cont).toBeDisabled()

  // Pick home + work countries via the two selects (first two selects on the page).
  // Values are the country codes (see HOME_COUNTRIES/WORK_COUNTRIES).
  const selects = page.locator('select')
  await selects.nth(0).selectOption('IN') // India -> INR
  await selects.nth(1).selectOption('KW') // Kuwait -> KWD

  await expect(cont).toBeEnabled()
})
