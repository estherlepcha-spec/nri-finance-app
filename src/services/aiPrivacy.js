const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){10,30}\b/gi
const LONG_DIGIT_SEQUENCE_PATTERN = /\b(?:\d[ -]?){8,}\d\b/g

export function lastFourOnly(value) {
  if (value == null) return null
  const digits = String(value).replace(/\D/g, '')
  return digits ? digits.slice(-4) : null
}

export function maskFinancialIdentifiers(value) {
  if (typeof value !== 'string' || !value) return value
  return value
    .replace(IBAN_PATTERN, match => `•••• ${lastFourOnly(match)}`)
    .replace(LONG_DIGIT_SEQUENCE_PATTERN, match => `•••• ${lastFourOnly(match)}`)
}

export function sanitizeAccounts(accounts) {
  if (!Array.isArray(accounts)) return accounts
  return accounts.map(account => account && typeof account === 'object'
    ? { ...account, accountNumber: lastFourOnly(account.accountNumber) }
    : account)
}
