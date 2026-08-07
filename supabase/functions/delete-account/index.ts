// Supabase Edge Function: delete the signed-in user's account
// ---------------------------------------------------------------------------
// Auth-gated. Permanently deletes EVERYTHING for the calling user:
//   1. their rows in public.nri_finance_data
//   2. their public.subscriptions row (if any)
//   3. their auth.users record (via the service-role key)
// The user can only ever delete THEMSELVES — we derive the id from their JWT,
// never from the request body, so no one can delete another account.
//
// Deploy: supabase functions deploy delete-account
// Secrets used: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// NOTE: If the user has an active Stripe subscription you may also want to
// cancel it in Stripe first — left out here to keep deletion dependency-free;
// the webhook + your dashboard remain the source of truth for billing.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Service-role client bypasses RLS so it can delete the auth user and any rows.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // 1. Authenticate the caller — the deletion target is ALWAYS this user.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
    )
    const { data: { user }, error: authErr } = await authClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // 2. Delete the user's data first (so nothing is orphaned if the last step
    //    somehow fails). These are keyed by user_id.
    const { error: dataErr } = await admin.from('nri_finance_data').delete().eq('user_id', user.id)
    if (dataErr) throw new Error(`data delete failed: ${dataErr.message}`)

    // subscriptions row — ignore "no row" cases.
    await admin.from('subscriptions').delete().eq('user_id', user.id)

    // 3. Delete the auth account itself.
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
    if (delErr) throw new Error(`account delete failed: ${delErr.message}`)

    return new Response(JSON.stringify({ deleted: true }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
