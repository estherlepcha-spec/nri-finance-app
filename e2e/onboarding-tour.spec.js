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

test('tour popover uses the compact font sizing (matches app scale)', async ({ tourAuthedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Let's take a quick tour/i)).toBeVisible({ timeout: 15_000 })

  // Our .nri-tour override sets title 14px / description 12px (vs Driver's 19/14).
  const titleSize = await page.locator('.driver-popover.nri-tour .driver-popover-title')
    .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  expect(titleSize).toBeLessThanOrEqual(14)

  const descSize = await page.locator('.driver-popover.nri-tour .driver-popover-description')
    .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  expect(descSize).toBeLessThanOrEqual(12)
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

test('on a mobile viewport (sidebar hidden) the tour still shows the welcome and does not break', async ({ tourAuthedPage: page }) => {
  // The sidebar (and its nav items) is display:none < 768px. The tour must not
  // silently vanish — the visibility filter keeps element-less steps like the
  // welcome so the user still gets a hello instead of nothing.
  await page.setViewportSize({ width: 390, height: 844 }) // iPhone-ish
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Let's take a quick tour/i)).toBeVisible({ timeout: 10_000 })
})

test('a returning user (tour already completed) does NOT see the tour', async ({ authedPage: page }) => {
  // authedPage sets onboarding_tour_completed_v1, so the tour must stay hidden.
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Let's take a quick tour/i)).toHaveCount(0)
})
