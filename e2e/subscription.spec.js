import { test, expect } from './fixtures.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Billing behavior is controlled by VITE_ENABLE_BILLING. These tests read the
// actual flag from .env and assert the correct behavior for whichever mode is
// active, so they pass whether billing is on (trial reminder + upgrade CTA) or
// off (fully free, no upgrade UI).
function billingEnabled() {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  try {
    const env = fs.readFileSync(path.resolve(dir, '..', '.env'), 'utf8')
    const m = env.match(/^\s*VITE_ENABLE_BILLING\s*=\s*(.+)\s*$/m)
    return !!m && m[1].trim().replace(/["']/g, '') === 'true'
  } catch { return false }
}

const BILLING = billingEnabled()

test('a new user reaches the app (not blocked by a paywall during trial)', async ({ authedPage: page }) => {
  await page.goto('/')
  // Whether billing is on or off, an onboarded user within their trial lands in
  // the app — the paywall only appears after the 14-day window ends.
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })
})

test('Settings upgrade CTA matches the billing flag', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  await page.getByText('Settings', { exact: false }).first().click()
  await expect(page.getByText(/Subscription/i).first()).toBeVisible({ timeout: 10_000 })

  const upgradeCount = await page.getByRole('button', { name: /Upgrade to Pro/i }).count()
  if (BILLING) {
    expect(upgradeCount).toBeGreaterThan(0) // billing on → CTA present
  } else {
    expect(upgradeCount).toBe(0) // billing off → fully free, no CTA
  }
})

test('trial reminder banner shows only when billing is enabled', async ({ authedPage: page }) => {
  await page.goto('/')
  await expect(page.getByText(/Overview of your NRI/i)).toBeVisible({ timeout: 15_000 })

  const banner = page.getByText(/Free trial —/i)
  if (BILLING) {
    await expect(banner).toBeVisible({ timeout: 10_000 })
  } else {
    await expect(banner).toHaveCount(0)
  }
})
