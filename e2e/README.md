# End-to-End Tests (Playwright)

Run: `npm run test:e2e`  (auto-starts the dev server on :3000)
Report after a run: `npx playwright show-report`

## What's covered now (no test account needed)
`auth-gate.spec.js` — smoke tests that need no login:
- App boots and the sign-in gate renders (catches white-screen / build-crash regressions)
- Sign-in vs create-account modes
- **No high-value secrets** (`sk-ant-`, `sk_live_`, `whsec_`, `service_role`) leak into the browser bundle

These alone catch the most common deploy-breaking regressions.

## Authenticated-shell tests (injected session, no account)
`authed-shell.spec.js` + `fixtures.js` — the `authedPage` fixture injects a
fake Supabase session into localStorage (key derived from `VITE_SUPABASE_URL`
in `.env`) plus `nri_setupComplete`, so the app renders past the login gate.
Asserts the authenticated shell + nav mount without crashing.

**Limitation:** the injected JWT is a dummy — the Supabase *server* rejects it,
so data reads/writes 401. These tests verify **UI structure/rendering, not real
data**. For real-data assertions (balances, import rules, saving goals), use a
dedicated test user — see below. The fixture auto-skips if `.env` has no
`VITE_SUPABASE_URL`.

## Testing authenticated flows (needs a decision)
The app is auth-gated behind Supabase — nothing past the sign-in screen renders
without a session. To E2E-test Dashboard/Accounts/Import/etc., pick one:

1. **Dedicated test account (simplest, recommended).**
   Create a throwaway email+password user in Supabase, then use a Playwright
   *global setup* to sign in once and save the storage state:
   ```js
   // e2e/global-setup.js — signs in and saves auth to e2e/.auth/state.json
   // then reuse it via `storageState` in playwright.config.js.
   ```
   Put the credentials in a **gitignored** `.env.test` (never commit them).

2. **Inject a Supabase session** into localStorage before the app loads
   (`page.addInitScript`) — faster, no network, but the injected JWT must be a
   real, unexpired token or Supabase calls 401. Good for UI-only assertions.

Once authenticated, add specs like `accounts.spec.js`, `import.spec.js`
(currency-mismatch guard, duplicate detection), `goals.spec.js`, etc.

## Add stable selectors first
There are currently **no `data-testid`** attributes, so specs must match on
visible text (brittle when copy changes). Before writing many authenticated
specs, add `data-testid` to key elements (nav tabs, "Add account", import
button, balance figures) so tests don't break on wording tweaks.
