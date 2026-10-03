// Supabase Edge Function: read site_feedback submissions (admin-only)
// ---------------------------------------------------------------------------
// site_feedback (marketing-site customer feedback: rating + comment) has no
// SELECT policy for anon/authenticated users — only the service-role key can
// read it (see migration 0006). This function is the one place that's
// allowed to read it back, gated to a single hardcoded owner email so a
// regular signed-in app user can never see other people's feedback.
//
// Deploy: supabase functions deploy site-feedback-admin
// Secrets used: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// Only this account may read feedback submissions.
const ADMIN_EMAIL = 'estherlepcha@gmail.com'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
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
    if ((user.email || '').toLowerCase() !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data, error } = await admin
      .from('site_feedback')
      .select('id, name, email, rating, comment, source, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)

    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
