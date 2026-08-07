import { test, expect } from './fixtures.js'

// Email-verification gate for a brand-new account (authenticated, but neither
// verified nor onboarded). Must appear BEFORE the currency wizard.

test('new account hits the email-verification gate before the wizard', async ({ unverifiedAuthedPage: page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('/')

  await expect(page.getByText(/Verify your email/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /Verify & continue/i })).toBeVisible()

  // Must NOT be on the wizard or dashboard yet.
  await expect(page.getByText(/set up your currencies/i)).toHaveCount(0)
  await expect(page.getByText(/Overview of your NRI/i)).toHaveCount(0)

  expect(errors, `Uncaught page errors:\n${errors.join('\n')}`).toEqual([])
})

test('verify button is disabled until a full 6-digit code is entered', async ({ unverifiedAuthedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Verify your email/i)).toBeVisible({ timeout: 15_000 })

  const verifyBtn = page.getByRole('button', { name: /Verify & continue/i })
  await expect(verifyBtn).toBeDisabled()

  const input = page.locator('input[inputmode="numeric"]')
  await input.fill('123')
  await expect(verifyBtn).toBeDisabled()
  await input.fill('123456')
  await expect(verifyBtn).toBeEnabled()
})
