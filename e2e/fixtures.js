import { test as base, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Read VITE_SUPABASE_URL from .env so we can compute Supabase's localStorage key
// (sb-<project-ref>-auth-token). We don't import Vite here — just parse the file.
function readEnv() {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const envPath = path.resolve(dir, '..', '.env')
  const out = {}
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* .env may be absent in CI — handled by the skip below */ }
  return out
}

const env = readEnv()
const projectRef = (env.VITE_SUPABASE_URL || '').match(/https?:\/\/([^.]+)\./)?.[1] || null

// A fake, well-formed Supabase session. The JWT is a dummy — enough for the
// client to treat the user as "signed in" and render past the AuthGate. It is
// NOT accepted by the Supabase server, so data (fetch/upsert) calls will 401.
// That's expected: these tests assert UI/rendering, not real data flow.
function fakeSession() {
  const now = Math.floor(Date.now() / 1000)
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'e2e-test@example.com',
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email' },
    user_metadata: {},
  }
  // A three-part token shape (header.payload.sig) so any decode attempt survives.
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp: now + 3600, role: 'authenticated' })}.sig`
  return {
    access_token,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  }
}

// `authedPage` renders the app in a signed-in + setup-complete state.
export const test = base.extend({
  authedPage: async ({ page }, use) => {
    test.skip(!projectRef, 'VITE_SUPABASE_URL missing from .env — cannot compute Supabase storage key')
    const storageKey = `sb-${projectRef}-auth-token`
    const session = fakeSession()

    await page.addInitScript(([key, sess]) => {
      // Supabase v2 stores { currentSession, expiresAt } (or the session directly
      // in newer versions). Store the session object; supabase-js reads it back.
      window.localStorage.setItem(key, JSON.stringify(sess))
      // Skip the setup wizard so we land on the real app shell.
      window.localStorage.setItem('nri_setupComplete', 'true')
    }, [storageKey, session])

    await use(page)
  },
})

export { expect }
