// Supabase Edge Function: Anthropic API proxy
// ----------------------------------------------------------------------------
// Keeps the Anthropic API key server-side so it is NEVER shipped to the
// browser. The frontend POSTs an Anthropic Messages API body here; we add the
// key and forward it to api.anthropic.com, then stream the JSON back.
//
// Security:
//  - Requires a valid Supabase auth JWT (only signed-in users can spend your
//    API budget). The frontend sends its session token in the Authorization
//    header automatically via supabase.functions.invoke / our fetch wrapper.
//  - The ANTHROPIC_API_KEY is set as a Supabase secret, not in the bundle.
//
// Deploy:
//   supabase functions deploy anthropic --no-verify-jwt=false
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// (Full step-by-step is in DEPLOY.md.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Require an authenticated Supabase user.
    const authHeader = req.headers.get('Authorization') || ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: { message: 'Not authenticated' } }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Forward the request body to Anthropic with the server-side key.
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: { message: 'Server missing ANTHROPIC_API_KEY' } }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.text() // pass through verbatim (messages, model, max_tokens, etc.)

    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      body,
    })

    // 3. Relay Anthropic's response (status + JSON) back to the caller.
    const text = await anthropicRes.text()
    return new Response(text, {
      status: anthropicRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: String(e?.message || e) } }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
