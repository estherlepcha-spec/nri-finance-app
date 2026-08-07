import { test, expect } from './fixtures.js'

// A signed-in user with no stored data (authedPage uses an empty localStorage
// cache) must NOT see any pre-seeded sample goals or budget balances. Guards the
// bug where new users saw fake goals ("Home Down Payment" with saved balances)
// and fake budget categories.

test('Goals screen shows no pre-seeded sample goals for a fresh user', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  await page.getByText('Goals', { exact: false }).first().click()

  // None of the fake sample goals (with their bogus saved balances) should appear.
  // "Home Down Payment" is a goal-TYPE dropdown option, so match the sample goal's
  // unique note/target context instead — the sample "Children Education" goal name
  // and the "Apartment in Bangalore" note are what a real fresh user must not see.
  await expect(page.getByText('Apartment in Bangalore', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Engineering college fund', { exact: false })).toHaveCount(0)
  await expect(page.getByText('6 months Kuwait expenses', { exact: false })).toHaveCount(0)
})

test('Budget screen shows no pre-seeded sample categories for a fresh user', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  await page.getByText('Budget', { exact: false }).first().click()

  // The old sample home-budget category should not be present with its fake limit.
  await expect(page.getByText('Home Loan EMI', { exact: false })).toHaveCount(0)
})
