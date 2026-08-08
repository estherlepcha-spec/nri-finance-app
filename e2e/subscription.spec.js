import { test, expect } from './fixtures.js'

// Billing is OFF by default (VITE_ENABLE_BILLING=false). With billing off the
// app must stay fully free: no paywall for new users, and no "Upgrade to Pro"
// CTA (the upgrade path only appears once billing is enabled). This guards the
// free experience; the billing-ON path is exercised by a separate build.

test('with billing off, a new user is NOT paywalled', async ({ authedPage: page }) => {
  await page.goto('/')
  // Reaches the app, not a paywall screen.
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Upgrade to Pro/i)).toHaveCount(0)
})

test('with billing off, Settings shows no Upgrade to Pro button', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  await page.getByText('Settings', { exact: false }).first().click()
  await expect(page.getByText(/Subscription/i).first()).toBeVisible({ timeout: 10_000 })

  // No upgrade CTA while billing is disabled.
  await expect(page.getByRole('button', { name: /Upgrade to Pro/i })).toHaveCount(0)
})
