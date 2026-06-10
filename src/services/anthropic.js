// ─── Anthropic API Service ─────────────────────────────────────────────────────
// All calls to the Claude AI API are centralised here.

const API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'prompt-caching-2024-07-31',
  'content-type': 'application/json',
  'anthropic-dangerous-direct-browser-access': 'true',
}

const getKey = () => import.meta.env.VITE_ANTHROPIC_API_KEY

export const callClaude = async (messages, { maxTokens = 1024, system = null, model = 'claude-sonnet-4-5' } = {}) => {
  const key = getKey()
  if (!key) throw new Error('API key missing — add VITE_ANTHROPIC_API_KEY to your .env file')

  const body = { model, max_tokens: maxTokens, messages }
  if (system) body.system = system

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { ...DEFAULT_HEADERS, 'x-api-key': key },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `API error ${res.status}`)
  return data
}

// Convenience: call with a simple text prompt and get the text back
export const extractWithPrompt = async (prompt, content, maxTokens = 1024) => {
  const messages = [{ role: 'user', content: [
    { type: 'text', text: prompt + '\n\n' + content, cache_control: { type: 'ephemeral' } }
  ]}]
  const data = await callClaude(messages, { maxTokens })
  return data.content?.[0]?.text || ''
}

// Call with mixed content (PDF document or image + prompt)
export const extractFromFile = async (prompt, fileContent, fileType, maxTokens = 1024) => {
  const key = getKey()
  if (!key) throw new Error('API key missing — add VITE_ANTHROPIC_API_KEY to your .env file')

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

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { ...DEFAULT_HEADERS, 'x-api-key': key },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content: msgContent }] }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || res.statusText)
  return data.content?.[0]?.text || ''
}
