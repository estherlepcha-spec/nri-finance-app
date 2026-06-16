// ─── Anthropic API Service ─────────────────────────────────────────────────────
// All calls to Claude go through the Supabase Edge Function proxy so the API
// key stays server-side and is never bundled into the browser. The function
// requires a signed-in Supabase user.

import { supabase } from '../supabase.js'

// Edge Function endpoint: <project>/functions/v1/anthropic
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/anthropic`

// Low-level: POST a full Anthropic Messages body to the proxy, return parsed JSON.
// Used by every AI feature (scan, advisor, statement import, etc.).
export const anthropicMessages = async (body) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in to use AI features.')

  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `API error ${res.status}`)
  return data
}

// Mid-level: messages + options → parsed JSON (matches old callClaude signature).
export const callClaude = async (messages, { maxTokens = 1024, system = null, model = 'claude-sonnet-4-5' } = {}) => {
  const body = { model, max_tokens: maxTokens, messages }
  if (system) body.system = system
  return anthropicMessages(body)
}

// Convenience: simple text prompt → text back.
export const extractWithPrompt = async (prompt, content, maxTokens = 1024) => {
  const messages = [{ role: 'user', content: [
    { type: 'text', text: prompt + '\n\n' + content, cache_control: { type: 'ephemeral' } }
  ]}]
  const data = await callClaude(messages, { maxTokens })
  return data.content?.[0]?.text || ''
}

// Convenience: PDF/image/text file + prompt → text back.
export const extractFromFile = async (prompt, fileContent, fileType, maxTokens = 1024) => {
  let msgContent
  if (fileType === 'application/pdf') {
    msgContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileContent }, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: prompt },
    ]
  } else if (fileType.startsWith('image/')) {
    msgContent = [
      { type: 'image', source: { type: 'base64', media_type: fileType, data: fileContent } },
      { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
    ]
  } else {
    msgContent = [{ type: 'text', text: prompt + '\n\n' + fileContent, cache_control: { type: 'ephemeral' } }]
  }
  const data = await anthropicMessages({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content: msgContent }] })
  return data.content?.[0]?.text || ''
}
