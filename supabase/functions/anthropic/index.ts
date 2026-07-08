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

const rateLimits = new Map<string, number[]>()
const MAX_BODY_BYTES = 1_000_000
const MAX_REQUESTS_PER_WINDOW = 10
const WINDOW_MS = 5 * 60 * 1000

function isRateLimited(userId: string) {
  const now = Date.now()
  const history = rateLimits.get(userId) || []
  const recent = history.filter(ts => now - ts < WINDOW_MS)
  recent.push(now)
  rateLimits.set(userId, recent)
  return recent.length > MAX_REQUESTS_PER_WINDOW
}

// Reassemble Anthropic's SSE stream into the same shape the non-streaming
// Messages API returns: { id, type, role, model, stop_reason, usage, content: [...] }.
// The client only reads content[].text and content[].input, so we rebuild those
// faithfully (text blocks concatenate text_delta; tool_use blocks concatenate
// input_json_delta then JSON.parse the accumulated string).
async function reassembleStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // deno-lint-ignore no-explicit-any
  let message: any = { type: 'message', role: 'assistant', content: [] }
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = []
  const partialJson: Record<number, string> = {}

  const handleEvent = (data: string) => {
    if (!data || data === '[DONE]') return
    // deno-lint-ignore no-explicit-any
    let evt: any
    try { evt = JSON.parse(data) } catch { return }
    switch (evt.type) {
      case 'message_start':
        message = { ...evt.message, content: [] }
        break
      case 'content_block_start':
        blocks[evt.index] = { ...evt.content_block }
        if (evt.content_block?.type === 'tool_use') partialJson[evt.index] = ''
        break
      case 'content_block_delta': {
        const b = blocks[evt.index]
        if (!b) break
        if (evt.delta?.type === 'text_delta') b.text = (b.text || '') + evt.delta.text
        else if (evt.delta?.type === 'input_json_delta') partialJson[evt.index] = (partialJson[evt.index] || '') + evt.delta.partial_json
        else if (evt.delta?.type === 'thinking_delta') b.thinking = (b.thinking || '') + evt.delta.thinking
        break
      }
      case 'content_block_stop': {
        const b = blocks[evt.index]
        if (b?.type === 'tool_use') {
          try { b.input = JSON.parse(partialJson[evt.index] || '{}') } catch { b.input = {} }
        }
        break
      }
      case 'message_delta':
        if (evt.delta?.stop_reason !== undefined) message.stop_reason = evt.delta.stop_reason
        if (evt.delta?.stop_sequence !== undefined) message.stop_sequence = evt.delta.stop_sequence
        if (evt.usage) message.usage = { ...message.usage, ...evt.usage }
        break
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE events are separated by a blank line; each carries one or more
    // "data: ..." lines. Process complete events, keep the remainder buffered.
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data:')) handleEvent(line.slice(5).trim())
      }
    }
  }

  message.content = blocks.filter(Boolean)
  return message
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

    if (isRateLimited(user.id)) {
      return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const contentLength = req.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: { message: 'Payload too large' } }), {
        status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: { message: 'Payload too large' } }), {
        status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Force streaming to Anthropic. Long generations (e.g. multi-month bank
    // statements at high max_tokens) can exceed the platform's wall-clock
    // timeout when waiting for a single non-streamed body — the connection is
    // killed and surfaces to the client as a spurious 5xx (e.g. 546). Streaming
    // keeps bytes flowing so the request completes; we reassemble the full
    // message here and still return ONE JSON object, so the browser client is
    // unchanged (it does res.json() as before).
    let parsedBody: Record<string, unknown>
    try { parsedBody = JSON.parse(body) } catch { parsedBody = {} }
    const upstreamBody = JSON.stringify({ ...parsedBody, stream: true })

    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      body: upstreamBody,
    })

    // On a non-OK status Anthropic returns a normal (non-SSE) JSON error —
    // relay it verbatim.
    if (!anthropicRes.ok || !anthropicRes.body) {
      const errText = await anthropicRes.text()
      return new Response(errText, {
        status: anthropicRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Reassemble the SSE stream into a single Messages API response object.
    const message = await reassembleStream(anthropicRes.body)
    return new Response(JSON.stringify(message), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: String(e?.message || e) } }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
