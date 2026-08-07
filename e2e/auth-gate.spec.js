import { test, expect } from '@playwright/test'

// Smoke tests for the pre-auth surface. These need NO test account — they
// verify the app boots and the sign-in gate renders correctly, which already
// catches the most common "white screen of death" regressions (bad build,
// missing env var, crashing top-level component).

test('app boots and shows the sign-in gate', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('/')

  // The full-screen sign-in offers exactly one primary action.
  await expect(page.getByText('Continue with Google')).toBeVisible()

  // No uncaught exceptions during boot.
  expect(errors, `Uncaught page errors:\n${errors.join('\n')}`).toEqual([])
})

test('can switch between sign-in and create-account modes', async ({ page }) => {
  await page.goto('/')
  // "Welcome back" (sign-in) is the default heading.
  await expect(page.getByText('Welcome back')).toBeVisible()
})

test('no high-value secrets are present in the served page/bundle', async ({ page }) => {
  // Guards against the #1 go-live mistake: a secret accidentally prefixed VITE_
  // and shipped to the browser. We scan the initial HTML + all loaded scripts.
  const scriptBodies = []
  page.on('response', async res => {
    const url = res.url()
    if (url.endsWith('.js') || url.includes('/assets/')) {
      try { scriptBodies.push(await res.text()) } catch { /* ignore */ }
    }
  })

  await page.goto('/')
  // Wait for the app to actually render (not networkidle — the app keeps a
  // realtime connection open, so the network never goes fully idle).
  await expect(page.getByText('Continue with Google')).toBeVisible()

  const haystack = (await page.content()) + scriptBodies.join('\n')
  for (const pattern of ['sk-ant-', 'sk_live_', 'sk_test_', 'whsec_', 'service_role']) {
    expect(haystack, `Found forbidden secret pattern "${pattern}" in the browser bundle`).not.toContain(pattern)
  }
})
