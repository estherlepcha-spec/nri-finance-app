import { test, expect } from './fixtures.js'

// Inline required-field validation: submitting a form with an empty required
// field should highlight it (red border) and show a message, instead of the
// Save button silently doing nothing.

test('Add Bill: saving with empty name shows an inline error and does not close', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  // Go to Bills and open Add Bill.
  await page.getByText('Bills', { exact: false }).first().click()
  await page.getByRole('button', { name: /Add Bill/i }).first().click()
  // Modal heading (h3) — scope to a heading role to avoid matching the button.
  await expect(page.getByRole('heading', { name: /Add Bill/i })).toBeVisible({ timeout: 10_000 })

  // Click the modal's save button (the last "Add Bill" button, inside the modal).
  await page.getByRole('button', { name: /^Add Bill$/i }).last().click()

  // The inline message appears and the modal stays open (not silently ignored).
  await expect(page.getByText(/Please enter a bill name/i)).toBeVisible()

  // Filling the name clears the error as you type.
  await page.getByPlaceholder('e.g. Netflix, Electricity').fill('Phone')
  await expect(page.getByText(/Please enter a bill name/i)).toHaveCount(0)
})
