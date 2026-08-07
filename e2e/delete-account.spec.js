import { test, expect } from './fixtures.js'

// Delete Account UI (Settings → Danger Zone). Uses the authed shell fixture.
// We assert the control + confirmation gate render; we do NOT actually trigger
// deletion (that needs the deployed Edge Function and a real account).

test('Settings Danger Zone shows a Delete Account control with a typed confirmation', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  // Navigate to Settings.
  await page.getByText('Settings', { exact: false }).first().click()
  await expect(page.getByText(/Danger Zone/i)).toBeVisible({ timeout: 10_000 })

  // The Delete Account button exists (distinct from "Clear All Data").
  const deleteBtn = page.getByRole('button', { name: /Delete Account/i })
  await expect(deleteBtn).toBeVisible()

  // Opening it reveals the typed-DELETE confirmation; the confirm button is
  // disabled until "DELETE" is typed.
  await deleteBtn.click()
  const confirm = page.getByRole('button', { name: /Permanently Delete My Account/i })
  await expect(confirm).toBeVisible()
  await expect(confirm).toBeDisabled()

  await page.getByPlaceholder('Type DELETE').last().fill('DELETE')
  await expect(confirm).toBeEnabled()
})
