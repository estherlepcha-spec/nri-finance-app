/* eslint-disable react-refresh/only-export-components */
import { CURRENCY_SYMBOLS, CURRENCY_ISO2 } from './constants.js'

// ─── ID & Date Helpers ────────────────────────────────────────────────────────
export const uid     = () => Date.now().toString(36) + Math.random().toString(36).slice(2)
export const today   = () => new Date().toISOString().split('T')[0]
export const maxDate = arr => arr.filter(Boolean).sort().pop() || null
export const fmtDate = d => d
  ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  : null

// ─── Currency Formatting ──────────────────────────────────────────────────────
export const fmt = (n, cur = 'INR') => {
  try {
    const sym = CURRENCY_SYMBOLS[cur]
    if (sym) {
      const abs = Math.abs(n || 0)
      const numStr = cur === 'INR'
        ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(abs)
        : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(abs)
      return `${sym} ${numStr}`
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0)
  } catch { return `${cur} ${(n || 0).toFixed(0)}` }
}

export const fmtConv = (n, cur = 'INR') => {
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency: cur, maximumFractionDigits: cur === 'INR' ? 0 : 2,
    }).format(n || 0)
  } catch { return `${cur} ${(n || 0).toFixed(cur === 'INR' ? 0 : 2)}` }
}

// ─── Flag Component ───────────────────────────────────────────────────────────
export const getCurrencyFlag = currency => {
  const cc = CURRENCY_ISO2[currency]
  return cc ? `https://flagcdn.com/${cc}.svg` : null
}

export function Flag({ currency, size = 16, style: extraStyle }) {
  const src = getCurrencyFlag(currency)
  if (!src) return (
    <span style={{ fontSize: size * 0.85, color: '#94a3b8', verticalAlign: 'middle', flexShrink: 0, display: 'inline-block', ...extraStyle }}>
      {currency || '?'}
    </span>
  )
  return (
    <img
      src={src}
      width={Math.round(size * 1.5)}
      height={Math.round(size)}
      alt={currency}
      style={{ verticalAlign: 'middle', flexShrink: 0, objectFit: 'cover', borderRadius: 2, display: 'inline-block', ...extraStyle }}
      onError={e => { e.currentTarget.style.display = 'none' }}
    />
  )
}
