import { maskFinancialIdentifiers } from './aiPrivacy.js'

export const MEMORY_MAX_ITEMS = 50
export const MEMORY_MAX_LENGTH = 500
export const MEMORY_SPECIALISTS = ['general', 'budget', 'goals', 'loans', 'investments', 'remittances']

const CREDENTIAL_PATTERN = /\b(password|passcode|passphrase|one[- ]time code|verification code|otp|cvv|cvc|security answer|pin|card number|account number|iban)\b/i

export function normalizeMemoryContent(value) {
  if (typeof value !== 'string') throw new Error('Memory must be plain text.')
  const content = maskFinancialIdentifiers(value).trim()
  if (!content) throw new Error('Enter a memory before saving.')
  if (content.length > MEMORY_MAX_LENGTH) throw new Error(`Memories must be ${MEMORY_MAX_LENGTH} characters or fewer.`)
  if (CREDENTIAL_PATTERN.test(content)) throw new Error('Do not save passwords, codes, card/account numbers, or other credentials as memory.')
  return content
}

export function selectRelevantMemories(memories, specialist, limit = 8) {
  if (!Array.isArray(memories) || !MEMORY_SPECIALISTS.includes(specialist)) return []
  const selected = []
  let totalLength = 0
  const relevant = memories.filter(memory => memory && (memory.specialist === 'general' || memory.specialist === specialist))
  const ordered = [
    ...relevant.filter(memory => memory.specialist === specialist && specialist !== 'general'),
    ...relevant.filter(memory => memory.specialist === 'general'),
  ]
  for (const memory of ordered) {
    if (selected.length >= limit || totalLength + memory.content.length > 3000) break
    selected.push({ content: memory.content, specialist: memory.specialist })
    totalLength += memory.content.length
  }
  return selected
}
