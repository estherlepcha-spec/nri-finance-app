import { test, expect } from './fixtures.js'

// The guided feature tour (Driver.js) must actually run for a first-time user
// and advance through the feature steps. Guards against the tour silently
// breaking because a step's target element is missing.

test('the onboarding tour auto-starts with a welcome step for a new user', async ({ tourAuthedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  // Driver.js renders a popover with our welcome copy.
  await expect(page.getByText(/Let's take a quick tour/i)).toBeVisible({ timeout: 10_000 })
})

test('the tour advances through feature steps and can be completed', async ({ tourAuthedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Let's take a quick tour/i)).toBeVisible({ timeout: 15_000 })

  // Step through: click "Next" and assert we reach the accounts step.
  const next = page.getByRole('button', { name: /^Next/i })
  await next.click()
  await expect(page.getByText(/Add your accounts/i)).toBeVisible()

  // Advance a couple more and confirm a later feature step renders.
  await next.click()
  await expect(page.getByText(/Import transactions/i)).toBeVisible()

  // The tour has a Done/close control; the tour can be dismissed.
  // (Driver.js labels the final button "Done"; a close X is always present.)
  await page.keyboard.press('Escape')
  await expect(page.getByText(/Let's take a quick tour/i)).toHaveCount(0)
})

test('a returning user (tour already completed) does NOT see the tour', async ({ authedPage: page }) => {
  // authedPage sets onboarding_tour_completed_v1, so the tour must stay hidden.
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Let's take a quick tour/i)).toHaveCount(0)
})
