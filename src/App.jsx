import { useState, useEffect, useRef, useCallback } from 'react'
import { anthropicMessages } from './services/anthropic.js'
import * as XLSX from 'xlsx'
import './App.css'

// ─── Extracted modules ────────────────────────────────────────────────────────
import SetupWizardComponent from './components/SetupWizard/index.jsx'
import FamilyComponent from './components/Family/index.jsx'

// ─── Utilities ───────────────────────────────────────────────────────────────
const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(key)
    if (v == null) return fallback
    const parsed = JSON.parse(v)
    // Return fallback if stored null/undefined but caller expects an array or object
    if (parsed == null && fallback != null) return fallback
    return parsed
  } catch { return fallback }
}
// Sync layer — uses Supabase for cloud persistence + localStorage as cache
let _syncPush = null
const _remoteKeys = new Set()
const persist = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
  if (!_remoteKeys.has(key)) _syncPush?.(key, val)
}
// Debounced Supabase push
const _supabaseQueue = {}
let _supabaseTimer = null
const supabasePush = (key, val) => {
  _supabaseQueue[key] = val
  clearTimeout(_supabaseTimer)
  _supabaseTimer = setTimeout(async () => {
    const batch = { ..._supabaseQueue }
    Object.keys(batch).forEach(k => delete _supabaseQueue[k])
    const { saveToSupabase } = await import('./supabase.js')
    for (const [k, v] of Object.entries(batch)) {
      saveToSupabase(k, v)
    }
  }, 1000)
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2)
const today = () => new Date().toISOString().split('T')[0]
const maxDate = arr => arr.filter(Boolean).sort().pop() || null
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

// ─── Balance Calculation Helpers ──────────────────────────────────────────────
// These are pure functions — they take accounts/transactions arrays as params.
// setupBalance is the account balance at setupDate (immutable after creation).
// All transaction effects since setupDate are layered on top to derive any point-in-time balance.

const calcTxDelta = (t, isCC) => {
  const amt = Math.abs(t.amount || 0)
  // CC: income (payment) decreases balance, expense (purchase) increases balance
  // Regular: income increases balance, expense decreases balance
  return isCC ? (t.type === 'income' ? -amt : amt) : (t.type === 'income' ? amt : -amt)
}

const getAccountBalanceAtDate = (accs, txs, accountId, date) => {
  const acc = accs.find(a => a.id === accountId)
  if (!acc) return 0
  const setupBal = acc.setupBalance ?? 0
  const isCC = acc.type === 'Credit Card'
  return txs
    .filter(t => t.accountId === accountId && t.date && t.date <= date)
    .reduce((bal, t) => bal + calcTxDelta(t, isCC), setupBal)
}

const getOpeningBalance = (accs, txs, accountId, month) => {
  const [yr, mo] = month.split('-').map(Number)
  // Last day of previous month
  const prevDate = new Date(yr, mo - 1, 0).toISOString().split('T')[0]
  return getAccountBalanceAtDate(accs, txs, accountId, prevDate)
}

const getClosingBalance = (accs, txs, accountId, month) => {
  const [yr, mo] = month.split('-').map(Number)
  // Last day of month
  const lastDate = new Date(yr, mo, 0).toISOString().split('T')[0]
  return getAccountBalanceAtDate(accs, txs, accountId, lastDate)
}

// Recompute every account's live balance from setupBalance + all transactions.
// Call this after any transaction add/edit/delete to keep balance in sync.
const recomputeAllBalances = (accs, txs) =>
  accs.map(acc => {
    if (acc.setupBalance === undefined) return acc
    const isCC = acc.type === 'Credit Card'
    const balance = txs
      .filter(t => t.accountId === acc.id)
      .reduce((bal, t) => bal + calcTxDelta(t, isCC), acc.setupBalance)
    return { ...acc, balance }
  })

const HOME_CURRENCIES    = ['INR', 'PKR', 'BDT', 'LKR', 'PHP', 'NPR']
const FOREIGN_CURRENCIES = ['KWD', 'AED', 'SAR', 'QAR', 'OMR', 'BHD', 'USD', 'GBP', 'EUR']
const getAccountCountry = (currency) => {
  if (HOME_CURRENCIES.includes(currency))    return 'home'
  if (FOREIGN_CURRENCIES.includes(currency)) return 'foreign'
  return 'home'
}

const CURRENCY_SYMBOLS = { KWD: 'KD', BHD: 'BD', OMR: 'OMR', QAR: 'QR', SAR: 'SR', AED: 'AED', USD: '$', EUR: '€', GBP: '£', INR: '₹', PHP: '₱', NPR: 'रू', PKR: '₨', BDT: '৳', LKR: 'Rs' }
const fmt = (n, cur = 'INR') => {
  try {
    const sym = CURRENCY_SYMBOLS[cur]
    if (sym) {
      const abs = Math.abs(n || 0)
      const numStr = cur === 'INR'
        ? new Intl.NumberFormat('en-IN',  { maximumFractionDigits: 0 }).format(abs)
        : new Intl.NumberFormat('en-US',  { maximumFractionDigits: 0 }).format(abs)
      return `${sym} ${numStr}`
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0)
  } catch { return `${cur} ${(n || 0).toFixed(0)}` }
}
const fmtConv = (n, cur = 'INR') => {
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency: cur, maximumFractionDigits: cur === 'INR' ? 0 : 2,
    }).format(n || 0)
  } catch { return `${cur} ${(n || 0).toFixed(cur === 'INR' ? 0 : 2)}` }
}

// ─── Constants ───────────────────────────────────────────────────────────────
const GCC_CURRENCIES = ['AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR']
const ARAB_CURRENCIES = ['AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'EGP', 'IQD', 'LBP', 'LYD', 'MAD', 'TND', 'DZD', 'YER', 'MRU', 'DJF']
const GCC_NAMES = { AED: 'UAE Dirham', SAR: 'Saudi Riyal', KWD: 'Kuwaiti Dinar', QAR: 'Qatari Riyal', BHD: 'Bahraini Dinar', OMR: 'Omani Rial' }
const CURRENCY_FULL_NAMES = {
  INR: 'Indian Rupee',
  // GCC
  AED: 'UAE Dirham', SAR: 'Saudi Riyal', KWD: 'Kuwaiti Dinar', QAR: 'Qatari Riyal', BHD: 'Bahraini Dinar', OMR: 'Omani Rial',
  // Other Arab Nations
  JOD: 'Jordanian Dinar', EGP: 'Egyptian Pound', IQD: 'Iraqi Dinar', LBP: 'Lebanese Pound',
  LYD: 'Libyan Dinar', MAD: 'Moroccan Dirham', TND: 'Tunisian Dinar', DZD: 'Algerian Dinar',
  YER: 'Yemeni Rial', MRU: 'Mauritanian Ouguiya', DJF: 'Djiboutian Franc',
  // Americas
  USD: 'US Dollar', CAD: 'Canadian Dollar', MXN: 'Mexican Peso', BRL: 'Brazilian Real', ARS: 'Argentine Peso', CLP: 'Chilean Peso',
  // Europe
  EUR: 'Euro', GBP: 'British Pound', CHF: 'Swiss Franc', NOK: 'Norwegian Krone', SEK: 'Swedish Krona',
  DKK: 'Danish Krone', PLN: 'Polish Zloty', CZK: 'Czech Koruna', HUF: 'Hungarian Forint', RUB: 'Russian Ruble',
  // Asia-Pacific
  JPY: 'Japanese Yen', CNY: 'Chinese Yuan', HKD: 'Hong Kong Dollar', KRW: 'South Korean Won',
  SGD: 'Singapore Dollar', AUD: 'Australian Dollar', NZD: 'New Zealand Dollar', TWD: 'Taiwan Dollar',
  THB: 'Thai Baht', IDR: 'Indonesian Rupiah', PHP: 'Philippine Peso', MYR: 'Malaysian Ringgit', VND: 'Vietnamese Dong',
  // South Asia
  PKR: 'Pakistani Rupee', BDT: 'Bangladeshi Taka', LKR: 'Sri Lankan Rupee', NPR: 'Nepalese Rupee',
  // Middle East (non-Arab)
  ILS: 'Israeli Shekel', TRY: 'Turkish Lira',
  // Africa
  ZAR: 'South African Rand', NGN: 'Nigerian Naira', KES: 'Kenyan Shilling', GHS: 'Ghanaian Cedi', ETB: 'Ethiopian Birr',
}
const CURRENCY_GROUPS = {
  'Indian Rupee': ['INR'],
  'GCC — Gulf States': ['AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR'],
  'Arab Nations': ['JOD', 'EGP', 'IQD', 'LBP', 'LYD', 'MAD', 'TND', 'DZD', 'YER', 'MRU', 'DJF'],
  'Americas': ['USD', 'CAD', 'MXN', 'BRL', 'ARS', 'CLP'],
  'Europe': ['EUR', 'GBP', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'RUB'],
  'Asia-Pacific': ['JPY', 'CNY', 'HKD', 'KRW', 'SGD', 'AUD', 'NZD', 'TWD', 'THB', 'IDR', 'PHP', 'MYR', 'VND'],
  'South Asia': ['PKR', 'BDT', 'LKR', 'NPR'],
  'Middle East': ['ILS', 'TRY'],
  'Africa': ['ZAR', 'NGN', 'KES', 'GHS', 'ETB'],
}
const CURRENCIES = Object.values(CURRENCY_GROUPS).flat()
const HOME_ACCOUNT_TYPES  = ['NRE', 'NRO', 'FCNR', 'Savings Account', 'Current Account', 'Credit Card', 'Fixed Deposit', 'Loan Account', 'Investment Account']
const WORK_ACCOUNT_TYPES  = ['Savings Account', 'Current Account', 'Salary Account', 'Credit Card', 'Loan Account', 'Fixed Deposit', 'Investment Account']
const ACCOUNT_TYPES = [...new Set([...HOME_ACCOUNT_TYPES, ...WORK_ACCOUNT_TYPES])]
const INVESTMENT_TYPES = ['Mutual Fund', 'Fixed Deposit', 'Stocks', 'PPF', 'NPS', 'Real Estate', 'Gold', 'Bonds', 'ETF']
const GOAL_CATEGORIES = ['House', 'Education', 'Retirement', 'Emergency Fund', 'Travel', 'Wedding', 'Business', 'Other']
const GOAL_TYPES = ['Home Down Payment', 'Children Education', 'Emergency Fund', 'Car Purchase', 'Wedding', 'Retirement', 'Travel/Holiday', 'Business Setup', 'Other']
const GOAL_PRIORITIES = ['High', 'Medium', 'Low']
const INVEST_TYPES_SIM = ['Mutual Fund', 'Fixed Deposit', 'Stock Market', 'Gold', 'Mix']
const INVEST_RETURNS = { 'Mutual Fund': 12, 'Fixed Deposit': 7, 'Stock Market': 15, 'Gold': 9, 'Mix': 10 }
const DEFAULT_GOALS = [
  { id: 1, name: 'Home Down Payment',  type: 'Home Down Payment',  target: 2500000, saved: 850000,  currency: 'INR', deadline: '2027-12-31', monthlyContribution: 25000, priority: 'High', notes: 'Apartment in Bangalore' },
  { id: 2, name: 'Emergency Fund',     type: 'Emergency Fund',     target: 5000,    saved: 3200,    currency: 'KWD', deadline: '2026-12-31', monthlyContribution: 300,   priority: 'High', notes: '6 months Kuwait expenses' },
  { id: 3, name: 'Children Education', type: 'Children Education', target: 5000000, saved: 1200000, currency: 'INR', deadline: '2030-06-30', monthlyContribution: 20000, priority: 'High', notes: 'Engineering college fund' },
]
const LOAN_TYPES = ['Home Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Business Loan', 'Other']
const TX_CATEGORY_GROUPS = {
  'Daily Living':      ['Rent', 'Groceries', 'Dining', 'Transport', 'Utilities', 'Household'],
  'Family & Personal': ['Healthcare', 'Education', 'Personal Care', 'Shopping', 'Entertainment'],
  'Financial':         ['Remittance', 'Loan EMI', 'Credit Card Bill', 'Insurance', 'Investment', 'Savings'],
  'Work & Travel':     ['Travel', 'Subscription', 'Fees & Charges'],
  'Income':            ['Salary', 'Other Income', 'Rental Income', 'Dividends'],
  'Other':             ['ATM Withdrawal', 'Transfer', 'Other'],
}
const TX_CATS = Object.values(TX_CATEGORY_GROUPS).flat()
const CURRENCY_ISO2 = {
  KWD:'kw', INR:'in', AED:'ae', SAR:'sa', QAR:'qa', OMR:'om', BHD:'bh',
  USD:'us', GBP:'gb', EUR:'eu', SGD:'sg', AUD:'au', CAD:'ca',
  JPY:'jp', CNY:'cn', THB:'th', MYR:'my', PHP:'ph', IDR:'id', HKD:'hk',
  PKR:'pk', BDT:'bd', LKR:'lk', NPR:'np',
  JOD:'jo', EGP:'eg', IQD:'iq', LYD:'ly', MAD:'ma', TND:'tn', IRR:'ir',
  CHF:'ch', NOK:'no', SEK:'se', DKK:'dk', PLN:'pl', CZK:'cz',
  HUF:'hu', RUB:'ru', KRW:'kr', TWD:'tw', VND:'vn',
  ZAR:'za', NGN:'ng', KES:'ke', GHS:'gh', ETB:'et',
  MXN:'mx', BRL:'br', ARS:'ar', CLP:'cl', ILS:'il', TRY:'tr',
}
// Returns a flag img element or currency text fallback — use instead of <Flag> when an img tag is needed inline
const getCurrencyFlag = (currency, size = 16) => {
  const cc = CURRENCY_ISO2[currency]
  if (!cc) return null
  return `https://flagcdn.com/${cc}.svg`
}
function Flag({ currency, size = 16, style: extraStyle }) {
  const src = getCurrencyFlag(currency, size)
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
const ALLOCATION_BUCKETS = {
  Essentials:    ['Groceries', 'Dining', 'Transport', 'Utilities', 'Household', 'Healthcare'],
  Remittance:    ['Remittance'],
  Investments:   ['Investment', 'Savings'],
  Discretionary: ['Shopping', 'Entertainment', 'Personal Care', 'Travel', 'Subscription'],
  Bills:         ['Loan EMI', 'Credit Card Bill', 'Insurance', 'Fees & Charges'],
  Buffer:        ['Other', 'ATM Withdrawal'],
}
const DEFAULT_BUDGETS = {
  Groceries: 15000, Dining: 8000, Transport: 5000, Utilities: 4000, Household: 3000,
  Healthcare: 5000, Education: 10000, 'Personal Care': 3000, Shopping: 8000, Entertainment: 3000,
  Remittance: 50000, 'Loan EMI': 20000, 'Credit Card Bill': 10000, Insurance: 3000, Investment: 20000, Savings: 15000,
  Travel: 10000, Subscription: 2000, 'Fees & Charges': 1000,
  Salary: 0, 'Other Income': 0, 'Rental Income': 0, Dividends: 0,
  'ATM Withdrawal': 5000, Transfer: 0, Other: 3000,
}
const RELATIONS = ['Parent', 'Spouse', 'Sibling', 'Child', 'In-laws', 'Relative', 'Other']
const BILL_FREQS = ['Weekly', 'Monthly', 'Quarterly', 'Yearly', 'One-time']
const BILL_CATS = ['Utilities', 'Rent', 'Insurance', 'Subscription', 'Internet', 'Phone', 'EMI', 'Other']
const REMIT_PURPOSES = ['Family Support', 'Property Purchase', 'Investment', 'Medical', 'Education', 'Business', 'Other']

const DEFAULT_WK_BUDGETS = [
  { id: 'wk-rent',       name: 'Rent',          limit: 250 },
  { id: 'wk-groc',       name: 'Groceries',     limit: 150 },
  { id: 'wk-dining',     name: 'Dining',         limit: 80 },
  { id: 'wk-transport',  name: 'Transport',      limit: 60 },
  { id: 'wk-health',     name: 'Healthcare',     limit: 40 },
  { id: 'wk-care',       name: 'Personal Care',  limit: 30 },
  { id: 'wk-entertain',  name: 'Entertainment',  limit: 50 },
  { id: 'wk-shopping',   name: 'Shopping',       limit: 80 },
  { id: 'wk-sub',        name: 'Subscription',   limit: 15 },
  { id: 'wk-fees',       name: 'Fees & Charges', limit: 10 },
  { id: 'wk-travel',     name: 'Travel',         limit: 100 },
  { id: 'wk-other',      name: 'Other',          limit: 30 },
]
const DEFAULT_HM_BUDGETS = [
  { id: 'hm-homeloan',   name: 'Home Loan EMI',      limit: 35000 },
  { id: 'hm-electricity',name: 'Electricity',         limit: 5000 },
  { id: 'hm-water',      name: 'Water Bill',          limit: 1000 },
  { id: 'hm-internet',   name: 'Internet & Cable',    limit: 2000 },
  { id: 'hm-groceries',  name: 'Groceries (Family)',  limit: 15000 },
  { id: 'hm-school',     name: 'School Fees',         limit: 10000 },
  { id: 'hm-health',     name: 'Healthcare',          limit: 5000 },
  { id: 'hm-insurance',  name: 'Insurance Premium',   limit: 8000 },
  { id: 'hm-household',  name: 'Household',           limit: 5000 },
  { id: 'hm-care',       name: 'Personal Care',       limit: 3000 },
  { id: 'hm-entertain',  name: 'Entertainment',       limit: 2000 },
  { id: 'hm-other',      name: 'Other',               limit: 5000 },
]

// ─── Default Data ─────────────────────────────────────────────────────────────
const DEFAULT_HOME_CURRENCY = 'INR'
const DEFAULT_FOREIGN_CURRENCY = 'KWD'
const DEFAULT_PRIMARY_CURRENCY = 'INR'

const DEFAULT_ACCOUNTS = [
  { id: 'acc-burgan-sav',  name: 'Burgan Bank Savings',   country: 'foreign', type: 'Salary Account', balance: 0, currency: 'KWD', setupBalance: 0, setupDate: today() },
  { id: 'acc-qatar-cc',    name: 'Qatar Credit Card',      country: 'foreign', type: 'Credit Card',    balance: 0, currency: 'KWD', setupBalance: 0, setupDate: today(), creditLimit: 2000 },
  { id: 'acc-visa-cc',     name: 'Visa Credit Card',       country: 'foreign', type: 'Credit Card',    balance: 0, currency: 'KWD', setupBalance: 0, setupDate: today(), creditLimit: 1500 },
  { id: 'acc-sbi-sav',     name: 'SBI Savings Account',   country: 'home',    type: 'NRE',            balance: 0, currency: 'INR', setupBalance: 0, setupDate: today() },
]

const DEFAULT_TRANSACTIONS = []

const DEFAULT_LOANS = []

const DEFAULT_INVESTMENTS = []

const DEFAULT_BILLS = []

const DEFAULT_REMITTANCES = []

const DEFAULT_FAMILY_MEMBERS = []

const DEFAULT_ALLOCATIONS = [
  { id: 'essentials',    name: 'Essentials',    percent: 40, color: '#b8645a' },
  { id: 'remittance',    name: 'Remittance',    percent: 20, color: '#7a92b0' },
  { id: 'investments',   name: 'Investments',   percent: 15, color: '#c9a961' },
  { id: 'savings',       name: 'Savings',       percent: 15, color: '#68a691' },
  { id: 'discretionary', name: 'Discretionary', percent: 7,  color: '#9b7eb5' },
  { id: 'buffer',        name: 'Buffer',        percent: 3,  color: '#7a8a9c' },
]

const DEFAULT_TEMPLATES = []

// ─── Estelle System Prompt ────────────────────────────────────────────────────
const ESTELLE_SYSTEM_PROMPT = `You are Estelle, a sassy, witty and genuinely caring personal finance AI best friend for NRIs and expats. You are like that one brilliant friend who happens to know everything about money but never makes you feel stupid about it.

YOUR PERSONALITY:
- Sassy but never mean. Think of a best friend who tells you the truth with love and humour.
- Use playful language, puns, and emojis but stay professional enough to be trusted.
- You celebrate wins enthusiastically 🎉
- You call out bad decisions with humour not judgment: "Honey, KD 270 on shopping in ONE month? We need to talk..."
- You use relatable metaphors and comparisons
- You are direct. No fluff. No corporate speak.
- You remember context from earlier in the chat
- You speak like a real person not a robot

YOUR ROLE:
- Best friend who happens to be a finance genius
- You know the user's full financial picture
- You give REAL advice based on REAL numbers
- You celebrate progress and gently roast overspending with humour
- You explain complex finance simply
- You help make purchase decisions wisely

PURCHASE ADVICE — when user shows you something to buy, analyse:
1. What is it and estimated price range
2. Which budget category it belongs to
3. Current budget status for that category
4. Whether they can afford it without affecting goals
5. Your honest verdict:
   ✅ "Go for it, you deserve it!" (well within budget, good health)
   🤔 "Hmm, let me think about this..." (borderline — give conditions)
   ⚠️ "Girl/Friend, maybe wait on this one..." (over budget but not critical)
   🚫 "Absolutely not right now, and I say that with love." (seriously over budget)

FINANCIAL EXPLANATION STYLE:
- Simple analogies everyone understands
- Celebrate good numbers enthusiastically
- Address bad numbers with humour and solutions
- NEVER use jargon without explaining it
- Always end with an actionable tip or encouraging note
- Keep responses concise — max 4 paragraphs with line breaks between them
- Use emojis strategically not excessively

IMPORTANT RULES:
- Always use the user's actual numbers from the context below
- Never make up figures
- If data is missing say so honestly
- Always end responses with either an actionable tip, a follow-up question, or an encouraging note

USER FINANCIAL CONTEXT:
{FINANCIAL_CONTEXT}`

const C = {
  bg: '#060e1a', card: '#0c1929', card2: '#112236', card3: '#162b43',
  border: '#1a3050', borderL: '#254565',
  accent: '#3b82f6', accentL: '#60a5fa', accentD: '#2563eb',
  green: '#10b981', greenL: '#34d399',
  red: '#f43f5e', redL: '#fb7185',
  yellow: '#f59e0b', yellowL: '#fcd34d',
  purple: '#8b5cf6', purpleL: '#a78bfa',
  teal: '#06b6d4', tealL: '#22d3ee',
  gold: '#d4a84b', goldL: '#e8c86e',
  text: '#f0f6ff', textS: '#c4d4e8',
  muted: '#5b7fa6', mutedL: '#7fa3c4',
}

// ─── Scroll-to-top / bottom floating arrows ───────────────────────────────────
// Two filled-yellow triangles fixed at the bottom-right. The up arrow jumps to
// the top of the scrolling main area, the down arrow to the bottom.
function ScrollArrows({ scrollRef, isMobile }) {
  // The actual scrolling element is the page wrapper INSIDE <main> (it has
  // overflowY:auto + height:100%), not <main> itself. Resolve it at click time
  // and fall back through <main>, the document, and window so a click always
  // moves something.
  const getScroller = () => {
    const main = scrollRef?.current
    const inner = main?.querySelector(':scope > div')
    const candidates = [inner, main, document.scrollingElement, document.documentElement]
    return candidates.find(el => el && el.scrollHeight > el.clientHeight + 4) || inner || main
  }
  const scrollTo = pos => {
    const el = getScroller()
    if (!el) return
    el.scrollTo({ top: pos === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' })
  }
  // Bare filled-yellow triangle, no button box/border/background. Rounded
  // corners via stroke-linejoin:round (stroke same colour as fill so the
  // rounding reads as a solid shape, like the reference image).
  const btn = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    display: 'flex', lineHeight: 0, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))',
    transition: 'transform 0.12s',
  }
  const Tri = ({ dir }) => (
    <svg width="15" height="13" viewBox="0 0 30 26" aria-hidden="true">
      <polygon
        points={dir === 'up' ? '15,3 27,23 3,23' : '3,3 27,3 15,23'}
        fill={C.yellow} stroke={C.yellow} strokeWidth="4"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
  return (
    <div style={{
      position: 'fixed', zIndex: 50, display: 'flex', flexDirection: 'column', gap: 6,
      // Mobile: bottom-right just above the nav bar. Desktop: bottom-right above Estelle.
      ...(isMobile ? { right: 18, bottom: 68 } : { right: 20, bottom: 88 }),
    }}>
      <button title="Scroll to top" aria-label="Scroll to top" style={btn}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.88)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        onClick={() => scrollTo('top')}><Tri dir="up" /></button>
      <button title="Scroll to bottom" aria-label="Scroll to bottom" style={btn}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.88)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        onClick={() => scrollTo('bottom')}><Tri dir="down" /></button>
    </div>
  )
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Card({ title, action, children, style: s = {}, accent, lift }) {
  return (
    <div className={lift ? 'card-lift' : ''} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20,
      position: 'relative', overflow: 'hidden', ...s,
    }}>
      {accent && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accent}, ${accent}55, transparent)` }} />}
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          {title && <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function Btn({ onClick, variant = 'primary', children, style: s = {}, disabled, size = 'md' }) {
  const sizes = { sm: { padding: '5px 12px', fontSize: 12 }, md: { padding: '8px 16px', fontSize: 13 }, lg: { padding: '11px 22px', fontSize: 14 } }
  const base = { border: 'none', borderRadius: 9, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, letterSpacing: '-0.01em', display: 'inline-flex', alignItems: 'center', gap: 5, ...sizes[size] }
  const vs = {
    primary: { background: `linear-gradient(135deg, ${C.accent}, ${C.accentD})`, color: '#fff', boxShadow: `0 2px 10px ${C.accent}44` },
    danger:  { background: `linear-gradient(135deg, ${C.red}, #dc2626)`,          color: '#fff', boxShadow: `0 2px 10px ${C.red}44` },
    ghost:   { background: 'transparent', color: C.mutedL, border: `1px solid ${C.border}` },
    success: { background: `linear-gradient(135deg, ${C.green}, #059669)`,        color: '#fff', boxShadow: `0 2px 10px ${C.green}44` },
    subtle:  { background: C.card2, color: C.textS, border: `1px solid ${C.border}` },
  }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...(vs[variant] || vs.primary), ...s }}>{children}</button>
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: C.mutedL, marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = { width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 9, padding: '10px 13px', color: C.text, fontSize: 'var(--input-fs, 13px)', minHeight: 'var(--input-min-h, 40px)', outline: 'none', letterSpacing: '-0.01em', transition: 'border-color 0.15s, box-shadow 0.15s' }

function Input({ label, ...props }) {
  const el = <input style={inputStyle} {...props} />
  return label ? <Field label={label}>{el}</Field> : el
}

function Sel({ label, options, ...props }) {
  const el = (
    <select style={inputStyle} {...props}>
      {options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
  return label ? <Field label={label}>{el}</Field> : el
}

function CurrencySel({ label, exclude = [], ...props }) {
  const el = (
    <select style={inputStyle} {...props}>
      {Object.entries(CURRENCY_GROUPS).map(([group, codes]) => {
        const filtered = codes.filter(c => !exclude.includes(c))
        if (!filtered.length) return null
        return (
          <optgroup key={group} label={group}>
            {filtered.map(code => (
              <option key={code} value={code}>{code} — {CURRENCY_FULL_NAMES[code] || code}</option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
  return label ? <Field label={label}>{el}</Field> : el
}

function CatSel({ label, value, onChange, incomeOnly }) {
  const groups = incomeOnly ? { Income: TX_CATEGORY_GROUPS['Income'] } : TX_CATEGORY_GROUPS
  const el = (
    <select value={value} onChange={onChange} style={inputStyle}>
      {Object.entries(groups).map(([group, cats]) => (
        <optgroup key={group} label={group}>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      ))}
    </select>
  )
  return label ? <Field label={label}>{el}</Field> : el
}

function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(5px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="modal-enter modal-sheet" style={{ background: C.card, border: `1px solid ${C.borderL}`, borderRadius: 18, padding: 26, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, display: 'none' }} className="modal-drag-handle" />
          <h3 style={{ fontSize: 17, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>{title}</h3>
          <button onClick={onClose} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.mutedL, fontSize: 14, cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color = C.accent, icon, trend }) {
  return (
    <div className="card-lift" style={{ background: `linear-gradient(135deg, ${color}12, ${color}06)`, border: `1px solid ${color}2e`, borderRadius: 14, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, ${color}44)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
          <div className="stat-num" style={{ fontSize: 21, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1, wordBreak: 'break-all' }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{sub}</div>}
        </div>
        {icon && <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 6 }}>{icon}</div>}
      </div>
    </div>
  )
}

function Badge({ children, color = C.accent }) {
  return <span style={{ background: color + '1a', color, border: `1px solid ${color}33`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600, display: 'inline-block', letterSpacing: '0.01em' }}>{children}</span>
}

function ProgressBar({ value, max, color = C.accent, height = 7 }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0)
  const barColor = pct >= 100 ? C.green : color
  return (
    <div style={{ background: C.card2, borderRadius: 100, height, overflow: 'hidden' }}>
      <div className="progress-bar" style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)`, borderRadius: 100, boxShadow: `0 0 6px ${barColor}55` }} />
    </div>
  )
}

function Empty({ icon, title, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '52px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.35 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.textS, marginBottom: 6, letterSpacing: '-0.01em' }}>{title}</div>
      <div style={{ fontSize: 12, color: C.muted, maxWidth: 240, margin: '0 auto', lineHeight: 1.6 }}>{sub}</div>
    </div>
  )
}

function IconBtn({ onClick, children, danger }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: danger ? C.red : C.muted, padding: '3px 5px', borderRadius: 6, lineHeight: 1 }}>
      {children}
    </button>
  )
}

function DonutChart({ segments, size = 72, thickness = 11, label }) {
  const total = segments.reduce((s, sg) => s + (sg.value || 0), 0)
  if (!total) return <div style={{ width: size, height: size, borderRadius: '50%', background: C.card2, border: `${thickness}px solid ${C.card3}` }} />
  const cx = 50, cy = 50, r = (100 - thickness) / 2
  const activeSegs = segments.filter(s => s.value > 0)
  let angle = -Math.PI / 2
  const arcs = activeSegs.map(seg => {
    const frac = seg.value / total
    // Single-segment: draw as full circle to avoid degenerate arc
    if (activeSegs.length === 1) return { full: true, color: seg.color }
    const sweep = frac * 2 * Math.PI
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle)
    angle += sweep
    const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, color: seg.color }
  })
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.card2} strokeWidth={thickness} />
        {arcs.map((arc, i) =>
          arc.full
            ? <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={arc.color} strokeWidth={thickness - 1} />
            : <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={thickness - 1} strokeLinecap="butt" />
        )}
      </svg>
      {label && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 1.2, maxWidth: size - thickness * 2 - 4 }}>{label}</div>
      </div>}
    </div>
  )
}

function MiniBarChart({ data, color = C.accent, height = 36 }) {
  const max = Math.max(...data.map(d => d.value || 0), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {data.map((d, i) => (
        <div key={i} title={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
          <div style={{ width: '100%', height: Math.max((d.value / max) * height, d.value > 0 ? 3 : 0), background: color, borderRadius: '3px 3px 0 0', opacity: i === data.length - 1 ? 1 : 0.5 }} />
        </div>
      ))}
    </div>
  )
}

const pg = { padding: 'var(--pg, 24px 28px)', overflowY: 'auto', overflowX: 'hidden', height: '100%', width: '100%', boxSizing: 'border-box' }
const pgTitle = { fontSize: 'var(--title-fs, 24px)', fontWeight: 800, color: C.text, marginBottom: 4, letterSpacing: '-0.03em' }
const grid2 = { display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 12 }
const rowSep = { padding: '12px 0', borderBottom: `1px solid ${C.border}` }
const linkBtn = { background: 'none', border: 'none', color: C.accentL, fontSize: 12, cursor: 'pointer', fontWeight: 600, letterSpacing: '-0.01em' }

// ─── Setup Wizard ─────────────────────────────────────────────────────────────
function SetupWizard({ homeCurrency, setHomeCurrency, foreignCurrency, setForeignCurrency, primaryCurrency, setPrimaryCurrency, exchangeRate, setExchangeRate, onComplete }) {
  const [step, setStep] = useState(0)
  const steps = [
    {
      title: "Welcome to NRI's & Expat's Personal Finance Manager",
      sub: "Let's configure your currencies",
      body: (
        <>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
            As an NRI you manage money across countries. Tell us your currencies to get started.
          </p>
          <CurrencySel label="Home currency (India)" value={homeCurrency} onChange={e => setHomeCurrency(e.target.value)} />
          <CurrencySel label="Foreign currency (country of residence)" value={foreignCurrency} onChange={e => setForeignCurrency(e.target.value)} exclude={['INR']} />
          <CurrencySel label="Primary display currency" value={primaryCurrency} onChange={e => setPrimaryCurrency(e.target.value)} />
        </>
      ),
    },
    {
      title: 'Set Exchange Rate',
      sub: 'Enter today\'s rate — update anytime in Settings',
      body: (
        <>
          <Field label={`1 ${foreignCurrency} = ? ${homeCurrency}`}>
            <input type="number" step="0.01" min="0" value={exchangeRate}
              onChange={e => setExchangeRate(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, fontSize: 20, fontWeight: 700 }} />
          </Field>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>For USD→INR, this is typically 83–85.</p>
        </>
      ),
    },
    {
      title: "You're all set!",
      sub: 'Start tracking your NRI finances',
      body: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <div style={{ background: C.card2, borderRadius: 10, padding: 16, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, color: C.text, display:'flex', alignItems:'center', gap:6 }}><Flag currency={homeCurrency} size={14} />Home: <strong>{homeCurrency}</strong></div>
            <div style={{ fontSize: 13, color: C.text, display:'flex', alignItems:'center', gap:6 }}><Flag currency={foreignCurrency} size={14} />Foreign: <strong>{foreignCurrency}</strong></div>
            <div style={{ fontSize: 13, color: C.text }}>💱 Rate: <strong>1 {foreignCurrency} = {exchangeRate} {homeCurrency}</strong></div>
          </div>
        </div>
      ),
    },
  ]

  const cur = steps[step]
  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div role="img" aria-label="logo" style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 16, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 3px 14px rgba(255,136,0,0.55))' }} />
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.2 }}>NRI's & Expat's<br /><span style={{ fontSize: 14, fontWeight: 600, color: C.mutedL }}>Personal Finance Manager</span></div>
          </div>
          <div style={{ color: C.muted, fontSize: 13 }}>Manage your money across borders — wherever you live and work</div>
          <div style={{ color: C.mutedL, fontSize: 11, marginTop: 6 }}>For Indians • Pakistanis • Filipinos • Bangladeshis • Sri Lankans • Nepalese • and all expats working abroad</div>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.borderL}`, borderRadius: 20, padding: 32, boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 26 }}>
            {steps.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 100, background: i <= step ? C.accent : C.border, transition: 'background 0.3s' }} />
            ))}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 6, letterSpacing: '-0.03em' }}>{cur.title}</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>{cur.sub}</p>
          {cur.body}
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {step > 0 && <Btn variant="ghost" onClick={() => setStep(s => s - 1)} style={{ flex: 1 }}>← Back</Btn>}
            <Btn onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : onComplete()} style={{ flex: 1 }}>
              {step < steps.length - 1 ? 'Continue →' : '🚀 Get Started'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ accounts, transactions, investments, goals, loans, bills, remittances,
  exchangeRate, foreignCurrency, homeCurrency, netWorth, totalINR, totalForeign,
  totalLoanBalance, monthlyEMI, wkBudgets, hmBudgets, budgetMonth, setBudgetMonth, toINR, setActiveTab,
  onOpenImport, lastImport, onAddSalary }) {

  const [dashboardMonth, setDashboardMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const FlagWk = <Flag currency={foreignCurrency} size={16} style={{ marginRight: 4 }} />
  const FlagHm = <Flag currency={homeCurrency} size={16} style={{ marginRight: 4 }} />

  const workAccounts = accounts.filter(a => a.country === 'foreign')
  const homeAccounts = accounts.filter(a => a.country === 'home')
  const workAccIds = new Set(workAccounts.map(a => a.id))
  const homeAccIds = new Set(homeAccounts.map(a => a.id))
  const foreignRate = toINR(1, foreignCurrency) || exchangeRate
  const toForeign = amt => foreignRate > 0 ? amt / foreignRate : 0

  // Cap savings rate between -200% and 100%; return null when income < 10 or rate invalid
  const sanitizeRate = (rate, income) => {
    if (income < 10) return null
    if (rate == null || isNaN(rate) || !isFinite(rate)) return null
    return Math.max(-200, Math.min(100, Math.round(rate * 10) / 10))
  }

  const mon = dashboardMonth
  const monName = new Date(mon + '-02').toLocaleString('default', { month: 'long' })
  const monYear = new Date(mon + '-02').getFullYear()
  const nextMonName = (() => { const d = new Date(mon + '-02'); d.setMonth(d.getMonth() + 1); return d.toLocaleString('default', { month: 'long' }) })()
  const currentMonthStr = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` })()
  const maxMonthStr = (() => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const isCurrentMonth = mon === currentMonthStr
  const isAtMaxMonth = mon >= maxMonthStr
  const isAtMinMonth = mon <= '2024-01'
  const isPastMonth = mon < currentMonthStr
  const isFutureMonth = mon > currentMonthStr
  const getPrevMonthLabel = () => { const [y, m] = mon.split('-').map(Number); return new Date(y, m - 2, 1).toLocaleString('default', { month: 'short' }) }
  const getNextMonthLabel = () => { const [y, m] = mon.split('-').map(Number); return new Date(y, m, 1).toLocaleString('default', { month: 'short' }) }
  const generateMonthOptions = () => {
    const opts = []
    const now = new Date()
    const nextD = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextVal = `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, '0')}`
    opts.push(<option key="next" value={nextVal}>{nextD.toLocaleString('default', { month: 'long', year: 'numeric' })} (upcoming)</option>)
    for (let i = 0; i < 18; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push(<option key={val} value={val}>{d.toLocaleString('default', { month: 'long', year: 'numeric' })}{i === 0 ? ' (current)' : ''}</option>)
    }
    return opts
  }
  const monTx = transactions.filter(t => (t.date || '').startsWith(mon))

  // Opening/Closing balances for country panels
  const wkOpeningBal = workAccounts.reduce((s, a) => s + getOpeningBalance(accounts, transactions, a.id, mon), 0)
  const wkClosingBal = workAccounts.reduce((s, a) => s + getClosingBalance(accounts, transactions, a.id, mon), 0)
  const hmOpeningBal = homeAccounts.reduce((s, a) => s + getOpeningBalance(accounts, transactions, a.id, mon), 0)
  const hmClosingBal = homeAccounts.reduce((s, a) => s + getClosingBalance(accounts, transactions, a.id, mon), 0)

  // Latest transaction date per country — indicates data freshness
  const wkLatestTxDate = maxDate(transactions.filter(t => t.accountId && workAccIds.has(t.accountId)).map(t => t.date))
  const hmLatestTxDate = maxDate(transactions.filter(t => t.accountId && homeAccIds.has(t.accountId)).map(t => t.date))

  // Per-country monthly figures — include labelled income + unlabelled positive-amount entries (e.g. raw bank imports)
  const isCredit = t => t.type === 'income' || (t.amount > 0 && !['income','expense','transfer','remittance'].includes(t.type))
  const wkMonTx = monTx.filter(t => t.accountId && workAccIds.has(t.accountId))
  const hmMonTx = monTx.filter(t => t.accountId && homeAccIds.has(t.accountId))

  // Fallback: transactions with matching currency when no accountId matches
  const wkMonTxFallback = monTx.filter(t => !t.accountId && t.currency && t.currency === foreignCurrency)
  const hmMonTxFallback = monTx.filter(t => !t.accountId && t.currency && t.currency === homeCurrency)
  const allWkTx = [...wkMonTx, ...wkMonTxFallback]
  const allHmTx = [...hmMonTx, ...hmMonTxFallback]

  // Transfers that are NOT true expenses — remittances move money between accounts,
  // credit card payments settle already-counted purchases. Exclude both from expense totals.
  const TRANSFER_CATS = ['Remittance', 'Credit Card Bill', 'Transfer']
  const isTrueExpense = t => (t.type === 'expense' || t.type === 'remittance') && !TRANSFER_CATS.includes(t.category)

  const wkMonIn     = allWkTx.filter(isCredit).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const wkMonEx     = allWkTx.filter(isTrueExpense).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const wkMonSaved  = wkMonIn - wkMonEx
  const wkSavRate   = sanitizeRate(wkMonIn > 0 ? (wkMonSaved / wkMonIn) * 100 : null, wkMonIn)

  const hmMonIn    = allHmTx.filter(isCredit).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const hmMonEx    = allHmTx.filter(isTrueExpense).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const hmMonSaved = hmMonIn - hmMonEx
  const hmSavRate  = sanitizeRate(hmMonIn > 0 ? (hmMonSaved / hmMonIn) * 100 : null, hmMonIn)

  // Home savings including remittances received this month
  const hmRemitsReceived = (remittances || []).filter(r => (r.date || '').startsWith(mon))
    .reduce((sum, r) => sum + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
  const hmTotalAvailable = hmMonIn + hmRemitsReceived
  const hmNetSavings = hmTotalAvailable - hmMonEx
  const hmSavRateAdj = sanitizeRate(hmTotalAvailable > 0 ? (hmNetSavings / hmTotalAvailable) * 100 : null, hmTotalAvailable)

  // Overall rate: direct income (no remittances received) to avoid double-counting
  const totalDirectInINR = toINR(wkMonIn, foreignCurrency) + hmMonIn
  const combinedSavedINR = toINR(wkMonSaved, foreignCurrency) + hmMonSaved
  const rawOverall = totalDirectInINR > 10
    ? (combinedSavedINR / totalDirectInINR) * 100
    : (hmMonIn >= 10 ? (hmMonSaved / hmMonIn) * 100 : null)
  const overallSavRate = sanitizeRate(rawOverall, totalDirectInINR > 10 ? totalDirectInINR : hmMonIn)
  const totalMonInINR = totalDirectInINR

  // Assets & Liabilities
  const wkAssetAccs = workAccounts.filter(a => a.type !== 'Credit Card' && a.type !== 'Loan Account')
  const wkCCAccs    = workAccounts.filter(a => a.type === 'Credit Card')
  const hmAssetAccs = homeAccounts.filter(a => a.type !== 'Credit Card' && a.type !== 'Loan Account')
  const hmCCAccs    = homeAccounts.filter(a => a.type === 'Credit Card')
  const totalAssetsINR = [...wkAssetAccs, ...hmAssetAccs].reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0)
    + investments.reduce((s, i) => s + toINR(i.currentValue || 0, i.currency), 0)
  const totalLiabINR = [...wkCCAccs, ...hmCCAccs].reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0)
    + loans.reduce((s, l) => s + (l.outstanding || 0), 0)
  const computedNetWorth = totalAssetsINR - totalLiabINR

  const wkNetForeign = toForeign(
    wkAssetAccs.reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0)
    - wkCCAccs.reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0)
  )
  const hmNetPos = hmAssetAccs.reduce((s, a) => s + (a.balance || 0), 0)
    - hmCCAccs.reduce((s, a) => s + (a.balance || 0), 0)

  // Last month
  const lastMonDate = new Date(); lastMonDate.setMonth(lastMonDate.getMonth() - 1)
  const lastMon = lastMonDate.toISOString().slice(0, 7)
  const lastMonTx = transactions.filter(t => (t.date || '').startsWith(lastMon))
  const lastWkIn = lastMonTx.filter(t => isCredit(t) && workAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const lastWkEx = lastMonTx.filter(t => (t.type === 'expense' || t.type === 'remittance') && workAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const lastHmIn = lastMonTx.filter(t => isCredit(t) && homeAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const lastHmEx = lastMonTx.filter(t => t.type === 'expense' && homeAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)

  // 6-month average
  const months6 = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7) })
  const avg6wk = months6.reduce((sum, m) => {
    const tx = transactions.filter(t => (t.date || '').startsWith(m))
    const mIn = tx.filter(t => isCredit(t) && workAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const mEx = tx.filter(t => (t.type === 'expense' || t.type === 'remittance') && workAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    return sum + (mIn - mEx)
  }, 0) / 6
  const avg6hm = months6.reduce((sum, m) => {
    const tx = transactions.filter(t => (t.date || '').startsWith(m))
    return sum + tx.filter(t => isCredit(t)  && homeAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
               - tx.filter(t => t.type === 'expense' && homeAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  }, 0) / 6

  // Remittance-adjusted home savings for last month and 6-month avg
  const lastMonRemitsRec = (remittances || []).filter(r => (r.date || '').startsWith(lastMon))
    .reduce((sum, r) => sum + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
  const avg6hmAdj = months6.reduce((sum, m) => {
    const tx = transactions.filter(t => (t.date || '').startsWith(m))
    const mIn = tx.filter(t => t.type === 'income'  && homeAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const mEx = tx.filter(t => t.type === 'expense' && homeAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const mRemits = (remittances || []).filter(r => (r.date || '').startsWith(m))
      .reduce((s, r) => s + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
    return sum + (mIn + mRemits - mEx)
  }, 0) / 6

  // Budget alerts
  const bMon = budgetMonth || mon
  const bMonTx  = transactions.filter(t => t.type === 'expense' && (t.date || '').startsWith(bMon))
  const wkExpTx = bMonTx.filter(t => t.accountId ? workAccIds.has(t.accountId) : t.currency !== homeCurrency)
  const hmExpTx = bMonTx.filter(t => t.accountId ? homeAccIds.has(t.accountId) : t.currency === homeCurrency)
  const aggSpent = (txList, amtFn) => { const m = {}; txList.forEach(t => { const k = (t.category || '').toLowerCase(); m[k] = (m[k] || 0) + amtFn(t) }); return m }
  const wkSp   = aggSpent(wkExpTx, t => t.amount || 0)
  const hmSp   = aggSpent(hmExpTx, t => t.amountINR || t.amount || 0)
  const wkOver = (wkBudgets || []).filter(b => (wkSp[(b.name || '').toLowerCase()] || 0) > b.limit && b.limit > 0)
  const hmOver = (hmBudgets || []).filter(b => (hmSp[(b.name || '').toLowerCase()] || 0) > b.limit && b.limit > 0)

  // Bills
  const todayD  = new Date()
  const daysUntil = b => b.dueDate ? Math.ceil((new Date(b.dueDate) - todayD) / 86400000) : 999
  const urgColor  = d => d <= 3 ? C.red : d <= 7 ? C.yellow : C.green
  const pendingBills = bills.filter(b => !b.paid).sort((a, b) => daysUntil(a) - daysUntil(b)).slice(0, 10)
  const wkBillsList  = pendingBills.filter(b => b.currency && b.currency !== homeCurrency)
  const hmBillsList  = pendingBills.filter(b => !b.currency || b.currency === homeCurrency)

  // Remittances
  const monRemits   = (remittances || []).filter(r => (r.date || '').startsWith(mon))
  const monSent     = monRemits.reduce((s, r) => s + (r.amount || 0), 0)
  const monReceived = monRemits.reduce((s, r) => s + (r.amount || 0) * (r.rate || 0), 0)
  const avgRemitRate = monSent > 0 ? monReceived / monSent : 0

  // Home country expenses for the same month as remittances sent (excluding transfers)
  const hmExpensesThisMonth = allHmTx
    .filter(isTrueExpense)
    .reduce((s, t) => s + Math.abs(t.amount || 0), 0)
  const ytdYear    = new Date().getFullYear().toString()
  const ytdRemits  = (remittances || []).filter(r => (r.date || '').startsWith(ytdYear))
  const ytdSent    = ytdRemits.reduce((s, r) => s + (r.amount || 0), 0)
  const ytdReceived = ytdRemits.reduce((s, r) => s + (r.amount || 0) * (r.rate || 0), 0)

  // Goals
  const priorityOrder = { High: 0, Medium: 1, Low: 2 }
  const top3Goals = [...goals].sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)).slice(0, 3)
  const goalStatus = g => {
    const pct = g.target > 0 ? (g.saved || 0) / g.target * 100 : 0
    if (pct >= 100) return { label: 'Complete ✅', color: C.green }
    if (!g.deadline) return { label: `${pct.toFixed(0)}% saved`, color: C.mutedL }
    const monthsLeft = Math.max(0, (new Date(g.deadline) - todayD) / (1000 * 60 * 60 * 24 * 30))
    const needed = monthsLeft > 0 ? (g.target - (g.saved || 0)) / monthsLeft : Infinity
    const monthly = g.monthlyContribution || 0
    if (needed <= monthly * 1.1) return { label: 'On Track ✅', color: C.green }
    if (needed <= monthly * 1.5) return { label: 'At Risk ⚠️', color: C.yellow }
    return { label: 'Behind 🔴', color: C.red }
  }

  // Financial Health Score
  const savScore   = Math.min(30, Math.max(0, (overallSavRate || 0) * 1.5))
  const efGoal     = goals.find(g => g.type === 'Emergency Fund')
  const efPct      = efGoal && efGoal.target > 0 ? Math.min(100, ((efGoal.saved || 0) / efGoal.target) * 100) : 0
  const efScore    = efPct * 0.2
  const dtiRatio   = totalMonInINR > 0 ? ((monthlyEMI || 0) / totalMonInINR) * 100 : 100
  const dtiScore   = dtiRatio < 20 ? 20 : dtiRatio < 40 ? 10 : 0
  const avgGoalPct = goals.length > 0 ? goals.reduce((s, g) => s + Math.min(100, g.target > 0 ? ((g.saved || 0) / g.target) * 100 : 0), 0) / goals.length : 50
  const goalScoreV = avgGoalPct * 0.15
  const totalBudgetCats = [...(wkBudgets || []), ...(hmBudgets || [])].filter(b => b.limit > 0).length
  const overBudget = wkOver.length + hmOver.length
  const adherenceScore = totalBudgetCats > 0 ? Math.max(0, (1 - overBudget / totalBudgetCats) * 15) : 15
  const healthScore = Math.round(savScore + efScore + dtiScore + goalScoreV + adherenceScore)
  const healthLabel = healthScore >= 80 ? 'Excellent' : healthScore >= 60 ? 'Good' : healthScore >= 40 ? 'Fair' : 'Needs Attention'
  const healthColor = healthScore >= 80 ? C.green : healthScore >= 60 ? C.teal : healthScore >= 40 ? C.yellow : C.red

  const recentTx = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5)

  const srClr = r => r == null ? C.muted  : r >= 20 ? C.green  : r >= 10 ? C.yellow  : C.red
  const srLbl = r => r == null ? 'No salary recorded' : r >= 20 ? '🟢 On Track' : r >= 10 ? '🟡 Review' : '🔴 Low'

  const panelRow = (label, value, sub) => (
    <div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted }}>{sub}</div>}
    </div>
  )

  // Point 1: income debug log
  useEffect(() => {
    console.log('=== INCOME DEBUG ===')
    console.log('All accounts:', accounts.map(a => ({ id: a.id, name: a.name, currency: a.currency, country: a.country })))
    console.log('All income transactions:', transactions.filter(t => t.type === 'income').map(t => {
      const acc = accounts.find(a => a.id === t.accountId)
      return { id: t.id, date: t.date, desc: t.description, amount: t.amount, currency: t.currency, accountId: t.accountId, accountName: acc?.name || 'NOT FOUND', accountCountry: acc?.country || 'UNKNOWN', accountCurrency: acc?.currency || 'UNKNOWN' }
    }))
    console.log('wkMonIn:', wkMonIn, foreignCurrency, '| wkMonEx (display):', wkMonEx, '| wkMonSaved (rate):', wkMonSaved)
    console.log('=== END DEBUG ===')
  }, [accounts, transactions])

  // Month navigation
  const goToPrevMonth = () => {
    if (isAtMinMonth) return
    const [yr, mo] = dashboardMonth.split('-').map(Number)
    const d = new Date(yr, mo - 2, 1)
    const newMon = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    setDashboardMonth(newMon)
    setBudgetMonth?.(newMon)
  }
  const goToNextMonth = () => {
    if (isAtMaxMonth) return
    const [yr, mo] = dashboardMonth.split('-').map(Number)
    const d = new Date(yr, mo, 1)
    const newMon = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    setDashboardMonth(newMon)
    setBudgetMonth?.(newMon)
  }
  const jumpToMonth = val => {
    if (val >= '2024-01' && val <= maxMonthStr) {
      setDashboardMonth(val)
      setBudgetMonth?.(val)
    }
  }

  const getStatCardStyle = (type, value) => {
    if (type === 'networth')  return value >= 0 ? C.gold : C.red
    if (type === 'savings')   return value == null ? C.muted : value >= 20 ? C.green : value >= 10 ? C.yellow : value >= 0 ? '#f97316' : C.red
    if (type === 'loans')     return C.muted
    return srClr(value)
  }

  return (
    <div style={pg}>
      {/* Title + Quick Actions */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h2 style={pgTitle}>Dashboard</h2>
          <div style={{ fontSize:13, color:C.muted }}>Overview of your NRI's & Expat's finances</div>
          <div style={{ fontSize:11, color:C.muted, marginTop:4, display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:C.teal, display:'inline-block' }} />
            <span>Data stored on this device · <strong style={{ color:C.textS }}>{new Date().toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })}</strong></span>
          </div>
          {lastImport && <div style={{ fontSize:11, color:C.muted, marginTop:3, display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:C.green, display:'inline-block' }} />
            Last import: <strong style={{ color:C.textS }}>{lastImport.bankName}</strong> {lastImport.statementMonth} · {lastImport.count} transactions · {lastImport.date}
          </div>}
        </div>
      </div>

      {/* Salary banner — current month: full warning; past: soft note; future: info */}
      {wkMonIn < 10 && isCurrentMonth && (
        <div style={{ background: C.yellow + '14', border: `1px solid ${C.yellow}44`, borderRadius: 12, padding: '11px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.yellow }}>💰 No salary recorded for {monName} {monYear}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Add your {monName} salary to see accurate savings rates</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {onAddSalary && (
              <button onClick={onAddSalary} style={{ background: C.yellow + '22', color: C.yellow, border: `1px solid ${C.yellow}55`, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                + Add {monName} Salary
              </button>
            )}
            <button onClick={() => onOpenImport()} style={{ background: C.accent + '18', color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              Import Statement
            </button>
          </div>
        </div>
      )}
      {wkMonIn < 10 && isPastMonth && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, padding: '6px 12px', background: C.card2, borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.6 }}>ℹ️</span> No salary transaction found in {monName} {monYear}
        </div>
      )}
      {isFutureMonth && (
        <div style={{ fontSize: 11, color: C.teal, marginBottom: 10, padding: '6px 12px', background: C.teal + '11', border: `1px solid ${C.teal}33`, borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>ℹ️</span> Salary not yet received for {monName} {monYear}
        </div>
      )}

      {/* Month navigation */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Monthly Snapshot</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={goToPrevMonth} disabled={isAtMinMonth}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: isAtMinMonth ? '#1a2332' : '#243447', color: isAtMinMonth ? '#3a4a5c' : '#f5f1e8', cursor: isAtMinMonth ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: isAtMinMonth ? 0.4 : 1, transition: 'all 0.2s' }}>
            ◀ {getPrevMonthLabel()}
          </button>
          <button style={{ padding: '6px 18px', borderRadius: 8, border: 'none', background: isCurrentMonth ? `linear-gradient(135deg, ${C.accent}, ${C.teal})` : '#3a4a5c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'default', minWidth: 110, textAlign: 'center', boxShadow: isCurrentMonth ? `0 0 12px ${C.accent}66` : 'none', transition: 'all 0.3s' }}>
            {new Date(mon + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })}
            {isCurrentMonth && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.85, fontStyle: 'italic' }}>now</span>}
          </button>
          <button onClick={goToNextMonth} disabled={isAtMaxMonth}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: isAtMaxMonth ? '#1a2332' : '#243447', color: isAtMaxMonth ? '#3a4a5c' : '#f5f1e8', cursor: isAtMaxMonth ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: isAtMaxMonth ? 0.4 : 1, transition: 'all 0.2s' }}>
            {getNextMonthLabel()} ▶
          </button>
          <select value={mon} onChange={e => jumpToMonth(e.target.value)}
            style={{ background: '#1a2332', color: C.gold, border: `1px solid #3a4a5c`, borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', marginLeft: 4 }}>
            {generateMonthOptions()}
          </select>
        </div>
      </div>

      {/* Past / future month context banner */}
      {(() => {
        const hasMonthData = transactions.some(t => (t.date || '').startsWith(mon))
        const noData = !isCurrentMonth && isPastMonth && !hasMonthData
        return (
          <>
            {noData && (
              <div style={{ background: C.red + '12', border: `1px solid ${C.red}44`, borderRadius: 10, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>
                    📭 No data available for {monName} {monYear}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    No transactions were recorded for this month. Try importing a bank statement for this period.
                  </div>
                </div>
                <button onClick={() => { setDashboardMonth(currentMonthStr); setBudgetMonth?.(currentMonthStr) }}
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, color: C.textS, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  Go to {new Date(currentMonthStr + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })}
                </button>
              </div>
            )}
            {!isCurrentMonth && !noData && (
              <div style={{ background: isPastMonth ? C.card2 : C.teal + '11', border: `1px solid ${isPastMonth ? C.border : C.teal + '44'}`, borderRadius: 10, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isPastMonth ? C.textS : C.teal }}>
                    📅 Viewing: {monName} {monYear} {isPastMonth ? '(past month)' : '(upcoming month)'}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    {isPastMonth ? 'Showing actual transactions and balances from this period.' : 'No transactions yet. Planning mode active — budget limits and goals shown as targets.'}
                  </div>
                </div>
                <button onClick={() => { setDashboardMonth(currentMonthStr); setBudgetMonth?.(currentMonthStr) }}
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, color: C.textS, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  Go to {new Date(currentMonthStr + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })}
                </button>
              </div>
            )}
          </>
        )
      })()}
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-5, repeat(5,1fr))', gap: 10, marginBottom: 16 }}>
        {/* Point 7: Net Worth shows as-of date, gold color — Point 3 */}
        <StatCard label="Net Worth" value={fmt(computedNetWorth)} color={getStatCardStyle('networth', computedNetWorth)} icon="💰" sub={`As of ${monName} ${monYear}`} />
        <StatCard label="Working Savings Rate"
          value={wkSavRate != null ? `${wkSavRate.toFixed(1)}%` : 'No salary'}
          color={getStatCardStyle('savings', wkSavRate)}
          sub={wkMonIn >= 10 ? `${fmt(wkMonSaved, foreignCurrency)} saved · ${fmt(wkMonIn, foreignCurrency)} income` : srLbl(wkSavRate)}
          icon={<Flag currency={foreignCurrency} size={20} />} />
        <StatCard label="Home Savings"
          value={hmTotalAvailable > 0 ? `${hmSavRateAdj != null ? hmSavRateAdj.toFixed(1) + '%' : '—'}` : '—'}
          color={getStatCardStyle('savings', hmSavRateAdj)}
          sub={hmTotalAvailable > 0 ? fmt(hmNetSavings) : 'No income recorded'}
          icon={<Flag currency={homeCurrency} size={20} />} />
        {/* Point 4: Total Loans — neutral grey */}
        <StatCard label="Total Loans" value={fmt(totalLoanBalance || 0)} color={getStatCardStyle('loans', 0)} sub={`${fmt(monthlyEMI || 0)}/mo EMI`} icon="🏦" />
        <StatCard label="Overall Savings"
          value={overallSavRate != null ? `${overallSavRate.toFixed(1)}%` : '—'}
          color={getStatCardStyle('savings', overallSavRate)}
          sub={srLbl(overallSavRate)}
          icon="📊" />
      </div>

      {/* Budget Alerts */}
      {(wkOver.length > 0 || hmOver.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 10, marginBottom: 14 }}>
          {[{ flag: FlagWk, label: 'Working Country', over: wkOver }, { flag: FlagHm, label: 'Home Country', over: hmOver }].map(({ flag, label, over }) => over.length > 0 && (
            <div key={label} style={{ background: C.red + '0e', border: `1px solid ${C.red}33`, borderRadius: 12, padding: '11px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:4, fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 5 }}>⚠️ {flag}{label}: {over.length} over budget</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{over.slice(0, 3).map(b => b.name).join(' · ')}{over.length > 3 ? ` +${over.length - 3} more` : ''}</div>
              <button onClick={() => setActiveTab('budget')} style={linkBtn}>View Budget →</button>
            </div>
          ))}
        </div>
      )}

      {/* Loan Alerts */}
      {loans && loans.length > 0 && (() => {
        const loanAlerts = [
          ...(dtiRatio > 40 ? [{ msg: `⚠️ High debt-to-income: ${dtiRatio.toFixed(0)}% of income goes to EMIs (target <40%)`, color: C.red }] : []),
          ...loans.filter(l => l.principal > 0 && l.outstanding > 0 && ((l.principal - l.outstanding) / l.principal) >= 0.5 && ((l.principal - l.outstanding) / l.principal) < 0.55)
            .map(l => ({ msg: `🎉 Milestone: ${l.name} is 50% repaid!`, color: C.green })),
          ...loans.filter(l => l.remainingMonths > 0 && l.remainingMonths <= 6)
            .map(l => ({ msg: `🏁 ${l.name} completes in ${l.remainingMonths} month${l.remainingMonths !== 1 ? 's' : ''}!`, color: C.teal })),
        ]
        if (!loanAlerts.length) return null
        return (
          <div style={{ marginBottom: 14 }}>
            {loanAlerts.map((a, i) => (
              <div key={i} style={{ background: `${a.color}0e`, border: `1px solid ${a.color}33`, borderRadius: 10, padding: '9px 14px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: a.color, fontWeight: 600 }}>{a.msg}</div>
                <button onClick={() => setActiveTab('loans')} style={linkBtn}>View Loans →</button>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Two Country Panels */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Income & Expenses</span>
        <span style={{ fontSize:11, background:C.teal+'22', color:C.teal, border:`1px solid ${C.teal}44`, borderRadius:20, padding:'2px 10px', fontWeight:700 }}>
          {new Date(mon + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 14, marginBottom: 16 }}>
        {[
          { flag: <Flag currency={foreignCurrency} size={18} />, title: `Working — ${foreignCurrency}`, fullTitle: `${CURRENCY_FULL_NAMES[foreignCurrency] || foreignCurrency}`, color: C.teal,
            monIn: wkMonIn, monEx: wkMonEx, monSaved: wkMonSaved, savRate: wkSavRate,
            inCount: wkMonTx.filter(t => t.type === 'income').length, exCount: wkMonTx.filter(t => t.type === 'expense').length,
            currency: foreignCurrency, accts: workAccounts, netPos: wkNetForeign,
            openBal: wkOpeningBal, closeBal: wkClosingBal, latestTxDate: wkLatestTxDate },
          { flag: <Flag currency={homeCurrency} size={18} />, title: `Home — ${homeCurrency}`, fullTitle: `${CURRENCY_FULL_NAMES[homeCurrency] || homeCurrency}`, color: C.purple,
            monIn: hmTotalAvailable, monEx: hmMonEx, monSaved: hmNetSavings, savRate: hmSavRateAdj,
            inCount: hmMonTx.filter(t => t.type === 'income').length + (hmRemitsReceived > 0 ? 1 : 0), exCount: hmMonTx.filter(t => t.type === 'expense').length,
            currency: homeCurrency, accts: homeAccounts, netPos: hmNetPos, remitsRec: hmRemitsReceived, directIncome: hmMonIn,
            openBal: hmOpeningBal, closeBal: hmClosingBal, latestTxDate: hmLatestTxDate },
        ].map(({ flag, title, fullTitle, color, monIn, monEx, monSaved, savRate, inCount, exCount, currency, accts, netPos, remitsRec = 0, directIncome = 0, openBal, closeBal, latestTxDate }) => (
          <div key={title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, ${color}44)` }} />
            <div style={{ borderBottom: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color, letterSpacing: '-0.01em' }}>{flag} {title}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{fullTitle}</div>
                {latestTxDate && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Last tx: {fmtDate(latestTxDate)}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: srClr(savRate) }}>{savRate != null ? `${savRate.toFixed(1)}%` : '—'}</div>
                <div style={{ fontSize: 10, color: srClr(savRate) }}>{srLbl(savRate)}</div>
              </div>
            </div>
            <div style={{ padding: '14px 18px' }}>
              {/* Opening → Closing balance flow */}
              <div style={{ background: C.card2, borderRadius: 10, padding: '9px 12px', marginBottom: 12, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: C.muted }}>Opening Balance ({monName} 1)</span>
                  <span className="num" style={{ color: C.text, fontWeight: 600 }}>{fmt(openBal, currency)}</span>
                </div>
                {monIn > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: C.muted }}>+ {remitsRec > 0 ? 'Available (incl. remittances)' : 'Income'}</span>
                  <span className="num" style={{ color: C.green, fontWeight: 600 }}>+{fmt(monIn, currency)}</span>
                </div>}
                {monEx > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: C.muted }}>− Expenses</span>
                  <span className="num" style={{ color: C.red, fontWeight: 600 }}>−{fmt(monEx, currency)}</span>
                </div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${C.border}`, paddingTop: 4, marginTop: 3 }}>
                  <div>
                    <span style={{ color: C.muted, fontWeight: 600 }}>Closing Balance</span>
                    <div style={{ fontSize: 9, color: C.accent, marginTop: 1 }}>→ carries to {nextMonName}</div>
                  </div>
                  <span className="num" style={{ color: color, fontWeight: 700 }}>{fmt(closeBal, currency)}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-3, repeat(3,1fr))', gap: 10, marginBottom: 14 }}>
                {[
                  { label: remitsRec > 0 ? 'Available' : 'New Income', value: fmt(monIn, currency), color: C.green, count: `↑ ${inCount}`, sub: remitsRec > 0 ? `${fmt(directIncome, currency)} + ${fmt(remitsRec, currency)} remit` : openBal !== 0 ? `${fmt(openBal, currency)} carried in` : null },
                  { label: 'Expenses', value: fmt(monEx, currency), color: C.red, count: `↓ ${exCount}`, sub: null },
                  { label: 'Carry-Fwd', value: fmt(closeBal, currency), color: closeBal >= 0 ? C.green : C.red, count: `→ ${nextMonName}`, sub: null },
                ].map(({ label, value, color: vc, count, sub }) => (
                  <div key={label} style={{ background: C.card2, borderRadius: 10, padding: '9px 10px' }}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
                    <div className="num" style={{ fontSize: 13, fontWeight: 700, color: vc, letterSpacing: '-0.02em' }}>{value}</div>
                    {count && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{count}</div>}
                    {sub && <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{sub}</div>}
                  </div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Accounts</div>
                {accts.length === 0
                  ? <div style={{ fontSize: 12, color: C.muted }}>No accounts</div>
                  : accts.map(a => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <div style={{ fontSize: 12, color: C.textS, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                      <span className="num" style={{ fontSize: 12, fontWeight: 700, color: a.type === 'Credit Card' ? C.red : (a.balance || 0) >= 0 ? C.greenL : C.red }}>
                        {a.type === 'Credit Card' ? '−' : ''}{fmt(Math.abs(a.balance || 0), a.currency)}
                      </span>
                    </div>
                  ))
                }
                <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 7, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Net Position</span>
                  <span className="num" style={{ fontSize: 14, fontWeight: 800, color: netPos >= 0 ? C.green : C.red }}>{fmt(netPos, currency)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Assets & Liabilities */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 16, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${C.gold}, ${C.gold}44)` }} />
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: '16px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <DonutChart size={68} thickness={10} segments={[
              { value: totalAssetsINR, color: C.green },
              { value: totalLiabINR, color: C.red },
            ]} label="Net Worth" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, letterSpacing: '-0.01em', marginBottom: 2 }}>Total Net Worth</div>
              <div style={{ fontSize: 11, color: C.muted }}>All figures in {homeCurrency}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: C.green }}>● Assets {fmt(totalAssetsINR)}</span>
                <span style={{ fontSize: 11, color: C.red }}>● Liabilities {fmt(totalLiabINR)}</span>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 28, fontWeight: 900, color: computedNetWorth >= 0 ? C.gold : C.red, letterSpacing: '-0.04em' }}>{fmt(computedNetWorth)}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Net = Assets − Liabilities</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)' }}>
          <div style={{ padding: '16px 20px', borderRight: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 12, letterSpacing: '0.5px' }}>ASSETS</div>
            {wkAssetAccs.length > 0 && <>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, display:'flex', alignItems:'center', gap:4 }}>{FlagWk}Working Country</div>
              {wkAssetAccs.map(a => (
                <div key={a.id} style={{ marginBottom: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.text }}>{a.name}</span>
                    <span style={{ color: C.green, fontWeight: 600 }}>{fmt(a.balance || 0, a.currency)}</span>
                  </div>
                  {a.currency !== homeCurrency && <div style={{ fontSize: 10, color: C.muted, textAlign: 'right' }}>≈ {fmt(toINR(a.balance || 0, a.currency))}</div>}
                </div>
              ))}
            </>}
            {hmAssetAccs.length > 0 && <>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, marginTop: 10, display:'flex', alignItems:'center', gap:4 }}>{FlagHm}Home Country</div>
              {hmAssetAccs.map(a => (
                <div key={a.id} style={{ marginBottom: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.text }}>{a.name}</span>
                    <span style={{ color: C.green, fontWeight: 600 }}>{fmt(a.balance || 0, a.currency)}</span>
                  </div>
                </div>
              ))}
            </>}
            {investments.length > 0 && <>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, marginTop: 10 }}>📈 Investments</div>
              {investments.slice(0, 6).map(i => (
                <div key={i.id} style={{ marginBottom: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.text }}>{i.name}</span>
                    <span style={{ color: C.green, fontWeight: 600 }}>{fmt(i.currentValue || 0, i.currency)}</span>
                  </div>
                  {i.currency !== homeCurrency && <div style={{ fontSize: 10, color: C.muted, textAlign: 'right' }}>≈ {fmt(toINR(i.currentValue || 0, i.currency))}</div>}
                </div>
              ))}
              {investments.length > 6 && <div style={{ fontSize: 11, color: C.muted }}>+{investments.length - 6} more investments</div>}
            </>}
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>TOTAL ASSETS</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.green }}>{fmt(totalAssetsINR)}</span>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 12, letterSpacing: '0.5px' }}>LIABILITIES</div>
            {(() => {
              const wkLoansL = loans.filter(l => l.country === 'foreign')
              const hmLoansL = loans.filter(l => l.country !== 'foreign')
              const hasWk = wkCCAccs.length > 0 || wkLoansL.length > 0
              const hasHm = hmCCAccs.length > 0 || hmLoansL.length > 0
              const LoanRow = ({ l }) => (
                <div key={l.id} style={{ marginBottom: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.text }}>{l.name}</span>
                    <span style={{ color: C.red, fontWeight: 600 }}>−{fmt(l.outstanding || 0, l.currency)}</span>
                  </div>
                  {l.currency !== homeCurrency && <div style={{ fontSize: 10, color: C.muted, textAlign: 'right' }}>≈ −{fmt(toINR(l.outstanding || 0, l.currency))}</div>}
                  <div style={{ fontSize: 10, color: C.muted, textAlign: 'right' }}>{fmt(l.emi || 0, l.currency)}/mo EMI</div>
                </div>
              )
              return <>
                {hasWk && <>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, display:'flex', alignItems:'center', gap:4 }}>{FlagWk}Working Country</div>
                  {wkCCAccs.map(a => (
                    <div key={a.id} style={{ marginBottom: 7 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: C.text }}>{a.name}</span>
                        <span style={{ color: C.red, fontWeight: 600 }}>−{fmt(a.balance || 0, a.currency)}</span>
                      </div>
                      {a.currency !== homeCurrency && <div style={{ fontSize: 10, color: C.muted, textAlign: 'right' }}>≈ −{fmt(toINR(a.balance || 0, a.currency))}</div>}
                    </div>
                  ))}
                  {wkLoansL.map(l => <LoanRow key={l.id} l={l} />)}
                </>}
                {hasHm && <>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, marginTop: hasWk ? 10 : 0, display:'flex', alignItems:'center', gap:4 }}>{FlagHm}Home Country</div>
                  {hmCCAccs.map(a => (
                    <div key={a.id} style={{ marginBottom: 7 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: C.text }}>{a.name}</span>
                        <span style={{ color: C.red, fontWeight: 600 }}>−{fmt(a.balance || 0, a.currency)}</span>
                      </div>
                    </div>
                  ))}
                  {hmLoansL.map(l => <LoanRow key={l.id} l={l} />)}
                </>}
              </>
            })()}
            {wkCCAccs.length === 0 && hmCCAccs.length === 0 && loans.length === 0 && (
              <div style={{ fontSize: 12, color: C.muted }}>No liabilities recorded</div>
            )}
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>TOTAL LIABILITIES</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.red }}>−{fmt(totalLiabINR)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Goals Progress */}
      {top3Goals.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 16, padding: '18px 22px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${C.accent}, ${C.purple})` }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>🎯 Savings Goals</div>
            <button onClick={() => setActiveTab('goals')} style={linkBtn}>View All →</button>
          </div>
          {top3Goals.map((g, idx) => {
            const pct = g.target > 0 ? Math.min(100, ((g.saved || 0) / g.target) * 100) : 0
            const status = goalStatus(g)
            const deadline = g.deadline ? new Date(g.deadline).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : null
            const barColor = pct >= 100 ? C.green : pct >= 50 ? C.accent : C.yellow
            return (
              <div key={g.id} style={{ marginBottom: idx < top3Goals.length - 1 ? 16 : 0, paddingBottom: idx < top3Goals.length - 1 ? 16 : 0, borderBottom: idx < top3Goals.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: '-0.01em' }}>{g.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: status.color }}>{status.label}</span>
                </div>
                <ProgressBar value={g.saved || 0} max={g.target} color={barColor} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginTop: 5 }}>
                  <span className="num">{fmt(g.saved || 0, g.currency)} <span style={{ color: C.muted }}>of</span> {fmt(g.target, g.currency)} <span style={{ color: barColor, fontWeight: 700 }}>({pct.toFixed(0)}%)</span></span>
                  <span>{deadline ? `By ${deadline}` : ''}{g.monthlyContribution > 0 ? ` · ${fmt(g.monthlyContribution, g.currency)}/mo` : ''}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Savings Summary + Remittance + Health */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 16 }}>
        <Card title="Savings Summary" action={<button onClick={() => setActiveTab('trends')} style={linkBtn}>Trends →</button>}>
          {[
            { label: 'This Month', wk: wkMonSaved, hm: hmNetSavings },
            { label: 'Last Month', wk: lastWkIn - lastWkEx, hm: lastHmIn + lastMonRemitsRec - lastHmEx },
            { label: '6-Mo Avg/mo', wk: avg6wk, hm: avg6hmAdj },
            { label: 'Proj. Annual', wk: avg6wk * 12, hm: avg6hmAdj * 12 },
          ].map(({ label, wk, hm }) => (
            <div key={label} style={{ background: C.card2, borderRadius: 10, padding: '9px 12px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, minWidth: 80 }}>{label}</div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:2 }}><Flag currency={foreignCurrency} size={12} /></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: wk >= 0 ? C.green : C.red }}>{fmt(wk, foreignCurrency)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:2 }}><Flag currency={homeCurrency} size={12} /></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: hm >= 0 ? C.green : C.red }}>{fmt(hm, homeCurrency)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: C.muted }}>Combined</div>
                  <div style={{ fontSize: 11, color: C.muted }}>≈ {fmt(Math.round(toINR(wk, foreignCurrency) + hm))}</div>
                </div>
              </div>
            </div>
          ))}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Remittance */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10, letterSpacing: '-0.01em' }}>💸 Remittances This Month</div>
            {monRemits.length === 0
              ? <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>No remittances this month</div>
              : <>
                {[
                  { label: 'Sent', value: fmt(monSent, foreignCurrency), color: C.textS },
                  { label: 'Received', value: fmt(monReceived), color: C.green },
                  { label: 'Avg Rate', value: `1 ${foreignCurrency} = ${fmt(avgRemitRate)}`, color: C.mutedL },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                    <span style={{ color: C.muted }}>{label}</span><span className="num" style={{ color, fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
                {hmExpensesThisMonth > 0 && (
                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>🏠 Home Expenses ({monName})</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: C.muted }}>Total Spent</span>
                      <span className="num" style={{ color: C.red, fontWeight: 600 }}>{fmt(hmExpensesThisMonth, homeCurrency)}</span>
                    </div>
                    {monReceived > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                        <span style={{ color: C.muted }}>Remittance Coverage</span>
                        <span className="num" style={{ color: monReceived >= hmExpensesThisMonth ? C.green : C.yellow, fontWeight: 600 }}>
                          {Math.round((monReceived / hmExpensesThisMonth) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            }
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 8 }}>
              <div style={{ fontSize: 11, color: C.muted }}>YTD Sent: <strong className="num" style={{ color: C.textS }}>{fmt(ytdSent, foreignCurrency)}</strong></div>
              <div style={{ fontSize: 11, color: C.muted }}>≈ <span className="num">{fmt(ytdReceived)}</span> received</div>
            </div>
            <button onClick={() => setActiveTab('remittances')} style={{ ...linkBtn, marginTop: 8, display: 'block' }}>View All →</button>
          </div>

          {/* Financial Health Score */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${healthColor}, ${healthColor}44)` }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12, letterSpacing: '-0.01em' }}>💪 Financial Health</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
              <div style={{ position: 'relative' }}>
                <DonutChart size={64} thickness={9} segments={[
                  { value: healthScore, color: healthColor },
                  { value: 100 - healthScore, color: C.card2 },
                ]} label={`${healthScore}`} />
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900, color: healthColor, letterSpacing: '-0.04em', lineHeight: 1 }}>{healthScore}<span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>/100</span></div>
                <div style={{ fontSize: 13, fontWeight: 700, color: healthColor, marginTop: 3 }}>{healthLabel}</div>
              </div>
            </div>
            {[
              { label: 'Savings rate', s: savScore, max: 30, ok: (overallSavRate || 0) >= 20 },
              { label: 'Emergency fund', s: efScore, max: 20, ok: efPct >= 100 },
              { label: 'Debt ratio', s: dtiScore, max: 20, ok: dtiRatio < 20 },
              { label: 'Goals progress', s: goalScoreV, max: 15, ok: avgGoalPct >= 50 },
              { label: 'Budget adherence', s: adherenceScore, max: 15, ok: overBudget === 0 },
            ].map(({ label, s, max, ok }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: C.muted }}>{ok ? '✅' : '⚠️'} {label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 50, height: 4, background: C.card2, borderRadius: 100, overflow: 'hidden' }}>
                    <div style={{ width: `${(s / max) * 100}%`, height: '100%', background: ok ? C.green : C.yellow, borderRadius: 100 }} />
                  </div>
                  <span style={{ fontSize: 10, color: ok ? C.green : C.yellow, fontWeight: 600 }}>{s.toFixed(0)}/{max}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bills + Recent Transactions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 14 }}>
        <Card title="Upcoming Bills" action={<button onClick={() => setActiveTab('bills')} style={linkBtn}>View All →</button>}>
          {pendingBills.length === 0
            ? <Empty icon="📋" title="No pending bills" sub="Add recurring bills" />
            : <>
              {wkBillsList.length > 0 && <>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, display:'flex', alignItems:'center', gap:4 }}>{FlagWk}Working Country</div>
                {wkBillsList.map(b => { const d = daysUntil(b); const uc = urgColor(d); return (
                  <div key={b.id} style={{ ...rowSep, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div><div style={{ fontSize: 12, color: C.text }}>{b.name}</div><div style={{ fontSize: 10, color: uc }}>{d <= 0 ? 'Overdue!' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`}</div></div>
                    <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12, fontWeight: 700, color: uc }}>{fmt(b.amount, b.currency)}</div><div style={{ width: 7, height: 7, borderRadius: '50%', background: uc, marginLeft: 'auto', marginTop: 3 }} /></div>
                  </div>
                )})}
              </>}
              {hmBillsList.length > 0 && <>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, marginTop: wkBillsList.length > 0 ? 10 : 0, display:'flex', alignItems:'center', gap:4 }}>{FlagHm}Home Country</div>
                {hmBillsList.map(b => { const d = daysUntil(b); const uc = urgColor(d); return (
                  <div key={b.id} style={{ ...rowSep, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div><div style={{ fontSize: 12, color: C.text }}>{b.name}</div><div style={{ fontSize: 10, color: uc }}>{d <= 0 ? 'Overdue!' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`}</div></div>
                    <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12, fontWeight: 700, color: uc }}>{fmt(b.amount, b.currency || homeCurrency)}</div><div style={{ width: 7, height: 7, borderRadius: '50%', background: uc, marginLeft: 'auto', marginTop: 3 }} /></div>
                  </div>
                )})}
              </>}
            </>
          }
        </Card>

        <Card title="Recent Transactions" action={<button onClick={() => setActiveTab('transactions')} style={linkBtn}>View All →</button>}>
          {recentTx.length === 0
            ? <Empty icon="↕" title="No transactions" sub="Add income and expenses" />
            : recentTx.map(t => {
              const acct = accounts.find(a => a.id === t.accountId)
              const txCur = acct ? acct.currency : t.currency
              return (
                <div key={t.id} style={{ ...rowSep, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || t.category}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{t.date} · {t.category}{acct ? ` · ${acct.name}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right', marginLeft: 8, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.type === 'income' ? C.green : C.red }}>
                      {t.type === 'income' ? '+' : '−'}{fmt(t.amount || 0, txCur)}
                    </div>
                    {txCur !== homeCurrency && <div style={{ fontSize: 10, color: C.muted }}>≈ {fmt(toINR(t.amount || 0, txCur))}</div>}
                  </div>
                </div>
              )
            })
          }
        </Card>
      </div>
    </div>
  )
}

// ─── Accounts ─────────────────────────────────────────────────────────────────
function Accounts({ accounts, setAccounts, transactions, setTransactions, remittances, foreignCurrency, homeCurrency, exchangeRate, toINR, onOpenImport }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const blank = { name: '', type: 'Savings Account', country: 'foreign', currency: foreignCurrency, balance: '', bank: '', accountNumber: '', creditLimit: '', dueDay: '', minPayment: '', apr: '' }
  const [form, setForm] = useState(blank)
  const f = k => e => {
    const val = e.target.value
    if (k === 'currency') {
      setForm(p => ({ ...p, currency: val, country: getAccountCountry(val) }))
    } else {
      setForm(p => ({ ...p, [k]: val }))
    }
  }

  const isCC = form.type === 'Credit Card'
  const accountTypeOptions = form.country === 'home' ? HOME_ACCOUNT_TYPES : WORK_ACCOUNT_TYPES

  const save = () => {
    if (!form.name || form.balance === '') return
    const parsedBal = parseFloat(form.balance) || 0
    const item = {
      ...form,
      balance: parsedBal,
      creditLimit: parseFloat(form.creditLimit) || 0,
      minPayment: parseFloat(form.minPayment) || 0,
      apr: parseFloat(form.apr) || 0,
      dueDay: parseInt(form.dueDay) || 0,
      id: editing?.id || uid(),
      // setupBalance is immutable after first creation; preserve it on edit
      setupBalance: editing?.setupBalance ?? parsedBal,
      setupDate: editing?.setupDate ?? today(),
    }
    setAccounts(p => editing ? p.map(a => a.id === editing.id ? item : a) : [...p, item])
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const del = id => { if (confirm('Delete this account?')) setAccounts(p => p.filter(a => a.id !== id)) }
  const edit = a => { setForm({ ...blank, ...a, balance: String(a.balance), creditLimit: String(a.creditLimit || ''), minPayment: String(a.minPayment || ''), apr: String(a.apr || ''), dueDay: String(a.dueDay || '') }); setEditing(a); setShowAdd(true) }

  const total = accounts.filter(a => a.type !== 'Credit Card').reduce((s, a) => s + toINR(a.balance, a.currency), 0)
  const totalDebt = accounts.filter(a => a.type === 'Credit Card').reduce((s, a) => s + toINR(a.balance, a.currency), 0)

  // Per-country breakdown (assets, credit-card debt, net worth) expressed in
  // that country's own currency. Each account is summed in its native currency
  // when it matches the country currency; any odd-currency account is converted
  // INR → the country currency so the totals stay in one unit.
  const toCur = (amount, fromCur, targetCur) => {
    if (fromCur === targetCur) return amount || 0
    const inr = toINR(amount || 0, fromCur)
    // convert INR → targetCur (inverse of toINR for the target)
    if (targetCur === 'INR') return inr
    return inr / (toINR(1, targetCur) || 1)
  }
  const countryTotals = (accs, cur) => {
    const assets = accs.filter(a => a.type !== 'Credit Card')
      .reduce((s, a) => s + toCur(a.balance, a.currency, cur), 0)
    const debt = accs.filter(a => a.type === 'Credit Card')
      .reduce((s, a) => s + toCur(a.balance, a.currency, cur), 0)
    return { assets, debt, net: assets - debt }
  }

  const typeColor = t => {
    if (t === 'NRE') return C.accent
    if (t === 'NRO') return C.yellow
    if (t === 'FCNR') return C.purple
    if (t === 'Credit Card') return C.red
    if (t === 'Salary Account') return C.green
    return C.teal
  }

  const homeAccounts = accounts.filter(a => a.country === 'home')
  const workAccounts = accounts.filter(a => a.country === 'foreign')

  const [reconcileAcct, setReconcileAcct] = useState(null)
  const [reconcileInput, setReconcileInput] = useState('')
  const [auditAcct, setAuditAcct] = useState(null)

  const AccountCard = ({ a }) => {
    const isCard = a.type === 'Credit Card'
    const available = isCard ? (a.creditLimit || 0) - (a.balance || 0) : null
    const tc = typeColor(a.type)
    const utilPct = isCard && a.creditLimit > 0 ? Math.min(100, ((a.balance || 0) / a.creditLimit) * 100) : 0

    const curMonth = new Date().toISOString().slice(0, 7)
    const [cmYr, cmMo] = curMonth.split('-').map(Number)
    const curMonName = new Date(cmYr, cmMo - 1).toLocaleString('default', { month: 'long' })
    const nextMonLabel = new Date(cmYr, cmMo).toLocaleString('default', { month: 'long' })
    const opening = getOpeningBalance(accounts, transactions, a.id, curMonth)
    const closing = getClosingBalance(accounts, transactions, a.id, curMonth)
    const monIn  = transactions.filter(t => t.accountId === a.id && t.type === 'income'  && (t.date||'').startsWith(curMonth)).reduce((s,t) => s + Math.abs(t.amount||0), 0)
    const monEx  = transactions.filter(t => t.accountId === a.id && t.type !== 'income'  && (t.date||'').startsWith(curMonth)).reduce((s,t) => s + Math.abs(t.amount||0), 0)
    const prevMonth = (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7) })()
    const acctLatestTx = maxDate(transactions.filter(t => t.accountId === a.id).map(t => t.date))
    const prevOpen = getOpeningBalance(accounts, transactions, a.id, prevMonth)
    const prevClose = getClosingBalance(accounts, transactions, a.id, prevMonth)

    return (
      <Card lift accent={tc}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge color={tc}>{a.type}</Badge>
            <Badge color={a.country === 'home' ? C.purple : C.teal}><Flag currency={a.currency} size={13} /></Badge>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <IconBtn onClick={() => { setReconcileAcct(a); setReconcileInput('') }} title="Reconcile balance">🔍</IconBtn>
            <IconBtn onClick={() => edit(a)}>✏️</IconBtn>
            <IconBtn onClick={() => del(a.id)} danger>🗑️</IconBtn>
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2, letterSpacing: '-0.02em' }}>{a.name}</div>
        {a.bank && <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>{a.bank}{a.accountNumber ? ` · ****${String(a.accountNumber).slice(-4)}` : ''}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: C.muted }}>Current Balance</span>
          {acctLatestTx
            ? <span style={{ fontSize: 10, color: C.muted }}>Last tx: <span style={{ color: C.accent }}>{fmtDate(acctLatestTx)}</span></span>
            : <span style={{ fontSize: 10, color: C.muted, fontStyle: 'italic' }}>No transactions yet</span>}
        </div>
        <div className="num" style={{ fontSize: 26, fontWeight: 900, color: isCard ? C.red : C.green, letterSpacing: '-0.04em' }}>
          {isCard ? '−' : ''}{fmt(a.balance, a.currency)}
        </div>
        {a.currency !== 'INR' && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>≈ <span className="num">{fmt(toINR(a.balance, a.currency))}</span> INR</div>}

        {/* Monthly balance breakdown */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 11 }}>
          <div style={{ color: C.muted, fontWeight: 700, marginBottom: 6 }}>{curMonName} {cmYr}:</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ color: C.muted }}>Opening Balance</span>
            <span className="num" style={{ color: C.text, fontWeight: 600 }}>{fmt(opening, a.currency)}</span>
          </div>
          {monIn > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ color: C.muted }}>+ New Income</span>
            <span className="num" style={{ color: C.green, fontWeight: 600 }}>+{fmt(monIn, a.currency)}</span>
          </div>}
          {monEx > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ color: C.muted }}>− Expenses</span>
            <span className="num" style={{ color: C.red, fontWeight: 600 }}>−{fmt(monEx, a.currency)}</span>
          </div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${C.border}`, paddingTop: 4, marginTop: 3 }}>
            <div>
              <span style={{ color: C.muted }}>Closing Balance</span>
              <div style={{ fontSize: 9, color: C.accent, marginTop: 1 }}>→ carries to {nextMonLabel}</div>
            </div>
            <span className="num" style={{ color: C.accent, fontWeight: 700 }}>{fmt(closing, a.currency)}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: C.muted }}>
            Prev month ({new Date(cmYr, cmMo - 2).toLocaleString('default',{month:'short'})}): <span className="num">{fmt(prevOpen,a.currency)}</span> → <span className="num" style={{ color: prevClose >= prevOpen ? C.green : C.red }}>{fmt(prevClose,a.currency)}</span>
          </div>
        </div>

        {isCard && a.creditLimit > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <div style={{ marginBottom: 8 }}>
              <ProgressBar value={a.balance || 0} max={a.creditLimit} color={utilPct > 80 ? C.red : utilPct > 50 ? C.yellow : C.green} />
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textAlign: 'right' }}>{utilPct.toFixed(0)}% utilised</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 7 }}>
              <div style={{ background: C.card2, borderRadius: 8, padding: 9 }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Limit</div>
                <div className="num" style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{fmt(a.creditLimit, a.currency)}</div>
              </div>
              <div style={{ background: C.card2, borderRadius: 8, padding: 9 }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Available</div>
                <div className="num" style={{ fontSize: 13, fontWeight: 700, color: available >= 0 ? C.green : C.red }}>{fmt(available, a.currency)}</div>
              </div>
            </div>
            {a.dueDay > 0 && <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>📅 Due: day {a.dueDay} · Min: <span className="num">{fmt(a.minPayment, a.currency)}</span> · APR: {a.apr}%</div>}
          </div>
        )}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
          <button onClick={() => onOpenImport && onOpenImport(a.id)}
            style={{ flex: 1, background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 0', fontSize: 11, fontWeight: 600, color: C.mutedL, cursor: 'pointer' }}
            onMouseOver={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accentL }}
            onMouseOut={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.mutedL }}>
            📄 Upload or Scan Document
          </button>
          <button onClick={() => setAuditAcct(a)}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, color: C.mutedL, cursor: 'pointer' }}
            onMouseOver={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal }}
            onMouseOut={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.mutedL }}
            title="Balance audit">
            📊
          </button>
        </div>
      </Card>
    )
  }

  // ── Balance Audit Modal ──────────────────────────────────────────────────────
  const AuditModal = () => {
    if (!auditAcct) return null
    const a = auditAcct
    const isHome = a.country === 'home'
    const allTxs = transactions.filter(t => t.accountId === a.id).sort((x, y) => (x.date||'').localeCompare(y.date||''))
    const totalIncome  = allTxs.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount||0), 0)
    const totalExpense = allTxs.filter(t => t.type !== 'income').reduce((s, t) => s + Math.abs(t.amount||0), 0)
    const calcBalance  = (a.setupBalance || 0) + totalIncome - totalExpense

    // Remittances received into this home account (not yet as transactions)
    const acctRemits = isHome ? (remittances || []).filter(r => r.toCurrency === a.currency || (!r.toCurrency && a.currency === homeCurrency)) : []
    const totalRemitsReceived = acctRemits.reduce((s, r) => s + (r.received || (r.amount||0) * (r.rate||0)), 0)
    // Which remittances already have a matching income tx?
    const linkedRemits = acctRemits.filter(r => {
      const received = r.received || (r.amount||0) * (r.rate||0)
      // Match if within 1% or ₹50 — handles rounding/FX differences and exchange company naming variations
      const tolerance = Math.max(50, received * 0.01)
      const month = (r.date||'').slice(0,7)
      return allTxs.some(t =>
        // Accept income OR remittance type transactions (exchange company imports may come in as remittance)
        (t.type === 'income' || t.type === 'remittance') &&
        Math.abs(t.amount - received) <= tolerance &&
        (t.date||'').startsWith(month)
      )
    })
    const unlinkedRemits = acctRemits.filter(r => !linkedRemits.includes(r))
    const unlinkedTotal = unlinkedRemits.reduce((s, r) => s + (r.received || (r.amount||0) * (r.rate||0)), 0)
    const expectedBalance = calcBalance + unlinkedTotal

    const row = (label, value, color, bold) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.border}22`, fontSize: 13 }}>
        <span style={{ color: C.muted }}>{label}</span>
        <span className="num" style={{ color: color || C.text, fontWeight: bold ? 700 : 500 }}>{value}</span>
      </div>
    )

    const syncRemittances = () => {
      const newTxs = unlinkedRemits.map(r => ({
        id: uid(), date: r.date || today(),
        description: `Remittance received${r.provider ? ` (${r.provider})` : ''}${r.recipient ? ` — ${r.recipient}` : ''}`,
        category: 'Remittance', type: 'income',
        amount: r.received || (r.amount||0) * (r.rate||0),
        currency: a.currency, accountId: a.id,
        notes: `Auto-linked from remittance record${r.notes ? ': ' + r.notes : ''}`,
      }))
      const updated = [...newTxs, ...transactions]
      setTransactions(updated)
      setAccounts(prev => recomputeAllBalances(prev, updated))
      setAuditAcct(null)
    }

    return (
      <Modal title={`📊 Balance Audit — ${a.name}`} onClose={() => setAuditAcct(null)} width={480}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>How the app calculates your balance vs what it should be.</div>

        <div style={{ background: C.card2, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Balance Breakdown</div>
          {row('Setup / Opening Balance', fmt(a.setupBalance || 0, a.currency))}
          {row('+ Income Transactions (' + allTxs.filter(t=>t.type==='income').length + ')', '+' + fmt(totalIncome, a.currency), C.green)}
          {row('− Expense Transactions (' + allTxs.filter(t=>t.type!=='income').length + ')', '−' + fmt(totalExpense, a.currency), C.red)}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
            <span style={{ fontWeight: 700, color: C.text }}>= App Balance (current)</span>
            <span className="num" style={{ fontWeight: 900, color: C.accent, fontSize: 15 }}>{fmt(a.balance, a.currency)}</span>
          </div>
        </div>

        {isHome && acctRemits.length > 0 && (
          <div style={{ background: C.card2, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Remittances to this Account</div>
            {acctRemits.map((r, i) => {
              const received = r.received || (r.amount||0) * (r.rate||0)
              const isLinked = linkedRemits.includes(r)
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}22`, fontSize: 12 }}>
                  <div>
                    <span style={{ color: C.muted }}>{r.date} {r.provider ? `· ${r.provider}` : ''}</span>
                    <span style={{ marginLeft: 8, fontSize: 10, color: isLinked ? C.green : C.yellow, fontWeight: 700 }}>{isLinked ? '✅ in transactions' : '⚠️ not in transactions'}</span>
                  </div>
                  <span className="num" style={{ color: isLinked ? C.green : C.yellow, fontWeight: 600 }}>+{fmt(received, a.currency)}</span>
                </div>
              )
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
              <span style={{ color: C.muted }}>Unlinked remittances</span>
              <span className="num" style={{ color: C.yellow, fontWeight: 700 }}>+{fmt(unlinkedTotal, a.currency)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
              <span style={{ fontWeight: 700, color: C.text }}>= Expected Balance</span>
              <span className="num" style={{ fontWeight: 900, color: C.green, fontSize: 15 }}>{fmt(expectedBalance, a.currency)}</span>
            </div>
          </div>
        )}

        {unlinkedRemits.length > 0 && (
          <div style={{ background: C.yellow + '15', border: `1px solid ${C.yellow}44`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.mutedL }}>
            ⚠️ <strong style={{ color: C.yellow }}>{unlinkedRemits.length} remittance{unlinkedRemits.length > 1 ? 's' : ''} ({fmt(unlinkedTotal, a.currency)})</strong> are not recorded as income transactions in this account. This is why your balance appears lower than expected.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="ghost" onClick={() => setAuditAcct(null)} style={{ flex: 1 }}>Close</Btn>
          {unlinkedRemits.length > 0 && (
            <Btn onClick={syncRemittances} style={{ flex: 1, background: `linear-gradient(135deg, ${C.green}, #059669)` }}>
              ✅ Sync {unlinkedRemits.length} Remittance{unlinkedRemits.length > 1 ? 's' : ''} to Account
            </Btn>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <h2 style={pgTitle}>Accounts</h2>
        <Btn onClick={() => { setForm(blank); setEditing(null); setShowAdd(true) }}>+ Add Account</Btn>
      </div>

      {/* Per-country net worth breakdown — each in its own currency */}
      {accounts.length > 0 && (() => {
        const wk = countryTotals(workAccounts, foreignCurrency)
        const hm = countryTotals(homeAccounts, homeCurrency)
        const SummaryCard = ({ title, color, cur, t, show }) => show ? (
          <div style={{ flex: 1, minWidth: 220, background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Net Worth</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 900, color: t.net >= 0 ? C.gold : C.red, letterSpacing: '-0.03em', marginBottom: 10 }}>{fmt(t.net, cur)}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: C.muted }}>Assets</span>
              <span className="num" style={{ color: C.green, fontWeight: 700 }}>{fmt(t.assets, cur)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: C.muted }}>Credit Card Debt</span>
              <span className="num" style={{ color: t.debt > 0 ? C.red : C.muted, fontWeight: 700 }}>{t.debt > 0 ? '−' : ''}{fmt(t.debt, cur)}</span>
            </div>
          </div>
        ) : null
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
            <SummaryCard title="Working Country" color={C.teal} cur={foreignCurrency} t={wk} show={workAccounts.length > 0} />
            <SummaryCard title="Home Country (India)" color={C.purple} cur={homeCurrency} t={hm} show={homeAccounts.length > 0} />
          </div>
        )
      })()}

      {accounts.length === 0
        ? <Empty icon="🏦" title="No accounts yet" sub="Add home and working country bank accounts" />
        : (
          <>
            {workAccounts.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 3, height: 16, borderRadius: 2, background: C.teal }} />
                  <h3 style={{ fontSize: 11, fontWeight: 700, color: C.teal, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Working Country</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 24 }}>
                  {workAccounts.map(a => <AccountCard key={a.id} a={a} />)}
                </div>
              </>
            )}
            {homeAccounts.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 3, height: 16, borderRadius: 2, background: C.purple }} />
                  <h3 style={{ fontSize: 11, fontWeight: 700, color: C.purple, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Home Country (India)</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {homeAccounts.map(a => <AccountCard key={a.id} a={a} />)}
                </div>
              </>
            )}
          </>
        )
      }

      {/* Reconcile modal */}
      {reconcileAcct && (() => {
        const diff = parseFloat(reconcileInput) - (reconcileAcct.balance || 0)
        const hasDiff = reconcileInput !== '' && !isNaN(diff) && Math.abs(diff) > 0.005
        const addAdjustment = () => {
          const adj = {
            id: uid(), date: today(), description: 'Balance adjustment (reconciliation)',
            category: 'Other', type: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff),
            currency: reconcileAcct.currency, accountId: reconcileAcct.id,
            amountINR: 0
          }
          const newTxs = [adj, ...transactions]
          setTransactions(newTxs)
          setAccounts(recomputeAllBalances(accounts, newTxs))
          setReconcileAcct(null)
        }
        return (
          <Modal title={`🔍 Reconcile — ${reconcileAcct.name}`} onClose={() => setReconcileAcct(null)}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: C.muted }}>App balance</span>
                <span className="num" style={{ color: C.text, fontWeight: 700 }}>{fmt(reconcileAcct.balance || 0, reconcileAcct.currency)}</span>
              </div>
              <Input label="Your actual bank balance" type="number" value={reconcileInput}
                onChange={e => setReconcileInput(e.target.value)} placeholder="Enter balance from your bank" />
              {hasDiff && (
                <div style={{ background: C.yellow+'15', border:`1px solid ${C.yellow}44`, borderRadius:10, padding:'10px 14px', marginTop:10 }}>
                  <div style={{ fontSize: 13, color: C.yellow, fontWeight: 700, marginBottom: 6 }}>
                    Difference: {diff > 0 ? '+' : ''}{fmt(diff, reconcileAcct.currency)}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                    A &ldquo;Balance adjustment&rdquo; transaction will be added to reconcile the difference.
                  </div>
                  <Btn onClick={addAdjustment} style={{ width: '100%' }}>
                    Add {diff > 0 ? '+' : ''}{fmt(diff, reconcileAcct.currency)} Adjustment
                  </Btn>
                </div>
              )}
              {reconcileInput !== '' && !hasDiff && !isNaN(parseFloat(reconcileInput)) && (
                <div style={{ background: C.green+'15', border:`1px solid ${C.green}44`, borderRadius:10, padding:'10px 14px', marginTop:10, fontSize:13, color: C.green, fontWeight:600, textAlign:'center' }}>
                  ✅ Balances match — no adjustment needed
                </div>
              )}
            </div>
            <Btn variant="ghost" onClick={() => setReconcileAcct(null)} style={{ width:'100%' }}>Cancel</Btn>
          </Modal>
        )
      })()}

      {auditAcct && <AuditModal />}

      {showAdd && (
        <Modal title={editing ? 'Edit Account' : 'Add Account'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[['foreign', 'Working Country'], ['home', 'Home Country']].map(([val, label]) => (
              <button key={val} onClick={() => setForm(p => ({ ...p, country: val, type: val === 'home' ? 'NRE' : 'Savings Account', currency: val === 'home' ? homeCurrency : foreignCurrency }))}
                style={{ flex: 1, padding: '8px', border: `2px solid ${form.country === val ? C.accent : C.border}`, borderRadius: 8, background: form.country === val ? C.accent + '22' : 'transparent', color: form.country === val ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {label}
              </button>
            ))}
          </div>
          <Input label="Account name" value={form.name} onChange={f('name')} placeholder="e.g. Emirates NBD Salary" />
          <Sel label="Account type" value={form.type} onChange={f('type')} options={accountTypeOptions} />
          <CurrencySel label="Currency" value={form.currency} onChange={f('currency')} />
          <Input label="Bank name (optional)" value={form.bank} onChange={f('bank')} placeholder="e.g. Emirates NBD" />
          <Input label="Account number (optional)" value={form.accountNumber} onChange={f('accountNumber')} placeholder="Last 4 digits shown" />
          <Input label={isCC ? 'Current balance owed' : 'Current balance'} type="number" value={form.balance} onChange={f('balance')} placeholder="0" />
          {isCC && (
            <>
              <div style={{ height: 1, background: C.border, margin: '4px 0 14px' }} />
              <div style={{ fontSize: 12, color: C.accent, fontWeight: 600, marginBottom: 10 }}>Credit Card Details</div>
              <Input label="Credit limit" type="number" value={form.creditLimit} onChange={f('creditLimit')} placeholder="0" />
              <div style={grid2}>
                <Input label="Payment due (day of month)" type="number" min="1" max="31" value={form.dueDay} onChange={f('dueDay')} placeholder="e.g. 15" />
                <Input label="Minimum payment" type="number" value={form.minPayment} onChange={f('minPayment')} placeholder="0" />
              </div>
              <Input label="Interest rate (APR %)" type="number" step="0.1" value={form.apr} onChange={f('apr')} placeholder="e.g. 36" />
            </>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update' : 'Add Account'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Transactions ─────────────────────────────────────────────────────────────
const CAT_COLORS = {
  Groceries: '#22c55e', Dining: '#f97316', Transport: '#3b82f6', Utilities: '#eab308',
  Household: '#d97706', Healthcare: '#ef4444', Education: '#6366f1', 'Personal Care': '#ec4899',
  Shopping: '#a855f7', Entertainment: '#8b5cf6', Remittance: '#14b8a6', 'Loan EMI': '#f97316',
  'Credit Card Bill': '#ef4444', Insurance: '#3b82f6', Investment: '#14b8a6', Savings: '#c9a961',
  Travel: '#0ea5e9', Subscription: '#8b5cf6', 'Fees & Charges': '#475569',
  Salary: '#c9a961', 'Other Income': '#22c55e', 'Rental Income': '#14b8a6', Dividends: '#c9a961',
  'ATM Withdrawal': '#94a3b8', Transfer: '#64748b', Other: '#64748b',
}

function Transactions({ transactions, setTransactions, accounts, setAccounts, foreignCurrency, homeCurrency, templates, setTemplates, toINR, onOpenImport, remittances, invoicePrefill, onClearInvoicePrefill }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filter, setFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('all')
  const [acctFilter, setAcctFilter] = useState('')
  const [dateRange, setDateRange] = useState('all')
  const [search, setSearch] = useState('')
  const [tmplName, setTmplName] = useState('')
  const [showSaveTmpl, setShowSaveTmpl] = useState(false)
  const [showStatement, setShowStatement] = useState(false)
  const [stmtMonth, setStmtMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState(new Set())

  const blank = { type: 'expense', date: today(), description: '', category: 'Groceries', amount: '', currency: 'AED', amountINR: '', accountId: '', ccPayAccountId: '' }
  const [form, setForm] = useState(blank)
  const f = k => e => {
    const val = e.target.value
    if (k === 'accountId') {
      const acct = accounts.find(a => a.id === val)
      setForm(p => ({ ...p, accountId: val, currency: acct ? acct.currency : p.currency }))
    } else {
      setForm(p => ({ ...p, [k]: val }))
    }
  }

  const workAccounts = accounts.filter(a => a.country === 'foreign')
  const homeAccounts = accounts.filter(a => a.country === 'home')
  const TX_CARD_TYPES = ['Savings Account', 'Current Account', 'Salary Account', 'Credit Card', 'NRE', 'NRO', 'FCNR']
  const workAccountCards = workAccounts.filter(a => TX_CARD_TYPES.includes(a.type))
  const homeAccountCards = homeAccounts.filter(a => TX_CARD_TYPES.includes(a.type))
  const selAcct = form.accountId ? accounts.find(a => a.id === form.accountId) : null
  const creditCards = accounts.filter(a => a.type === 'Credit Card')
  const isCCBill = form.category === 'Credit Card Bill'

  const afterBal = selAcct && form.amount ? (() => {
    const amt = parseFloat(form.amount) || 0
    const isCC = selAcct.type === 'Credit Card'
    if (isCC) return form.type === 'income' ? (selAcct.balance || 0) - amt : (selAcct.balance || 0) + amt
    return form.type === 'income' ? (selAcct.balance || 0) + amt : (selAcct.balance || 0) - amt
  })() : null

  const save = () => {
    if (!form.amount || !form.date) return
    const amt = parseFloat(form.amount) || 0
    const txCur = selAcct ? selAcct.currency : form.currency
    const amountINR = parseFloat(form.amountINR) || toINR(amt, txCur)
    const item = { ...form, amount: amt, currency: txCur, amountINR, id: editing?.id || uid() }

    const newTxs = editing
      ? transactions.map(t => t.id === editing.id ? item : t)
      : [item, ...transactions]
    setTransactions(newTxs)
    // Recompute all balances from setupBalance + transactions (handles add, edit, and account changes)
    setAccounts(recomputeAllBalances(accounts, newTxs))
    setEditing(null); setShowAdd(false); setForm(blank)
  }

  const saveTemplate = () => {
    if (!tmplName.trim()) return
    setTemplates(p => [...p, { ...form, name: tmplName.trim(), id: uid() }])
    setTmplName(''); setShowSaveTmpl(false)
  }
  const useTemplate = t => {
    setForm({ ...blank, type: t.type, description: t.description, category: t.category, amount: t.amount, currency: t.currency, amountINR: t.amountINR, accountId: t.accountId, date: today() })
    setShowAdd(true)
  }
  const delTemplate = id => setTemplates(p => p.filter(t => t.id !== id))
  const edit = t => { setForm({ ...blank, ...t, amount: String(t.amount), amountINR: String(t.amountINR || '') }); setEditing(t); setShowAdd(true) }
  const del = id => {
    const newTxs = transactions.filter(t => t.id !== id)
    setTransactions(newTxs)
    setAccounts(recomputeAllBalances(accounts, newTxs))
  }

  const applyPrefill = prefill => {
    setForm(p => ({
      ...p,
      date: prefill.date || today(),
      amount: prefill.amount ? String(prefill.amount) : '',
      currency: prefill.currency || p.currency,
      description: prefill.description || '',
      category: TX_CATS.includes(prefill.category) ? prefill.category : 'Other',
      type: prefill.type === 'income' ? 'income' : 'expense',
      amountINR: '',
    }))
    setEditing(null)
    setShowAdd(true)
  }

  // Ref always holds the latest invoicePrefill so effects don't capture a stale closure
  const invoicePrefillRef = useRef(invoicePrefill)
  useEffect(() => { invoicePrefillRef.current = invoicePrefill }, [invoicePrefill])

  const tryApplyPrefill = (source) => {
    const data = invoicePrefillRef.current || (() => {
      try { const s = localStorage.getItem('nri_invoicePrefill'); return s ? JSON.parse(s) : null } catch { return null }
    })()
    if (!data) return
    applyPrefill(data)
    localStorage.removeItem('nri_invoicePrefill')
    onClearInvoicePrefill?.()
  }

  // On mount — catches case where invoicePrefill was set before Transactions mounted
  useEffect(() => {
    const t = setTimeout(() => tryApplyPrefill('mount'), 150)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // On prop change — catches case where Transactions was already mounted
  useEffect(() => {
    if (!invoicePrefill) return
    const t = setTimeout(() => tryApplyPrefill('prop-change'), 50)
    return () => clearTimeout(t)
  }, [invoicePrefill]) // eslint-disable-line react-hooks/exhaustive-deps

  const DR_LABEL = { all: 'All Time', thisMonth: 'This Month', lastMonth: 'Last Month', '3months': 'Last 3mo', '6months': 'Last 6mo' }
  const inDateRange = t => {
    if (dateRange === 'all') return true
    const now = new Date(), d = new Date(t.date || '')
    if (dateRange === 'thisMonth') return (t.date || '').startsWith(now.toISOString().slice(0, 7))
    if (dateRange === 'lastMonth') { const lm = new Date(now); lm.setMonth(lm.getMonth() - 1); return (t.date || '').startsWith(lm.toISOString().slice(0, 7)) }
    if (dateRange === '3months') { const c = new Date(now); c.setMonth(c.getMonth() - 3); return d >= c }
    if (dateRange === '6months') { const c = new Date(now); c.setMonth(c.getMonth() - 6); return d >= c }
    return true
  }

  const sorted = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const filtered = sorted.filter(t =>
    (filter === 'all' || t.type === filter) &&
    (catFilter === 'all' || t.category === catFilter) &&
    (acctFilter === '' || t.accountId === acctFilter) &&
    inDateRange(t) &&
    (search === '' || (() => {
      const q = search.toLowerCase().trim()
      const acct = accounts.find(a => a.id === t.accountId)
      return (
        (t.description || '').toLowerCase().includes(q) ||
        (t.category    || '').toLowerCase().includes(q) ||
        (t.type        || '').toLowerCase().includes(q) ||
        (t.currency    || '').toLowerCase().includes(q) ||
        (t.date        || '').includes(q) ||
        (acct?.name    || '').toLowerCase().includes(q) ||
        String(Math.abs(t.amount || 0)).includes(q)
      )
    })())
  )
  const activeFilters = [filter !== 'all', catFilter !== 'all', acctFilter !== '', dateRange !== 'all', search !== ''].filter(Boolean).length

  const getAcctCur     = t => { const a = accounts.find(x => x.id === t.accountId); return a ? a.currency : t.currency }
  const getAcctCountry = t => { const a = accounts.find(x => x.id === t.accountId); return a ? a.country  : 'foreign' }
  const totalIn = filtered.filter(t => t.type === 'income').reduce((s, t) => s + toINR(t.amount || 0, getAcctCur(t)), 0)
  const totalEx = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + toINR(t.amount || 0, getAcctCur(t)), 0)

  const wkTx  = filtered.filter(t => getAcctCountry(t) === 'foreign')
  const hmTx  = filtered.filter(t => getAcctCountry(t) === 'home')
  const wkIn  = wkTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0)
  const wkEx  = wkTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0)
  const hmIn  = hmTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0)
  const hmEx  = hmTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0)
  const hmRemitsTotal = (remittances || []).reduce((sum, r) => sum + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
  const hmAvailable = hmIn + hmRemitsTotal
  const combinedIncomeINR  = toINR(wkIn, foreignCurrency) + hmAvailable
  const combinedExpenseINR = toINR(wkEx, foreignCurrency) + hmEx
  const combinedNetINR     = combinedIncomeINR - combinedExpenseINR

  const selAcctObj = acctFilter ? accounts.find(a => a.id === acctFilter) : null
  const acctIn = filtered.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0)
  const acctEx = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0)

  // ── Delete Modal ────────────────────────────────────────────────────────────
  const DeleteModal = () => {
    const [mode, setMode] = useState('select') // 'select' | 'confirm-all'
    const toggleSelect = id => setSelectedForDelete(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    const selectAll = () => setSelectedForDelete(new Set(transactions.map(t => t.id)))
    const clearAll = () => setSelectedForDelete(new Set())

    const doDelete = ids => {
      const remaining = transactions.filter(t => !ids.has(t.id))
      setTransactions(remaining)
      setAccounts(prev => recomputeAllBalances(prev, remaining))
      setShowDeleteModal(false)
      setSelectedForDelete(new Set())
    }

    return (
      <Modal title="🗑️ Delete Transactions" onClose={() => setShowDeleteModal(false)} width={700}>
        <div style={{ display:'flex', gap:10, marginBottom:14 }}>
          <Btn variant={mode==='select'?'primary':'ghost'} size="sm" onClick={() => setMode('select')}>Select Manually</Btn>
          <Btn variant={mode==='confirm-all'?'danger':'ghost'} size="sm" onClick={() => setMode('confirm-all')}>Delete All</Btn>
        </div>

        {mode === 'confirm-all' && (
          <div style={{ background:C.red+'12', border:`1px solid ${C.red}44`, borderRadius:10, padding:'16px', textAlign:'center' }}>
            <div style={{ fontSize:15, fontWeight:700, color:C.red, marginBottom:8 }}>⚠️ Delete ALL {transactions.length} transactions?</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>This cannot be undone. All account balances will be reset to their setup balance.</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <Btn variant="ghost" onClick={() => setMode('select')}>Cancel</Btn>
              <Btn variant="danger" onClick={() => doDelete(new Set(transactions.map(t => t.id)))}>Yes, Delete All</Btn>
            </div>
          </div>
        )}

        {mode === 'select' && (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <span style={{ fontSize:12, color:C.muted }}>{selectedForDelete.size} selected</span>
              <button onClick={selectAll} style={{ background:'none', border:'none', color:C.accent, fontSize:12, cursor:'pointer', fontWeight:600 }}>Select All</button>
              <button onClick={clearAll} style={{ background:'none', border:'none', color:C.muted, fontSize:12, cursor:'pointer' }}>Clear</button>
              <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
                {/* Quick filters */}
                {[
                  { label:'This Month', fn: () => { const m=new Date().toISOString().slice(0,7); setSelectedForDelete(new Set(transactions.filter(t=>(t.date||'').startsWith(m)).map(t=>t.id))) } },
                  { label:'Duplicates', fn: () => { const normD=s=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); const seen=new Set(); const dups=new Set(); transactions.forEach(t=>{ const k=`${t.accountId}|${t.date}|${Math.abs(t.amount||0).toFixed(2)}|${normD(t.description).slice(0,15)}`; seen.has(k)?dups.add(t.id):seen.add(k) }); setSelectedForDelete(dups) } },
                ].map(({label,fn}) => (
                  <button key={label} onClick={fn} style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:6, padding:'3px 10px', fontSize:11, color:C.mutedL, cursor:'pointer', fontWeight:600 }}>{label}</button>
                ))}
              </div>
            </div>
            <div style={{ border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden', marginBottom:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'28px 86px 1fr 110px 90px', gap:4, padding:'7px 10px', background:C.card2, fontSize:11, color:C.muted, fontWeight:600 }}>
                <div/><div>Date</div><div>Description</div><div>Account</div><div style={{textAlign:'right'}}>Amount</div>
              </div>
              <div style={{ maxHeight:360, overflowY:'auto' }}>
                {transactions.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t => {
                  const acct = accounts.find(a=>a.id===t.accountId)
                  const checked = selectedForDelete.has(t.id)
                  return (
                    <div key={t.id} onClick={() => toggleSelect(t.id)} style={{ display:'grid', gridTemplateColumns:'28px 86px 1fr 110px 90px', gap:4, padding:'6px 10px', borderBottom:`1px solid ${C.border}22`, alignItems:'center', cursor:'pointer', background:checked?C.red+'12':'transparent' }}>
                      <input type="checkbox" checked={checked} readOnly />
                      <div style={{ fontSize:11, color:C.muted }}>{t.date}</div>
                      <div style={{ fontSize:12, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.description}</div>
                      <div style={{ fontSize:11, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{acct?.name||'—'}</div>
                      <div style={{ fontSize:12, fontWeight:700, textAlign:'right', color:t.type==='income'?C.green:C.red }}>
                        {t.type==='income'?'+':'-'}{fmt(Math.abs(t.amount||0), acct?.currency)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <Btn variant="ghost" onClick={() => setShowDeleteModal(false)} style={{ flex:1 }}>Cancel</Btn>
              <Btn variant="danger" disabled={selectedForDelete.size===0} onClick={() => doDelete(selectedForDelete)} style={{ flex:1 }}>
                🗑️ Delete {selectedForDelete.size} Transaction{selectedForDelete.size!==1?'s':''}
              </Btn>
            </div>
          </>
        )}
      </Modal>
    )
  }

  return (
    <div style={pg}>
      <div className="tx-page-header">
        <h2 style={pgTitle}>Transactions</h2>
        <div className="tx-page-header-actions">
          <Btn onClick={() => onOpenImport(null, 'invoice')} variant="ghost" style={{ fontSize:12, padding:'6px 11px' }}>📄 <span className="btn-label-hide">Upload or Scan Document</span></Btn>
          {acctFilter && <Btn variant="ghost" onClick={() => setShowStatement(true)} style={{ fontSize:12, padding:'6px 11px' }}>📄 <span className="btn-label-hide">Monthly Statement</span></Btn>}
          <Btn variant="ghost" style={{ fontSize:12, padding:'6px 11px', color: C.yellow }} onClick={() => {
            const normD = s => (s||'').toLowerCase().replace(/[^a-z0-9]/g,'')
            const seen = new Set()
            const deduped = transactions.filter(t => {
              const key = `${t.accountId}|${t.date}|${Math.abs(t.amount||0).toFixed(2)}|${normD(t.description).slice(0,15)}`
              if (seen.has(key)) return false
              seen.add(key); return true
            })
            const removed = transactions.length - deduped.length
            if (removed === 0) { alert('No duplicates found.'); return }
            if (confirm(`Found ${removed} duplicate transaction${removed>1?'s':''}. Remove them?`)) {
              setTransactions(deduped)
              setAccounts(prev => recomputeAllBalances(prev, deduped))
            }
          }}>🧹 <span className="btn-label-hide">Remove Duplicates</span></Btn>
          <Btn variant="danger" style={{ fontSize:12, padding:'6px 11px' }} onClick={() => { setSelectedForDelete(new Set()); setShowDeleteModal(true) }}>🗑️ <span className="btn-label-hide">Delete</span></Btn>
          <Btn onClick={() => { setForm(blank); setEditing(null); setShowAdd(true) }}>+ Add Transaction</Btn>
        </div>
      </div>

      {/* Account balance cards — grouped by country */}
      {(workAccountCards.length > 0 || homeAccountCards.length > 0) && (
        <div style={{ marginBottom: 14 }}>
          {workAccountCards.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: C.teal, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, display:'flex', alignItems:'center', gap:4 }}><Flag currency={foreignCurrency} size={12} />Working Country Accounts</div>
              <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                <div style={{ display: 'flex', gap: 10, minWidth: 'max-content' }}>
                  {workAccountCards.map(a => {
                    const isCC = a.type === 'Credit Card'
                    const isActive = acctFilter === a.id
                    const bal = a.balance || 0
                    return (
                      <div key={a.id} onClick={() => setAcctFilter(isActive ? '' : a.id)}
                        style={{ background: C.card, border: `2px solid ${isActive ? '#c9a961' : C.border}`, borderRadius: 12, padding: '10px 14px', minWidth: 155, cursor: 'pointer', flexShrink: 0, transition: 'border-color 0.15s' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: isCC ? C.red : bal >= 0 ? C.green : C.red }}>{isCC ? '-' : ''}{fmt(Math.abs(bal), a.currency)}</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{a.type}</div>
                        {isActive && <div style={{ fontSize: 10, color: '#c9a961', fontWeight: 700, marginTop: 2 }}>▶ Filtered</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          {homeAccountCards.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, display:'flex', alignItems:'center', gap:4 }}><Flag currency={homeCurrency} size={12} />Home Country Accounts</div>
              <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                <div style={{ display: 'flex', gap: 10, minWidth: 'max-content' }}>
                  {homeAccountCards.map(a => {
                    const isCC = a.type === 'Credit Card'
                    const isActive = acctFilter === a.id
                    const bal = a.balance || 0
                    return (
                      <div key={a.id} onClick={() => setAcctFilter(isActive ? '' : a.id)}
                        style={{ background: C.card, border: `2px solid ${isActive ? '#c9a961' : C.border}`, borderRadius: 12, padding: '10px 14px', minWidth: 155, cursor: 'pointer', flexShrink: 0, transition: 'border-color 0.15s' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: isCC ? C.red : bal >= 0 ? C.green : C.red }}>{isCC ? '-' : ''}{fmt(Math.abs(bal), a.currency)}</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{a.type}</div>
                        {isActive && <div style={{ fontSize: 10, color: '#c9a961', fontWeight: 700, marginTop: 2 }}>▶ Filtered</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary row */}
      {selAcctObj ? (
        <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>{selAcctObj.name} — {DR_LABEL[dateRange]}</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Balance', value: fmt(selAcctObj.balance || 0, selAcctObj.currency), color: C.text },
              { label: 'Total In', value: '+' + fmt(acctIn, selAcctObj.currency), color: C.green },
              { label: 'Total Out', value: '-' + fmt(acctEx, selAcctObj.currency), color: C.red },
              { label: 'Net', value: fmt(acctIn - acctEx, selAcctObj.currency), color: acctIn >= acctEx ? C.green : C.red },
            ].map(({ label, value, color }) => (
              <div key={label}><div style={{ fontSize: 11, color: C.muted }}>{label}</div><div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div></div>
            ))}
          </div>
        </div>
      ) : (
        <>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
          <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Summary</span>
          <span style={{ fontSize:11, background:C.accent+'22', color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:20, padding:'2px 10px', fontWeight:700 }}>{DR_LABEL[dateRange]}</span>
          <span style={{ fontSize:11, color:C.muted }}>{filtered.length} transactions</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-3, repeat(3,1fr))', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Total Income',   wkAmt: wkIn,        hmAmt: hmAvailable,          combined: combinedIncomeINR,  color: C.green, netLabel: false, hmSub: hmRemitsTotal > 0 ? `Direct ${fmt(hmIn)} + Remit ${fmt(hmRemitsTotal)}` : null },
            { label: 'Total Expenses', wkAmt: wkEx,        hmAmt: hmEx,                 combined: combinedExpenseINR, color: C.red,   netLabel: false, hmSub: null },
            { label: 'Net',            wkAmt: wkIn - wkEx, hmAmt: hmAvailable - hmEx,   combined: combinedNetINR,     color: null,    netLabel: true,  hmSub: null },
          ].map(({ label, wkAmt, hmAmt, combined, color, netLabel, hmSub }) => {
            const wkColor = color || (wkAmt >= 0 ? C.green : C.red)
            const hmColor = color || (hmAmt >= 0 ? C.green : C.red)
            const combColor = color || (combined >= 0 ? C.green : C.red)
            return (
              <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, display:'flex', alignItems:'center', gap:3 }}><Flag currency={foreignCurrency} size={11} />Working Country</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: wkColor, marginBottom: 8 }}>
                  {fmt(Math.abs(wkAmt), foreignCurrency)}{netLabel ? (wkAmt >= 0 ? ' (saved)' : ' (deficit)') : ''}
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, display:'flex', alignItems:'center', gap:3 }}><Flag currency={homeCurrency} size={11} />Home Country{hmSub ? ' (incl. remittances)' : ''}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: hmColor, marginBottom: hmSub ? 2 : 8 }}>
                  {fmt(Math.abs(hmAmt), homeCurrency)}{netLabel ? (hmAmt >= 0 ? ' (saved)' : ' (deficit)') : ''}
                </div>
                {hmSub && <div style={{ fontSize: 10, color: C.muted, marginBottom: 8 }}>{hmSub}</div>}
                <div style={{ height: 1, background: C.border, margin: '6px 0' }} />
                <div style={{ fontSize: 11, color: combColor, fontWeight: 600 }}>Combined ≈ {fmtConv(Math.abs(combined), homeCurrency)}</div>
              </div>
            )
          })}
        </div>
        </>
      )}

      {/* Templates */}
      {templates.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, letterSpacing: '0.5px' }}>QUICK TEMPLATES</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {templates.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <button onClick={() => useTemplate(t)} style={{ background: 'none', border: 'none', padding: '6px 10px', color: C.text, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>⚡ {t.name} · {t.amount} {t.currency}</button>
                <button onClick={() => delTemplate(t.id)} style={{ background: 'none', border: 'none', borderLeft: `1px solid ${C.border}`, padding: '6px 8px', color: C.muted, fontSize: 12, cursor: 'pointer' }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="tx-filter-bar" style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {['all', 'income', 'expense'].map(v => (
          <button key={v} onClick={() => setFilter(v)} style={{
            background: filter === v ? (v === 'income' ? `linear-gradient(135deg,${C.green},#059669)` : v === 'expense' ? `linear-gradient(135deg,${C.red},#dc2626)` : `linear-gradient(135deg,${C.accent},${C.accentD})`) : C.card2,
            color: filter === v ? '#fff' : C.muted,
            border: `1px solid ${filter === v ? 'transparent' : C.border}`,
            borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize', fontWeight: filter === v ? 700 : 400,
            boxShadow: filter === v ? `0 2px 8px ${v === 'income' ? C.green : v === 'expense' ? C.red : C.accent}44` : 'none',
          }}>{v}</button>
        ))}
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ background: C.card2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
          <option value="all">All categories</option>
          {Object.entries(TX_CATEGORY_GROUPS).map(([g, cats]) => (
            <optgroup key={g} label={g}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
          ))}
        </select>
        <select value={acctFilter} onChange={e => setAcctFilter(e.target.value)} style={{ background: C.card2, color: C.text, border: `1px solid ${acctFilter ? '#c9a961' : C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
          <option value="">All accounts</option>
          {workAccountCards.length > 0 && <optgroup label="Working">{workAccountCards.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
          {homeAccountCards.length > 0 && <optgroup label="Home">{homeAccountCards.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
        </select>
        <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={{ background: C.card2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
          {Object.entries(DR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 8, color: C.muted, fontSize: 12, pointerEvents: 'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search desc, amount, date…" className="tx-search-input" style={{ ...inputStyle, paddingLeft: 26, width: 180, fontSize: 12 }} />
        </div>
        {activeFilters > 0 && (
          <>
            <span style={{ background: C.accent + '22', color: C.accent, borderRadius: 12, padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>{activeFilters} active</span>
            <button onClick={() => { setFilter('all'); setCatFilter('all'); setAcctFilter(''); setDateRange('all'); setSearch('') }} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>Clear all</button>
          </>
        )}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Showing {filtered.length} of {transactions.length} transactions</div>

      {/* Transaction list */}
      {(() => {
        // Build running balance map for the filtered account (sorted by date asc)
        const runBalMap = {}
        if (acctFilter) {
          const acc = accounts.find(a => a.id === acctFilter)
          if (acc && acc.setupBalance !== undefined) {
            const isCC = acc.type === 'Credit Card'
            const acctTxsSorted = [...transactions]
              .filter(t => t.accountId === acctFilter && t.date)
              .sort((a, b) => a.date.localeCompare(b.date))
            let bal = acc.setupBalance
            acctTxsSorted.forEach(t => { bal += calcTxDelta(t, isCC); runBalMap[t.id] = bal })
          }
        }
        return (
          <Card>
            {filtered.length === 0
              ? <Empty icon="↕" title="No transactions" sub="Add income and expense records" />
              : filtered.map(t => {
                const acct = accounts.find(a => a.id === t.accountId)
                const txCur = acct ? acct.currency : t.currency
                const isCC = acct?.type === 'Credit Card'
                const isTransfer = t.category === 'Transfer' || t.category === 'Remittance'
                const arrowColor = t.type === 'income' ? C.green : isTransfer ? C.accent : C.red
                const catColor = CAT_COLORS[t.category] || C.muted
                const convertedINR = toINR(t.amount || 0, txCur) || t.amountINR || 0
                const isHomeTxCur = txCur === homeCurrency
                const convRate = toINR(1, foreignCurrency)
                const convertedAmt = isHomeTxCur ? (convRate > 0 ? (t.amount || 0) / convRate : 0) : convertedINR
                const convertedCurDisplay = isHomeTxCur ? foreignCurrency : homeCurrency
                const showConverted = txCur !== convertedCurDisplay
                const runBal = runBalMap[t.id]
                return (
                  <div key={t.id} style={{ ...rowSep, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: arrowColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, color: arrowColor, fontWeight: 700, marginTop: 2 }}>
                        {t.type === 'income' ? '↑' : isTransfer ? '→' : '↓'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>{t.description || t.category}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: acct ? 3 : 0 }}>
                          <span style={{ fontSize: 11, color: C.muted }}>{t.date}</span>
                          <span style={{ background: catColor + '20', color: catColor, border: `1px solid ${catColor}44`, borderRadius: 5, padding: '1px 7px', fontSize: 10, fontWeight: 600 }}>{t.category}</span>
                        </div>
                        {acct && <div style={{ fontSize: 11, color: C.muted, display:'flex', alignItems:'center', gap:3 }}><Flag currency={acct.currency} size={11} />{isCC ? '💳' : '🏦'} {acct.name}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginLeft: 10, flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.type === 'income' ? C.green : C.red, whiteSpace: 'nowrap' }}>
                          {t.type === 'income' ? '+' : '-'}{fmt(t.amount || 0, txCur)}
                        </div>
                        {showConverted && <div style={{ fontSize: 11, color: C.muted }}>≈ {fmtConv(convertedAmt, convertedCurDisplay)}</div>}
                        {runBal !== undefined && (
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                            Bal: <span className="num" style={{ color: runBal >= 0 ? C.greenL : C.red, fontWeight: 600 }}>{fmt(runBal, txCur)}</span>
                          </div>
                        )}
                      </div>
                      <IconBtn onClick={() => edit(t)}>✏️</IconBtn>
                      <IconBtn onClick={() => del(t.id)}>🗑️</IconBtn>
                    </div>
                  </div>
                )
              })
            }
          </Card>
        )
      })()}

      {/* Add/Edit modal */}
      {showAdd && (
        <Modal title={editing ? 'Edit Transaction' : 'Add Transaction'} onClose={() => { setShowAdd(false); setEditing(null); setShowSaveTmpl(false) }} width={500}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {['income', 'expense'].map(v => (
              <button key={v} onClick={() => setForm(p => ({ ...p, type: v }))}
                style={{ flex: 1, padding: '8px', border: `2px solid ${form.type === v ? (v === 'income' ? C.green : C.red) : C.border}`, borderRadius: 8, background: form.type === v ? (v === 'income' ? C.green : C.red) + '22' : 'transparent', color: form.type === v ? (v === 'income' ? C.green : C.red) : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{v}</button>
            ))}
          </div>
          <div style={grid2}>
            <Input label="Date" type="date" value={form.date} onChange={f('date')} />
            <Input label={`Amount${selAcct ? ` (${selAcct.currency})` : ''}`} type="number" value={form.amount} onChange={f('amount')} placeholder="0" />
          </div>
          {selAcct && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, marginTop: -6, padding: '4px 8px', background: C.card2, borderRadius: 6 }}>
              Amount will be recorded in <strong style={{ color: C.text }}>{selAcct.currency}</strong> — {CURRENCY_FULL_NAMES[selAcct.currency] || selAcct.currency} ({selAcct.name} currency)
            </div>
          )}
          <Input label="Description" value={form.description} onChange={f('description')} placeholder="What was this for?" />
          <CatSel label="Category" value={form.category} onChange={f('category')} />

          {/* Grouped account selector */}
          <Field label="Account">
            <select value={form.accountId} onChange={f('accountId')} style={inputStyle}>
              <option value="">— No account —</option>
              {workAccountCards.length > 0 && (
                <optgroup label="Working Country">
                  {workAccountCards.map(a => <option key={a.id} value={a.id}>{a.name} — {fmt(a.balance || 0, a.currency)}</option>)}
                </optgroup>
              )}
              {homeAccountCards.length > 0 && (
                <optgroup label="Home Country">
                  {homeAccountCards.map(a => <option key={a.id} value={a.id}>{a.name} — {fmt(a.balance || 0, a.currency)}</option>)}
                </optgroup>
              )}
            </select>
          </Field>

          {/* Balance preview */}
          {selAcct && (
            <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>{selAcct.name}</div>
              {selAcct.type === 'Credit Card' ? (<>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: C.muted }}>Current owed</span><span style={{ color: C.red, fontWeight: 700 }}>{fmt(selAcct.balance || 0, selAcct.currency)} 🔴</span>
                </div>
                {selAcct.creditLimit > 0 && <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: C.muted }}>Credit limit</span><span style={{ color: C.text }}>{fmt(selAcct.creditLimit, selAcct.currency)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: C.muted }}>Available</span><span style={{ color: C.green }}>{fmt(selAcct.creditLimit - (selAcct.balance || 0), selAcct.currency)}</span>
                  </div>
                </>}
                {form.amount && afterBal !== null && <>
                  <div style={{ height: 1, background: C.border, margin: '6px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.muted }}>After transaction</span><span style={{ color: C.red, fontWeight: 700 }}>{fmt(afterBal, selAcct.currency)} owed</span>
                  </div>
                </>}
              </>) : (<>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: C.muted }}>Current balance</span><span style={{ color: (selAcct.balance || 0) >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmt(selAcct.balance || 0, selAcct.currency)} {(selAcct.balance || 0) >= 0 ? '✅' : '⚠️'}</span>
                </div>
                {form.amount && afterBal !== null && <>
                  <div style={{ height: 1, background: C.border, margin: '6px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.muted }}>After transaction</span><span style={{ color: afterBal >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmt(afterBal, selAcct.currency)}</span>
                  </div>
                </>}
              </>)}
            </div>
          )}

          {!selAcct && <CurrencySel label="Currency" value={form.currency} onChange={f('currency')} />}
          {selAcct && <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Currency: <strong style={{ color: C.text }}>{selAcct.currency}</strong> (from account)</div>}
          {(selAcct ? selAcct.currency : form.currency) !== 'INR' && (
            <Input label="Amount in INR (optional — auto-computed if blank)" type="number" value={form.amountINR} onChange={f('amountINR')} placeholder="Leave blank to auto-convert" />
          )}
          {isCCBill && creditCards.length > 0 && (
            <Sel label="Which credit card was paid?" value={form.ccPayAccountId} onChange={f('ccPayAccountId')}
              options={[{ value: '', label: 'Select credit card…' }, ...creditCards.map(a => ({ value: a.id, label: `${a.name} (${fmt(a.balance, a.currency)} owed)` }))]} />
          )}

          {showSaveTmpl ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={tmplName} onChange={e => setTmplName(e.target.value)} placeholder="Template name…" style={{ ...inputStyle, flex: 1 }} />
              <Btn onClick={saveTemplate} variant="success">Save</Btn>
              <Btn onClick={() => setShowSaveTmpl(false)} variant="ghost">✕</Btn>
            </div>
          ) : (
            <button onClick={() => setShowSaveTmpl(true)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer', marginTop: 6, textAlign: 'left', padding: 0 }}>⚡ Save as template</button>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null); setShowSaveTmpl(false) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update' : 'Add Transaction'}</Btn>
          </div>
        </Modal>
      )}

      {/* Monthly Statement modal */}
      {showStatement && acctFilter && (() => {
        const acc = accounts.find(a => a.id === acctFilter)
        if (!acc) return null
        const isCC = acc.type === 'Credit Card'
        const stmtLabel = new Date(stmtMonth + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })
        const stmtTxs = [...transactions]
          .filter(t => t.accountId === acctFilter && (t.date||'').startsWith(stmtMonth))
          .sort((a, b) => a.date.localeCompare(b.date))
        const opening = getOpeningBalance(accounts, transactions, acctFilter, stmtMonth)
        let running = opening
        const rows = stmtTxs.map(t => {
          const delta = calcTxDelta(t, isCC)
          running += delta
          return { ...t, delta, balance: running }
        })
        const totalCredits = stmtTxs.filter(t => t.type === 'income').reduce((s,t)=>s+Math.abs(t.amount||0),0)
        const totalDebits  = stmtTxs.filter(t => t.type !== 'income').reduce((s,t)=>s+Math.abs(t.amount||0),0)
        const closing = running
        return (
          <Modal title={`📄 ${acc.name} — ${stmtLabel}`} onClose={() => setShowStatement(false)} width={620}>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:14 }}>
              <button onClick={() => { const d=new Date(stmtMonth+'-01'); d.setMonth(d.getMonth()-1); setStmtMonth(d.toISOString().slice(0,7)) }} style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:8, width:30, height:30, cursor:'pointer', color:C.text, fontSize:16 }}>‹</button>
              <div style={{ flex:1, textAlign:'center', fontWeight:700, color:C.text }}>{stmtLabel}</div>
              <button onClick={() => { const d=new Date(stmtMonth+'-01'); d.setMonth(d.getMonth()+1); setStmtMonth(d.toISOString().slice(0,7)) }} style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:8, width:30, height:30, cursor:'pointer', color:C.text, fontSize:16 }}>›</button>
            </div>
            <div style={{ background:C.card2, borderRadius:10, padding:'10px 14px', marginBottom:12, display:'flex', justifyContent:'space-between' }}>
              <span style={{ color:C.muted, fontSize:12 }}>Opening Balance (01 {stmtLabel})</span>
              <span className="num" style={{ fontWeight:700, color:C.text }}>{fmt(opening, acc.currency)}</span>
            </div>
            <div style={{ maxHeight:340, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                    {['Date','Description','Debit','Credit','Balance'].map(h => (
                      <th key={h} style={{ padding:'6px 8px', color:C.muted, fontWeight:600, textAlign: h==='Date'||h==='Description' ? 'left':'right', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0
                    ? <tr><td colSpan={5} style={{ textAlign:'center', padding:20, color:C.muted }}>No transactions this month</td></tr>
                    : rows.map(r => (
                      <tr key={r.id} style={{ borderBottom:`1px solid ${C.border}22` }}>
                        <td style={{ padding:'6px 8px', color:C.muted, whiteSpace:'nowrap' }}>{r.date}</td>
                        <td style={{ padding:'6px 8px', color:C.text, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.description||r.category}</td>
                        <td style={{ padding:'6px 8px', textAlign:'right', color:C.red, fontWeight:600 }} className="num">
                          {r.type !== 'income' ? fmt(Math.abs(r.amount||0), acc.currency) : ''}
                        </td>
                        <td style={{ padding:'6px 8px', textAlign:'right', color:C.green, fontWeight:600 }} className="num">
                          {r.type === 'income' ? fmt(Math.abs(r.amount||0), acc.currency) : ''}
                        </td>
                        <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:700, color:r.balance>=0?C.text:C.red }} className="num">
                          {fmt(r.balance, acc.currency)}
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
            <div style={{ borderTop:`1px solid ${C.border}`, marginTop:12, paddingTop:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                <span style={{ color:C.green, fontWeight:600 }}>Total Credits</span>
                <span className="num" style={{ color:C.green, fontWeight:700 }}>{fmt(totalCredits, acc.currency)}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:8 }}>
                <span style={{ color:C.red, fontWeight:600 }}>Total Debits</span>
                <span className="num" style={{ color:C.red, fontWeight:700 }}>{fmt(totalDebits, acc.currency)}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:14, fontWeight:700 }}>
                <span style={{ color:C.text }}>Closing Balance (end of {stmtLabel})</span>
                <span className="num" style={{ color:C.accent }}>{fmt(closing, acc.currency)}</span>
              </div>
            </div>
          </Modal>
        )
      })()}

      {showDeleteModal && <DeleteModal />}

    </div>
  )
}

// ─── Remittances ──────────────────────────────────────────────────────────────
function Remittances({ remittances, setRemittances, accounts, transactions, foreignCurrency, homeCurrency, exchangeRate, rates, toINR }) {
  const liveRate = (cur) => rates.INR && rates[cur] ? (rates.INR / rates[cur]).toFixed(4) : String(exchangeRate)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const blank = { date: today(), amount: '', fromCurrency: foreignCurrency, rate: liveRate(foreignCurrency), purpose: 'Family Support', recipient: '', fees: '', notes: '' }
  const [showScan, setShowScan] = useState(false)
  const [scanFile, setScanFile] = useState(null)
  const [scanProcessing, setScanProcessing] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanResult, setScanResult] = useState(null)

  const processScan = async () => {
    if (!scanFile) return
    setScanProcessing(true); setScanError('')
    try {
      const ext = scanFile.name.split('.').pop().toLowerCase()
      let msgContent
      if (ext === 'pdf') {
        const b64 = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.readAsDataURL(scanFile) })
        msgContent = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: REMIT_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }]
      } else if (['xls','xlsx','csv'].includes(ext)) {
        let text
        if (['xls','xlsx'].includes(ext)) { const buf = await scanFile.arrayBuffer(); const wb = XLSX.read(buf, { type: 'array' }); text = wb.SheetNames.map(n => `${n}:\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n') }
        else { text = await scanFile.text() }
        msgContent = [{ type: 'text', text: REMIT_EXTRACTION_PROMPT + '\n\nDocument:\n' + text.slice(0, 12000), cache_control: { type: 'ephemeral' } }]
      } else {
        const b64 = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.readAsDataURL(scanFile) })
        const mtype = scanFile.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`
        msgContent = [{ type: 'image', source: { type: 'base64', media_type: mtype, data: b64 } }, { type: 'text', text: REMIT_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }]
      }
      const data = await anthropicMessages({ model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [{ role: 'user', content: msgContent }] })
      const raw = data.content?.[0]?.text || ''
      const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
      const s = clean.indexOf('{'), e2 = clean.lastIndexOf('}')
      if (s < 0 || e2 < 0) throw new Error('Could not parse response — try a clearer image')
      setScanResult(JSON.parse(clean.slice(s, e2 + 1)))
    } catch (err) { setScanError(err.message || 'Processing failed') }
    setScanProcessing(false)
  }

  const applyScanResult = () => {
    if (!scanResult) return
    const r = scanResult
    const cur = r.fromCurrency || foreignCurrency
    setForm({
      date: r.date || today(),
      amount: r.amount ? String(r.amount) : '',
      fromCurrency: cur,
      rate: r.rate ? String(r.rate) : liveRate(cur),
      purpose: r.purpose || 'Family Support',
      recipient: r.recipient || '',
      fees: r.fees ? String(r.fees) : '',
      notes: [r.provider, r.notes].filter(Boolean).join(' · ') || '',
    })
    setShowScan(false); setScanFile(null); setScanResult(null); setScanError('')
    setShowAdd(true)
  }
  const [form, setForm] = useState(blank)
  const f = k => e => {
    const val = e.target.value
    if (k === 'fromCurrency') setForm(p => ({ ...p, fromCurrency: val, rate: liveRate(val) }))
    else setForm(p => ({ ...p, [k]: val }))
  }

  const received = r => (parseFloat(r.amount) || 0) * (parseFloat(r.rate) || 1)

  const save = () => {
    if (!form.amount) return
    const item = { ...form, amount: parseFloat(form.amount), rate: parseFloat(form.rate), fees: parseFloat(form.fees) || 0, id: editing?.id || uid() }
    setRemittances(p => editing ? p.map(r => r.id === editing.id ? item : r) : [item, ...p])
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const edit = r => { setForm({ ...blank, ...r, amount: String(r.amount), rate: String(r.rate), fees: String(r.fees || '') }); setEditing(r); setShowAdd(true) }
  const del = id => setRemittances(p => p.filter(r => r.id !== id))
  const safeRemits = remittances || []
  const totalSent = safeRemits.reduce((s, r) => s + (r.amount || 0), 0)
  const totalRec = safeRemits.reduce((s, r) => s + received(r), 0)

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={pgTitle}>Remittances</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => { setShowScan(true); setScanFile(null); setScanResult(null); setScanError('') }} variant="subtle">📷 Scan or Upload Receipt</Btn>
          <Btn onClick={() => setShowAdd(true)}>+ Record Remittance</Btn>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Summary</span>
        <span style={{ fontSize:11, background:C.accent+'22', color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:20, padding:'2px 10px', fontWeight:700 }}>All Time</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-3, repeat(3,1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label={`Total Sent (${foreignCurrency})`} value={fmt(totalSent, foreignCurrency)} color={C.accent} icon={<Flag currency={foreignCurrency} size={20} />} />
        <StatCard label={`Received (${homeCurrency})`} value={fmt(totalRec)} color={C.green} icon={<Flag currency={homeCurrency} size={20} />} />
        <StatCard label="Transfers" value={String(safeRemits.length)} color={C.purple} icon="🔄" />
      </div>

      {/* Efficiency tracker — monthly remittances vs home expenses */}
      {safeRemits.length > 0 && (() => {
        const hmAccIds = new Set(accounts.filter(a => a.country === 'home').map(a => a.id))
        const months = [...new Set(safeRemits.map(r => (r.date || '').slice(0, 7)))].filter(Boolean).sort().reverse().slice(0, 6)
        return (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>📊 Monthly Efficiency Tracker</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: C.muted, textAlign: 'right' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 600 }}>Month</th>
                    <th style={{ paddingBottom: 8, fontWeight: 600 }}>Sent</th>
                    <th style={{ paddingBottom: 8, fontWeight: 600 }}>Received</th>
                    <th style={{ paddingBottom: 8, fontWeight: 600 }}>Home Expenses</th>
                    <th style={{ paddingBottom: 8, fontWeight: 600 }}>After Expenses</th>
                    <th style={{ paddingBottom: 8, fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map(m => {
                    const mRemits = safeRemits.filter(r => (r.date || '').startsWith(m))
                    const mSent = mRemits.reduce((s, r) => s + (r.amount || 0), 0)
                    const mReceived = mRemits.reduce((s, r) => s + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
                    const EXCL_CATS = ['Remittance', 'Credit Card Bill', 'Transfer']
                    const mHmEx = (transactions || []).filter(t => t.type === 'expense' && !EXCL_CATS.includes(t.category) && (t.date || '').startsWith(m) && hmAccIds.has(t.accountId)).reduce((s, t) => s + (t.amount || 0), 0)
                    const afterEx = mReceived - mHmEx
                    const surplus = afterEx >= 0
                    return (
                      <tr key={m} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '7px 0', color: C.textS, fontWeight: 600 }}>{m}</td>
                        <td className="num" style={{ textAlign: 'right', color: C.textS }}>{fmt(mSent, foreignCurrency)}</td>
                        <td className="num" style={{ textAlign: 'right', color: C.green }}>{fmt(mReceived)}</td>
                        <td className="num" style={{ textAlign: 'right', color: C.red }}>{fmt(mHmEx)}</td>
                        <td className="num" style={{ textAlign: 'right', color: surplus ? C.green : C.red, fontWeight: 700 }}>{fmt(Math.abs(afterEx))}</td>
                        <td style={{ textAlign: 'right', paddingLeft: 8 }}>
                          <span style={{ background: (surplus ? C.green : C.red) + '22', color: surplus ? C.green : C.red, borderRadius: 6, padding: '2px 7px', fontWeight: 700, fontSize: 10 }}>
                            {surplus ? '✓ Surplus' : '⚠ Deficit'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      <Card>
        {safeRemits.length === 0
          ? <Empty icon="✈️" title="No remittances" sub="Track money you send to India" />
          : safeRemits.map(r => (
            <div key={r.id} style={{ ...rowSep, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `3px solid ${C.accent}66`, paddingLeft: 10, borderRadius: '0 6px 6px 0' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: '-0.01em' }}>{r.purpose}{r.recipient ? <span style={{ color: C.accent }}> → {r.recipient}</span> : ''}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted, marginTop: 3 }}>
                  <Flag currency={r.fromCurrency || foreignCurrency} size={12} />
                  <span>{r.fromCurrency || foreignCurrency}</span>
                  <span>→</span>
                  <Flag currency={homeCurrency} size={12} />
                  <span>{homeCurrency}</span>
                  <span>·</span>
                  <span>{r.date}</span>
                  <span>· Rate {r.rate}</span>
                  {r.fees ? <span>· Fees {r.fees} {r.fromCurrency}</span> : null}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{fmt(r.amount, r.fromCurrency)}</div>
                  <div className="num" style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>₹{fmt(received(r))} received</div>
                </div>
                <IconBtn onClick={() => edit(r)}>✏️</IconBtn>
                <IconBtn onClick={() => del(r.id)}>🗑️</IconBtn>
              </div>
            </div>
          ))
        }
      </Card>

      {showAdd && (
        <Modal title={editing ? 'Edit Remittance' : 'Record Remittance'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <Input label="Date" type="date" value={form.date} onChange={f('date')} />
          <div style={grid2}>
            <Input label="Amount sent" type="number" value={form.amount} onChange={f('amount')} />
            <CurrencySel label="From currency" value={form.fromCurrency} onChange={f('fromCurrency')} />
          </div>
          <Field label={`Exchange rate (live: 1 ${form.fromCurrency} = ₹${liveRate(form.fromCurrency)})`}>
            <input type="number" step="0.0001" value={form.rate} onChange={f('rate')} style={inputStyle} />
          </Field>
          <div style={{ background: C.card2, borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: C.green }}>
            Recipient gets: {fmt((parseFloat(form.amount) || 0) * (parseFloat(form.rate) || 0))}
          </div>
          <Sel label="Purpose" value={form.purpose} onChange={f('purpose')} options={REMIT_PURPOSES} />
          <Input label="Recipient name (optional)" value={form.recipient} onChange={f('recipient')} placeholder="e.g. Mom, Dad" />
          <Input label="Transfer fees (optional)" type="number" value={form.fees} onChange={f('fees')} placeholder="0" />
          <Input label="Notes (optional)" value={form.notes} onChange={f('notes')} placeholder="Reference number, provider..." />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update' : 'Save'}</Btn>
          </div>
        </Modal>
      )}

      {showScan && (
        <Modal title="Scan Remittance Receipt" onClose={() => { setShowScan(false); setScanFile(null); setScanResult(null); setScanError('') }} width={480}>
          {!scanResult ? (
            <>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
                Upload a receipt, screenshot, or PDF of your money transfer. Claude AI will extract the details automatically.
              </div>

              {/* Upload zone */}
              <div style={{ border: `2px dashed ${scanFile ? C.accent : C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', marginBottom: 14, background: scanFile ? C.accent + '08' : 'transparent', cursor: 'pointer' }}
                onClick={() => document.getElementById('remit-scan-input').click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setScanFile(f) }}>
                {scanFile ? (
                  <>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{scanFile.name}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{(scanFile.size / 1024).toFixed(0)} KB · Click to change</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Drop file here or click to browse</div>
                    <div style={{ fontSize: 11, color: C.muted }}>PDF · Excel / CSV · JPG · PNG supported</div>
                  </>
                )}
              </div>

              {/* Hidden file input — general */}
              <input id="remit-scan-input" type="file" accept="image/*,application/pdf,.xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => { if (e.target.files[0]) setScanFile(e.target.files[0]) }} />

              {/* Camera label — wraps input directly so browser opens camera without JS intermediary */}
              <label htmlFor="remit-camera-input"
                style={{ width: '100%', padding: '10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.card2, color: C.text, cursor: 'pointer', fontSize: 13, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxSizing: 'border-box' }}>
                📷 Take a Photo
                <input id="remit-camera-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files[0]) setScanFile(e.target.files[0]) }} />
              </label>

              <div style={{ background: C.accent + '15', border: `1px solid ${C.accent}33`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.mutedL, lineHeight: 1.7 }}>
                <div>Supported banks: NBK, KFH, Burgan, Gulf Bank, HDFC, SBI, Axis, ICICI and most major banks. Upload PDF or Excel/CSV export for best accuracy.</div>
                <div style={{ marginTop: 5 }}>🏷️ <strong>Heads up on categorisation:</strong> AI assigns categories automatically — you can review and fix every one before importing.</div>
                <div style={{ marginTop: 5 }}>🔒 <strong>Privacy Notice:</strong> Your file is sent securely to Anthropic's AI for extraction only. No data is stored externally.</div>
              </div>

              {scanError && (
                <div style={{ background: C.red + '15', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.red }}>
                  {scanError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="ghost" onClick={() => setShowScan(false)} style={{ flex: 1 }}>Cancel</Btn>
                <Btn onClick={processScan} disabled={!scanFile || scanProcessing} style={{ flex: 2 }}>
                  {scanProcessing ? '⏳ Scanning...' : '✨ Extract Details'}
                </Btn>
              </div>
            </>
          ) : (
            <>
              <div style={{ background: C.green + '12', border: `1px solid ${C.green}33`, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>✅ Details extracted — review before saving</div>
                {[
                  { label: 'Date', val: scanResult.date || '—' },
                  { label: 'Amount sent', val: scanResult.amount ? `${scanResult.amount} ${scanResult.fromCurrency || foreignCurrency}` : '—' },
                  { label: 'Exchange rate', val: scanResult.rate ? `1 ${scanResult.fromCurrency || foreignCurrency} = ${scanResult.rate} ${scanResult.toCurrency || homeCurrency}` : '—' },
                  { label: 'Recipient gets', val: scanResult.received ? fmt(scanResult.received) : scanResult.amount && scanResult.rate ? fmt(scanResult.amount * scanResult.rate) : '—' },
                  { label: 'Fees', val: scanResult.fees ? `${scanResult.fees} ${scanResult.fromCurrency || foreignCurrency}` : 'None' },
                  { label: 'Recipient', val: scanResult.recipient || '—' },
                  { label: 'Provider', val: scanResult.provider || '—' },
                  { label: 'Purpose', val: scanResult.purpose || '—' },
                  { label: 'Notes', val: scanResult.notes || '—' },
                ].map(({ label, val }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: C.muted }}>{label}</span>
                    <span style={{ color: C.text, fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{val}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="ghost" onClick={() => setScanResult(null)} style={{ flex: 1 }}>← Re-scan</Btn>
                <Btn onClick={applyScanResult} style={{ flex: 2 }}>✓ Fill Form</Btn>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

// ─── Bills ────────────────────────────────────────────────────────────────────
function Bills({ bills, setBills, transactions = [], foreignCurrency, homeCurrency }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const blank = { name: '', amount: '', currency: 'INR', dueDate: '', frequency: 'Monthly', category: 'Utilities', paid: false, country: 'foreign' }
  const [form, setForm] = useState(blank)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  // ── Auto-mark bills paid from matching expense transactions ──────────────────
  // When an expense in Transactions plausibly corresponds to a bill (same
  // currency, amount within tolerance, and the bill name appears in the
  // transaction description OR the category matches), flag the bill as paid.
  // We mark autoPaid so it's distinguishable from a manual tick and so we can
  // safely un-mark it if the matching transaction later disappears. Manual
  // paid bills (paid && !autoPaid) are never touched here.
  const findMatch = useCallback(b => {
    if (!b.amount) return null
    const bn = (b.name || '').trim().toLowerCase()
    return transactions.find(t => {
      if (t.type !== 'expense') return false
      if ((t.currency || 'INR') !== (b.currency || 'INR')) return false
      // amount within 1% or 1 unit, whichever is larger (covers rounding/fees)
      const tol = Math.max(1, b.amount * 0.01)
      if (Math.abs((t.amount || 0) - b.amount) > tol) return false
      const desc = (t.description || '').toLowerCase()
      const nameHit = bn.length >= 3 && desc.includes(bn)
      const catHit = b.category && t.category && b.category.toLowerCase() === t.category.toLowerCase()
      return nameHit || catHit
    }) || null
  }, [transactions])

  useEffect(() => {
    let changed = false
    const next = bills.map(b => {
      const match = findMatch(b)
      if (b.autoSuppressed) return b // user deliberately un-ticked — leave alone
      if (match && !b.paid) { changed = true; return { ...b, paid: true, autoPaid: true, autoPaidTxId: match.id } }
      // If a previously auto-marked bill lost its matching transaction, revert it.
      if (b.autoPaid && !match) { changed = true; const { autoPaid, autoPaidTxId, ...rest } = b; return { ...rest, paid: false } }
      return b
    })
    if (changed) setBills(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, bills.length])

  const save = () => {
    if (!form.name || !form.amount) return
    const item = { ...form, amount: parseFloat(form.amount), id: editing?.id || uid() }
    setBills(p => editing ? p.map(b => b.id === editing.id ? item : b) : [...p, item])
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const toggle = id => setBills(p => p.map(b => {
    if (b.id !== id) return b
    const nowPaid = !b.paid
    // Manual action overrides auto-matching. If the user un-ticks an auto-paid
    // bill, suppress re-matching so their choice sticks; ticking clears it.
    return { ...b, paid: nowPaid, autoPaid: false, autoPaidTxId: undefined, autoSuppressed: !nowPaid }
  }))
  const del = id => setBills(p => p.filter(b => b.id !== id))
  const edit = b => { setForm({ ...blank, ...b, amount: String(b.amount) }); setEditing(b); setShowAdd(true) }
  const unpaid = bills.filter(b => !b.paid)
  const paid = bills.filter(b => b.paid)
  const wkUnpaid = unpaid.filter(b => b.country === 'foreign')
  const hmUnpaid = unpaid.filter(b => b.country === 'home')
  const wkTotal = wkUnpaid.reduce((s, b) => s + (b.amount || 0), 0)
  const hmTotal = hmUnpaid.reduce((s, b) => s + (b.amount || 0), 0)

  const daysUntil = dueDate => {
    if (!dueDate) return null
    return Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24))
  }

  const overdueCount = unpaid.filter(b => { const d = daysUntil(b.dueDate); return d !== null && d < 0 }).length
  const dueSoonCount = unpaid.filter(b => { const d = daysUntil(b.dueDate); return d !== null && d >= 0 && d <= 7 }).length

  const BillRow = ({ b }) => {
    const days = daysUntil(b.dueDate)
    const isOverdue = days !== null && days < 0
    const isDueSoon = days !== null && days >= 0 && days <= 7
    const dueBadgeColor = isOverdue ? C.red : isDueSoon ? C.yellow : C.muted
    const dueBadgeText = days === null ? null : isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`
    const accentCol = isOverdue && !b.paid ? C.red : isDueSoon && !b.paid ? C.yellow : b.country === 'home' ? C.purple : C.teal
    return (
      <div style={{
        ...rowSep, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        opacity: b.paid ? 0.5 : 1,
        background: isOverdue && !b.paid ? C.red + '0a' : 'transparent',
        borderLeft: `3px solid ${b.paid ? C.border : accentCol}`,
        paddingLeft: 10, borderRadius: '0 6px 6px 0',
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input type="checkbox" checked={b.paid} onChange={() => toggle(b.id)} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.accent, flexShrink: 0 }} />
          <div style={{ textDecoration: b.paid ? 'line-through' : 'none' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: isOverdue && !b.paid ? C.red : C.text }}>{b.name}</span>
              <Badge color={b.country === 'home' ? C.purple : C.teal}><Flag currency={b.currency} size={13} /></Badge>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>{b.frequency}{b.dueDate ? ` · Due ${b.dueDate}` : ''} · {b.category}{b.autoPaid ? ' · ✓ auto-matched from transactions' : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {dueBadgeText && !b.paid && <Badge color={dueBadgeColor}>{dueBadgeText}</Badge>}
          <div className="num" style={{ fontSize: 14, fontWeight: 700, color: b.paid ? C.muted : C.yellow }}>{fmt(b.amount, b.currency)}</div>
          <IconBtn onClick={() => edit(b)}>✏️</IconBtn>
          <IconBtn onClick={() => del(b.id)}>🗑️</IconBtn>
        </div>
      </div>
    )
  }

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={pgTitle}>Bills & Utilities</h2>
        <Btn onClick={() => setShowAdd(true)}>+ Add Bill</Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-4, repeat(4,1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label={`Working Pending (${foreignCurrency})`} value={fmt(wkTotal, foreignCurrency)} color={C.teal} icon={<Flag currency={foreignCurrency} size={20} />} sub={`${wkUnpaid.length} bill${wkUnpaid.length !== 1 ? 's' : ''}`} />
        <StatCard label={`Home Pending (${homeCurrency})`} value={fmt(hmTotal, homeCurrency)} color={C.purple} icon={<Flag currency={homeCurrency} size={20} />} sub={`${hmUnpaid.length} bill${hmUnpaid.length !== 1 ? 's' : ''}`} />
        <StatCard label="Overdue" value={String(overdueCount)} color={overdueCount > 0 ? C.red : C.muted} icon="⚠️" />
        <StatCard label="Due This Week" value={String(dueSoonCount)} color={dueSoonCount > 0 ? C.yellow : C.muted} icon="⏰" />
      </div>

      {(overdueCount > 0 || dueSoonCount > 0) && (
        <div style={{ background: C.red + '15', border: `1px solid ${C.red}44`, borderRadius: 10, padding: 12, marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {overdueCount > 0 && <span style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>⚠️ {overdueCount} overdue bill{overdueCount > 1 ? 's' : ''}</span>}
          {dueSoonCount > 0 && <span style={{ fontSize: 13, color: C.yellow, fontWeight: 600 }}>⏰ {dueSoonCount} due within 7 days</span>}
        </div>
      )}

      {bills.length === 0
        ? <Empty icon="📋" title="No bills tracked" sub="Add recurring bills and subscriptions" />
        : (
          <>
            {unpaid.length > 0 && <Card title="Pending" style={{ marginBottom: 14 }}>{unpaid.map(b => <BillRow key={b.id} b={b} />)}</Card>}
            {paid.length > 0 && <Card title="Paid">{paid.map(b => <BillRow key={b.id} b={b} />)}</Card>}
          </>
        )
      }

      {showAdd && (
        <Modal title={editing ? 'Edit Bill' : 'Add Bill'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[['foreign', 'Working Country'], ['home', 'Home Country']].map(([val, label]) => (
              <button key={val} onClick={() => setForm(p => ({ ...p, country: val, currency: val === 'home' ? (homeCurrency || 'INR') : (foreignCurrency || 'KWD') }))}
                style={{ flex: 1, padding: '8px', border: `2px solid ${form.country === val ? C.accent : C.border}`, borderRadius: 8, background: form.country === val ? C.accent + '22' : 'transparent', color: form.country === val ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {label}
              </button>
            ))}
          </div>
          <Input label="Bill name" value={form.name} onChange={f('name')} placeholder="e.g. Netflix, Electricity" />
          <div style={grid2}>
            <Input label="Amount" type="number" value={form.amount} onChange={f('amount')} />
            <CurrencySel label="Currency" value={form.currency} onChange={f('currency')} />
          </div>
          <Sel label="Frequency" value={form.frequency} onChange={f('frequency')} options={BILL_FREQS} />
          <Sel label="Category" value={form.category} onChange={f('category')} options={BILL_CATS} />
          <Input label="Due date (optional)" type="date" value={form.dueDate} onChange={f('dueDate')} />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update Bill' : 'Add Bill'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Investment Extraction ────────────────────────────────────────────────────
const INVESTMENT_EXTRACTION_PROMPT = `You are extracting investment portfolio holdings from a statement (mutual fund CAS, brokerage statement, FD certificate, stock portfolio, or any investment summary document — PDF, image, CSV, or Excel).

Extract ALL individual investment holdings. For each holding return:
- name: full scheme/stock/FD name (string)
- type: one of "Mutual Fund","Fixed Deposit","Stocks","PPF","NPS","Real Estate","Gold","Bonds","ETF" — pick the closest match
- isin: ISIN code if visible (null if not)
- folio: folio or account/demat number (null if not found)
- units: number of units or shares held as a plain decimal (null if not applicable)
- nav: NAV or current price per unit/share as a plain decimal (null if not applicable)
- invested: EXACT total cost basis / amount invested — strip all commas and currency symbols (e.g. "1,25,000.00" → 125000, "INR 45,000" → 45000); preserve decimal precision; 0 if not found
- currentValue: EXACT current market value — strip commas/symbols the same way; compute as units×nav if both present and no stated value, else use stated value; preserve decimal precision; 0 if unknown
- purchaseDate: earliest purchase/allotment date in YYYY-MM-DD (null if not found)
- maturityDate: maturity date for FDs/bonds in YYYY-MM-DD (null if not applicable)
- interestRate: annual interest rate % as a plain decimal for FDs/bonds (e.g. "7.5%" → 7.5; null if not applicable)
- dividends: total dividends or distributions received as a plain decimal (0 if none)
- currency: currency code (INR, KWD, USD, GBP, etc.)

IMPORTANT number parsing:
- Indian number formatting uses lakhs: "1,25,000" means 125000 — parse correctly
- Strip all commas and currency symbols before treating as a number
- Preserve the exact decimal precision shown in the source; do NOT round

Return ONLY valid JSON — no markdown, no explanation:
{"holdings":[],"statementDate":null,"accountHolder":"","totalInvested":0,"totalCurrentValue":0}
No text before { or after }`

const calcCAGR = (invested, currentValue, purchaseDate) => {
  if (!invested || !currentValue || !purchaseDate || invested <= 0 || currentValue <= 0) return null
  const days = (Date.now() - new Date(purchaseDate).getTime()) / 86400000
  if (days < 30) return null
  return (Math.pow(currentValue / invested, 365.25 / days) - 1) * 100
}

const daysHeld = purchaseDate => {
  if (!purchaseDate) return null
  return Math.floor((Date.now() - new Date(purchaseDate).getTime()) / 86400000)
}

// ─── Investments ──────────────────────────────────────────────────────────────
function Investments({ investments, setInvestments, foreignCurrency, homeCurrency, toINR }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadProcessing, setUploadProcessing] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [previewHoldings, setPreviewHoldings] = useState(null)
  const [selectedHoldings, setSelectedHoldings] = useState([])
  const [countryTab, setCountryTab] = useState('all')

  const blank = { name: '', type: 'Mutual Fund', invested: '', currentValue: '', currency: foreignCurrency, purchaseDate: '', expectedReturn: '', units: '', nav: '', isin: '', folio: '', maturityDate: '', interestRate: '', dividends: '', country: 'foreign' }
  const [form, setForm] = useState(blank)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const getInvCountry = i => i.country || (i.currency === homeCurrency ? 'home' : 'foreign')
  const convINR = (i, field) => toINR(i[field] || 0, i.currency)

  const save = () => {
    if (!form.name || !form.invested) return
    const invested = parseFloat(form.invested) || 0
    const nav = parseFloat(form.nav) || 0
    const units = parseFloat(form.units) || 0
    const currentValue = parseFloat(form.currentValue) || (nav > 0 && units > 0 ? nav * units : invested)
    const item = { ...form, invested, currentValue, expectedReturn: parseFloat(form.expectedReturn) || parseFloat(form.interestRate) || 0, units, nav, dividends: parseFloat(form.dividends) || 0, asOfDate: today(), id: editing?.id || uid() }
    setInvestments(p => editing ? p.map(i => i.id === editing.id ? item : i) : [...p, item])
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const del = id => { if (confirm('Delete investment?')) setInvestments(p => p.filter(i => i.id !== id)) }
  const edit = i => {
    setForm({ ...blank, ...i, invested: String(i.invested || ''), currentValue: String(i.currentValue || ''), expectedReturn: String(i.expectedReturn || ''), units: String(i.units || ''), nav: String(i.nav || ''), interestRate: String(i.interestRate || ''), dividends: String(i.dividends || '') })
    setEditing(i); setShowAdd(true)
  }

  const processUpload = async () => {
    if (!uploadFile) return
    setUploadProcessing(true); setUploadError('')
    try {
      const ext = uploadFile.name.split('.').pop().toLowerCase()
      let msgContent
      if (ext === 'pdf') {
        const b64 = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.readAsDataURL(uploadFile) })
        msgContent = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: INVESTMENT_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }]
      } else if (['jpg','jpeg','png','webp'].includes(ext) || uploadFile.type.startsWith('image/')) {
        const b64 = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.readAsDataURL(uploadFile) })
        msgContent = [{ type: 'image', source: { type: 'base64', media_type: uploadFile.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`, data: b64 } }, { type: 'text', text: INVESTMENT_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }]
      } else {
        let text = await uploadFile.text()
        if (['xls','xlsx'].includes(ext)) { const buf = await uploadFile.arrayBuffer(); const wb = XLSX.read(buf, { type: 'array' }); text = wb.SheetNames.map(n => `${n}:\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n') }
        msgContent = [{ type: 'text', text: INVESTMENT_EXTRACTION_PROMPT + '\n\nDocument:\n' + text.slice(0, 12000), cache_control: { type: 'ephemeral' } }]
      }
      const data = await anthropicMessages({ model: 'claude-sonnet-4-5', max_tokens: 3000, messages: [{ role: 'user', content: msgContent }] })
      const raw = data.content?.[0]?.text || ''
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No structured data found in response')
      const result = JSON.parse(match[0])
      if (!result.holdings?.length) throw new Error('No investment holdings found in this document')
      setPreviewHoldings({ ...result, docName: uploadFile.name })
      setSelectedHoldings(result.holdings.map((_, idx) => idx))
      setShowUpload(false); setUploadFile(null)
    } catch (e) { setUploadError(e.message || 'Extraction failed') }
    setUploadProcessing(false)
  }

  const confirmHoldings = (selected) => {
    const newInvestments = selected.map(h => ({
      id: uid(),
      name: h.name || 'Unknown',
      type: INVESTMENT_TYPES.includes(h.type) ? h.type : 'Mutual Fund',
      currency: h.currency || homeCurrency,
      country: h.currency === homeCurrency ? 'home' : 'foreign',
      invested: parseFloat(h.invested) || 0,
      currentValue: parseFloat(h.currentValue) || parseFloat(h.invested) || 0,
      purchaseDate: h.purchaseDate || '',
      expectedReturn: parseFloat(h.interestRate) || 0,
      units: parseFloat(h.units) || 0,
      nav: parseFloat(h.nav) || 0,
      isin: h.isin || '',
      folio: h.folio || '',
      maturityDate: h.maturityDate || '',
      interestRate: parseFloat(h.interestRate) || 0,
      dividends: parseFloat(h.dividends) || 0,
      asOfDate: previewHoldings.statementDate || today(),
      fromDoc: true,
      docName: previewHoldings.docName,
    }))
    setInvestments(p => [...p, ...newInvestments])
    setPreviewHoldings(null)
  }

  const filtered = countryTab === 'all' ? investments : investments.filter(i => getInvCountry(i) === countryTab)
  const totalInvested = investments.reduce((s, i) => s + convINR(i, 'invested'), 0)
  const totalCurrent  = investments.reduce((s, i) => s + convINR(i, 'currentValue'), 0)
  const totalDivs     = investments.reduce((s, i) => s + toINR(i.dividends || 0, i.currency), 0)
  const pnl = totalCurrent - totalInvested
  const totalReturn = pnl + totalDivs
  const pnlPct = totalInvested > 0 ? ((totalReturn / totalInvested) * 100).toFixed(1) : '0.0'
  const typeColors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#06b6d4','#f43f5e','#d4a84b','#a78bfa','#34d399']

  const byType = INVESTMENT_TYPES.map(t => ({
    type: t,
    value: investments.filter(i => i.type === t).reduce((s, i) => s + convINR(i, 'currentValue'), 0),
  })).filter(t => t.value > 0)

  const latestInvDate = maxDate(investments.map(i => i.asOfDate || i.purchaseDate))

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={pgTitle}>Investments</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={() => { setUploadFile(null); setUploadError(''); setShowUpload(true) }} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>📄 Upload Statement</Btn>
          <Btn onClick={() => { setForm({ ...blank, currency: foreignCurrency }); setEditing(null); setShowAdd(true) }}>+ Add</Btn>
        </div>
      </div>

      {/* Country tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['all','All'], ['foreign', foreignCurrency + ' (Working)'], ['home', homeCurrency + ' (Home)']].map(([v, label]) => (
          <button key={v} onClick={() => setCountryTab(v)} style={{ padding: '5px 14px', borderRadius: 20, border: `1px solid ${countryTab === v ? C.accent : C.border}`, background: countryTab === v ? C.accent + '22' : 'none', color: countryTab === v ? C.accent : C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Portfolio</span>
        <span style={{ fontSize:11, background:C.accent+'22', color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:20, padding:'2px 10px', fontWeight:700 }}>
          Values as of {latestInvDate ? fmtDate(latestInvDate) : new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-4, repeat(4,1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="Total Invested" value={fmt(totalInvested)} color={C.accent} icon="💼" />
        <StatCard label="Current Value" value={fmt(totalCurrent)} color={C.green} icon="📊" />
        <StatCard label="P&L (Unrealised)" value={`${pnl >= 0 ? '+' : ''}${fmt(pnl)}`} sub={`${pnlPct}% total return`} color={pnl >= 0 ? C.green : C.red} icon={pnl >= 0 ? '📈' : '📉'} />
        {totalDivs > 0
          ? <StatCard label="Dividends / Income" value={fmt(totalDivs)} color={C.teal} icon="💸" />
          : <StatCard label="Holdings" value={`${investments.length}`} sub={`${byType.length} asset types`} color={C.purple} icon="🗂️" />}
      </div>

      {byType.length > 0 && (() => {
        const donutSegs = byType.map((t, i) => ({ value: t.value, color: typeColors[i % typeColors.length] }))
        return (
          <Card title="Portfolio Allocation" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              <DonutChart size={88} thickness={13} segments={donutSegs} />
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                {byType.map((t, idx) => (
                  <div key={t.type} style={{ background: C.card2, borderRadius: 9, padding: '9px 11px', borderLeft: `3px solid ${typeColors[idx % typeColors.length]}` }}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>{t.type}</div>
                    <div className="num" style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{fmt(t.value)}</div>
                    <div style={{ fontSize: 11, color: typeColors[idx % typeColors.length], fontWeight: 600 }}>{totalCurrent > 0 ? ((t.value / totalCurrent) * 100).toFixed(1) : 0}%</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )
      })()}

      {filtered.length === 0
        ? <Empty icon="📈" title="No investments" sub={countryTab === 'all' ? 'Upload a statement or add manually' : `No ${countryTab === 'foreign' ? 'working country' : 'home country'} investments yet`} />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 14 }}>
            {filtered.map(i => {
              const inv  = convINR(i, 'invested')
              const cur  = convINR(i, 'currentValue')
              const gain = cur - inv
              const gPct = inv > 0 ? ((gain / inv) * 100) : 0
              const divs = toINR(i.dividends || 0, i.currency)
              const totalRet = gain + divs
              const totalRetPct = inv > 0 ? ((totalRet / inv) * 100) : 0
              const cagr = calcCAGR(i.invested, i.currentValue, i.purchaseDate)
              const days = daysHeld(i.purchaseDate)
              const tc = getInvCountry(i) === 'foreign' ? C.teal : C.purple
              const displayRate = cagr ?? i.expectedReturn ?? i.interestRate ?? 0
              return (
                <div key={i.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${tc}, ${tc}44)` }} />
                  <div style={{ padding: '14px 16px' }}>
                    {/* Badge row + actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <Badge color={C.accent}>{i.type}</Badge>
                        <Badge color={tc}><Flag currency={i.currency} size={11} /> {i.currency}</Badge>
                        {i.fromDoc && <Badge color={C.muted} style={{ fontSize: 9 }}>📄 Imported</Badge>}
                      </div>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <IconBtn onClick={() => { setForm({ ...blank, currency: foreignCurrency }); setUploadFile(null); setUploadError(''); setShowUpload(true) }} title="Upload statement for this holding">📄</IconBtn>
                        <IconBtn onClick={() => edit(i)}>✏️</IconBtn>
                        <IconBtn onClick={() => del(i.id)}>🗑️</IconBtn>
                      </div>
                    </div>

                    {/* Name */}
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2, lineHeight: 1.3 }}>{i.name}</div>
                    {(i.isin || i.folio) && (
                      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>
                        {i.isin && <span>ISIN: {i.isin}</span>}
                        {i.isin && i.folio && <span> · </span>}
                        {i.folio && <span>Folio: {i.folio}</span>}
                      </div>
                    )}
                    {days !== null && (
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                        Since {i.purchaseDate} · <span style={{ color: C.accent }}>{days >= 365 ? `${(days/365).toFixed(1)} yrs` : `${days} days`}</span>
                      </div>
                    )}

                    {/* Current Value — hero number */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 1 }}>
                      <span style={{ fontSize: 10, color: C.muted }}>Current Value</span>
                      {i.asOfDate && <span style={{ fontSize: 10, color: C.accent }}>as of {fmtDate(i.asOfDate)}</span>}
                    </div>
                    <div className="num" style={{ fontSize: 26, fontWeight: 900, color: gain >= 0 ? C.green : C.red, letterSpacing: '-0.04em', marginBottom: 10 }}>
                      {fmt(i.currentValue, i.currency)}
                    </div>

                    {/* Units × NAV */}
                    {i.units > 0 && i.nav > 0 && (
                      <div style={{ background: C.card2, borderRadius: 8, padding: '7px 10px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: C.muted }}>{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(i.units)} units</span>
                        <span style={{ color: C.muted }}>×</span>
                        <span style={{ color: C.muted }}>NAV {fmt(i.nav, i.currency)}</span>
                        <span className="num" style={{ color: C.accent, fontWeight: 700 }}>= {fmt(i.units * i.nav, i.currency)}</span>
                      </div>
                    )}

                    {/* P&L breakdown */}
                    <div style={{ fontSize: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ color: C.muted }}>Invested</span>
                        <span className="num" style={{ color: C.text, fontWeight: 600 }}>{fmt(i.invested, i.currency)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ color: C.muted }}>Unrealised Gain/Loss</span>
                        <span className="num" style={{ color: gain >= 0 ? C.green : C.red, fontWeight: 700 }}>
                          {gain >= 0 ? '+' : ''}{fmt(gain, i.currency)} ({gPct >= 0 ? '+' : ''}{gPct.toFixed(1)}%)
                        </span>
                      </div>
                      {i.dividends > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ color: C.muted }}>Dividends / Income</span>
                          <span className="num" style={{ color: C.teal, fontWeight: 600 }}>+{fmt(i.dividends, i.currency)}</span>
                        </div>
                      )}
                      {(i.dividends > 0) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.border}`, paddingTop: 4, marginBottom: 3 }}>
                          <span style={{ color: C.muted, fontWeight: 600 }}>Total Return</span>
                          <span className="num" style={{ color: totalRet >= 0 ? C.green : C.red, fontWeight: 700 }}>
                            {totalRet >= 0 ? '+' : ''}{fmt(totalRet, i.currency)} ({totalRetPct >= 0 ? '+' : ''}{totalRetPct.toFixed(1)}%)
                          </span>
                        </div>
                      )}

                      {/* CAGR / Interest rate */}
                      {(cagr !== null || i.interestRate > 0) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                          <span style={{ color: C.muted }}>{i.interestRate > 0 && cagr === null ? 'Interest Rate' : 'CAGR'}</span>
                          <span className="num" style={{ color: (cagr ?? i.interestRate ?? 0) >= 0 ? C.green : C.red, fontWeight: 700, fontSize: 13 }}>
                            {(cagr ?? i.interestRate ?? 0) >= 0 ? '' : ''}{(cagr ?? i.interestRate ?? 0).toFixed(1)}% p.a.
                          </span>
                        </div>
                      )}

                      {/* Maturity date for FDs */}
                      {i.maturityDate && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                          <span style={{ color: C.muted }}>Matures</span>
                          <span style={{ color: C.yellow, fontWeight: 600, fontSize: 11 }}>{i.maturityDate}</span>
                        </div>
                      )}
                    </div>

                    {/* Projections */}
                    {displayRate > 0 && i.currentValue > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                          Projected ({cagr !== null ? 'at CAGR' : `at ${displayRate.toFixed(1)}%`})
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {[1, 3, 5].map(yr => (
                            <div key={yr} style={{ flex: 1, background: C.card2, borderRadius: 8, padding: '6px 4px', textAlign: 'center' }}>
                              <div style={{ fontSize: 9, color: C.muted, marginBottom: 2 }}>{yr}yr</div>
                              <div className="num" style={{ fontSize: 11, fontWeight: 700, color: C.green }}>{fmt(i.currentValue * Math.pow(1 + displayRate / 100, yr), i.currency)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      }

      {/* Upload Statement Modal */}
      {showUpload && (
        <Modal title="Scan Investment Statement" onClose={() => { setShowUpload(false); setUploadFile(null); setUploadError('') }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
            Upload or photograph your investment statement. Claude AI will extract all holdings automatically.
          </div>

          {/* Drop zone — click to browse */}
          <div style={{ border: `2px dashed ${uploadFile ? C.accent : C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', marginBottom: 14, background: uploadFile ? C.accent + '08' : 'transparent', cursor: 'pointer' }}
            onClick={() => document.getElementById('inv-scan-input').click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setUploadFile(f) }}>
            {uploadFile ? (
              <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{uploadFile.name}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{(uploadFile.size / 1024).toFixed(0)} KB · Click to change</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Drop file here or click to browse</div>
                <div style={{ fontSize: 11, color: C.muted }}>PDF, JPG, PNG, WEBP, XLSX, CSV supported</div>
              </>
            )}
          </div>

          {/* Hidden file input — general browse */}
          <input id="inv-scan-input" type="file" accept="image/*,application/pdf,.xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => { if (e.target.files[0]) setUploadFile(e.target.files[0]) }} />

          {/* Camera label — opens camera directly on mobile */}
          <label htmlFor="inv-camera-input"
            style={{ width: '100%', padding: '10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.card2, color: C.text, cursor: 'pointer', fontSize: 13, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxSizing: 'border-box' }}>
            📷 Take a Photo
            <input id="inv-camera-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) setUploadFile(e.target.files[0]) }} />
          </label>

          {uploadError && (
            <div style={{ background: C.red + '15', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.red }}>
              {uploadError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={() => { setShowUpload(false); setUploadFile(null); setUploadError('') }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={processUpload} disabled={!uploadFile || uploadProcessing} style={{ flex: 2 }}>
              {uploadProcessing ? '⏳ Scanning...' : '✨ Extract Details'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* Preview / Confirm Holdings Modal */}
      {previewHoldings && (
        <Modal title={`Review Extracted Holdings — ${previewHoldings.docName}`} onClose={() => setPreviewHoldings(null)}>
          {previewHoldings.accountHolder && <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Account: {previewHoldings.accountHolder}</div>}
          {previewHoldings.statementDate && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Statement date: {previewHoldings.statementDate}</div>}
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            Found <strong style={{ color: C.text }}>{previewHoldings.holdings.length}</strong> holdings. Select which to import:
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 14 }}>
            {previewHoldings.holdings.map((h, idx) => {
              const gain = (h.currentValue || 0) - (h.invested || 0)
              const gPct = h.invested > 0 ? ((gain / h.invested) * 100).toFixed(1) : null
              const isSel = selectedHoldings.includes(idx)
              return (
                <div key={idx} onClick={() => setSelectedHoldings(p => p.includes(idx) ? p.filter(x => x !== idx) : [...p, idx])} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: `1px solid ${isSel ? C.accent : C.border}`, background: isSel ? C.accent + '08' : C.card2, marginBottom: 8, cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSel ? C.accent : C.muted}`, background: isSel ? C.accent : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    {isSel && <span style={{ color: '#fff', fontSize: 11, fontWeight: 800 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>{h.name}</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
                      <Badge color={C.accent}>{h.type}</Badge>
                      <Badge color={C.muted}>{h.currency}</Badge>
                      {h.isin && <Badge color={C.muted} style={{ fontSize: 9 }}>{h.isin}</Badge>}
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, flexWrap: 'wrap' }}>
                      {h.invested > 0 && <span style={{ color: C.muted }}>Invested: <span className="num" style={{ color: C.text }}>{fmt(h.invested, h.currency)}</span></span>}
                      {h.currentValue > 0 && <span style={{ color: C.muted }}>Value: <span className="num" style={{ color: C.green }}>{fmt(h.currentValue, h.currency)}</span></span>}
                      {gPct !== null && <span className="num" style={{ color: gain >= 0 ? C.green : C.red, fontWeight: 700 }}>{gain >= 0 ? '+' : ''}{gPct}%</span>}
                      {h.units > 0 && <span style={{ color: C.muted }}>{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(h.units)} units</span>}
                      {h.interestRate > 0 && <span style={{ color: C.yellow }}>{h.interestRate}% p.a.</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={() => setPreviewHoldings(null)} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={() => confirmHoldings(selectedHoldings.map(i => previewHoldings.holdings[i]))} disabled={!selectedHoldings.length} style={{ flex: 2 }}>
              ✅ Import {selectedHoldings.length} Holding{selectedHoldings.length !== 1 ? 's' : ''}
            </Btn>
          </div>
        </Modal>
      )}

      {/* Add / Edit Investment Modal */}
      {showAdd && (
        <Modal title={editing ? 'Edit Investment' : 'Add Investment'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <Input label="Investment name" value={form.name} onChange={f('name')} placeholder="e.g. HDFC Top 100 Fund" />
          <div style={grid2}>
            <Sel label="Type" value={form.type} onChange={f('type')} options={INVESTMENT_TYPES} />
            <Sel label="Country" value={form.country || 'foreign'} onChange={f('country')} options={[['foreign', `Working (${foreignCurrency})`], ['home', `Home (${homeCurrency})`]]} />
          </div>
          <CurrencySel label="Currency" value={form.currency} onChange={f('currency')} />
          <div style={grid2}>
            <Input label="Amount invested" type="number" value={form.invested} onChange={f('invested')} />
            <Input label="Current value" type="number" value={form.currentValue} onChange={f('currentValue')} placeholder="Auto from units×NAV" />
          </div>
          <div style={grid2}>
            <Input label="Units (optional)" type="number" step="0.001" value={form.units} onChange={f('units')} placeholder="e.g. 1234.567" />
            <Input label="NAV / Price (optional)" type="number" step="0.01" value={form.nav} onChange={f('nav')} placeholder="Per unit/share" />
          </div>
          <Input label="Purchase date (optional)" type="date" value={form.purchaseDate} onChange={f('purchaseDate')} />
          <div style={grid2}>
            <Input label="Expected return % p.a." type="number" step="0.1" value={form.expectedReturn} onChange={f('expectedReturn')} placeholder="e.g. 12" />
            <Input label="Interest rate % (FD)" type="number" step="0.1" value={form.interestRate} onChange={f('interestRate')} placeholder="e.g. 7.5" />
          </div>
          <div style={grid2}>
            <Input label="ISIN (optional)" value={form.isin} onChange={f('isin')} placeholder="e.g. INF179K01BB4" />
            <Input label="Folio / Acct No." value={form.folio} onChange={f('folio')} />
          </div>
          <div style={grid2}>
            <Input label="Maturity date (FD)" type="date" value={form.maturityDate} onChange={f('maturityDate')} />
            <Input label="Dividends received" type="number" value={form.dividends} onChange={f('dividends')} placeholder="0" />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update' : 'Add Investment'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Goals ────────────────────────────────────────────────────────────────────
function Goals({ goals, setGoals, goalContribs, setGoalContribs, accounts, remittances, transactions, toINR, foreignCurrency, homeCurrency }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detailGoal, setDetailGoal] = useState(null)
  const [celebration, setCelebration] = useState(null)
  const blank = { name: '', type: 'Other', target: '', saved: '', currency: 'INR', deadline: '', monthlyContribution: '', linkedAccountId: '', priority: 'Medium', notes: '' }
  const [form, setForm] = useState(blank)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const [contribForm, setContribForm] = useState({ amount: '', date: today(), note: '' })
  const [whatIfExtra, setWhatIfExtra] = useState(0)

  const save = () => {
    if (!form.name || !form.target) return
    const item = { ...form, target: parseFloat(form.target) || 0, saved: parseFloat(form.saved) || 0, monthlyContribution: parseFloat(form.monthlyContribution) || 0, id: editing?.id || uid() }
    if (!editing && item.saved >= item.target && item.target > 0) { setCelebration(item.name); setTimeout(() => setCelebration(null), 5000) }
    setGoals(p => editing ? p.map(g => g.id === editing.id ? item : g) : [...p, item])
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const edit = g => { setForm({ ...blank, ...g, target: String(g.target), saved: String(g.saved || 0), monthlyContribution: String(g.monthlyContribution || ''), linkedAccountId: g.linkedAccountId || '' }); setEditing(g); setShowAdd(true) }
  const del = id => { if (confirm('Delete this goal?')) setGoals(p => p.filter(g => g.id !== id)) }

  const addContrib = goalId => {
    const amt = parseFloat(contribForm.amount)
    if (!amt || amt <= 0) return
    setGoalContribs(p => [...p, { id: uid(), goalId, amount: amt, date: contribForm.date, note: contribForm.note }])
    setGoals(p => p.map(g => {
      if (g.id !== goalId) return g
      const newSaved = (g.saved || 0) + amt
      if (newSaved >= g.target && g.target > 0 && (g.saved || 0) < g.target) { setCelebration(g.name); setTimeout(() => setCelebration(null), 5000) }
      return { ...g, saved: newSaved }
    }))
    setContribForm({ amount: '', date: today(), note: '' })
  }

  const goalStatus = g => {
    if (!g.target) return 'No target'
    const pct = (g.saved || 0) / g.target
    if (pct >= 1) return 'Completed'
    if (!g.deadline) return 'Active'
    const now = new Date(), end = new Date(g.deadline)
    const monthsLeft = Math.max(0, (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth()))
    const needed = monthsLeft > 0 ? (g.target - (g.saved || 0)) / monthsLeft : Infinity
    const monthly = g.monthlyContribution || 0
    if (monthly >= needed * 0.95) return 'On Track'
    if (monthly >= needed * 0.7) return 'At Risk'
    return 'Behind'
  }
  const statusColor = s => ({ 'Completed': C.green, 'On Track': C.teal, 'At Risk': C.yellow, 'Behind': C.red }[s] || C.muted)

  const totalSaved = goals.reduce((s, g) => s + (g.saved || 0), 0)
  const totalTarget = goals.reduce((s, g) => s + (g.target || 0), 0)
  const combinedPct = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0
  const onTrack = goals.filter(g => ['On Track', 'Completed'].includes(goalStatus(g))).length
  const behind = goals.filter(g => goalStatus(g) === 'Behind').length
  const monthlyCommit = goals.reduce((s, g) => s + (g.monthlyContribution || 0), 0)
  const latestContribDate = maxDate((goalContribs || []).map(c => c.date))

  // Remittance funding analysis for goals (current month)
  const goalsMon = new Date().toISOString().slice(0, 7)
  const goalsHmAccIds = new Set(accounts.filter(a => a.country === 'home').map(a => a.id))
  const goalsHmDirectIncome = (transactions || [])
    .filter(t => t.type === 'income' && (t.date || '').startsWith(goalsMon) && goalsHmAccIds.has(t.accountId))
    .reduce((s, t) => s + (t.amount || 0), 0)
  const goalsRemitsReceived = (remittances || [])
    .filter(r => (r.date || '').startsWith(goalsMon))
    .reduce((sum, r) => sum + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
  const goalsTotalAvailable = goalsHmDirectIncome + goalsRemitsReceived
  const detailG = detailGoal ? goals.find(g => g.id === detailGoal) : null
  const detailContribs = detailGoal ? (goalContribs || []).filter(c => c.goalId === detailGoal).sort((a, b) => (b.date || '').localeCompare(a.date || '')) : []

  return (
    <div style={pg}>
      {celebration && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: 'linear-gradient(135deg, #d4a84b, #f59e0b)', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 16, boxShadow: '0 16px 48px rgba(212,168,75,0.4)', animation: 'confetti-fly 0.4s ease' }}>
          <span style={{ fontSize: 26 }}>🎉</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#060e1a', letterSpacing: '-0.02em' }}>Goal Achieved: {celebration}!</span>
          <span style={{ fontSize: 26 }}>🏆</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={pgTitle}>Financial Goals</h2><div style={{ fontSize: 13, color: C.muted }}>Track your savings milestones</div></div>
        <Btn onClick={() => { setForm(blank); setEditing(null); setShowAdd(true) }}>+ Add Goal</Btn>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Summary</span>
        <span style={{ fontSize:11, background:C.accent+'22', color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:20, padding:'2px 10px', fontWeight:700 }}>
          {latestContribDate ? `Last contribution: ${fmtDate(latestContribDate)}` : `As of ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-4, repeat(4,1fr))', gap: 10, marginBottom: 16 }}>
        <StatCard label="Total Saved" value={fmt(totalSaved)} color={C.green} icon="💰" />
        <StatCard label="Total Target" value={fmt(totalTarget)} color={C.accent} icon="🎯" />
        <StatCard label="On Track" value={`${onTrack} / ${goals.length}`} color={behind > 0 ? C.yellow : C.green} sub={behind > 0 ? `${behind} behind` : 'All on track'} icon="📈" />
        <StatCard label="Monthly Commitment" value={fmt(monthlyCommit)} color={C.purple} icon="🔄" />
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${C.gold}, ${C.accent})` }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 7 }}>
          <span style={{ color: C.muted }}>Combined Progress</span>
          <span className="num" style={{ color: C.gold, fontWeight: 700 }}>{combinedPct.toFixed(1)}%</span>
        </div>
        <ProgressBar value={totalSaved} max={totalTarget} color={C.gold} height={9} />
      </div>

      {goals.length === 0
        ? <Empty icon="🎯" title="No goals yet" sub="Set targets for house, education, retirement and more" />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {goals.map(g => {
              const pct = g.target > 0 ? Math.min(100, ((g.saved || 0) / g.target) * 100) : 0
              const remaining = (g.target || 0) - (g.saved || 0)
              const status = goalStatus(g)
              const sColor = statusColor(status)
              const monthsLeft = (() => { if (!g.deadline) return null; const now = new Date(), end = new Date(g.deadline); return Math.max(0, (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth())) })()
              const monthlyNeeded = monthsLeft > 0 ? (remaining / monthsLeft) : null
              return (
                <Card key={g.id} lift accent={sColor}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Badge color={sColor}>{status}</Badge>
                      {g.priority && <Badge color={g.priority === 'High' ? C.red : g.priority === 'Medium' ? C.yellow : C.muted}>{g.priority}</Badge>}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <IconBtn onClick={() => edit(g)}>✏️</IconBtn>
                      <IconBtn onClick={() => del(g.id)} danger>🗑️</IconBtn>
                    </div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 2, letterSpacing: '-0.02em' }}>{g.name}</div>
                  {g.type && <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>{g.type}</div>}
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <ProgressBar value={g.saved || 0} max={g.target} color={pct >= 100 ? C.green : C.gold} height={18} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: pct > 25 ? C.card : C.textS }}>{pct.toFixed(0)}%</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 8, marginBottom: 10 }}>
                    <div style={{ background: C.card2, borderRadius: 9, padding: '8px 10px' }}>
                      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Saved</div>
                      <div className="num" style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{fmt(g.saved || 0, g.currency)}</div>
                    </div>
                    <div style={{ background: C.card2, borderRadius: 9, padding: '8px 10px' }}>
                      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Remaining</div>
                      <div className="num" style={{ fontSize: 13, fontWeight: 700, color: remaining <= 0 ? C.green : C.textS }}>{remaining <= 0 ? '🎉 Done!' : fmt(remaining, g.currency)}</div>
                    </div>
                  </div>
                  {g.deadline && <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>🗓 {g.deadline}{monthsLeft !== null ? ` · ${monthsLeft} months left` : ''}</div>}
                  {monthlyNeeded !== null && <div className="num" style={{ fontSize: 11, color: monthlyNeeded <= (g.monthlyContribution || 0) ? C.teal : C.yellow, marginBottom: 6 }}>
                    Need {fmt(Math.round(monthlyNeeded), g.currency)}/mo · Saving {fmt(g.monthlyContribution || 0, g.currency)}/mo
                  </div>}
                  {goalsTotalAvailable > 0 && g.currency === 'INR' && monthlyNeeded !== null && (
                    <div style={{ background: goalsRemitsReceived > 0 ? C.teal + '12' : C.card2, borderRadius: 8, padding: '6px 8px', marginBottom: 10, fontSize: 10 }}>
                      <span style={{ color: C.muted, display:'inline-flex', alignItems:'center', gap:3 }}><Flag currency={homeCurrency} size={11} />Available this month: </span>
                      <span className="num" style={{ color: C.teal, fontWeight: 700 }}>{fmt(goalsTotalAvailable)}</span>
                      {goalsRemitsReceived > 0 && <span style={{ color: C.muted }}> (incl. {fmt(goalsRemitsReceived)} remit)</span>}
                      <span style={{ color: goalsTotalAvailable >= monthlyNeeded ? C.green : C.red }}>
                        {' · '}{goalsTotalAvailable >= monthlyNeeded ? '✓ Covered' : `Gap: ${fmt(Math.round(monthlyNeeded - goalsTotalAvailable))}`}
                      </span>
                    </div>
                  )}
                  <button onClick={() => { setDetailGoal(g.id); setWhatIfExtra(0) }} style={{ width: '100%', background: `${C.accent}18`, border: `1px solid ${C.accent}33`, borderRadius: 9, padding: '7px', color: C.accentL, fontSize: 12, cursor: 'pointer', fontWeight: 600, letterSpacing: '-0.01em' }}>
                    + Add Contribution & Details
                  </button>
                </Card>
              )
            })}
          </div>
        )
      }

      {showAdd && (
        <Modal title={editing ? 'Edit Goal' : 'Add Goal'} onClose={() => { setShowAdd(false); setEditing(null) }} width={520}>
          <div style={grid2}>
            <Input label="Goal name" value={form.name} onChange={f('name')} placeholder="e.g. Home Down Payment" />
            <Sel label="Type" value={form.type} onChange={f('type')} options={GOAL_TYPES} />
          </div>
          <div style={grid2}>
            <Sel label="Priority" value={form.priority} onChange={f('priority')} options={GOAL_PRIORITIES} />
            <CurrencySel label="Currency" value={form.currency} onChange={f('currency')} />
          </div>
          <div style={grid2}>
            <Input label="Target amount" type="number" value={form.target} onChange={f('target')} />
            <Input label="Already saved" type="number" value={form.saved} onChange={f('saved')} />
          </div>
          <div style={grid2}>
            <Input label="Monthly contribution" type="number" value={form.monthlyContribution} onChange={f('monthlyContribution')} placeholder="e.g. 10000" />
            <Input label="Deadline" type="date" value={form.deadline} onChange={f('deadline')} />
          </div>
          <Sel label="Linked account (optional)" value={form.linkedAccountId} onChange={f('linkedAccountId')}
            options={[{ value: '', label: '— None —' }, ...(accounts || []).map(a => ({ value: a.id, label: `${a.name} (${a.currency})` }))]} />
          <Field label="Notes (optional)">
            <textarea value={form.notes} onChange={f('notes')} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Additional notes..." />
          </Field>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update Goal' : 'Add Goal'}</Btn>
          </div>
        </Modal>
      )}

      {detailG && (
        <Modal title={detailG.name} onClose={() => setDetailGoal(null)} width={560}>
          {(() => {
            const pct = detailG.target > 0 ? Math.min(100, ((detailG.saved || 0) / detailG.target) * 100) : 0
            const remaining = (detailG.target || 0) - (detailG.saved || 0)
            const status = goalStatus(detailG)
            const extraRemaining = remaining
            const extraMonthly = (detailG.monthlyContribution || 0) + whatIfExtra
            const projMonths = extraMonthly > 0 && extraRemaining > 0 ? Math.ceil(extraRemaining / extraMonthly) : null
            const projD = projMonths ? (() => { const d = new Date(); d.setMonth(d.getMonth() + projMonths); return d.toISOString().slice(0, 7) })() : null
            const maxA = detailContribs.length > 0 ? Math.max(...detailContribs.slice(0, 8).map(c => c.amount)) : 1
            return (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <Badge color={statusColor(status)}>{status}</Badge>
                  {detailG.priority && <Badge color={detailG.priority === 'High' ? C.red : detailG.priority === 'Medium' ? C.yellow : C.muted}>{detailG.priority}</Badge>}
                  {detailG.type && <Badge color={C.muted}>{detailG.type}</Badge>}
                </div>
                <div style={{ position: 'relative', marginBottom: 14 }}>
                  <ProgressBar value={detailG.saved || 0} max={detailG.target} color={pct >= 100 ? C.green : C.gold} height={26} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: pct > 30 ? '#0d1520' : C.text }}>{pct.toFixed(1)}%</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-3, repeat(3,1fr))', gap: 8, marginBottom: 14 }}>
                  {[{ label: 'Saved', value: fmt(detailG.saved || 0, detailG.currency), color: C.green }, { label: 'Remaining', value: remaining <= 0 ? 'Done!' : fmt(remaining, detailG.currency), color: remaining <= 0 ? C.green : C.text }, { label: 'Target', value: fmt(detailG.target, detailG.currency), color: C.text }].map(({ label, value, color }) => (
                    <div key={label} style={{ background: C.card2, borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>
                {detailG.deadline && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>🗓 Deadline: {detailG.deadline}</div>}
                {detailG.notes && <div style={{ fontSize: 12, color: C.mutedL, background: C.card2, borderRadius: 8, padding: 10, marginBottom: 14 }}>{detailG.notes}</div>}
                <div style={{ background: C.card2, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>What-If: Extra Monthly Contribution</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 6 }}>
                    <span>Extra: <strong style={{ color: C.accent }}>{fmt(whatIfExtra, detailG.currency)}/mo</strong></span>
                    <span>Projected done: <strong style={{ color: projD ? C.green : C.muted }}>{projD || '—'}</strong></span>
                  </div>
                  <input type="range" min={0} max={Math.max(50000, (detailG.monthlyContribution || 0) * 3 + 10000)} step={500}
                    value={whatIfExtra} onChange={e => setWhatIfExtra(Number(e.target.value))} style={{ width: '100%' }} />
                </div>
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Add Contribution</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 8, marginBottom: 8 }}>
                    <input type="number" placeholder="Amount" value={contribForm.amount} onChange={e => setContribForm(p => ({ ...p, amount: e.target.value }))} style={inputStyle} />
                    <input type="date" value={contribForm.date} onChange={e => setContribForm(p => ({ ...p, date: e.target.value }))} style={inputStyle} />
                  </div>
                  <input placeholder="Note (optional)" value={contribForm.note} onChange={e => setContribForm(p => ({ ...p, note: e.target.value }))} style={{ ...inputStyle, marginBottom: 8 }} />
                  <Btn onClick={() => addContrib(detailG.id)} style={{ width: '100%' }}>+ Add Contribution</Btn>
                </div>
                {detailContribs.length > 0 && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Contribution History</div>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 50, marginBottom: 10 }}>
                      {detailContribs.slice(0, 10).map(c => (
                        <div key={c.id} title={`${fmt(c.amount, detailG.currency)} · ${c.date}`}
                          style={{ flex: 1, height: `${Math.max(4, (c.amount / maxA) * 40)}px`, background: `linear-gradient(180deg, ${C.goldL}, ${C.gold})`, borderRadius: 3 }} />
                      ))}
                    </div>
                    <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                      {detailContribs.slice(0, 20).map(c => (
                        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                          <span style={{ color: C.muted }}>{c.date}{c.note ? ` · ${c.note}` : ''}</span>
                          <span style={{ color: C.green, fontWeight: 600 }}>+{fmt(c.amount, detailG.currency)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </Modal>
      )}
    </div>
  )
}

// ─── Loan helpers (module-level) ─────────────────────────────────────────────
const calcEMI = (principal, annualRate, months) => {
  if (!principal || !months || months <= 0) return 0
  if (!annualRate || annualRate <= 0) return principal / months
  const r = annualRate / 100 / 12
  return principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1)
}

const generateSchedule = (principal, annualRate, tenureMonths, extraMonthly = 0) => {
  const r = annualRate > 0 ? annualRate / 100 / 12 : 0
  const baseEMI = calcEMI(principal, annualRate, tenureMonths)
  const payment = baseEMI + (extraMonthly || 0)
  if (payment <= 0) return []
  const rows = []
  let bal = principal
  const startDate = new Date()
  for (let i = 1; bal > 0.01 && i <= tenureMonths + 120; i++) {
    const interest = bal * r
    const principalPaid = Math.min(payment - interest, bal)
    if (principalPaid <= 0) break
    bal = Math.max(0, bal - principalPaid)
    const d = new Date(startDate); d.setMonth(d.getMonth() + i - 1)
    rows.push({ month: i, date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, emi: payment, principal: principalPaid, interest, balance: bal })
    if (bal < 0.01) break
  }
  return rows
}

const downloadScheduleAsCSV = (schedule, loan) => {
  const header = 'Month,Date,EMI,Principal,Interest,Balance\n'
  const rows = schedule.map(r => `${r.month},${r.date},${r.emi.toFixed(2)},${r.principal.toFixed(2)},${r.interest.toFixed(2)},${r.balance.toFixed(2)}`).join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${(loan.name||'loan').replace(/\s+/g,'_')}_schedule.csv`; a.click()
  URL.revokeObjectURL(url)
}

const TX_INVOICE_PROMPT = `You are extracting transaction/expense details from an invoice, receipt, or bill (image, PDF, or text/CSV/Excel).
Return ONLY a valid JSON object with exactly this structure:
{"date":"","amount":0,"currency":"","description":"","category":"Other","type":"expense"}
Rules:
- date: ISO format YYYY-MM-DD, or empty string if not found
- amount: the EXACT total amount as a plain number — strip all commas and currency symbols (e.g. "KWD 1,250.500" → 1250.5, "INR 45,000" → 45000). Preserve decimal precision exactly as shown; do NOT round. 0 if not found
- currency: 3-letter ISO code (e.g. KWD, AED, USD, INR); infer from document headers or symbols if not explicit; empty string if truly unclear
- description: merchant/vendor name or a brief description of what was purchased
- category: pick the best match from this list — Rent, Groceries, Dining, Transport, Utilities, Household, Healthcare, Education, Personal Care, Shopping, Entertainment, Remittance, Loan EMI, Credit Card Bill, Insurance, Investment, Savings, Travel, Subscription, Fees & Charges, Salary, Other Income, Rental Income, Dividends, ATM Withdrawal, Transfer, Other
- type: "expense" for invoices/bills/purchases, "income" for salary slips or incoming payment notices
- For CSV/Excel files: read column headers carefully to identify the amount column; numbers may have comma thousand-separators — always parse them as plain decimals
Return ONLY the JSON object — no text before { or after }\``

const REMIT_EXTRACTION_PROMPT = `You are extracting remittance/money-transfer details from a receipt, screenshot, bank statement, or transaction history file (CSV/Excel).

Return ONLY a valid JSON object with exactly this structure:
{"date":"","amount":0,"fromCurrency":"","rate":0,"received":0,"toCurrency":"INR","recipient":"","fees":0,"purpose":"Family Support","provider":"","notes":""}

Rules:
- date: ISO format YYYY-MM-DD of the most recent or most relevant transaction; empty string if not found
- amount: the EXACT numeric debit/sent amount — strip all commas and currency symbols (e.g. "1,500.000 KWD" → 1500, "KWD 250.500" → 250.5). Preserve decimal precision exactly as shown in the source; do NOT round. 0 if not found
- fromCurrency: 3-letter ISO code of the sending/debit currency (e.g. KWD, AED, USD); infer from column headers or cell labels if not explicit; empty if truly unclear
- rate: exchange rate used (1 fromCurrency = rate toCurrency); look for columns like "Rate", "Exchange Rate", "FX Rate"; 0 if not found
- received: EXACT amount received by beneficiary in toCurrency — strip commas/symbols the same way; preserve decimal precision; 0 if not found
- toCurrency: 3-letter ISO code of the receiving currency; default "INR"
- recipient: beneficiary/receiver name; empty if not shown
- fees: transaction/service fee in fromCurrency as a plain number (strip commas/symbols); 0 if none or not found
- purpose: best guess from context — one of: Family Support, Property Purchase, Investment, Medical, Education, Business, Other
- provider: transfer provider name (e.g. Western Union, MoneyGram, Bank Transfer, Wise, Remitly, NBK, KFH, Burgan); empty if unclear
- notes: reference number, transaction ID, or any useful note; empty if none

IMPORTANT for multi-row files (CSV/Excel transaction history):
- Look for rows that represent outward remittances or international transfers (keywords: remittance, transfer, SWIFT, TT, foreign, overseas, beneficiary)
- If there is only one such row, extract that row
- If there are multiple remittance rows, extract the MOST RECENT one and list all reference numbers in "notes"
- Do NOT sum up multiple rows — extract a single transaction
- Pay close attention to column headers to identify which column holds the sent amount vs. received amount vs. fees
- Numbers in CSV may be formatted with comma thousands-separators (e.g. "1,250.500") — always parse them as plain decimals

Return ONLY the JSON object — no text before { or after }\``

const LOAN_EXTRACTION_PROMPT = `You are extracting loan details from a loan statement document (PDF, image, CSV, or Excel).
Return ONLY a valid JSON object with exactly this structure:
{"lenderName":"","loanType":"Home Loan","accountNumber":"","borrowerName":"","originalPrincipal":0,"outstandingBalance":0,"emi":0,"interestRate":0,"currency":"INR","tenureMonths":0,"remainingMonths":0,"startDate":null,"nextDueDate":null}
Rules:
- All amounts (originalPrincipal, outstandingBalance, emi) must be plain numbers — strip all commas and currency symbols (e.g. "₹15,00,000" → 1500000, "KWD 25,500.000" → 25500); preserve decimal precision; do NOT round
- Indian number formatting uses lakhs: "15,00,000" means 1500000 — parse correctly
- interestRate: annual % as a plain decimal (e.g. "8.5% p.a." → 8.5)
- tenureMonths and remainingMonths: integers only
- startDate and nextDueDate: YYYY-MM-DD format or null
- For CSV/Excel: read column headers carefully to identify which column holds each value; numbers may have comma thousand-separators
Return ONLY the JSON object — no text before { or after }`

// ─── Loans ────────────────────────────────────────────────────────────────────
function Loans({ loans, setLoans, foreignCurrency, homeCurrency, toINR, wkBudgets, setWkBudgets, hmBudgets, setHmBudgets, transactions, setTransactions, accounts }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [calcLoan, setCalcLoan] = useState(null)
  const [extraPay, setExtraPay] = useState('')
  const [showSchedule, setShowSchedule] = useState(null)
  const [scheduleExtra, setScheduleExtra] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importProcessing, setImportProcessing] = useState(false)
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState(null)
  const [loanDupWarning, setLoanDupWarning] = useState(null)
  const [loanFileAlreadyImported, setLoanFileAlreadyImported] = useState(null)
  const [autoAddEMI, setAutoAddEMI] = useState(true)
  const [confirmExtra, setConfirmExtra] = useState(null)
  const blank = { name: '', type: 'Home Loan', lender: '', principal: '', outstanding: '', emi: '', rate: '', currency: 'INR', country: 'home', startDate: '', tenureMonths: '', remainingMonths: '', extraMonthly: '' }
  const [form, setForm] = useState(blank)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const wkLoans = loans.filter(l => l.country === 'foreign')
  const hmLoans = loans.filter(l => l.country === 'home')
  const latestLoanDate = maxDate(loans.map(l => l.asOfDate))

  const calcPayoff = (outstanding, emi, rate, extra = 0) => {
    if (!emi || emi <= 0) return null
    const payment = emi + extra
    const r = (rate || 0) / 100 / 12
    if (r === 0) return { months: Math.ceil(outstanding / payment), interest: 0 }
    if (payment <= outstanding * r) return null
    let bal = outstanding, interest = 0, months = 0
    while (bal > 0.01 && months < 600) { const ic = bal * r; interest += ic; bal = bal + ic - payment; months++ }
    return { months, interest: Math.round(interest) }
  }

  const addToBudget = loan => {
    const catName = `${loan.name} EMI`
    ;(loan.country === 'foreign' ? setWkBudgets : setHmBudgets)(p => {
      if (p.find(b => b.name.toLowerCase() === catName.toLowerCase())) return p
      return [...p, { id: uid(), name: catName, limit: loan.emi || 0 }]
    })
  }

  const save = () => {
    if (!form.name || !form.outstanding) return
    const item = { ...form, principal: parseFloat(form.principal)||0, outstanding: parseFloat(form.outstanding)||0, emi: parseFloat(form.emi)||0, rate: parseFloat(form.rate)||0, tenureMonths: parseInt(form.tenureMonths)||0, remainingMonths: parseInt(form.remainingMonths)||0, extraMonthly: parseFloat(form.extraMonthly)||0, asOfDate: today(), id: editing?.id || uid() }
    setLoans(p => editing ? p.map(l => l.id === editing.id ? item : l) : [...p, item])
    if (autoAddEMI && item.emi > 0) addToBudget(item)
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const del = id => { if (confirm('Delete this loan?')) setLoans(p => p.filter(l => l.id !== id)) }
  const editLoan = l => {
    setForm({ ...blank, ...l, principal: String(l.principal||''), outstanding: String(l.outstanding||''), emi: String(l.emi||''), rate: String(l.rate||''), tenureMonths: String(l.tenureMonths||''), remainingMonths: String(l.remainingMonths||''), extraMonthly: String(l.extraMonthly||'') })
    setEditing(l); setShowAdd(true)
  }

  const applyExtra = (loan, amount) => {
    const catName = `${loan.name} Extra Payment`
    ;(loan.country === 'foreign' ? setWkBudgets : setHmBudgets)(p => {
      const ex = p.find(b => b.name.toLowerCase() === catName.toLowerCase())
      if (ex) return p.map(b => b.name.toLowerCase() === catName.toLowerCase() ? { ...b, limit: amount } : b)
      return [...p, { id: uid(), name: catName, limit: amount }]
    })
    setLoans(p => p.map(l => l.id === loan.id ? { ...l, extraMonthly: amount } : l))
    setConfirmExtra(null)
  }

  const processLoanImport = async () => {
    if (!importFile) return
    setImportProcessing(true); setImportError('')
    try {
      const ext = importFile.name.split('.').pop().toLowerCase()
      let msgContent
      if (ext === 'pdf') {
        const b64 = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.readAsDataURL(importFile) })
        msgContent = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: LOAN_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }]
      } else if (['jpg','jpeg','png','webp','gif'].includes(ext) || importFile.type.startsWith('image/')) {
        const b64 = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.readAsDataURL(importFile) })
        msgContent = [{ type: 'image', source: { type: 'base64', media_type: importFile.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`, data: b64 } }, { type: 'text', text: LOAN_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }]
      } else {
        let text = await importFile.text()
        if (['xls','xlsx'].includes(ext)) { const buf = await importFile.arrayBuffer(); const wb = XLSX.read(buf, { type: 'array' }); text = wb.SheetNames.map(n => `${n}:\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n') }
        msgContent = [{ type: 'text', text: LOAN_EXTRACTION_PROMPT + '\n\nDocument:\n' + text.slice(0, 8000), cache_control: { type: 'ephemeral' } }]
      }
      const data = await anthropicMessages({ model: 'claude-sonnet-4-5', max_tokens: 1000, messages: [{ role: 'user', content: msgContent }] })
      const raw = data.content?.[0]?.text || ''
      const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
      const s = clean.indexOf('{'), e2 = clean.lastIndexOf('}')
      if (s < 0 || e2 < 0) throw new Error('Could not extract JSON from response')
      const parsed = JSON.parse(clean.slice(s, e2 + 1))
      setImportResult(parsed)
      // Check for existing loan with same lender / account number
      const lenderMatch = parsed.lenderName
        ? loans.find(l =>
            l.lender && l.lender.toLowerCase() === parsed.lenderName.toLowerCase() &&
            (!parsed.accountNumber || !l.accountNumber || String(l.accountNumber).slice(-4) === String(parsed.accountNumber).slice(-4))
          )
        : null
      setLoanDupWarning(lenderMatch || null)
    } catch (err) { setImportError(err.message || 'Processing failed') }
    setImportProcessing(false)
  }

  const saveLoanFileToHistory = () => {
    if (!importFile) return
    try {
      const history = JSON.parse(localStorage.getItem('nri_importHistory') || '[]')
      const filtered = history.filter(h => h.fileName !== importFile.name)
      filtered.unshift({ type: 'loan', fileName: importFile.name, importedAt: new Date().toISOString() })
      localStorage.setItem('nri_importHistory', JSON.stringify(filtered.slice(0, 100)))
    } catch {}
  }

  const applyImportResult = () => {
    if (!importResult) return
    const r = importResult
    setForm({ name: r.lenderName ? `${r.loanType||'Loan'} - ${r.lenderName}` : (r.loanType||'Loan'), type: r.loanType||'Home Loan', lender: r.lenderName||'', principal: String(r.originalPrincipal||''), outstanding: String(r.outstandingBalance||''), emi: String(r.emi||''), rate: String(r.interestRate||''), currency: r.currency||'INR', country: (r.currency||'INR')==='INR' ? 'home' : 'foreign', startDate: r.startDate||'', tenureMonths: String(r.tenureMonths||''), remainingMonths: String(r.remainingMonths||''), extraMonthly: '' })
    saveLoanFileToHistory()
    setEditing(null); setShowImport(false); setImportResult(null); setImportFile(null); setLoanDupWarning(null); setLoanFileAlreadyImported(null); setShowAdd(true)
  }

  const applyImportResultAsUpdate = () => {
    if (!importResult || !loanDupWarning) return
    const r = importResult
    const existing = loanDupWarning
    setForm({
      ...blank, ...existing,
      principal: String(r.originalPrincipal || existing.principal || ''),
      outstanding: String(r.outstandingBalance || ''),
      emi: String(r.emi || existing.emi || ''),
      rate: String(r.interestRate || existing.rate || ''),
      remainingMonths: String(r.remainingMonths || existing.remainingMonths || ''),
      tenureMonths: String(r.tenureMonths || existing.tenureMonths || ''),
    })
    saveLoanFileToHistory()
    setEditing(existing); setShowImport(false); setImportResult(null); setImportFile(null); setLoanDupWarning(null); setLoanFileAlreadyImported(null); setShowAdd(true)
  }

  // Returns expense transactions that match this loan's EMI payments
  const getEMIHistory = loan => {
    const nameLower = (loan.name || '').toLowerCase()
    const lenderLower = (loan.lender || '').toLowerCase()

    const sameCountryAccIds = new Set(
      (accounts || []).filter(a => a.country === loan.country).map(a => a.id)
    )
    const isSameCountry = t => t.accountId
      ? sameCountryAccIds.has(t.accountId)
      : (t.currency || '').toUpperCase() === (loan.currency || '').toUpperCase()

    return (transactions || []).filter(t => {
      // Accept expense OR transfer type — some EMI transactions may be wrongly tagged as transfer
      if (t.type === 'income') return false
      const cat = (t.category || '').toLowerCase()
      const desc = (t.description || '').toLowerCase()

      // Highest priority: explicitly matched to this loan during import
      if (t.matchedLoanId === loan.id) return true

      // Primary: Loan EMI category from same country
      if ((cat === 'loan emi' || cat === 'emi') && isSameCountry(t)) return true

      // Secondary: loan name or lender appears in description
      if (nameLower && nameLower.length >= 4 && desc.includes(nameLower)) return true
      if (lenderLower && lenderLower.length >= 4 && desc.includes(lenderLower)) return true

      // Tertiary: any EMI keyword OR exchange company + same country + amount close to loan EMI (5%)
      if (isSameCountry(t) && loan.emi > 0 && Math.abs(t.amount - loan.emi) / loan.emi < 0.05 &&
          (isEMIPayment(t.description) || isExchangeCompany(t.description))) return true

      return false
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }

  // Returns the next upcoming due date based on loan start day-of-month (default: 5th)
  const getNextDueDate = loan => {
    const today = new Date()
    const dueDay = loan.startDate ? (parseInt(loan.startDate.split('-')[2]) || 5) : 5
    const thisMonthDue = new Date(today.getFullYear(), today.getMonth(), dueDay)
    return thisMonthDue >= today
      ? thisMonthDue
      : new Date(today.getFullYear(), today.getMonth() + 1, dueDay)
  }

  // Creates an expense transaction marking the EMI as paid + reduces outstanding balance
  const markEMIPaid = (loan, dueDate) => {
    const acct = (accounts || []).find(a => a.country === loan.country && a.currency === loan.currency)
      || (accounts || []).find(a => a.country === loan.country)
    const tx = {
      id: uid(),
      date: dueDate.toISOString().slice(0, 10),
      description: `${loan.name} EMI`,
      amount: loan.emi,
      currency: loan.currency,
      type: 'expense',
      category: 'Loan EMI',
      accountId: acct?.id || null,
      matchedLoanId: loan.id,
    }
    setTransactions(p => [tx, ...p])
    // Reduce outstanding balance: EMI - interest = principal portion
    const r = (loan.rate || 0) / 100 / 12
    const interest = (loan.outstanding || 0) * r
    const principal = Math.max(0, loan.emi - interest)
    const newOutstanding = Math.max(0, (loan.outstanding || 0) - principal)
    setLoans(p => p.map(l => l.id === loan.id
      ? { ...l, outstanding: Math.round(newOutstanding * 100) / 100, remainingMonths: Math.max(0, (l.remainingMonths || 0) - 1), asOfDate: today() }
      : l
    ))
  }

  const LoanCard = ({ l }) => {
    const paidPct = l.principal > 0 ? ((l.principal - l.outstanding) / l.principal) * 100 : 0
    const base = l.emi > 0 ? calcPayoff(l.outstanding, l.emi, l.rate) : null
    const withEx = l.emi > 0 && l.extraMonthly > 0 ? calcPayoff(l.outstanding, l.emi, l.rate, l.extraMonthly) : null
    const fmtPayoff = months => { if (!months) return null; const d = new Date(); d.setMonth(d.getMonth() + months); return d.toLocaleDateString('default', { month: 'short', year: 'numeric' }) }
    const mSaved = base && withEx ? base.months - withEx.months : 0
    const iSaved = base && withEx ? base.interest - withEx.interest : 0

    // Next due date (needed for paidThisMonth check below)
    const nextDue = getNextDueDate(l)
    const nextDueLabel = nextDue.toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })

    // EMI history: last 3 calendar months
    const emiHistory = getEMIHistory(l)
    const last3Months = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (2 - i))
      return d.toISOString().slice(0, 7)
    })
    // Check if the upcoming EMI's month has already been paid
    const nextDueMonStr = nextDue.toISOString().slice(0, 7)
    const paidThisMonth = emiHistory.some(t => (t.date || '').startsWith(nextDueMonStr))

    return (
      <Card lift accent={C.yellow}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge color={C.yellow}>{l.type}</Badge>
            {l.country === 'foreign' ? <Badge color={C.teal}>{foreignCurrency}</Badge> : <Badge color={C.purple}>INR</Badge>}
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <IconBtn onClick={() => editLoan(l)}>✏️</IconBtn>
            <IconBtn onClick={() => del(l.id)}>🗑️</IconBtn>
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 2 }}>{l.name}</div>
        {l.lender && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{l.lender}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 8, marginBottom: 10 }}>
          <div style={{ background: `${C.red}0e`, border: `1px solid ${C.red}22`, borderRadius: 9, padding: 10 }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Outstanding</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 800, color: C.red }}>{fmt(l.outstanding, l.currency)}</div>
          </div>
          <div style={{ background: `${C.yellow}0e`, border: `1px solid ${C.yellow}22`, borderRadius: 9, padding: 10 }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>EMI/mo</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 800, color: C.yellow }}>{fmt(l.emi, l.currency)}</div>
          </div>
        </div>
        {(l.rate > 0 || l.remainingMonths > 0) && (
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
            {l.rate > 0 && <span>⚡ {l.rate}% p.a.</span>}
            {l.remainingMonths > 0 && <span style={{ marginLeft: 8 }}>🗓 {l.remainingMonths} months left</span>}
          </div>
        )}
        {l.extraMonthly > 0 && (
          <div style={{ fontSize: 12, color: C.green, background: `${C.green}0e`, borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
            ➕ {fmt(l.extraMonthly, l.currency)}/mo extra · saves {mSaved > 0 ? `${mSaved} months & ${fmt(iSaved, l.currency)}` : '—'}
          </div>
        )}
        {l.principal > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 4 }}>
              <span>Repaid {paidPct.toFixed(0)}%</span>
              <span>{fmt(l.principal - l.outstanding, l.currency)} / {fmt(l.principal, l.currency)}</span>
            </div>
            <ProgressBar value={l.principal - l.outstanding} max={l.principal} color={C.teal} />
          </div>
        )}
        {base && (
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
            📅 Payoff: <strong style={{ color: C.textS }}>{fmtPayoff(base.months)}</strong>
            {withEx && fmtPayoff(withEx.months) !== fmtPayoff(base.months) && (
              <> · With extra: <strong style={{ color: C.green }}>{fmtPayoff(withEx.months)}</strong></>
            )}
          </div>
        )}

        {/* Upcoming EMI */}
        {l.emi > 0 && (
          <div style={{ background: paidThisMonth ? `${C.green}0a` : `${C.yellow}0a`, border: `1px solid ${paidThisMonth ? C.green : C.yellow}33`, borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Upcoming EMI</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                  <span className="num">{fmt(l.emi, l.currency)}</span>
                  <span style={{ color: C.muted, fontWeight: 400 }}> · Due {nextDueLabel}</span>
                </div>
              </div>
              {paidThisMonth
                ? <span style={{ fontSize: 11, color: C.green, fontWeight: 700, whiteSpace: 'nowrap' }}>✅ Paid</span>
                : <button onClick={() => markEMIPaid(l, nextDue)}
                    style={{ background: C.green, border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 11, color: '#fff', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    ✅ Mark Paid
                  </button>
              }
            </div>
          </div>
        )}

        {/* Last 3 months EMI history */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 7 }}>EMI Payment History</div>
          {last3Months.map(m => {
            const paid = emiHistory.filter(t => (t.date || '').startsWith(m))
            const total = paid.reduce((s, t) => s + (t.amount || 0), 0)
            const mLabel = new Date(m + '-01').toLocaleDateString('default', { month: 'short', year: 'numeric' })
            const dateStr = paid.length ? paid[0].date?.slice(8) + ' ' + mLabel.split(' ')[0] : null
            return (
              <div key={m} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: C.muted, minWidth: 70 }}>{mLabel}</span>
                {paid.length > 0
                  ? <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✅ <span className="num">{fmt(total, l.currency)}</span><span style={{ color: C.muted, fontWeight: 400 }}> · {dateStr}</span></span>
                  : <span style={{ fontSize: 11, color: C.mutedL }}>— not recorded</span>
                }
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => { setCalcLoan(l); setExtraPay(l.extraMonthly ? String(l.extraMonthly) : '') }}
            style={{ flex: 1, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 7, padding: 6, fontSize: 12, color: C.accent, cursor: 'pointer', fontWeight: 600 }}>
            🧮 Calculator
          </button>
          <button onClick={() => { setShowSchedule(l); setScheduleExtra(l.extraMonthly ? String(l.extraMonthly) : '') }}
            style={{ flex: 1, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 7, padding: 6, fontSize: 12, color: C.teal, cursor: 'pointer', fontWeight: 600 }}>
            📊 Schedule
          </button>
        </div>
      </Card>
    )
  }

  const LoanSection = ({ title, flag, loanList, totalOut, totalEMIVal, currency, color }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '12px 16px', background: C.card, border: `1px solid ${color}22`, borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>{flag}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{loanList.length} loan{loanList.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: C.muted }}>Outstanding</div>
            <div className="num" style={{ fontSize: 15, fontWeight: 700, color: C.red }}>{fmt(totalOut, currency)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: C.muted }}>EMI/mo</div>
            <div className="num" style={{ fontSize: 15, fontWeight: 700, color: C.yellow }}>{fmt(totalEMIVal, currency)}</div>
          </div>
        </div>
      </div>
      {loanList.length === 0
        ? <div style={{ textAlign: 'center', padding: 24, color: C.muted, fontSize: 13, background: C.card2, borderRadius: 10, border: `1px dashed ${C.border}` }}>No loans in this category</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
            {loanList.map(l => <LoanCard key={l.id} l={l} />)}
          </div>
      }
    </div>
  )

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={pgTitle}>Loans & EMIs</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="subtle" onClick={() => { setImportFile(null); setImportError(''); setImportResult(null); setShowImport(true) }}>📄 Upload or Scan Document</Btn>
          <Btn onClick={() => { setForm(blank); setEditing(null); setShowAdd(true) }}>+ Add Loan</Btn>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Summary</span>
        <span style={{ fontSize:11, background:C.red+'22', color:C.red, border:`1px solid ${C.red}44`, borderRadius:20, padding:'2px 10px', fontWeight:700 }}>
          {latestLoanDate ? `Updated: ${fmtDate(latestLoanDate)}` : `As of ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-4, repeat(4,1fr))', gap: 12, marginBottom: 22 }}>
        <StatCard label="Total Outstanding" value={fmt(wkLoans.reduce((s,l)=>s+toINR(l.outstanding||0,l.currency),0) + hmLoans.reduce((s,l)=>s+(l.outstanding||0),0))} color={C.red} icon="💸" />
        <StatCard label="Monthly EMI" value={fmt(wkLoans.reduce((s,l)=>s+toINR(l.emi||0,l.currency),0) + hmLoans.reduce((s,l)=>s+(l.emi||0),0))} color={C.yellow} icon="📅" />
        <StatCard label="Working Country" value={fmt(wkLoans.reduce((s,l)=>s+(l.outstanding||0),0), foreignCurrency)} color={C.teal} sub={`${fmt(wkLoans.reduce((s,l)=>s+(l.emi||0),0), foreignCurrency)}/mo`} icon={<Flag currency={foreignCurrency} size={20} />} />
        <StatCard label="Home Country" value={fmt(hmLoans.reduce((s,l)=>s+(l.outstanding||0),0))} color={C.purple} sub={`${fmt(hmLoans.reduce((s,l)=>s+(l.emi||0),0))}/mo`} icon={<Flag currency={homeCurrency} size={20} />} />
      </div>

      <LoanSection title="Working Country Loans" flag={<Flag currency={foreignCurrency} size={22} />} loanList={wkLoans}
        totalOut={wkLoans.reduce((s,l)=>s+(l.outstanding||0),0)} totalEMIVal={wkLoans.reduce((s,l)=>s+(l.emi||0),0)}
        currency={foreignCurrency} color={C.teal} />
      <LoanSection title="Home Country Loans" flag={<Flag currency={homeCurrency} size={22} />} loanList={hmLoans}
        totalOut={hmLoans.reduce((s,l)=>s+(l.outstanding||0),0)} totalEMIVal={hmLoans.reduce((s,l)=>s+(l.emi||0),0)}
        currency={homeCurrency} color={C.purple} />

      {/* Amortisation Schedule Modal */}
      {showSchedule && (() => {
        const extra = parseFloat(scheduleExtra) || 0
        const tenure = showSchedule.remainingMonths || showSchedule.tenureMonths || 120
        const sched = generateSchedule(showSchedule.outstanding, showSchedule.rate, tenure, extra)
        const schedBase = extra > 0 ? generateSchedule(showSchedule.outstanding, showSchedule.rate, tenure, 0) : null
        const totalInt = sched.reduce((s, r) => s + r.interest, 0)
        const totalIntBase = schedBase ? schedBase.reduce((s, r) => s + r.interest, 0) : 0
        return (
          <Modal title={`Amortisation Schedule — ${showSchedule.name}`} onClose={() => setShowSchedule(null)} width={720}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px' }}>
                <Input label="Extra monthly payment" type="number" value={scheduleExtra} onChange={e => setScheduleExtra(e.target.value)} placeholder="0" />
              </div>
              <Btn variant="subtle" onClick={() => downloadScheduleAsCSV(sched, showSchedule)}>⬇️ CSV</Btn>
              {extra > 0 && <Btn style={{ background: C.green }} onClick={() => setConfirmExtra({ loan: showSchedule, amount: extra })}>Set as Budget</Btn>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: extra > 0 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div style={{ background: C.card2, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: C.muted }}>Months to payoff</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{sched.length}</div>
              </div>
              <div style={{ background: C.card2, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: C.muted }}>Total Interest</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: C.red }}>{fmt(totalInt, showSchedule.currency)}</div>
              </div>
              {extra > 0 && schedBase && (
                <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}33`, borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: C.green }}>Interest saved with extra</div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{fmt(totalIntBase - totalInt, showSchedule.currency)}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{schedBase.length - sched.length} months shorter</div>
                </div>
              )}
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto', borderRadius: 8, border: `1px solid ${C.border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.card2, position: 'sticky', top: 0 }}>
                    {['#', 'Date', 'EMI', 'Principal', 'Interest', 'Balance'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: h === '#' ? 'center' : 'right', color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sched.slice(0, 120).map((r, i) => (
                    <tr key={r.month} style={{ background: i % 2 ? `${C.card2}66` : 'transparent' }}>
                      <td style={{ padding: '5px 10px', textAlign: 'center', color: C.muted, fontSize: 11 }}>{r.month}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: C.textS }}>{r.date}</td>
                      <td className="num" style={{ padding: '5px 10px', textAlign: 'right' }}>{fmt(r.emi, showSchedule.currency)}</td>
                      <td className="num" style={{ padding: '5px 10px', textAlign: 'right', color: C.green }}>{fmt(r.principal, showSchedule.currency)}</td>
                      <td className="num" style={{ padding: '5px 10px', textAlign: 'right', color: C.red }}>{fmt(r.interest, showSchedule.currency)}</td>
                      <td className="num" style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(r.balance, showSchedule.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sched.length > 120 && <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 8 }}>Showing first 120 of {sched.length} months · Download CSV for full schedule</div>}
          </Modal>
        )
      })()}

      {/* Repayment Calculator Modal */}
      {calcLoan && (() => {
        const base = calcPayoff(calcLoan.outstanding, calcLoan.emi, calcLoan.rate)
        const extra = parseFloat(extraPay) || 0
        const withEx = extra > 0 ? calcPayoff(calcLoan.outstanding, calcLoan.emi, calcLoan.rate, extra) : null
        const mSaved = base && withEx ? base.months - withEx.months : 0
        const iSaved = base && withEx ? base.interest - withEx.interest : 0
        const fmtDate = months => { if (!months) return '—'; const d = new Date(); d.setMonth(d.getMonth() + months); return d.toLocaleDateString('default', { month: 'long', year: 'numeric' }) }
        return (
          <Modal title={`Repayment Calculator — ${calcLoan.name}`} onClose={() => setCalcLoan(null)} width={520}>
            <div style={{ background: C.card2, borderRadius: 8, padding: 12, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, fontSize: 12 }}>
              <div><div style={{ color: C.muted }}>Outstanding</div><div className="num" style={{ fontWeight: 700 }}>{fmt(calcLoan.outstanding, calcLoan.currency)}</div></div>
              <div><div style={{ color: C.muted }}>EMI/mo</div><div className="num" style={{ fontWeight: 700 }}>{fmt(calcLoan.emi, calcLoan.currency)}</div></div>
              <div><div style={{ color: C.muted }}>Rate</div><div style={{ fontWeight: 700 }}>{calcLoan.rate}% p.a.</div></div>
            </div>
            <Input label="Extra monthly payment (on top of EMI)" type="number" value={extraPay} onChange={e => setExtraPay(e.target.value)} placeholder="e.g. 5000" />
            {base ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                  <div style={{ background: C.card2, borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Without extra</div>
                    <div className="num" style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{base.months}<span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}> mo</span></div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Interest: <span className="num" style={{ color: C.red }}>{fmt(base.interest, calcLoan.currency)}</span></div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Payoff: {fmtDate(base.months)}</div>
                  </div>
                  <div style={{ background: extra > 0 ? `${C.green}12` : C.card2, border: extra > 0 ? `1px solid ${C.green}33` : 'none', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: extra > 0 ? C.green : C.muted, marginBottom: 6 }}>With +{fmt(extra, calcLoan.currency)}/mo</div>
                    <div className="num" style={{ fontSize: 22, fontWeight: 800, color: extra > 0 ? C.green : C.text }}>{(withEx||base).months}<span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}> mo</span></div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Interest: <span className="num" style={{ color: extra > 0 ? C.green : C.red }}>{fmt((withEx||base).interest, calcLoan.currency)}</span></div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Payoff: {fmtDate((withEx||base).months)}</div>
                  </div>
                </div>
                {mSaved > 0 && (
                  <div style={{ background: `${C.green}15`, border: `1px solid ${C.green}44`, borderRadius: 8, padding: 12, textAlign: 'center', marginTop: 10 }}>
                    <div style={{ fontSize: 15, color: C.green, fontWeight: 700 }}>Save {mSaved} months & {fmt(iSaved, calcLoan.currency)} in interest!</div>
                  </div>
                )}
                {extra > 0 && (
                  <Btn style={{ marginTop: 12, width: '100%', background: C.green }} onClick={() => { setConfirmExtra({ loan: calcLoan, amount: extra }); setCalcLoan(null) }}>
                    ✅ Add {fmt(extra, calcLoan.currency)}/mo Extra to Budget
                  </Btn>
                )}
              </>
            ) : <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>Set EMI and interest rate on the loan to calculate payoff.</div>}
            <Btn variant="ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => setCalcLoan(null)}>Close</Btn>
          </Modal>
        )
      })()}

      {/* Confirm Extra Payment in Budget */}
      {confirmExtra && (
        <Modal title="Add Extra Payment to Budget" onClose={() => setConfirmExtra(null)} width={400}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 14 }}>
            Add <strong className="num">{fmt(confirmExtra.amount, confirmExtra.loan.currency)}/mo</strong> extra payment for <strong>{confirmExtra.loan.name}</strong> to your {confirmExtra.loan.country === 'foreign' ? 'Working Country' : 'Home Country'} budget?
          </div>
          <div style={{ fontSize: 12, color: C.muted, background: C.card2, borderRadius: 8, padding: '8px 12px', marginBottom: 18 }}>
            Creates/updates budget category "{confirmExtra.loan.name} Extra Payment" and saves the extra amount on the loan.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={() => setConfirmExtra(null)} style={{ flex: 1 }}>Cancel</Btn>
            <Btn style={{ flex: 1, background: C.green }} onClick={() => applyExtra(confirmExtra.loan, confirmExtra.amount)}>Confirm</Btn>
          </div>
        </Modal>
      )}

      {/* Import Loan Statement Modal */}
      {showImport && (
        <Modal title="Import Loan Statement" onClose={() => { setShowImport(false); setImportResult(null); setImportFile(null); setLoanDupWarning(null); setLoanFileAlreadyImported(null) }} width={480}>
          {!importResult ? (
            <>
              <div style={{ background: C.card2, border: `2px dashed ${C.border}`, borderRadius: 10, padding: 24, textAlign: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textS, marginBottom: 6 }}>Upload your loan statement</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>PDF, image (JPG/PNG/WebP), Excel, or CSV</div>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls"
                  onChange={e => {
                    const f = e.target.files[0]
                    if (!f) return
                    setImportFile(f); setImportError('')
                    try {
                      const history = JSON.parse(localStorage.getItem('nri_importHistory') || '[]')
                      setLoanFileAlreadyImported(history.find(h => h.fileName === f.name) || null)
                    } catch { setLoanFileAlreadyImported(null) }
                  }}
                  style={{ fontSize: 12, color: C.muted }} />
                {importFile && <div style={{ fontSize: 12, color: C.green, marginTop: 10 }}>📎 {importFile.name}</div>}
              </div>
              {loanFileAlreadyImported && (
                <div style={{ background: C.red+'15', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: C.red, marginBottom: 3 }}>🚫 This file was already imported</div>
                  <div style={{ color: C.mutedL }}>
                    <strong style={{ color: C.textS }}>{loanFileAlreadyImported.fileName}</strong> was imported on{' '}
                    <strong style={{ color: C.textS }}>{new Date(loanFileAlreadyImported.importedAt).toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>.
                    {' '}Re-importing will overwrite the existing loan details.
                  </div>
                </div>
              )}
              <div style={{ background: C.teal+'15', border: `1px solid ${C.teal}44`, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12, color: C.mutedL, lineHeight: 1.6 }}>
                🏷️ <strong style={{ color: C.teal }}>Review before saving:</strong> AI will extract loan details from your statement, but figures like the interest rate, outstanding balance, or tenure may need manual correction. You'll review everything before it's added.
              </div>
              {importError && <div style={{ background: `${C.red}15`, border: `1px solid ${C.red}33`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.red, marginBottom: 12 }}>{importError}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="ghost" onClick={() => setShowImport(false)} style={{ flex: 1 }}>Cancel</Btn>
                <Btn onClick={processLoanImport} disabled={!importFile || importProcessing} style={{ flex: 1 }}>
                  {importProcessing ? '⏳ Extracting...' : '🤖 Extract with AI'}
                </Btn>
              </div>
            </>
          ) : (
            <>
              {loanDupWarning && (
                <div style={{ background: C.yellow+'18', border: `1px solid ${C.yellow}44`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: C.yellow, marginBottom: 4 }}>⚠️ Loan already exists</div>
                  <div style={{ color: C.mutedL }}>
                    <strong style={{ color: C.textS }}>{loanDupWarning.name}</strong> from <strong style={{ color: C.textS }}>{loanDupWarning.lender}</strong> is already in your loans.
                    You can update it with the fresh figures below, or add this as a separate loan entry.
                  </div>
                </div>
              )}
              <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}33`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: C.green, fontWeight: 700, marginBottom: 10 }}>✅ Loan details extracted</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  {importResult.lenderName && <div><span style={{ color: C.muted }}>Lender: </span><strong>{importResult.lenderName}</strong></div>}
                  {importResult.loanType && <div><span style={{ color: C.muted }}>Type: </span><strong>{importResult.loanType}</strong></div>}
                  {importResult.outstandingBalance > 0 && <div><span style={{ color: C.muted }}>Outstanding: </span><strong className="num">{fmt(importResult.outstandingBalance, importResult.currency)}</strong></div>}
                  {importResult.emi > 0 && <div><span style={{ color: C.muted }}>EMI: </span><strong className="num">{fmt(importResult.emi, importResult.currency)}</strong></div>}
                  {importResult.interestRate > 0 && <div><span style={{ color: C.muted }}>Rate: </span><strong>{importResult.interestRate}% p.a.</strong></div>}
                  {importResult.remainingMonths > 0 && <div><span style={{ color: C.muted }}>Remaining: </span><strong>{importResult.remainingMonths} months</strong></div>}
                  {importResult.currency && <div><span style={{ color: C.muted }}>Currency: </span><strong>{importResult.currency}</strong></div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="ghost" onClick={() => { setImportResult(null); setImportFile(null); setLoanDupWarning(null) }} style={{ flex: 1 }}>Re-upload</Btn>
                {loanDupWarning
                  ? <>
                      <Btn variant="ghost" onClick={applyImportResult} style={{ flex: 1 }}>Add as New</Btn>
                      <Btn onClick={applyImportResultAsUpdate} style={{ flex: 1, background: C.yellow, color: '#000' }}>Update Existing</Btn>
                    </>
                  : <Btn onClick={applyImportResult} style={{ flex: 1 }}>Use These Details →</Btn>
                }
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Add / Edit Loan Modal */}
      {showAdd && (
        <Modal title={editing ? 'Edit Loan' : 'Add Loan'} onClose={() => { setShowAdd(false); setEditing(null) }} width={500}>
          <Input label="Loan name" value={form.name} onChange={f('name')} placeholder="e.g. SBI Home Loan" />
          <div style={grid2}>
            <Sel label="Type" value={form.type} onChange={f('type')} options={LOAN_TYPES} />
            <Sel label="Country" value={form.country} onChange={f('country')} options={[{ value: 'home', label: 'Home Country' }, { value: 'foreign', label: 'Working Country' }]} />
          </div>
          <div style={grid2}>
            <Input label="Lender" value={form.lender} onChange={f('lender')} placeholder="e.g. State Bank of India" />
            <CurrencySel label="Currency" value={form.currency} onChange={f('currency')} />
          </div>
          <div style={grid2}>
            <Input label="Original principal" type="number" value={form.principal} onChange={f('principal')} />
            <Input label="Outstanding balance" type="number" value={form.outstanding} onChange={f('outstanding')} />
          </div>
          <div style={grid2}>
            <Input label="Monthly EMI" type="number" value={form.emi} onChange={f('emi')} />
            <Input label="Interest rate % p.a." type="number" step="0.1" value={form.rate} onChange={f('rate')} />
          </div>
          <div style={grid2}>
            <Input label="Tenure (months)" type="number" value={form.tenureMonths} onChange={f('tenureMonths')} />
            <Input label="Months remaining" type="number" value={form.remainingMonths} onChange={f('remainingMonths')} />
          </div>
          <div style={grid2}>
            <Input label="Start date" type="date" value={form.startDate} onChange={f('startDate')} />
            <Input label="Extra payment/mo" type="number" value={form.extraMonthly} onChange={f('extraMonthly')} placeholder="0" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card2, borderRadius: 8, padding: '10px 12px', marginTop: 4 }}>
            <input type="checkbox" id="autoEMI" checked={autoAddEMI} onChange={e => setAutoAddEMI(e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
            <label htmlFor="autoEMI" style={{ fontSize: 13, color: C.textS, cursor: 'pointer' }}>Auto-add EMI as budget category</label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update Loan' : 'Add Loan'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Family ───────────────────────────────────────────────────────────────────
function Family({ familyMembers, setFamilyMembers, remittances, foreignCurrency }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const blank = { name: '', relation: 'Parent', city: '', phone: '' }
  const [form, setForm] = useState(blank)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = () => {
    if (!form.name) return
    const item = { ...form, id: editing?.id || uid() }
    setFamilyMembers(p => editing ? p.map(m => m.id === editing.id ? item : m) : [...p, item])
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const edit = m => { setForm({ ...m }); setEditing(m); setShowAdd(true) }
  const del = id => setFamilyMembers(p => p.filter(m => m.id !== id))
  const sentTo = name => (remittances || []).filter(r => r.recipient === name).reduce((s, r) => s + (r.amount || 0), 0)
  const relIcon = r => ({ Parent: '👴', Spouse: '💑', Child: '👶', Sibling: '👤' }[r] || '👤')

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={pgTitle}>Family Members</h2>
        <Btn onClick={() => setShowAdd(true)}>+ Add Member</Btn>
      </div>

      {familyMembers.length === 0
        ? <Empty icon="👨‍👩‍👧" title="No family members" sub="Add family members in India to track remittances" />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {familyMembers.map(m => {
              const sent = sentTo(m.name)
              return (
                <Card key={m.id} lift accent={C.purple}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}33, ${C.purple}18)`, border: `1.5px solid ${C.purple}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                      {relIcon(m.relation)}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <IconBtn onClick={() => edit(m)}>✏️</IconBtn>
                      <IconBtn onClick={() => del(m.id)}>🗑️</IconBtn>
                    </div>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4, letterSpacing: '-0.02em' }}>{m.name}</div>
                  <Badge color={C.purple}>{m.relation}</Badge>
                  {m.city && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>📍 {m.city}</div>}
                  {m.phone && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>📞 {m.phone}</div>}
                  {sent > 0 && (
                    <div style={{ background: `linear-gradient(135deg, ${C.green}12, ${C.green}06)`, border: `1px solid ${C.green}33`, borderRadius: 10, padding: '10px 12px', marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total remitted</div>
                      <div className="num" style={{ fontSize: 15, fontWeight: 800, color: C.green }}>{fmt(sent, foreignCurrency)}</div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )
      }

      {showAdd && (
        <Modal title={editing ? 'Edit Family Member' : 'Add Family Member'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <Input label="Name" value={form.name} onChange={f('name')} placeholder="e.g. Mom, Dad" />
          <Sel label="Relation" value={form.relation} onChange={f('relation')} options={RELATIONS} />
          <Input label="City in India (optional)" value={form.city} onChange={f('city')} placeholder="e.g. Mumbai" />
          <Input label="Phone (optional)" value={form.phone} onChange={f('phone')} placeholder="+91 98765 43210" />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update Member' : 'Add Member'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Estelle launcher button ──────────────────────────────────────────────────
// Static (no float/nod/glow/blink animations) launcher for the Estelle chat.
// Placed bottom-LEFT so it never collides with the scroll arrows (bottom-right)
// or covers the sidebar account info / main content.
function FloatingEstelle({ onOpen }) {
  return (
    <button onClick={onOpen} title="Chat with Estelle" aria-label="Chat with Estelle"
      className="estelle-launcher"
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 60,
        width: 56, height: 56, borderRadius: '50%', padding: 0,
        border: '3px solid #c9a961', background: '#c9a961', cursor: 'pointer',
        overflow: 'hidden', boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <img src="/estelle-avatar.jpg" alt="Estelle" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="font-size:26px;font-weight:900;color:#0c1929">E</span>' }} />
    </button>
  )
}

// ─── Estelle — AI Finance BFF ─────────────────────────────────────────────────
function EstelleAvatar({ size = 40 }) {
  const s = typeof size === 'number' ? size : parseInt(size)
  return (
    <div style={{
      width: s, height: s, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      border: '2px solid #c9a961', boxShadow: '0 0 0 2px #0c1929, 0 0 0 4px #c9a961',
      backgroundColor: '#c9a961',
    }}>
      <img
        src="/estelle-avatar.jpg"
        alt="Estelle"
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }}
        onError={e => {
          e.target.style.display = 'none'
          e.target.parentElement.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:${Math.round(s * 0.45)}px;font-weight:900;color:#0c1929">E</div>`
        }}
      />
    </div>
  )
}

function Estelle({ aiMessages, aiInput, setAiInput, aiLoading, sendAI, financialContext }) {
  const endRef = useRef(null)
  const [purchaseFile, setPurchaseFile] = useState(null)
  const [purchasePreview, setPurchasePreview] = useState(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  const handleSend = () => {
    const text = aiInput.trim() || (purchaseFile ? 'I want to buy this item. Should I based on my budget and financial goals?' : '')
    if (!text && !purchaseFile) return
    sendAI(text, purchaseFile)
    setAiInput('')
    setPurchaseFile(null)
    if (purchasePreview) { URL.revokeObjectURL(purchasePreview); setPurchasePreview(null) }
  }

  const handlePhoto = e => {
    const f = e.target.files[0]
    if (!f) return
    if (purchasePreview) URL.revokeObjectURL(purchasePreview)
    setPurchaseFile(f)
    setPurchasePreview(URL.createObjectURL(f))
    e.target.value = ''
  }

  const quickChips = [
    { icon: '💰', text: 'How am I doing this month?' },
    { icon: '📸', text: 'Should I buy this?' },
    { icon: '🎯', text: 'Am I on track with my goals?' },
    { icon: '💸', text: 'Where is my money going?' },
    { icon: '🏦', text: 'Explain my loans' },
    { icon: '📊', text: 'Give me a full financial health breakdown' },
    { icon: '🎲', text: 'Surprise me with a money tip!' },
  ]

  const { workingCountry, homeCountry, goals, loans, upcomingBills, currentMonth } = financialContext || {}

  const GOLD = '#c9a961'
  const NAVY = '#0c1929'
  const PANEL = '#152035'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)', gap: 0, background: C.bg }}>

      {/* ── Header ── */}
      <div style={{ background: NAVY, borderBottom: `2px solid ${GOLD}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <EstelleAvatar size={56} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: GOLD, letterSpacing: '-0.02em' }}>Estelle</span>
            <span style={{ fontSize: 16 }}>💅</span>
            <span style={{ fontSize: 10, background: '#10b98122', color: '#10b981', border: '1px solid #10b98144', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>🟢 Online</span>
          </div>
          <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Your Finance BFF — always honest, never boring ✨</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: C.muted }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
          <div>Financial BFF Mode</div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Welcome message when no chat yet */}
        {aiMessages.length === 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <EstelleAvatar size={34} />
            <div style={{ flex: 1, maxWidth: '88%' }}>
              <div style={{ background: PANEL, border: `1px solid ${GOLD}33`, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 16px 16px 16px', padding: '16px 20px', fontSize: 13, lineHeight: 1.85, color: C.text, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: GOLD, marginBottom: 8 }}>Hey gorgeous! I'm Estelle 💅 — your personal finance bestie and yes, I am as cute as I look!</div>
                <div>I know everything about your money situation — your accounts, your spending habits, your goals — and I'm here to help you make every Dinar and Rupee count.</div>

                {/* Dynamic vibe check */}
                {financialContext && (
                  <div style={{ marginTop: 14, background: NAVY, borderRadius: 12, padding: '14px 16px', border: `1px solid ${GOLD}44` }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: GOLD, marginBottom: 10, letterSpacing: '0.03em' }}>📊 Your {currentMonth || 'Monthly'} Vibe Check:</div>
                    {workingCountry?.income > 0 && (
                      <div style={{ fontSize: 12, color: C.textS, marginBottom: 5 }}>
                        💼 Working income: <strong style={{ color: C.text }}>{workingCountry.income.toFixed(0)} {workingCountry.currency}</strong>
                        {' · '}savings rate: <strong style={{ color: parseFloat(workingCountry.savingsRate) >= 20 ? '#10b981' : parseFloat(workingCountry.savingsRate) >= 10 ? C.gold : C.red }}>{workingCountry.savingsRate || '—'}</strong>
                        {parseFloat(workingCountry.savingsRate) >= 30 ? ' 🏆 stellar!' : parseFloat(workingCountry.savingsRate) >= 20 ? ' 👍 solid!' : parseFloat(workingCountry.savingsRate) > 0 ? ' 📈 room to grow' : ''}
                      </div>
                    )}
                    {loans?.length > 0 && (
                      <div style={{ fontSize: 12, color: C.textS, marginBottom: 5 }}>
                        🏠 Loans: <strong style={{ color: C.textS }}>{loans.length} active</strong> · total EMI {loans.reduce((s, l) => s + (l.emi || 0), 0).toFixed(0)} {loans[0]?.currency || ''}/mo
                      </div>
                    )}
                    {goals?.length > 0 && (
                      <div style={{ fontSize: 12, color: C.textS, marginBottom: 5 }}>
                        🎯 <strong style={{ color: C.textS }}>{goals.length} goal{goals.length !== 1 ? 's' : ''}</strong> in progress · top goal <strong style={{ color: GOLD }}>{Math.round((goals[0]?.saved || 0) / Math.max(1, goals[0]?.target || 1) * 100)}%</strong> done
                      </div>
                    )}
                    {upcomingBills?.length > 0 && (
                      <div style={{ fontSize: 12, color: C.yellow, marginBottom: 2 }}>
                        ⏰ <strong>{upcomingBills.length} bill{upcomingBills.length !== 1 ? 's' : ''}</strong> coming up · next: {upcomingBills[0]?.name} ({upcomingBills[0]?.amount} {upcomingBills[0]?.currency})
                      </div>
                    )}
                    {!workingCountry?.income && !loans?.length && !goals?.length && (
                      <div style={{ fontSize: 12, color: C.muted }}>No transactions yet this month — add your salary to get started! 💪</div>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>What would you like to talk about? Ask me anything, show me something you want to buy, or just say hi! I don't judge... much. 😂</div>
              </div>

              {/* Quick chips */}
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Quick questions</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {quickChips.map(c => (
                  <button key={c.text}
                    onClick={() => {
                      if (c.text === 'Should I buy this?') {
                        document.getElementById('estelle-photo-input')?.click()
                      } else {
                        setAiInput(c.text)
                        setTimeout(() => document.getElementById('estelle-input')?.focus(), 50)
                      }
                    }}
                    style={{ background: PANEL, border: `1px solid ${GOLD}44`, borderRadius: 20, padding: '7px 14px', color: C.textS, fontSize: 12, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; e.currentTarget.style.background = GOLD + '18' }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = GOLD + '44'; e.currentTarget.style.color = C.textS; e.currentTarget.style.background = PANEL }}>
                    {c.icon} {c.text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chat messages */}
        {aiMessages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 10, alignItems: 'flex-start' }}>
            {m.role === 'assistant' && <EstelleAvatar size={30} />}
            <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.imageUrl && (
                <img src={m.imageUrl} alt="purchase" style={{ maxWidth: 160, maxHeight: 160, borderRadius: 12, objectFit: 'cover', border: `2px solid ${GOLD}`, boxShadow: `0 4px 16px ${GOLD}44` }} />
              )}
              <div style={{
                padding: '12px 16px',
                borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '0 16px 16px 16px',
                fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? GOLD : PANEL,
                color: m.role === 'user' ? NAVY : C.text,
                borderLeft: m.role === 'assistant' ? `3px solid ${GOLD}` : 'none',
                fontWeight: m.role === 'user' ? 700 : 400,
                boxShadow: m.role === 'user' ? `0 2px 12px ${GOLD}44` : 'none',
              }}>
                {m.role === 'assistant' && (
                  <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Estelle</span><span>💅</span>
                  </div>
                )}
                {m.content}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {aiLoading && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <EstelleAvatar size={36} />
            <div style={{ background: PANEL, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 16px 16px 16px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: C.muted, fontStyle: 'italic' }}>
                {purchaseFile ? 'Ooh let me see what you\'re eyeing... putting on my finance glasses 🤓✨' : 'Estelle is thinking...'}
              </span>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: GOLD, display: 'inline-block', animation: `pulse 1s ${i * 0.22}s infinite` }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Purchase photo preview bar */}
      {purchasePreview && (
        <div style={{ padding: '10px 20px', background: NAVY, borderTop: `1px solid ${GOLD}44`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <img src={purchasePreview} alt="purchase preview" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8, border: `2px solid ${GOLD}` }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>📸 Photo attached</div>
            <div style={{ fontSize: 11, color: C.muted }}>Estelle will analyse this purchase for you</div>
          </div>
          <button onClick={() => { setPurchaseFile(null); if (purchasePreview) { URL.revokeObjectURL(purchasePreview); setPurchasePreview(null) } }}
            style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
      )}

      {/* Input bar */}
      <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, background: C.card, display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <label htmlFor="estelle-photo-input"
          title="Show Estelle what you want to buy 📸"
          style={{ width: 42, height: 42, borderRadius: 11, background: GOLD + '22', border: `1px solid ${GOLD}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 20, transition: 'all 0.15s' }}
          onMouseOver={e => { e.currentTarget.style.background = GOLD + '44' }}
          onMouseOut={e => { e.currentTarget.style.background = GOLD + '22' }}>
          📸
          <input id="estelle-photo-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />
        </label>
        <input id="estelle-input" value={aiInput} onChange={e => setAiInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Ask Estelle anything..."
          style={{ flex: 1, ...inputStyle, padding: '12px 16px', borderRadius: 12, fontSize: 13 }}
          disabled={aiLoading} />
        <button onClick={handleSend} disabled={aiLoading || (!aiInput.trim() && !purchaseFile)}
          style={{ background: aiLoading || (!aiInput.trim() && !purchaseFile) ? C.card2 : GOLD, color: aiLoading || (!aiInput.trim() && !purchaseFile) ? C.muted : NAVY, border: 'none', borderRadius: 12, padding: '12px 20px', cursor: aiLoading || (!aiInput.trim() && !purchaseFile) ? 'default' : 'pointer', fontSize: 13, fontWeight: 800, transition: 'all 0.15s', flexShrink: 0 }}>
          Send →
        </button>
      </div>
    </div>
  )
}

// ─── Budget ───────────────────────────────────────────────────────────────────
function Budget({ transactions, accounts, wkBudgets, setWkBudgets, hmBudgets, setHmBudgets, budgetMonth, setBudgetMonth, foreignCurrency, homeCurrency, setActiveTab, remittances, loans }) {
  const [countryTab, setCountryTab] = useState('working')
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [addForm, setAddForm] = useState({ name: '', limit: '' })
  const [showAllocPlanner, setShowAllocPlanner] = useState(false)
  const [allocPcts, setAllocPcts] = useState({})
  const [allocIncome, setAllocIncome] = useState('')
  const [showSavingsDist, setShowSavingsDist] = useState(false)
  const [savingsDistPcts, setSavingsDistPcts] = useState({})

  // Month navigation
  const [yr, mo] = budgetMonth.split('-').map(Number)
  const shiftMonth = delta => {
    const d = new Date(yr, mo - 1 + delta)
    setBudgetMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthLabel = new Date(yr, mo - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
  const nextMonthLabel = new Date(yr, mo).toLocaleString('default', { month: 'long' })
  const isCurrentMonth = budgetMonth === new Date().toISOString().slice(0, 7)

  // Account sets by country
  const wkAccIds = new Set(accounts.filter(a => a.country === 'foreign').map(a => a.id))
  const hmAccIds = new Set(accounts.filter(a => a.country === 'home').map(a => a.id))

  // Home country money available = direct income + remittances received this budget month
  const hmDirectIncomeBudget = transactions.filter(t => t.type === 'income' && (t.date || '').startsWith(budgetMonth) && hmAccIds.has(t.accountId))
    .reduce((s, t) => s + (t.amount || 0), 0)
  const hmRemitsBudget = (remittances || []).filter(r => (r.date || '').startsWith(budgetMonth))
    .reduce((sum, r) => sum + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
  const hmMoneyAvailable = hmDirectIncomeBudget + hmRemitsBudget

  // Transactions for selected month
  const monthTx = transactions.filter(t => t.type === 'expense' && (t.date || '').startsWith(budgetMonth))
  console.log('[Budget] Month filter:', budgetMonth, '— matched', monthTx.length, 'expense transactions out of', transactions.length, 'total')

  // Route transactions: by accountId if set, else by currency
  const wkTx = monthTx.filter(t => t.accountId ? wkAccIds.has(t.accountId) : t.currency !== 'INR')
  const hmTx  = monthTx.filter(t => t.accountId ? hmAccIds.has(t.accountId)  : t.currency === 'INR')

  // Fuzzy category matching — handles "Apartment Rent" → "Rent", etc.
  const CAT_VARIATIONS = {
    'rent': ['rent', 'apartment rent', 'house rent', 'flat rent', 'housing', 'accommodation'],
    'groceries': ['groceries', 'grocery', 'supermarket', 'sultan center', 'lulu', 'carrefour'],
    'food': ['food', 'groceries', 'grocery', 'dining', 'restaurant', 'eating out'],
    'dining': ['dining', 'restaurant', 'eating out', 'cafe', 'coffee', 'food court'],
    'transport': ['transport', 'transportation', 'petrol', 'fuel', 'uber', 'careem', 'commute', 'travel', 'parking'],
    'utilities': ['utilities', 'utility', 'electricity', 'water', 'mew', 'internet', 'electric', 'gas', 'broadband'],
    'healthcare': ['healthcare', 'health', 'medical', 'doctor', 'hospital', 'pharmacy', 'clinic', 'dentist'],
    'shopping': ['shopping', 'clothes', 'clothing', 'retail', 'mall'],
    'entertainment': ['entertainment', 'cinema', 'movies', 'leisure', 'streaming', 'subscription'],
    'personal care': ['personal care', 'grooming', 'salon', 'gym', 'fitness', 'spa'],
    'insurance': ['insurance'],
    'savings': ['savings', 'saving', 'invest', 'investment', 'goal'],
    'loan emi': ['loan emi', 'loan', 'emi', 'mortgage'],
    'remittance': ['remittance', 'transfer', 'remit', 'wire'],
  }
  const matchCategory = (txCat, budgetCat) => {
    if (!txCat || !budgetCat) return false
    const t = txCat.toLowerCase().trim()
    const b = budgetCat.toLowerCase().trim()
    if (t === b) return true
    const vars = CAT_VARIATIONS[b] || [b]
    return vars.some(v => t === v || t.includes(v) || v.includes(t))
  }
  const getSpentFrom = (txs, amtFn, name) =>
    txs.filter(t => matchCategory(t.category, name)).reduce((s, t) => s + amtFn(t), 0)

  const isWorking = countryTab === 'working'
  const budgets   = isWorking ? wkBudgets : hmBudgets
  const setBudgets = isWorking ? setWkBudgets : setHmBudgets
  const currency  = isWorking ? foreignCurrency : 'INR'
  const activeTx  = isWorking ? wkTx : hmTx
  const activeAmt = isWorking ? (t => t.amount || 0) : (t => t.amountINR || t.amount || 0)
  const getSpent  = name => getSpentFrom(activeTx, activeAmt, name)

  // Summary totals
  const totalBudget  = budgets.reduce((s, b) => s + (b.limit || 0), 0)
  const totalSpent   = budgets.reduce((s, b) => s + getSpent(b.name), 0)
  const totalLeft    = totalBudget - totalSpent
  const pctUsed      = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0
  const overCount    = budgets.filter(b => getSpent(b.name) > b.limit && b.limit > 0).length

  // Health score
  const healthOf = (bs, htxs, hamtFn) => {
    if (!bs.length) return 100
    const total = bs.reduce((s, b) => s + b.limit, 0)
    const sp = bs.reduce((s, b) => s + getSpentFrom(htxs, hamtFn, b.name), 0)
    const overC = bs.filter(b => getSpentFrom(htxs, hamtFn, b.name) > b.limit && b.limit > 0).length
    const pctSpent = total > 0 ? sp / total : 0
    const score = 100 - overC * 10 - Math.max(0, pctSpent - 0.9) * 100
    return Math.round(Math.max(0, Math.min(100, score)))
  }
  const wkH = healthOf(wkBudgets, wkTx, t => t.amount || 0)
  const hmH = healthOf(hmBudgets, hmTx, t => t.amountINR || t.amount || 0)
  const overallH = Math.round((wkH + hmH) / 2)
  const hColor = overallH >= 80 ? C.green : overallH >= 60 ? C.yellow : overallH >= 40 ? '#f97316' : C.red
  const hLabel = overallH >= 80 ? 'Excellent' : overallH >= 60 ? 'Good' : overallH >= 40 ? 'Needs Attention' : 'Over Budget'

  const barColor = pct => pct >= 90 ? C.red : pct >= 70 ? C.yellow : C.green

  const saveCategory = () => {
    if (!addForm.name.trim() || !addForm.limit) return
    if (editItem) {
      setBudgets(p => p.map(b => b.id === editItem.id ? { ...b, name: addForm.name.trim(), limit: parseFloat(addForm.limit) || 0 } : b))
      setEditItem(null)
    } else {
      setBudgets(p => [...p, { id: uid(), name: addForm.name.trim(), limit: parseFloat(addForm.limit) || 0 }])
    }
    setAddForm({ name: '', limit: '' }); setShowAdd(false)
  }
  const startEdit = b => { setEditItem(b); setAddForm({ name: b.name, limit: String(b.limit) }); setShowAdd(true) }
  const delCat = id => setBudgets(p => p.filter(b => b.id !== id))

  const wkMonthlyIncome = transactions.filter(t => t.type === 'income' && (t.date || '').startsWith(budgetMonth) && wkAccIds.has(t.accountId))
    .reduce((s, t) => s + (t.amount || 0), 0)
  const monthlyIncome = isWorking ? wkMonthlyIncome : hmMoneyAvailable

  // Opening balance context for budget month
  const activeAccIds = isWorking ? wkAccIds : hmAccIds
  const txOpeningBal = accounts.filter(a => activeAccIds.has(a.id))
    .reduce((s, a) => s + getOpeningBalance(accounts, transactions, a.id, budgetMonth), 0)

  // For home country: carry-forward must also include remittances received in prior months
  // that are NOT already recorded as income transactions (to avoid double-counting)
  const budgetOpeningBal = (() => {
    if (isWorking) return txOpeningBal
    const [byr, bmo] = budgetMonth.split('-').map(Number)
    const prevEnd = new Date(byr, bmo - 1, 0).toISOString().split('T')[0]
    // Cumulative remittances received before this month
    const cumulRemits = (remittances || [])
      .filter(r => (r.date || '') <= prevEnd)
      .reduce((s, r) => s + (r.received || (r.amount||0) * (r.rate||0)), 0)
    // Remittances already recorded as income in home account transactions (avoid double-count)
    const remitAlreadyInTxs = transactions
      .filter(t => hmAccIds.has(t.accountId) && t.type === 'income' && (t.date||'') <= prevEnd &&
        (t.category === 'Remittance' || (t.notes||'').toLowerCase().includes('remittance') || (t.description||'').toLowerCase().includes('remittance')))
      .reduce((s, t) => s + (t.amount||0), 0)
    return txOpeningBal + Math.max(0, cumulRemits - remitAlreadyInTxs)
  })()

  const totalAvailable = budgetOpeningBal + monthlyIncome
  const projectedClosing = totalAvailable - totalSpent
  // Carry-forward = opening + income - spent (the real leftover, not just income - spent)
  const monthlySavings = projectedClosing > 0 ? projectedClosing : 0

  const ALLOC_RULES_WK = [
    { keys: ['rent', 'housing', 'accommodation'], pct: 25 },
    { keys: ['groceries', 'food', 'grocery'], pct: 10 },
    { keys: ['transport', 'commute', 'travel'], pct: 8 },
    { keys: ['utilities', 'utility', 'electric', 'water', 'gas'], pct: 5 },
    { keys: ['healthcare', 'health', 'medical'], pct: 4 },
    { keys: ['insurance'], pct: 3 },
    { keys: ['dining', 'restaurant', 'eating out'], pct: 7 },
    { keys: ['shopping', 'clothing', 'clothes'], pct: 7 },
    { keys: ['entertainment', 'leisure'], pct: 5 },
    { keys: ['subscription', 'subscriptions'], pct: 3 },
    { keys: ['remittance', 'transfer', 'remit'], pct: 10 },
    { keys: ['savings', 'saving'], pct: 8 },
    { keys: ['loan', 'emi'], pct: 13 },
  ]
  const ALLOC_RULES_HM = [
    { keys: ['loan', 'emi', 'mortgage'], pct: 25 },
    { keys: ['groceries', 'food', 'grocery'], pct: 15 },
    { keys: ['utilities', 'utility', 'electric', 'water', 'gas'], pct: 8 },
    { keys: ['healthcare', 'health', 'medical'], pct: 8 },
    { keys: ['education', 'school', 'tuition'], pct: 10 },
    { keys: ['transport', 'commute', 'travel'], pct: 7 },
    { keys: ['shopping', 'clothing', 'clothes'], pct: 7 },
    { keys: ['entertainment', 'leisure'], pct: 5 },
    { keys: ['savings', 'saving', 'investment', 'invest'], pct: 10 },
    { keys: ['insurance'], pct: 5 },
  ]
  const getRecommendedPct = name => {
    const n = (name || '').toLowerCase()
    const rules = isWorking ? ALLOC_RULES_WK : ALLOC_RULES_HM
    for (const rule of rules) {
      if (rule.keys.some(k => n.includes(k))) return rule.pct
    }
    return 5
  }

  const openAllocPlanner = () => {
    const init = {}
    budgets.forEach(b => { init[b.id] = b.allocPct != null ? b.allocPct : getRecommendedPct(b.name) })
    setAllocPcts(init)
    setAllocIncome(monthlyIncome > 0 ? String(Math.round(monthlyIncome)) : '')
    setShowAllocPlanner(true)
  }

  const applyAllocations = () => {
    const inc = parseFloat(allocIncome) || 0
    const total = Object.values(allocPcts).reduce((s, v) => s + v, 0)
    if (total > 100) return
    setBudgets(p => p.map(b => ({
      ...b,
      allocPct: allocPcts[b.id] != null ? allocPcts[b.id] : b.allocPct,
      limit: inc > 0 && allocPcts[b.id] != null ? Math.round(inc * allocPcts[b.id] / 100) : b.limit,
    })))
    setShowAllocPlanner(false)
  }

  const normalizePcts = () => {
    const total = Object.values(allocPcts).reduce((s, v) => s + v, 0)
    if (total === 0) return
    const factor = 100 / total
    const keys = Object.keys(allocPcts)
    const normalized = {}
    keys.forEach(k => { normalized[k] = Math.round(allocPcts[k] * factor * 10) / 10 })
    setAllocPcts(normalized)
  }

  const openSavingsDist = () => {
    const init = {}
    const savingsCats = budgets.filter(b => /saving|invest|goal|fund/i.test(b.name))
    if (savingsCats.length > 0) {
      const share = Math.floor(100 / savingsCats.length)
      budgets.forEach(b => { init[b.id] = savingsCats.includes(b) ? share : 0 })
    } else {
      budgets.forEach(b => { init[b.id] = 0 })
    }
    setSavingsDistPcts(init)
    setShowSavingsDist(true)
  }

  const applySavingsDist = () => {
    const total = Object.values(savingsDistPcts).reduce((s, v) => s + v, 0)
    if (total > 100) return
    setBudgets(p => p.map(b => ({
      ...b,
      limit: b.limit + (savingsDistPcts[b.id] ? Math.round(monthlySavings * savingsDistPcts[b.id] / 100) : 0),
    })))
    setShowSavingsDist(false)
  }

  return (
    <div style={pg}>
      <h2 style={pgTitle}>Budget</h2>

      {/* Health Score */}
      <div style={{ background: C.card, border: `1px solid ${hColor}33`, borderRadius: 14, padding: '16px 20px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${hColor}, ${hColor}44)` }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <DonutChart size={64} thickness={9} segments={[{ value: overallH, color: hColor }, { value: 100 - overallH, color: C.card2 }]} label={String(overallH)} />
          <div>
            <div style={{ fontSize: 24, fontWeight: 900, color: hColor, letterSpacing: '-0.04em', lineHeight: 1 }}>{overallH}<span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>/100</span></div>
            <div style={{ fontSize: 13, fontWeight: 700, color: hColor }}>{hLabel}</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Budget Health Score</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, display:'flex', alignItems:'center', gap:3 }}><Flag currency={foreignCurrency} size={11} />Working</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: wkH >= 80 ? C.green : wkH >= 60 ? C.yellow : C.red }}>{wkH}/100</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, display:'flex', alignItems:'center', gap:3 }}><Flag currency={homeCurrency} size={11} />Home</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: hmH >= 80 ? C.green : hmH >= 60 ? C.yellow : C.red }}>{hmH}/100</div>
            </div>
          </div>
        </div>
      </div>

      {/* Month Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <button onClick={() => shiftMonth(-1)} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, width: 34, height: 34, color: C.text, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600, color: C.text }}>{monthLabel}</div>
        <button onClick={() => !isCurrentMonth && shiftMonth(1)}
          disabled={isCurrentMonth}
          style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, width: 34, height: 34, color: isCurrentMonth ? C.muted : C.text, cursor: isCurrentMonth ? 'default' : 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isCurrentMonth ? 0.4 : 1 }}>›</button>
        {!isCurrentMonth && (
          <button onClick={() => setBudgetMonth(new Date().toISOString().slice(0, 7))}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', color: C.muted, cursor: 'pointer', fontSize: 11 }}>
            Today
          </button>
        )}
        <button onClick={() => shiftMonth(1)}
          title="Budget limits carry forward automatically"
          style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', color: C.muted, cursor: 'pointer', fontSize: 11 }}>
          Copy →
        </button>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: C.accent, fontWeight: 600, marginBottom: 14, background: C.accent + '11', borderRadius: 8, padding: '4px 0' }}>
        Viewing {monthLabel} transactions only
      </div>

      {/* Country Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[
          { id: 'working', jsx: <><Flag currency={foreignCurrency} size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Working Country ({foreignCurrency})</> },
          { id: 'home',    jsx: <><Flag currency={homeCurrency} size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Home Country ({homeCurrency || 'INR'})</> },
        ].map(t => (
          <button key={t.id} onClick={() => setCountryTab(t.id)} style={{
            flex: 1, padding: '10px 14px', border: `2px solid ${countryTab === t.id ? C.accent : C.border}`,
            borderRadius: 10, background: countryTab === t.id ? C.accent + '22' : C.card2,
            color: countryTab === t.id ? C.accent : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{t.jsx}</button>
        ))}
      </div>

      {/* Opening balance context — always show when accounts exist */}
      {accounts.filter(a => activeAccIds.has(a.id)).length > 0 && (
        <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: C.text, marginBottom: 8 }}>Balance Context — {monthLabel}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: C.muted }}>Opening Balance (carried from {new Date(yr, mo - 2).toLocaleString('default', { month: 'long' })})</span>
            <span className="num" style={{ fontWeight: 600, color: C.text }}>{fmt(budgetOpeningBal, currency)}</span>
          </div>
          {monthlyIncome > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: C.muted }}>+ New Income this month</span>
            <span className="num" style={{ color: C.green, fontWeight: 600 }}>+{fmt(monthlyIncome, currency)}</span>
          </div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: C.muted, fontWeight: 600 }}>= Total Available</span>
            <span className="num" style={{ color: C.accent, fontWeight: 700 }}>{fmt(totalAvailable, currency)}</span>
          </div>
          <div style={{ height: 1, background: C.border, margin: '6px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: C.muted }}>− Budgeted Expenses (limit)</span>
            <span className="num" style={{ color: C.red, fontWeight: 600 }}>−{fmt(totalBudget, currency)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: C.muted }}>− Actual Spent (so far)</span>
            <span className="num" style={{ color: C.yellow, fontWeight: 600 }}>−{fmt(totalSpent, currency)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${C.border}`, paddingTop: 6, marginTop: 3 }}>
            <div>
              <span style={{ color: C.text, fontWeight: 700 }}>→ Carry-Forward to {nextMonthLabel}</span>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>projected closing balance</div>
            </div>
            <span className="num" style={{ color: projectedClosing >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmt(projectedClosing, currency)}</span>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {monthLabel} Summary · {activeTx.length} expense transactions
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-4, repeat(4,1fr))', gap: 10, marginBottom: 16 }}>
        <StatCard label="Total Budget" value={fmt(totalBudget, currency)} color={C.accent} />
        <StatCard label="Total Spent" value={fmt(totalSpent, currency)} color={pctUsed >= 90 ? C.red : pctUsed >= 70 ? C.yellow : C.green} />
        <StatCard label={totalLeft >= 0 ? 'Remaining' : 'Over by'} value={fmt(Math.abs(totalLeft), currency)} color={totalLeft >= 0 ? C.green : C.red} />
        <StatCard label="% Used" value={`${Math.min(pctUsed, 999).toFixed(0)}%`} color={pctUsed >= 90 ? C.red : pctUsed >= 70 ? C.yellow : C.green} />
      </div>

      {/* Carry-Forward banner */}
      {monthlySavings > 0 && (
        <div style={{ background: C.green + '15', border: `1px solid ${C.green}44`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.green, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>💰 <span className="num">{fmt(monthlySavings, currency)}</span> projected to carry forward to {nextMonthLabel}</span>
          <Btn variant="ghost" onClick={openSavingsDist} style={{ fontSize: 11, color: C.green, borderColor: C.green + '66' }}>Distribute →</Btn>
        </div>
      )}

      {/* Over-budget alert */}
      {overCount > 0 && (
        <div style={{ background: C.red + '15', border: `1px solid ${C.red}44`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.red, fontWeight: 600 }}>
          ⚠️ {overCount} categor{overCount === 1 ? 'y' : 'ies'} over budget in {isWorking ? 'Working Country' : 'Home Country'}
        </div>
      )}

      {/* Home country money available banner */}
      {!isWorking && hmMoneyAvailable > 0 && (
        <div style={{ background: C.purple + '12', border: `1px solid ${C.purple}33`, borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 8, display:'flex', alignItems:'center', gap:4 }}><Flag currency={homeCurrency} size={13} />Money Available This Month</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted }}>Direct Income</div>
              <div className="num" style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{fmt(hmDirectIncomeBudget)}</div>
            </div>
            {hmRemitsBudget > 0 && (
              <div>
                <div style={{ fontSize: 10, color: C.muted }}>Remittances Received</div>
                <div className="num" style={{ fontSize: 14, fontWeight: 700, color: C.teal }}>{fmt(hmRemitsBudget)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, color: C.muted }}>Total Available</div>
              <div className="num" style={{ fontSize: 14, fontWeight: 800, color: C.purple }}>{fmt(hmMoneyAvailable)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted }}>After Budget</div>
              <div className="num" style={{ fontSize: 14, fontWeight: 700, color: hmMoneyAvailable - totalSpent >= 0 ? C.green : C.red }}>{fmt(hmMoneyAvailable - totalSpent)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Loan EMI reference */}
      {loans && loans.length > 0 && (() => {
        const relevantLoans = loans.filter(l => l.country === (isWorking ? 'foreign' : 'home') && l.emi > 0)
        if (!relevantLoans.length) return null
        return (
          <div style={{ background: `${C.yellow}0a`, border: `1px solid ${C.yellow}22`, borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.yellow, marginBottom: 8 }}>🏦 Loan EMIs this month</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {relevantLoans.map(l => (
                <div key={l.id}>
                  <div style={{ fontSize: 10, color: C.muted }}>{l.name}</div>
                  <div className="num" style={{ fontSize: 13, fontWeight: 700, color: C.yellow }}>{fmt(l.emi, l.currency)}/mo</div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 10, color: C.muted }}>Total EMI</div>
                <div className="num" style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{fmt(relevantLoans.reduce((s,l)=>s+(l.emi||0),0), isWorking ? foreignCurrency : 'INR')}/mo</div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Category list */}
      <Card
        title={isWorking ? `Working Country Budget (${foreignCurrency})` : 'Home Country Budget (INR)'}
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Btn variant="ghost" onClick={openAllocPlanner} style={{ fontSize: 11 }}>📊 Allocations</Btn><Btn onClick={() => { setEditItem(null); setAddForm({ name: '', limit: '' }); setShowAdd(true) }}>+ Add Category</Btn></div>}
        style={{ marginBottom: 16 }}>
        {budgets.length === 0
          ? <Empty icon="📊" title="No budget categories" sub="Add categories to start tracking" />
          : budgets.map(b => {
            const s = getSpent(b.name)
            const txCount = activeTx.filter(t => matchCategory(t.category, b.name)).length
            const pct = b.limit > 0 ? Math.min((s / b.limit) * 100, 100) : 0
            const rawPct = b.limit > 0 ? (s / b.limit) * 100 : 0
            const over = s > b.limit && b.limit > 0
            const nearLimit = !over && rawPct >= 90
            const remaining = b.limit - s
            const bc = barColor(pct)
            const spentPctColor = rawPct >= 100 ? C.red : rawPct >= 90 ? '#f97316' : rawPct >= 70 ? C.yellow : C.green
            return (
              <div key={b.id} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: over ? C.red : C.text, letterSpacing: '-0.01em' }}>{b.name}</span>
                    <span style={{ fontSize: 10, background: spentPctColor + '22', color: spentPctColor, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{rawPct.toFixed(0)}%</span>
                    {over && <Badge color={C.red}>⚠️ Over Budget</Badge>}
                    {nearLimit && <span style={{ fontSize: 10, color: C.yellow, fontWeight: 600 }}>⚠️ Near Limit</span>}
                    {b.allocPct != null && monthlyIncome > 0 && (
                      <span style={{ fontSize: 10, color: C.muted, fontStyle: 'italic' }}>alloc {b.allocPct}%</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="num" style={{ fontSize: 12, color: over ? C.redL : C.mutedL, fontWeight: 600 }}>
                      {fmt(s, currency)} <span style={{ color: C.muted, fontWeight: 400 }}>/ {fmt(b.limit, currency)}</span>
                    </span>
                    <IconBtn onClick={() => startEdit(b)}>✏️</IconBtn>
                    <IconBtn onClick={() => delCat(b.id)} danger>🗑️</IconBtn>
                  </div>
                </div>
                <ProgressBar value={s} max={b.limit} color={bc} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
                  <span style={{ color: over ? C.red : C.muted }}>
                    {over
                      ? <span className="num">⚠️ {fmt(Math.abs(remaining), currency)} over limit</span>
                      : <span className="num">{fmt(remaining, currency)} remaining</span>}
                  </span>
                  <span style={{ color: C.muted }}>{txCount} transaction{txCount !== 1 ? 's' : ''} in {monthLabel}</span>
                </div>
              </div>
            )
          })}
          {budgets.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>Total Spent</span>
                <span className="num" style={{ fontWeight: 700, color: totalLeft < 0 ? C.red : C.text }}>
                  {fmt(totalSpent, currency)} <span style={{ color: C.muted, fontWeight: 400 }}>/ {fmt(totalBudget, currency)}</span>
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 5, color: C.muted }}>
                <span>Remaining</span>
                <span className="num" style={{ color: totalLeft < 0 ? C.red : C.green, fontWeight: 600 }}>
                  {fmt(Math.abs(totalLeft), currency)}{totalLeft < 0 ? ' over' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 3, color: C.muted }}>
                <span>→ Carry-Forward to {nextMonthLabel}</span>
                <span className="num" style={{ color: projectedClosing >= 0 ? C.green : C.red, fontWeight: 600 }}>
                  {fmt(projectedClosing, currency)}
                </span>
              </div>
            </div>
          )}

      </Card>

      {/* Budget vs Actual chart */}
      {budgets.length > 0 && (() => {
        const vals = budgets.flatMap(b => [b.limit, getSpent(b.name)])
        const maxVal = Math.max(...vals, 1)
        const CHART_H = 130
        const colW = Math.max(36, Math.floor(520 / budgets.length))
        const bW = Math.min(13, colW / 2 - 3)
        return (
          <Card title={`Budget vs Actual — ${monthLabel}`}>
            <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: budgets.length * colW }}>
                {budgets.map(b => {
                  const s = getSpent(b.name)
                  const bH = (b.limit / maxVal) * CHART_H
                  const sH = (s / maxVal) * CHART_H
                  const over = s > b.limit && b.limit > 0
                  return (
                    <div key={b.id} style={{ flex: 1, minWidth: colW, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: CHART_H }}>
                        <div title={`Budget: ${fmt(b.limit, currency)}`}
                          style={{ width: bW, height: Math.max(bH, 2), background: C.border, borderRadius: '3px 3px 0 0' }} />
                        <div title={`Spent: ${fmt(s, currency)}`}
                          style={{ width: bW, height: Math.max(sH, s > 0 ? 2 : 0), background: over ? C.red : C.yellow, borderRadius: '3px 3px 0 0', opacity: 0.88 }} />
                      </div>
                      <div style={{ fontSize: 9, color: C.muted, marginTop: 5, textAlign: 'center', width: colW - 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.name}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 12, background: C.border, borderRadius: 2 }} />
                <span style={{ fontSize: 11, color: C.muted }}>Budget (limit)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 12, background: C.yellow, borderRadius: 2 }} />
                <span style={{ fontSize: 11, color: C.muted }}>Spent</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 12, background: C.red, borderRadius: 2, opacity: 0.88 }} />
                <span style={{ fontSize: 11, color: C.muted }}>Over budget</span>
              </div>
            </div>
          </Card>
        )
      })()}

      {/* Add/Edit modal */}
      {showAdd && (
        <Modal title={editItem ? 'Edit Category' : `Add Budget Category (${currency})`} onClose={() => { setShowAdd(false); setEditItem(null) }}>
          <Input label="Category name" value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
            placeholder={isWorking ? 'e.g. Rent, Groceries' : 'e.g. Home Loan EMI'} />
          <Field label={`Monthly limit (${currency})`}>
            <input type="number" value={addForm.limit} onChange={e => setAddForm(p => ({ ...p, limit: e.target.value }))}
              placeholder="0" style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditItem(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={saveCategory} style={{ flex: 1 }}>{editItem ? 'Update' : 'Add Category'}</Btn>
          </div>
        </Modal>
      )}

      {/* Allocation Planner modal */}
      {showAllocPlanner && (() => {
        const inc = parseFloat(allocIncome) || 0
        const total = Object.values(allocPcts).reduce((s, v) => s + v, 0)
        const totalRounded = Math.round(total * 10) / 10
        const totalColor = totalRounded === 100 ? C.green : (totalRounded >= 90 && totalRounded <= 110) ? C.yellow : C.red
        return (
          <Modal title="📊 Allocation Planner" onClose={() => setShowAllocPlanner(false)} width={560}>
            <Field label={`Monthly Income (${currency})`}>
              <input type="number" value={allocIncome} onChange={e => setAllocIncome(e.target.value)}
                placeholder="Auto-detected from income transactions" style={inputStyle} />
            </Field>
            <div style={{ marginBottom: 14 }}>
              {budgets.map(b => {
                const pct = allocPcts[b.id] != null ? allocPcts[b.id] : 0
                const recPct = getRecommendedPct(b.name)
                const derived = inc > 0 ? Math.round(inc * pct / 100) : 0
                return (
                  <div key={b.id} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{b.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: C.muted }}>(rec: {recPct}%)</span>
                        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: C.accent, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                        {inc > 0 && <span className="num" style={{ fontSize: 11, color: C.mutedL, minWidth: 70, textAlign: 'right' }}>{fmt(derived, currency)}</span>}
                      </div>
                    </div>
                    <input type="range" min={0} max={60} value={pct}
                      onChange={e => setAllocPcts(p => ({ ...p, [b.id]: Number(e.target.value) }))}
                      style={{ width: '100%', accentColor: C.accent }} />
                  </div>
                )
              })}
            </div>
            <div style={{ background: C.card2, borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Total Allocated</span>
                <span className="num" style={{ fontSize: 22, fontWeight: 900, color: totalColor }}>{totalRounded}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: C.border, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(totalRounded, 100)}%`, background: totalColor, borderRadius: 4, transition: 'width 0.2s' }} />
              </div>
              <div style={{ fontSize: 11, color: totalColor, marginTop: 5, fontWeight: 600 }}>
                {totalRounded === 100 ? '✓ Perfectly allocated' : totalRounded < 100 ? `${(100 - totalRounded).toFixed(1)}% unallocated` : `${(totalRounded - 100).toFixed(1)}% over 100%`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <Btn variant="ghost" onClick={() => setShowAllocPlanner(false)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn variant="ghost" onClick={normalizePcts} style={{ flex: 1 }}>Normalize to 100%</Btn>
              <Btn onClick={applyAllocations} disabled={totalRounded > 100} style={{ flex: 1 }}>Apply</Btn>
            </div>
          </Modal>
        )
      })()}

      {/* Savings Distribution modal */}
      {showSavingsDist && (() => {
        const distTotal = Object.values(savingsDistPcts).reduce((s, v) => s + v, 0)
        const distTotalRounded = Math.round(distTotal * 10) / 10
        const remaining = Math.max(0, 100 - distTotalRounded)
        return (
          <Modal title="💰 Distribute Savings" onClose={() => setShowSavingsDist(false)} width={520}>
            <div style={{ background: C.card2, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Available to distribute</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 900, color: C.green }}>{fmt(monthlySavings, currency)}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              {budgets.map(b => {
                const pct = savingsDistPcts[b.id] != null ? savingsDistPcts[b.id] : 0
                const amount = Math.round(monthlySavings * pct / 100)
                return (
                  <div key={b.id} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{b.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: C.accent, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                        <span className="num" style={{ fontSize: 11, color: C.mutedL, minWidth: 70, textAlign: 'right' }}>{fmt(amount, currency)}</span>
                      </div>
                    </div>
                    <input type="range" min={0} max={100} value={pct}
                      onChange={e => setSavingsDistPcts(p => ({ ...p, [b.id]: Number(e.target.value) }))}
                      style={{ width: '100%', accentColor: C.accent }} />
                  </div>
                )
              })}
            </div>
            <div style={{ background: C.card2, borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Total allocated</span>
              <span className="num" style={{ fontSize: 18, fontWeight: 900, color: distTotalRounded > 100 ? C.red : C.green }}>{distTotalRounded}%</span>
              <span style={{ fontSize: 12, color: C.muted }}>{remaining.toFixed(1)}% unallocated</span>
            </div>
            {distTotalRounded > 100 && (
              <div style={{ fontSize: 12, color: C.red, marginBottom: 10, fontWeight: 600 }}>Total exceeds 100% — reduce some sliders</div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <Btn variant="ghost" onClick={() => setShowSavingsDist(false)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={applySavingsDist} disabled={distTotalRounded > 100} style={{ flex: 1 }}>Apply Distribution</Btn>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

// ─── Spending Trends ──────────────────────────────────────────────────────────
function Trends({ transactions, accounts, remittances, foreignCurrency, homeCurrency, toINR }) {
  const [view, setView] = useState('working')

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i))
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleString('default', { month: 'short' }) }
  })

  const wkAccIds = new Set((accounts || []).filter(a => a.country === 'foreign').map(a => a.id))
  const hmAccIds = new Set((accounts || []).filter(a => a.country === 'home').map(a => a.id))
  const txCountry = t => {
    if (t.accountId) { if (wkAccIds.has(t.accountId)) return 'foreign'; if (hmAccIds.has(t.accountId)) return 'home' }
    return (t.currency || '') === homeCurrency ? 'home' : 'foreign'
  }

  const monthlyData = months.map(({ key, label }) => {
    const wkTx = transactions.filter(t => (t.date || '').startsWith(key) && txCountry(t) === 'foreign')
    const hmTx = transactions.filter(t => (t.date || '').startsWith(key) && txCountry(t) === 'home')
    const sum = (arr, fn) => arr.reduce((s, t) => s + Math.abs(fn(t) || 0), 0)

    const wkIncome   = sum(wkTx.filter(t => t.type === 'income'), t => t.amount)
    const wkExpenses = sum(wkTx.filter(t => t.type === 'expense' || t.type === 'remittance'), t => t.amount)
    const wkRemit    = sum(wkTx.filter(t => t.type === 'remittance'), t => t.amount)
    const wkSavings  = wkIncome - wkExpenses

    const hmDirectIncome = sum(hmTx.filter(t => t.type === 'income'), t => t.amount)
    const hmRemitsRec    = (remittances || []).filter(r => (r.date || '').startsWith(key))
      .reduce((s, r) => s + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
    const hmTotalIn  = hmDirectIncome + hmRemitsRec
    const hmExpenses = sum(hmTx.filter(t => t.type === 'expense' && !['Remittance','Credit Card Bill','Transfer'].includes(t.category)), t => t.amount)
    const hmSavings  = hmTotalIn - hmExpenses

    const wkCats = {}; wkTx.filter(t => t.type === 'expense').forEach(t => { const k = t.category || 'Other'; wkCats[k] = (wkCats[k] || 0) + Math.abs(t.amount || 0) })
    const hmCats = {}; hmTx.filter(t => t.type === 'expense').forEach(t => { const k = t.category || 'Other'; hmCats[k] = (hmCats[k] || 0) + Math.abs(t.amount || 0) })

    return { key, label, wkIncome, wkExpenses, wkSavings, wkRemit, hmDirectIncome, hmRemitsRec, hmTotalIn, hmExpenses, hmSavings, wkCats, hmCats }
  })

  const CHART_H = 160
  const WK_CLR  = { income: '#4a9eff', expenses: '#b8645a', savings: '#c9a961', remittance: '#7a92b0' }
  const HM_CLR  = { received: '#68a691', directIncome: '#4a9eff', expenses: '#b8645a', savings: '#c9a961' }
  const CAT_CLR = {
    Rent: '#e74c3c', Groceries: '#27ae60', Dining: '#f39c12', Transport: '#3498db',
    Utilities: '#9b59b6', Healthcare: '#e91e63', Shopping: '#ff5722', Entertainment: '#00bcd4',
    'Loan EMI': '#e74c3c', Insurance: '#8e44ad', Household: '#16a085', Education: '#2980b9',
    Remittance: '#7a92b0', 'Personal Care': '#f06292', Subscription: '#26c6da', Other: '#78909c',
  }
  const BKT_CLR = { Essentials: C.teal, Discretionary: C.yellow, 'Remittance Sent': C.purple, Bills: C.red }

  const fmtWk = v => `KD ${v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0)}`
  const fmtHm = v => v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v.toFixed(0)}`

  const nonZeroAvg = arr => { const f = arr.filter(v => v !== 0); return f.length ? f.reduce((s, v) => s + v, 0) / f.length : 0 }
  const wkAvgIn  = nonZeroAvg(monthlyData.map(m => m.wkIncome))
  const wkAvgEx  = nonZeroAvg(monthlyData.map(m => m.wkExpenses))
  const wkAvgSav = nonZeroAvg(monthlyData.map(m => m.wkSavings))
  const hmAvgRec = nonZeroAvg(monthlyData.map(m => m.hmRemitsRec))
  const hmAvgEx  = nonZeroAvg(monthlyData.map(m => m.hmExpenses))
  const hmAvgSav = nonZeroAvg(monthlyData.map(m => m.hmSavings))

  // ── Sub-components ──────────────────────────────────────────────────────────

  const Legend = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
      <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
    </div>
  )

  const TrendStat = ({ label, value, sub, color }) => (
    <div style={{ background: C.card2, borderRadius: 10, padding: '12px 14px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 17, fontWeight: 800, color: color || C.text, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )

  const GroupedBarChart = ({ data, series, height = CHART_H, fmtFn }) => {
    const maxVal = Math.max(...data.flatMap(d => series.map(s => d[s.key] || 0)), 1)
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {data.map(d => (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, width: '100%', justifyContent: 'center' }}>
              {series.map(s => {
                const val = d[s.key] || 0
                const bH  = Math.max((val / maxVal) * (height - 24), val > 0 ? 3 : 0)
                return (
                  <div key={s.key} title={`${s.label}: ${fmtFn ? fmtFn(val) : val.toFixed(0)}`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height }}>
                    <div style={{ width: '100%', height: bH, background: s.color, borderRadius: '3px 3px 0 0', opacity: 0.88 }} />
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{d.label}</div>
          </div>
        ))}
      </div>
    )
  }

  const CategoryBreakdown = ({ catsKey, fmtFn, emptyMsg }) => {
    const allCats = [...new Set(monthlyData.flatMap(m => Object.keys(m[catsKey] || {})))]
      .filter(c => monthlyData.some(m => (m[catsKey][c] || 0) > 0))
      .sort((a, b) => monthlyData.reduce((s, m) => s + ((m[catsKey][b] || 0) - (m[catsKey][a] || 0)), 0))
      .slice(0, 9)
    if (!allCats.length) return <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>{emptyMsg || 'No data yet'}</div>
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {allCats.map(cat => {
          const vals  = monthlyData.map(m => m[catsKey][cat] || 0)
          const maxV  = Math.max(...vals, 1)
          const tot6  = vals.reduce((s, v) => s + v, 0)
          const color = CAT_CLR[cat] || C.accent
          return (
            <div key={cat} style={{ background: C.card2, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 1 }}>{cat}</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>6mo: {fmtFn(tot6)}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }}>
                {vals.map((v, i) => (
                  <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                    <div style={{ width: '100%', height: maxV > 0 ? Math.max((v / maxV) * 34, v > 0 ? 2 : 0) : 0, background: color, borderRadius: '2px 2px 0 0', opacity: 0.8 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                {monthlyData.map(m => <span key={m.label} style={{ fontSize: 9, color: C.muted }}>{m.label}</span>)}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const BucketGrid = ({ catsKey, buckets, fmtFn }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
      {Object.entries(buckets).map(([bucket, cats]) => {
        const vals  = monthlyData.map(m => cats.reduce((s, c) => s + ((m[catsKey] || {})[c] || 0), 0))
        const maxV  = Math.max(...vals, 1)
        const tot6  = vals.reduce((s, v) => s + v, 0)
        const color = BKT_CLR[bucket] || C.accent
        return (
          <div key={bucket} style={{ background: C.card2, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 1 }}>{bucket}</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>6mo: {fmtFn(tot6)}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }}>
              {vals.map((v, i) => (
                <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: maxV > 0 ? Math.max((v / maxV) * 34, v > 0 ? 2 : 0) : 0, background: color, borderRadius: '2px 2px 0 0', opacity: 0.8 }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              {monthlyData.map(m => <span key={m.label} style={{ fontSize: 9, color: C.muted }}>{m.label}</span>)}
            </div>
          </div>
        )
      })}
    </div>
  )

  const tabBtn = (id, label) => (
    <button onClick={() => setView(id)} style={{
      padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
      background: view === id ? C.accent : C.card2, color: view === id ? '#fff' : C.muted,
    }}>{label}</button>
  )

  const WK_BUCKETS = {
    Essentials:        ['Rent', 'Groceries', 'Transport', 'Utilities', 'Healthcare', 'Household'],
    Discretionary:     ['Dining', 'Shopping', 'Entertainment', 'Personal Care', 'Subscription', 'Travel'],
    'Remittance Sent': ['Remittance'],
    Bills:             ['Loan EMI', 'Credit Card Bill', 'Insurance', 'Fees & Charges'],
  }
  const HM_BUCKETS = {
    Bills:         ['Loan EMI', 'Credit Card Bill', 'Insurance', 'Fees & Charges'],
    Essentials:    ['Groceries', 'Healthcare', 'Household', 'Utilities', 'Education'],
    Discretionary: ['Dining', 'Shopping', 'Entertainment', 'Personal Care', 'Travel'],
  }

  const combinedData = monthlyData.map(m => ({
    ...m,
    wkSavingsINR:  toINR ? toINR(m.wkSavings,  foreignCurrency) : 0,
    wkIncomeINR:   toINR ? toINR(m.wkIncome,   foreignCurrency) : 0,
    wkExpensesINR: toINR ? toINR(m.wkExpenses, foreignCurrency) : 0,
  }))

  return (
    <div style={pg}>
      <h2 style={pgTitle}>Spending Trends</h2>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
        Last 6 months — Working ({foreignCurrency}) and Home ({homeCurrency}) shown separately
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabBtn('working',  <><Flag currency={foreignCurrency} size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> Working ({foreignCurrency})</>)}
        {tabBtn('home',     <><Flag currency={homeCurrency} size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> Home ({homeCurrency})</>)}
        {tabBtn('combined', '🌐 Combined')}
      </div>

      {/* ── Working Country ─────────────────────────────────────────────────── */}
      {view === 'working' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <TrendStat label="Avg Monthly Income"   value={fmtWk(wkAvgIn)}  sub="6-mo average" color={WK_CLR.income} />
            <TrendStat label="Avg Monthly Expenses" value={fmtWk(wkAvgEx)}  sub="incl. remittances" color={WK_CLR.expenses} />
            <TrendStat label="Avg Monthly Savings"
              value={fmtWk(Math.abs(wkAvgSav))}
              sub={wkAvgIn > 0 ? `${((wkAvgSav / wkAvgIn) * 100).toFixed(1)}% savings rate` : 'no income data'}
              color={wkAvgSav >= 0 ? WK_CLR.savings : C.red} />
          </div>

          <Card title={<><Flag currency={foreignCurrency} size={13} style={{ marginRight: 5 }} />Working Country — Monthly Overview ({foreignCurrency})</>} style={{ marginBottom: 16 }}>
            <GroupedBarChart data={monthlyData}
              series={[
                { key: 'wkIncome',   label: 'Income',   color: WK_CLR.income },
                { key: 'wkExpenses', label: 'Expenses', color: WK_CLR.expenses },
                { key: 'wkSavings',  label: 'Savings',  color: WK_CLR.savings },
              ]}
              fmtFn={fmtWk} />
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <Legend color={WK_CLR.income}   label="Income" />
              <Legend color={WK_CLR.expenses} label="Expenses (incl. remittances sent)" />
              <Legend color={WK_CLR.savings}  label="Savings" />
            </div>
          </Card>

          {monthlyData.some(m => m.wkRemit > 0) && (
            <Card title={`Remittances Sent (${foreignCurrency})`} style={{ marginBottom: 16 }}>
              <GroupedBarChart data={monthlyData}
                series={[{ key: 'wkRemit', label: 'Remittance Sent', color: WK_CLR.remittance }]}
                height={90} fmtFn={fmtWk} />
            </Card>
          )}

          <Card title={`Working Country — Expenses by Category (${foreignCurrency})`} style={{ marginBottom: 16 }}>
            <CategoryBreakdown catsKey="wkCats" fmtFn={fmtWk} emptyMsg="No working country expense transactions yet" />
          </Card>

          <Card title="Working Country — Allocation Buckets">
            <BucketGrid catsKey="wkCats" buckets={WK_BUCKETS} fmtFn={fmtWk} />
          </Card>
        </>
      )}

      {/* ── Home Country ────────────────────────────────────────────────────── */}
      {view === 'home' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <TrendStat label="Avg Remittances Received" value={fmtHm(hmAvgRec)}  sub="6-mo average" color={HM_CLR.received} />
            <TrendStat label="Avg Monthly Expenses"     value={fmtHm(hmAvgEx)}   sub="6-mo average" color={HM_CLR.expenses} />
            <TrendStat label="Avg Monthly Savings"
              value={fmtHm(Math.abs(hmAvgSav))}
              sub={hmAvgRec > 0 ? `${((hmAvgSav / hmAvgRec) * 100).toFixed(1)}% savings rate` : 'no remittances recorded'}
              color={hmAvgSav >= 0 ? HM_CLR.savings : C.red} />
          </div>

          <Card title={<><Flag currency={homeCurrency} size={13} style={{ marginRight: 5 }} />Home Country — Monthly Overview ({homeCurrency})</>} style={{ marginBottom: 16 }}>
            <GroupedBarChart data={monthlyData}
              series={[
                { key: 'hmRemitsRec', label: 'Remittances Received', color: HM_CLR.received },
                { key: 'hmExpenses',  label: 'Expenses',             color: HM_CLR.expenses },
                { key: 'hmSavings',   label: 'Savings',              color: HM_CLR.savings },
              ]}
              fmtFn={fmtHm} />
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <Legend color={HM_CLR.received} label="Remittances Received" />
              <Legend color={HM_CLR.expenses} label="Expenses" />
              <Legend color={HM_CLR.savings}  label="Savings" />
            </div>
          </Card>

          <Card title={`Home Country — Expenses by Category (${homeCurrency})`} style={{ marginBottom: 16 }}>
            <CategoryBreakdown catsKey="hmCats" fmtFn={fmtHm} emptyMsg="No home country expense transactions yet" />
          </Card>

          <Card title="Home Country — Allocation Buckets">
            <BucketGrid catsKey="hmCats" buckets={HM_BUCKETS} fmtFn={fmtHm} />
          </Card>
        </>
      )}

      {/* ── Combined View ───────────────────────────────────────────────────── */}
      {view === 'combined' && (
        <>
          <Card title="🌐 Combined Savings — Both Countries (₹)" style={{ marginBottom: 16 }}>
            <GroupedBarChart data={combinedData}
              series={[
                { key: 'wkSavingsINR', label: `Working Savings (${foreignCurrency}→₹)`, color: WK_CLR.savings },
                { key: 'hmSavings',    label: `Home Savings (₹)`,                        color: HM_CLR.savings },
              ]}
              fmtFn={fmtHm} />
            <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
              <Legend color={WK_CLR.savings}  label={`Working Savings (in ₹)`} />
              <Legend color={HM_CLR.savings}  label="Home Savings" />
            </div>
          </Card>

          <Card title="🌐 Combined Income vs Expenses (₹)" style={{ marginBottom: 16 }}>
            <GroupedBarChart data={combinedData}
              series={[
                { key: 'wkIncomeINR',   label: `Working Income (₹)`,   color: WK_CLR.income },
                { key: 'hmRemitsRec',   label: 'Home Remittances (₹)', color: HM_CLR.received },
                { key: 'wkExpensesINR', label: `Working Expenses (₹)`, color: WK_CLR.expenses },
                { key: 'hmExpenses',    label: 'Home Expenses (₹)',     color: '#c0392b' },
              ]}
              fmtFn={fmtHm} />
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <Legend color={WK_CLR.income}    label="Working Income" />
              <Legend color={HM_CLR.received}  label="Remittances Received" />
              <Legend color={WK_CLR.expenses}  label="Working Expenses" />
              <Legend color="#c0392b"          label="Home Expenses" />
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {monthlyData.map(m => {
              const combIn  = (toINR ? toINR(m.wkIncome, foreignCurrency) : 0) + m.hmRemitsRec
              const combEx  = (toINR ? toINR(m.wkExpenses, foreignCurrency) : 0) + m.hmExpenses
              const combSav = combIn - combEx
              return (
                <div key={m.key} style={{ background: C.card2, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>Income <span className="num" style={{ color: WK_CLR.income, fontWeight: 600 }}>{fmtHm(combIn)}</span></div>
                  <div style={{ fontSize: 11, color: C.muted }}>Expenses <span className="num" style={{ color: WK_CLR.expenses, fontWeight: 600 }}>{fmtHm(combEx)}</span></div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: combSav >= 0 ? C.green : C.red, marginTop: 6 }}>
                    Savings {fmtHm(combSav)}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tax Estimator ────────────────────────────────────────────────────────────
const TAX_PROFILES = {
  IN: {
    name: 'India (NRI)', flag: '🇮🇳', currency: 'INR', symbol: '₹',
    fields: ['salary','nroInterest','rental','dividends','ltcgEquity','stcgEquity','ltcgOther','otherIncome','dtaaCredit'],
    notes: [
      { t: 'NRO Interest', d: '30% flat TDS. No basic exemption for NRIs.', color: '#b8645a' },
      { t: 'Rental Income', d: '30% standard deduction applied, then new-regime slabs.', color: '#c9a961' },
      { t: 'LTCG Equity', d: '12.5% above ₹1.25L exemption (post July 2024 budget).', color: '#68a691' },
      { t: 'STCG Equity', d: '20% flat (revised July 2024). No 87A rebate for NRIs.', color: '#7a92b0' },
      { t: 'DTAA', d: 'File Form 67 before ITR to claim foreign tax credit.', color: '#9b7eb5' },
    ],
  },
  US: {
    name: 'United States', flag: '🇺🇸', currency: 'USD', symbol: '$',
    fields: ['salary','dividends','ltcgEquity','stcgEquity','rental','otherIncome','taxCredits'],
    notes: [
      { t: 'Federal Brackets', d: '10% / 12% / 22% / 24% / 32% / 35% / 37%. State tax additional.', color: '#b8645a' },
      { t: 'LTCG', d: '0% / 15% / 20% depending on total income. Held > 1 year.', color: '#68a691' },
      { t: 'STCG', d: 'Taxed as ordinary income (up to 37%).', color: '#c9a961' },
      { t: 'FBAR / FATCA', d: 'Foreign accounts > $10,000 require FBAR filing.', color: '#9b7eb5' },
    ],
  },
  GB: {
    name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', symbol: '£',
    fields: ['salary','dividends','ltcgEquity','rental','otherIncome','taxCredits'],
    notes: [
      { t: 'Income Tax', d: 'Personal allowance £12,570. Basic 20%, Higher 40%, Additional 45%.', color: '#b8645a' },
      { t: 'Capital Gains', d: '£3,000 annual exemption. 18% (basic) / 24% (higher) on property. 10%/20% on other assets.', color: '#68a691' },
      { t: 'Dividends', d: '£500 allowance, then 8.75% / 33.75% / 39.35%.', color: '#c9a961' },
      { t: 'NI Contributions', d: 'Class 1 NI on employment income. Check HMRC guidance.', color: '#7a92b0' },
    ],
  },
  CA: {
    name: 'Canada', flag: '🇨🇦', currency: 'CAD', symbol: 'CA$',
    fields: ['salary','dividends','ltcgEquity','rental','otherIncome','taxCredits'],
    notes: [
      { t: 'Federal Tax', d: '15% / 20.5% / 26% / 29% / 33% on progressive brackets.', color: '#b8645a' },
      { t: 'Capital Gains', d: '50% inclusion rate (< CA$250K/yr), 2/3 above that. Added to income.', color: '#68a691' },
      { t: 'Provincial Tax', d: 'Additional 5%–25% depending on province. Not included here.', color: '#c9a961' },
      { t: 'TFSA / RRSP', d: 'Contributions reduce taxable income. Consult CRA guidelines.', color: '#9b7eb5' },
    ],
  },
  AU: {
    name: 'Australia', flag: '🇦🇺', currency: 'AUD', symbol: 'A$',
    fields: ['salary','dividends','ltcgEquity','rental','otherIncome','taxCredits'],
    notes: [
      { t: 'Income Tax', d: 'Tax-free threshold A$18,200. Then 16% / 30% / 37% / 45%.', color: '#b8645a' },
      { t: 'LTCG Discount', d: '50% CGT discount if asset held > 12 months.', color: '#68a691' },
      { t: 'Medicare Levy', d: '2% Medicare levy on taxable income (included in estimate).', color: '#c9a961' },
      { t: 'Super', d: 'Superannuation contributions at 11.5% (employer). Concessional tax 15%.', color: '#7a92b0' },
    ],
  },
  SG: {
    name: 'Singapore', flag: '🇸🇬', currency: 'SGD', symbol: 'S$',
    fields: ['salary','dividends','rental','otherIncome','taxCredits'],
    notes: [
      { t: 'Income Tax', d: 'Progressive 0%–24%. First S$20,000 exempt.', color: '#b8645a' },
      { t: 'No CGT', d: 'Singapore has no capital gains tax.', color: '#68a691' },
      { t: 'Dividends', d: 'One-tier system — dividends are tax-exempt in hands of shareholders.', color: '#c9a961' },
      { t: 'CPF', d: 'CPF contributions mandatory for citizens/PRs. Not applicable for foreigners.', color: '#7a92b0' },
    ],
  },
  DE: {
    name: 'Germany', flag: '🇩🇪', currency: 'EUR', symbol: '€',
    fields: ['salary','dividends','ltcgEquity','rental','otherIncome','taxCredits'],
    notes: [
      { t: 'Income Tax', d: 'Progressive 14%–45% + 5.5% solidarity surcharge on tax.', color: '#b8645a' },
      { t: 'Capital Gains', d: '25% Abgeltungsteuer (withholding tax) + solidarity surcharge.', color: '#68a691' },
      { t: 'Savings Allowance', d: '€1,000 tax-free on investment income (Sparerpauschbetrag).', color: '#c9a961' },
      { t: 'Church Tax', d: 'Additional 8–9% on income tax if registered. Not included.', color: '#7a92b0' },
    ],
  },
  KW: { name: 'Kuwait', flag: '🇰🇼', currency: 'KWD', symbol: 'KD', noPersonalTax: true },
  AE: { name: 'UAE', flag: '🇦🇪', currency: 'AED', symbol: 'AED', noPersonalTax: true },
  SA: { name: 'Saudi Arabia', flag: '🇸🇦', currency: 'SAR', symbol: 'SAR', noPersonalTax: true },
  QA: { name: 'Qatar', flag: '🇶🇦', currency: 'QAR', symbol: 'QAR', noPersonalTax: true },
  BH: { name: 'Bahrain', flag: '🇧🇭', currency: 'BHD', symbol: 'BD', noPersonalTax: true },
  OM: { name: 'Oman', flag: '🇴🇲', currency: 'OMR', symbol: 'OMR', noPersonalTax: true },
}

const FIELD_LABELS = {
  salary: 'Employment / Salary Income',
  nroInterest: 'NRO Interest / FD Income',
  rental: 'Rental Income',
  dividends: 'Dividends / Investment Income',
  ltcgEquity: 'Long-Term Capital Gains — Equity / MF',
  stcgEquity: 'Short-Term Capital Gains — Equity / MF',
  ltcgOther: 'Long-Term Capital Gains — Other Assets',
  otherIncome: 'Other Taxable Income',
  dtaaCredit: 'DTAA / Foreign Tax Credit',
  taxCredits: 'Tax Credits / Deductions',
}

function calcTax(country, vals) {
  const v = k => parseFloat(vals[k]) || 0
  const rows = []
  let totalTax = 0

  const addRow = (label, income, tax) => { if (income > 0 || tax > 0) { rows.push({ label, income, tax }); totalTax += tax } }

  if (country === 'IN') {
    const slabTax = inc => {
      if (inc <= 300000) return 0
      if (inc <= 700000) return (inc - 300000) * 0.05
      if (inc <= 1000000) return 20000 + (inc - 700000) * 0.10
      if (inc <= 1200000) return 50000 + (inc - 1000000) * 0.15
      if (inc <= 1500000) return 80000 + (inc - 1200000) * 0.20
      return 140000 + (inc - 1500000) * 0.30
    }
    addRow('Salary (slab rates)', v('salary'), slabTax(v('salary')))
    addRow('NRO Interest (30% flat)', v('nroInterest'), v('nroInterest') * 0.30)
    addRow('Rental Income (after 30% std deduction)', v('rental'), slabTax(v('rental') * 0.70))
    addRow('Dividends (slab rates)', v('dividends'), slabTax(v('dividends')))
    addRow('LTCG Equity (12.5% above ₹1.25L)', v('ltcgEquity'), Math.max(0, v('ltcgEquity') - 125000) * 0.125)
    addRow('STCG Equity (20%)', v('stcgEquity'), v('stcgEquity') * 0.20)
    addRow('LTCG Other Assets (20%)', v('ltcgOther'), v('ltcgOther') * 0.20)
    addRow('Other Income (slab rates)', v('otherIncome'), slabTax(v('otherIncome')))
    const cess = totalTax * 0.04
    const credit = v('dtaaCredit')
    return { rows, subtax: totalTax, surcharge: cess, surchargeLabel: '4% Health & Education Cess', credit, finalTax: Math.max(0, totalTax + cess - credit) }
  }

  if (country === 'US') {
    const fedTax = inc => {
      const brackets = [[11600,0.10],[47150,0.12],[100525,0.22],[191950,0.24],[243725,0.32],[609350,0.35],[Infinity,0.37]]
      let tax = 0, prev = 0
      for (const [limit, rate] of brackets) { if (inc <= prev) break; tax += (Math.min(inc, limit) - prev) * rate; prev = limit }
      return tax
    }
    const ltcgRate = inc => inc <= 47025 ? 0 : inc <= 518900 ? 0.15 : 0.20
    addRow('Employment / Salary (federal)', v('salary'), fedTax(v('salary')))
    addRow('Rental Income', v('rental'), fedTax(v('rental')))
    addRow('STCG — Equity (ordinary rates)', v('stcgEquity'), fedTax(v('stcgEquity')))
    addRow('Other Income', v('otherIncome'), fedTax(v('otherIncome')))
    const totalOrdinary = v('salary') + v('rental') + v('stcgEquity') + v('otherIncome')
    addRow('Dividends (qualified, LTCG rates)', v('dividends'), v('dividends') * ltcgRate(totalOrdinary + v('dividends')))
    addRow('LTCG — Equity', v('ltcgEquity'), v('ltcgEquity') * ltcgRate(totalOrdinary + v('ltcgEquity')))
    const credit = v('taxCredits')
    return { rows, subtax: totalTax, surcharge: 0, surchargeLabel: '', credit, finalTax: Math.max(0, totalTax - credit), note: 'Federal tax only. State/local taxes not included.' }
  }

  if (country === 'GB') {
    const allowance = 12570
    const incomeTax = inc => {
      const taxable = Math.max(0, inc - allowance)
      if (taxable <= 37700) return taxable * 0.20
      if (taxable <= 125140) return 37700 * 0.20 + (taxable - 37700) * 0.40
      return 37700 * 0.20 + 87440 * 0.40 + (taxable - 125140) * 0.45
    }
    addRow('Employment / Salary', v('salary'), incomeTax(v('salary')))
    addRow('Rental Income', v('rental'), incomeTax(v('rental')))
    addRow('Other Income', v('otherIncome'), incomeTax(v('otherIncome')))
    const divAllowance = 500
    const divTaxable = Math.max(0, v('dividends') - divAllowance)
    const totalIncome = v('salary') + v('rental') + v('otherIncome')
    const divRate = totalIncome <= 37700 + allowance ? 0.0875 : totalIncome <= 125140 ? 0.3375 : 0.3935
    addRow('Dividends (after £500 allowance)', v('dividends'), divTaxable * divRate)
    const cgtExemption = 3000
    const cgtTaxable = Math.max(0, v('ltcgEquity') - cgtExemption)
    const cgtRate = totalIncome <= 37700 + allowance ? 0.10 : 0.20
    addRow('Capital Gains (after £3,000 exemption)', v('ltcgEquity'), cgtTaxable * cgtRate)
    const credit = v('taxCredits')
    return { rows, subtax: totalTax, surcharge: 0, surchargeLabel: '', credit, finalTax: Math.max(0, totalTax - credit), note: 'National Insurance not included. Consult HMRC for full liability.' }
  }

  if (country === 'CA') {
    const fedTax = inc => {
      if (inc <= 55867) return inc * 0.15
      if (inc <= 111733) return 8380 + (inc - 55867) * 0.205
      if (inc <= 154906) return 19832 + (inc - 111733) * 0.26
      if (inc <= 220000) return 31041 + (inc - 154906) * 0.29
      return 49945 + (inc - 220000) * 0.33
    }
    addRow('Employment / Salary (federal)', v('salary'), fedTax(v('salary')))
    addRow('Rental Income', v('rental'), fedTax(v('rental')))
    addRow('Other Income', v('otherIncome'), fedTax(v('otherIncome')))
    addRow('Dividends', v('dividends'), fedTax(v('dividends')))
    const capGains = v('ltcgEquity')
    const inclusionRate = capGains <= 250000 ? 0.5 : 0.6667
    addRow('Capital Gains (50% inclusion)', capGains, fedTax(capGains * inclusionRate))
    const credit = v('taxCredits')
    return { rows, subtax: totalTax, surcharge: 0, surchargeLabel: '', credit, finalTax: Math.max(0, totalTax - credit), note: 'Federal tax only. Add 5–25% for provincial tax.' }
  }

  if (country === 'AU') {
    const incomeTax = inc => {
      if (inc <= 18200) return 0
      if (inc <= 45000) return (inc - 18200) * 0.16
      if (inc <= 120000) return 4288 + (inc - 45000) * 0.30
      if (inc <= 180000) return 26838 + (inc - 120000) * 0.37
      return 51638 + (inc - 180000) * 0.45
    }
    addRow('Employment / Salary', v('salary'), incomeTax(v('salary')))
    addRow('Rental Income', v('rental'), incomeTax(v('rental')))
    addRow('Dividends', v('dividends'), incomeTax(v('dividends')))
    addRow('Other Income', v('otherIncome'), incomeTax(v('otherIncome')))
    const ltcg = v('ltcgEquity') * 0.5
    addRow('LTCG Equity (50% discount applied)', v('ltcgEquity'), incomeTax(ltcg))
    addRow('STCG Equity (no discount)', v('stcgEquity'), incomeTax(v('stcgEquity')))
    const medicare = totalTax * 0.02
    const credit = v('taxCredits')
    return { rows, subtax: totalTax, surcharge: medicare, surchargeLabel: '2% Medicare Levy', credit, finalTax: Math.max(0, totalTax + medicare - credit) }
  }

  if (country === 'SG') {
    const incomeTax = inc => {
      const brackets = [[20000,0],[30000,0.02],[40000,0.035],[80000,0.07],[120000,0.115],[160000,0.15],[200000,0.18],[240000,0.19],[280000,0.195],[320000,0.20],[500000,0.22],[1000000,0.23],[Infinity,0.24]]
      let tax = 0, prev = 0
      for (const [limit, rate] of brackets) { if (inc <= prev) break; tax += (Math.min(inc, limit) - prev) * rate; prev = limit }
      return tax
    }
    addRow('Employment / Salary', v('salary'), incomeTax(v('salary')))
    addRow('Rental Income', v('rental'), incomeTax(v('rental')))
    addRow('Other Income', v('otherIncome'), incomeTax(v('otherIncome')))
    const credit = v('taxCredits')
    return { rows, subtax: totalTax, surcharge: 0, surchargeLabel: '', credit, finalTax: Math.max(0, totalTax - credit), note: 'No capital gains tax or dividend tax in Singapore.' }
  }

  if (country === 'DE') {
    const incomeTax = inc => {
      if (inc <= 11604) return 0
      if (inc <= 17005) { const y = (inc - 11604) / 10000; return (979.18 * y + 1400) * y }
      if (inc <= 66760) { const z = (inc - 17005) / 10000; return (192.59 * z + 2397) * z + 1025.38 }
      if (inc <= 277825) return inc * 0.42 - 10602.13
      return inc * 0.45 - 18936.88
    }
    addRow('Employment / Salary', v('salary'), incomeTax(v('salary')))
    addRow('Rental Income', v('rental'), incomeTax(v('rental')))
    addRow('Other Income', v('otherIncome'), incomeTax(v('otherIncome')))
    const savingsAllowance = 1000
    const investIncome = Math.max(0, v('dividends') + v('ltcgEquity') - savingsAllowance)
    addRow('Investment Income (25% Abgeltungsteuer)', v('dividends') + v('ltcgEquity'), investIncome * 0.25)
    const soli = totalTax > 18130 ? totalTax * 0.055 : 0
    const credit = v('taxCredits')
    return { rows, subtax: totalTax, surcharge: soli, surchargeLabel: '5.5% Solidarity Surcharge', credit, finalTax: Math.max(0, totalTax + soli - credit) }
  }

  return { rows: [], subtax: 0, surcharge: 0, surchargeLabel: '', credit: 0, finalTax: 0 }
}

function TaxEstimator({ transactions = [], investments = [], remittances = [], foreignCurrency, homeCurrency, exchangeRate, toINR }) {
  const curYear = new Date().getFullYear()
  const [taxCountry, setTaxCountry] = useState('IN')
  const [taxYear, setTaxYear] = useState(String(curYear))
  const [vals, setVals] = useState({})
  const [autoFilled, setAutoFilled] = useState(false)

  const profile = TAX_PROFILES[taxCountry]
  const set = (k, v) => setVals(p => ({ ...p, [k]: v }))

  const autoFill = () => {
    const yr = taxYear
    const txs = transactions.filter(t => (t.date || '').startsWith(yr))
    const sumCat = (...cats) => txs.filter(t => cats.includes(t.category) && t.amount > 0).reduce((s, t) => s + Math.abs(t.amount), 0)

    const salary = sumCat('Salary')
    const rental = sumCat('Rental Income')
    const dividends = sumCat('Dividends')
    const otherIncome = sumCat('Other Income')

    // Capital gains from investments
    let ltcgEquity = 0, stcgEquity = 0, ltcgOther = 0
    investments.forEach(inv => {
      const gain = (inv.currentValue || 0) - (inv.invested || 0)
      if (gain <= 0 || !inv.purchaseDate) return
      const days = (Date.now() - new Date(inv.purchaseDate).getTime()) / 86400000
      const isEquity = ['Mutual Fund', 'Stocks', 'ETF'].includes(inv.type)
      if (isEquity) { days > 365 ? (ltcgEquity += gain) : (stcgEquity += gain) }
      else { days > 730 ? (ltcgOther += gain) : (stcgEquity += gain) }
    })

    // NRO interest from transactions tagged as interest/FD
    const nroInterest = sumCat('Dividends') // approximation — FD interest often logged here

    setVals(p => ({
      ...p,
      salary: salary ? String(Math.round(salary)) : p.salary,
      rental: rental ? String(Math.round(rental)) : p.rental,
      dividends: dividends ? String(Math.round(dividends)) : p.dividends,
      otherIncome: otherIncome ? String(Math.round(otherIncome)) : p.otherIncome,
      ltcgEquity: ltcgEquity ? String(Math.round(ltcgEquity)) : p.ltcgEquity,
      stcgEquity: stcgEquity ? String(Math.round(stcgEquity)) : p.stcgEquity,
      ltcgOther: ltcgOther ? String(Math.round(ltcgOther)) : p.ltcgOther,
      nroInterest: nroInterest && taxCountry === 'IN' ? String(Math.round(nroInterest)) : p.nroInterest,
    }))
    setAutoFilled(true)
  }

  const result = profile?.noPersonalTax ? null : calcTax(taxCountry, vals)

  const downloadReport = () => {
    const p = profile
    const lines = [
      `TAX ESTIMATE REPORT`,
      `Generated: ${new Date().toLocaleDateString()}`,
      `Tax Year: ${taxYear}`,
      `Country: ${p.name}`,
      ``,
      `INCOME & TAX BREAKDOWN`,
      `${'Income Type'.padEnd(45)} ${'Income'.padStart(15)} ${'Tax'.padStart(15)}`,
      `${'-'.repeat(75)}`,
    ]
    if (result) {
      result.rows.forEach(r => {
        lines.push(`${r.label.padEnd(45)} ${String(r.income.toFixed(2)).padStart(15)} ${String(r.tax.toFixed(2)).padStart(15)}`)
      })
      lines.push(`${'-'.repeat(75)}`)
      lines.push(`${'Subtotal Tax'.padEnd(45)} ${''.padStart(15)} ${String(result.subtax.toFixed(2)).padStart(15)}`)
      if (result.surcharge > 0) lines.push(`${result.surchargeLabel.padEnd(45)} ${''.padStart(15)} ${String(result.surcharge.toFixed(2)).padStart(15)}`)
      if (result.credit > 0) lines.push(`${'Tax Credits / DTAA'.padEnd(45)} ${''.padStart(15)} ${String((-result.credit).toFixed(2)).padStart(15)}`)
      lines.push(`${'-'.repeat(75)}`)
      lines.push(`${'ESTIMATED TOTAL TAX'.padEnd(45)} ${''.padStart(15)} ${String(result.finalTax.toFixed(2)).padStart(15)}`)
      lines.push(``)
      lines.push(`Currency: ${p.currency}`)
      if (result.note) lines.push(`Note: ${result.note}`)
    } else {
      lines.push(`${p.name} has no personal income tax.`)
    }
    lines.push(``)
    lines.push(`DISCLAIMER: This is an estimate only. Consult a qualified tax advisor for filing.`)

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `tax-report-${taxCountry}-${taxYear}.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  const downloadCSV = () => {
    const p = profile
    const rows = [['Tax Year', taxYear], ['Country', p.name], ['Currency', p.currency], []]
    rows.push(['Income Type', 'Income Amount', 'Tax Amount'])
    if (result) {
      result.rows.forEach(r => rows.push([r.label, r.income.toFixed(2), r.tax.toFixed(2)]))
      rows.push([])
      rows.push(['Subtotal Tax', '', result.subtax.toFixed(2)])
      if (result.surcharge > 0) rows.push([result.surchargeLabel, '', result.surcharge.toFixed(2)])
      if (result.credit > 0) rows.push(['Tax Credits / DTAA', '', (-result.credit).toFixed(2)])
      rows.push(['ESTIMATED TOTAL TAX', '', result.finalTax.toFixed(2)])
    }
    rows.push([])
    rows.push(['Disclaimer', 'Estimate only. Consult a qualified tax advisor.'])
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `tax-report-${taxCountry}-${taxYear}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={pg}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ ...pgTitle, marginBottom: 0 }}>Tax Estimator</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" size="sm" onClick={autoFill}>⚡ Auto-fill from App Data</Btn>
          <Btn variant="ghost" size="sm" onClick={downloadCSV}>📊 CSV</Btn>
          <Btn variant="subtle" size="sm" onClick={downloadReport}>📄 Download Report</Btn>
        </div>
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Worldwide tax estimate · {taxYear} tax year</div>

      {/* Country & Year selectors */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Tax Residency Country</div>
          <select value={taxCountry} onChange={e => { setTaxCountry(e.target.value); setVals({}); setAutoFilled(false) }}
            style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13 }}>
            {Object.entries(TAX_PROFILES).map(([k, p]) => (
              <option key={k} value={k}>{p.flag} {p.name}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Tax Year</div>
          <select value={taxYear} onChange={e => { setTaxYear(e.target.value); setVals({}); setAutoFilled(false) }}
            style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 13 }}>
            {[curYear, curYear - 1, curYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {autoFilled && (
        <div style={{ background: C.teal + '15', border: `1px solid ${C.teal}33`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.mutedL }}>
          ⚡ Auto-filled from your {taxYear} transactions and investments. Review and adjust any values below.
        </div>
      )}

      {profile?.noPersonalTax ? (
        <Card title={`${profile.flag} ${profile.name} — Tax Summary`}>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>{profile.name} has no personal income tax.</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, maxWidth: 400, margin: '0 auto' }}>
              Residents pay no tax on salaries, capital gains, or investment income.
              However, you may still have tax obligations in your home country on worldwide income.
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Btn onClick={downloadReport} variant="subtle">📄 Download Summary Report</Btn>
              <Btn onClick={downloadCSV} variant="ghost">📊 Download CSV</Btn>
            </div>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 16, alignItems: 'start' }}>
          <Card title={`Income Inputs (${profile.currency})`}>
            {profile.fields.filter(f => f !== 'dtaaCredit' && f !== 'taxCredits').map(f => (
              <Input key={f} label={FIELD_LABELS[f] || f} type="number" value={vals[f] || ''}
                onChange={e => set(f, e.target.value)} placeholder="0" />
            ))}
            {(profile.fields.includes('dtaaCredit') || profile.fields.includes('taxCredits')) && (
              <Input
                label={profile.fields.includes('dtaaCredit') ? FIELD_LABELS.dtaaCredit : FIELD_LABELS.taxCredits}
                type="number"
                value={vals[profile.fields.includes('dtaaCredit') ? 'dtaaCredit' : 'taxCredits'] || ''}
                onChange={e => set(profile.fields.includes('dtaaCredit') ? 'dtaaCredit' : 'taxCredits', e.target.value)}
                placeholder="0"
              />
            )}
          </Card>

          <div>
            <Card title="Tax Breakdown" style={{ marginBottom: 14 }}>
              {result.rows.length === 0
                ? <div style={{ fontSize: 13, color: C.muted }}>Enter income amounts on the left, or click ⚡ Auto-fill.</div>
                : <>
                  {result.rows.map(r => (
                    <div key={r.label} style={{ ...rowSep, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: C.mutedL, flex: 1, paddingRight: 8 }}>{r.label}</span>
                      <span style={{ color: C.text, fontWeight: 600, flexShrink: 0 }}>{profile.symbol}{r.tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                  {result.surcharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0' }}>
                      <span style={{ color: C.muted }}>+ {result.surchargeLabel}</span>
                      <span style={{ color: C.text }}>{profile.symbol}{result.surcharge.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {result.credit > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                      <span style={{ color: C.green }}>− Tax Credits / DTAA</span>
                      <span style={{ color: C.green }}>−{profile.symbol}{result.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div style={{ background: `linear-gradient(135deg, ${C.red}15, ${C.red}06)`, border: `1px solid ${C.red}33`, borderRadius: 10, padding: '12px 14px', marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>Estimated Total Tax</span>
                    <span className="num" style={{ fontSize: 22, fontWeight: 900, color: C.red, letterSpacing: '-0.03em' }}>{profile.symbol}{result.finalTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {result.note && (
                    <div style={{ marginTop: 10, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>ℹ️ {result.note}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <Btn onClick={downloadCSV} variant="ghost" style={{ flex: 1 }}>📊 CSV</Btn>
                    <Btn onClick={downloadReport} variant="subtle" style={{ flex: 1 }}>📄 Download Report</Btn>
                  </div>
                </>
              }
            </Card>

            <Card title={`${profile.flag} Tax Notes`}>
              {profile.notes?.map(n => (
                <div key={n.t} style={{ borderLeft: `3px solid ${n.color}`, paddingLeft: 10, marginBottom: 10, paddingTop: 2, paddingBottom: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: n.color, marginBottom: 2 }}>{n.t}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{n.d}</div>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: 11, color: C.muted, lineHeight: 1.5, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                ⚠️ This is an estimate only. Tax laws change frequently. Consult a qualified tax advisor before filing.
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Bank Statement Import ────────────────────────────────────────────────────
// ── Exchange company detection ────────────────────────────────────────────────
const EXCHANGE_COMPANIES = [
  // Gulf / Middle East
  'al mulla', 'almulla', 'al muzaini', 'almuzaini', 'wall street exchange',
  'orient exchange', 'city exchange', 'national exchange', 'global exchange',
  'uae exchange', 'lulu exchange', 'tahweel', 'al rajhi', 'finance house exchange',
  'kuwait finance exchange', 'gcc exchange', 'habib exchange', 'al ansari',
  'al fardan', 'oman exchange', 'bahrain exchange', 'doha exchange',
  'al rostamani', 'emirates exchange', 'joyalukkas exchange', 'redha al ansari',
  // Global majors
  'western union', 'moneygram', 'wise', 'transferwise', 'xpress money',
  'ria money', 'ria financial', 'small world', 'instarem', 'remitly',
  'currencyfair', 'ofx', 'worldremit', 'world remit', 'azimo', 'paysend',
  'pangea', 'transfast', 'placid express', 'remitbee', 'xe money',
  'xe.com', 'travelex', 'currency exchange', 'forex', 'fx transfer',
  // Digital / Fintech
  'revolut', 'payoneer transfer', 'skrill', 'neteller', 'paypal transfer',
  'crypto remit', 'bitpesa', 'sendwave', 'cash app transfer', 'zelle',
  'venmo transfer', 'popmoney', 'wire transfer', 'swift transfer',
  // South / Southeast Asia focused
  'remit2india', 'sbi remit', 'icici money2india', 'axis remit',
  'hdfc quickremit', 'bookmyforex', 'extravelmoney', 'thomas cook',
  'ebixcash', 'paul merchants', 'transcorp', 'unimoni', 'eastern exchange',
  // Generic identifiers
  'exchange co', 'exchange center', 'money transfer', 'hawala',
  'fund transfer', 'remittance', 'overseas transfer', 'international transfer',
]
const HOME_INCOME_KEYWORDS = ['salary', 'salry', 'wages', 'bonus', 'incentive', 'allowance',
  'neft', 'rtgs', 'credit by', 'interest credit', 'dividend', 'pension', 'gratuity',
]
const CC_INTEREST_KEYWORDS = [
  'finance charge', 'finance charges', 'interest charge', 'interest charges',
  'late payment fee', 'late fee', 'overlimit fee', 'over limit fee',
  'annual fee', 'card fee', 'membership fee', 'renewal fee',
  'cash advance fee', 'foreign transaction fee', 'currency conversion fee',
  'minimum due charge', 'service charge', 'processing fee',
  'profit charge', 'profit rate', // Islamic banking terms
]
const CC_PAYMENT_KEYWORDS = [
  'payment received', 'payment thank you', 'bill payment', 'credit card payment',
  'card payment', 'cc payment', 'autopay', 'auto pay', 'direct debit',
]

// Internal bank credits that should be Transfer, not Income
const INTERNAL_TRANSFER_KEYWORDS = [
  // Account-to-account transfers
  'transfer from', 'trf from', 'tfr from', 'from account', 'from acc',
  'inward transfer', 'own account', 'self transfer', 'inter account',
  'from saving', 'from current', 'internal transfer', 'bank transfer',
  // Loan/financing credits (disbursement goes to account but is a liability)
  'loan proceeds', 'loan disbursement', 'financing proceeds', 'facility proceeds',
  'murabaha proceeds', 'musawama proceeds', 'credit facility',
  // Reversals / corrections
  'reversal', 'reversed', 'charge reversal', 'fee reversal', 'refund from bank',
  'correction credit', 'error correction',
  // Kuwait/Gulf specific internal credits
  'atm cash deposit', 'cash deposit machine', 'cdm deposit',
  'sweep from', 'sweep credit', 'auto sweep',
  'standing order credit', 'so credit',
]
const isInternalBankCredit = desc => {
  const d = (desc || '').toLowerCase()
  return INTERNAL_TRANSFER_KEYWORDS.some(k => d.includes(k))
}
const isExchangeCompany = desc => {
  const d = (desc || '').toLowerCase()
  return EXCHANGE_COMPANIES.some(c => d.includes(c))
}
const isHomeIncome = desc => {
  const d = (desc || '').toLowerCase()
  return HOME_INCOME_KEYWORDS.some(k => d.includes(k))
}
const isCCInterest = desc => {
  const d = (desc || '').toLowerCase()
  return CC_INTEREST_KEYWORDS.some(k => d.includes(k))
}
const isCCPayment = desc => {
  const d = (desc || '').toLowerCase()
  return CC_PAYMENT_KEYWORDS.some(k => d.includes(k))
}
// Detect UPI debit to a person (not a business)
// UPI format: UPI/DR/REF/PAYEE_NAME/BANK/...
// EMI detection keywords + lender matching
const EMI_KEYWORDS = [
  'emi', 'equated monthly', 'loan payment', 'loan emi', 'home loan', 'housing loan',
  'car loan', 'auto loan', 'personal loan', 'education loan', 'mortgage',
  'loan repayment', 'loan instalment', 'loan installment', 'loan debit',
  'hdfc loan', 'sbi loan', 'icici loan', 'axis loan', 'kotak loan',
  'bajaj finserv', 'tata capital', 'l&t finance', 'lichfl', 'lic housing',
  'pnb housing', 'indiabulls', 'fullerton', 'capital first', 'muthoot',
  // Islamic finance terms (Gulf banks)
  'musawama', 'murabaha', 'ijarah', 'ijara', 'diminishing musharakah',
  'al mulla finance', 'kmefic', 'bfin', 'gulf finance', 'kuwait finance',
  'aayan leasing', 'ajil', 'tawarruq',
]
const isEMIPayment = desc => {
  const d = (desc || '').toLowerCase()
  return EMI_KEYWORDS.some(k => d.includes(k))
}
// Match a transaction description to an existing loan by lender/name similarity
const matchLoanFromDesc = (desc, loans) => {
  if (!loans?.length || !desc) return null
  const d = desc.toLowerCase()
  return loans.find(l => {
    const lenderWords = (l.lender || l.name || '').toLowerCase().split(/\s+/).filter(w => w.length > 3)
    return lenderWords.some(w => d.includes(w))
  }) || null
}

const isPersonUPI = desc => {
  const d = (desc || '').toUpperCase()
  return (d.includes('UPI/DR') || d.includes('UPI-DR') || d.includes('UPI DR')) &&
    !d.includes('GOOGLE') && !d.includes('AMAZON') && !d.includes('FLIPKART') &&
    !d.includes('SWIGGY') && !d.includes('ZOMATO') && !d.includes('PAYTM') &&
    !d.includes('PHONEPE') && !d.includes('GPAY') && !d.includes('BILL') &&
    !d.includes('RECHARGE') && !d.includes('ELECTRICITY') && !d.includes('WATER') &&
    !d.includes('GAS') && !d.includes('INSURANCE') && !d.includes('LIC') &&
    !d.includes('BBPS') && !d.includes('NACH') && !d.includes('EMI') &&
    !d.includes('LOAN') && !d.includes('TAX') && !d.includes('GOVT') &&
    !d.includes('UTILITY') && !d.includes('SUBSCRIPTION') && !d.includes('NETFLIX') &&
    !d.includes('SPOTIFY') && !d.includes('HOTSTAR') && !d.includes('JUSPAY')
}

const IMPORT_CAT_NORM = {
  GROCERIES:'Groceries', DINING:'Dining', TRANSPORT:'Transport', UTILITIES:'Utilities',
  HEALTHCARE:'Healthcare', SHOPPING:'Shopping', ENTERTAINMENT:'Entertainment',
  REMITTANCE:'Remittance', SALARY:'Salary', 'LOAN EMI':'Loan EMI',
  'CREDIT CARD BILL':'Credit Card Bill', INSURANCE:'Insurance', INVESTMENT:'Investment',
  SAVINGS:'Savings', TRAVEL:'Travel', SUBSCRIPTION:'Subscription',
  FEES:'Fees & Charges', 'FEES & CHARGES':'Fees & Charges',
  ATM:'ATM Withdrawal', 'ATM WITHDRAWAL':'ATM Withdrawal', TRANSFER:'Transfer', OTHER:'Other',
}
function normImportCat(raw) {
  const up = (raw||'').toUpperCase().trim()
  return IMPORT_CAT_NORM[up] || TX_CATS.find(c=>c.toLowerCase()===(raw||'').toLowerCase()) || 'Other'
}

const STATEMENT_EXTRACTION_PROMPT = `You are extracting transactions and account details from a bank statement. The statement may be from a Kuwait bank (KFH, NBK, Burgan, Gulf Bank) or an Indian bank (SBI, HDFC, Axis, ICICI). The file may be a PDF, image, CSV, or Excel export.

Extract ALL transactions and return ONLY a valid JSON object with NO markdown, NO backticks, NO explanation text before or after.

Return exactly this structure:
{"bankName":"name of the bank","accountNumber":"last 4 digits only or null","accountHolder":"account holder name or null","statementMonth":"YYYY-MM format","currency":"KWD or INR or USD","country":"Kuwait or India","openingBalance":null,"closingBalance":null,"creditLimit":null,"apr":null,"minPayment":null,"dueDay":null,"transactions":[{"date":"YYYY-MM-DD","description":"clean merchant name","originalDescription":"raw text","amount":0,"category":"Groceries","type":"income or expense or remittance","confidence":"high or medium or low"}]}

Rules:
- Negative amount = money going OUT (debit / expense)
- Positive amount = money coming IN (credit / income)
- amount must be a NUMBER, not a string — strip all commas and currency symbols (e.g. "KWD 1,250.500" → 1250.5, "1,25,000.00" → 125000); preserve decimal precision exactly; do NOT round
- Indian number formatting uses lakhs: "1,25,000" means 125000 — parse correctly
- For CSV/Excel: read column headers carefully; debit and credit may be in separate columns — combine them (debit = negative, credit = positive)
- date must be in YYYY-MM-DD format — if no year use 2026; DD/MM/YYYY → YYYY-MM-DD, DD-MM-YYYY → YYYY-MM-DD
- category must be one of: Salary, Groceries, Dining, Transport, Utilities, Healthcare, Shopping, Entertainment, Remittance, Loan EMI, Credit Card Bill, Insurance, Investment, Savings, Travel, Subscription, Fees & Charges, ATM Withdrawal, Transfer, Other
- Kuwait hints: KWD amounts, Sultan Center, Lulu, Talabat, Careem, Zain, MEW, salary on 1st or last day
- India hints: INR amounts, UPI (GPay PhonePe Paytm), NEFT/RTGS, Amazon, Swiggy, Zomato
- creditLimit: credit limit as a plain number if shown (e.g. "Credit Limit: KWD 2,000" → 2000); null if not found or not a credit card statement
- apr: annual interest/finance charge rate as a plain decimal percent (e.g. "APR 3.75%" → 3.75, "Finance charge rate: 2.99% per month" → 35.88 annualised); null if not found
- minPayment: minimum payment due as a plain number; null if not found
- dueDay: payment due day of month as an integer (e.g. "Due date: 15th of each month" → 15); null if not found
- Return ONLY the JSON object — do NOT include any text before { or after }`

function BankStatementImport({ accounts, transactions, loans, setLoans, onImport, onClose, preAccountId,
  initialMode, foreignCurrency, smartRules, setSmartRules, setActiveTab, onInvoiceScan }) {
  const [step, setStep] = useState('upload')
  const [mode, setMode] = useState(initialMode || 'statement')
  const [file, setFile] = useState(null)
  const [accountId, setAccountId] = useState(preAccountId || '')
  const [error, setError] = useState('')
  const [uploadError, setUploadError] = useState(null)
  const [uploadWarning, setUploadWarning] = useState(null)
  const [uploadProgress, setUploadProgress] = useState('')
  const [aiResult, setAiResult] = useState(null)
  const [dupStatement, setDupStatement] = useState(null)
  const [fileAlreadyImported, setFileAlreadyImported] = useState(null)
  const [rows, setRows] = useState([])
  const [skipDups, setSkipDups] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)
  const [importSummary, setImportSummary] = useState(null)
  const [invoiceResult, setInvoiceResult] = useState(null)
  const fileRef = useRef()

  const account = accounts.find(a => a.id === accountId)

  const checkFileHistory = fileName => {
    try {
      const history = JSON.parse(localStorage.getItem('nri_importHistory') || '[]')
      return history.find(h => h.fileName === fileName) || null
    } catch { return null }
  }
  const cur = aiResult?.currency || account?.currency || foreignCurrency

  // System-level categorization rules — always applied last, cannot be overridden by user smart rules
  const applySystemRules = (desc, type) => {
    if (!desc) return null
    // Internal bank credits must be demoted to Transfer even if AI says income
    if (type === 'income' && isInternalBankCredit(desc)) return { cat: 'Transfer', type: 'transfer' }
    if (type === 'income') return null // other income types are not overridden
    if (isCCInterest(desc)) return { cat: 'Fees & Charges', type: 'expense' }
    if (isCCPayment(desc)) return { cat: 'Transfer', type: 'transfer' }
    if (isExchangeCompany(desc)) return { cat: 'Transfer', type: 'transfer' }
    return null
  }

  const applyRules = (desc, cat, type) => {
    // 1. Apply user smart rules first
    const d = (desc || '').toLowerCase()
    let resolved = cat
    for (const [k, v] of Object.entries(smartRules || {})) {
      if (d.includes(k.toLowerCase())) { resolved = v; break }
    }
    // 2. System rules always win — override user rules and AI
    const sys = applySystemRules(desc, type)
    return sys ? sys.cat : resolved
  }

  // isSystemProtected — returns true if description matches a system rule
  // Used to block saving user smart rules for system-protected descriptions
  const isSystemProtected = desc => !!applySystemRules(desc, 'expense')

  const saveRule = (desc, cat) => {
    const key = (desc || '').toLowerCase().trim().slice(0, 50)
    if (!key) return
    // Don't save user rules for system-protected descriptions
    if (isSystemProtected(desc)) return
    setSmartRules(p => { const u = { ...p, [key]: cat }; persist('smartRules', u); return u })
  }

  const readAsBase64 = f => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => res(e.target.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(f)
  })
  const readAsText = f => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => res(e.target.result)
    r.onerror = rej
    r.readAsText(f)
  })
  const readAsArrayBuffer = f => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => res(e.target.result)
    r.onerror = rej
    r.readAsArrayBuffer(f)
  })
  const parseExcelToText = async f => {
    const buf = await readAsArrayBuffer(f)
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
    return wb.SheetNames.map(name => {
      const ws = wb.Sheets[name]
      const csv = XLSX.utils.sheet_to_csv(ws)
      // Reverse-sort rows so latest transactions are first (avoids truncation cutting off recent dates)
      const lines = csv.split('\n')
      const header = lines[0]
      const dataRows = lines.slice(1).filter(r => r.trim())
      // Detect if rows are date-sorted ascending — if so, reverse so newest is first
      const reversed = dataRows.slice().reverse()
      return `Sheet: ${name}\n${header}\n${reversed.join('\n')}`
    }).join('\n\n')
  }
  const fixDate = dateStr => {
    if (!dateStr) return today()
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) { const [d,m,y]=dateStr.split('/'); return `${y}-${m}-${d}` }
    if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) { const [d,m,y]=dateStr.split('-'); return `${y}-${m}-${d}` }
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(dateStr)) { const [d,m,y]=dateStr.split('/'); return `20${y}-${m}-${d}` }
    try { const dt=new Date(dateStr); if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0] } catch {}
    return today()
  }
  const extractField = (text, fieldName) => {
    const m = text.match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)"`, 'i'))
    return m ? m[1] : null
  }
  const extractNumberField = (text, fieldName) => {
    const m = text.match(new RegExp(`"${fieldName}"\\s*:\\s*([0-9.]+)`, 'i'))
    return m ? parseFloat(m[1]) : null
  }
  const extractCompleteObjects = arrayText => {
    const objects = []; let depth = 0, start = -1, inString = false, escape = false
    for (let i = 0; i < arrayText.length; i++) {
      const c = arrayText[i]
      if (escape) { escape = false; continue }
      if (c === '\\' && inString) { escape = true; continue }
      if (c === '"') { inString = !inString; continue }
      if (inString) continue
      if (c === '{') { if (depth === 0) start = i; depth++ }
      else if (c === '}') {
        depth--
        if (depth === 0 && start !== -1) {
          try {
            const obj = JSON.parse(arrayText.substring(start, i + 1))
            if (obj.date || obj.amount !== undefined || obj.description) objects.push(obj)
          } catch { /* skip malformed */ }
          start = -1
        }
      }
    }
    return objects
  }
  const validateAndClean = parsed => {
    if (!parsed.transactions || !Array.isArray(parsed.transactions))
      throw new Error('No transactions found in statement.')
    parsed.transactions = parsed.transactions
      .filter(t => t != null)
      .map(t => ({
        date: fixDate(t.date),
        description: t.description || t.narration || t.particulars || 'Unknown',
        originalDescription: t.originalDescription || t.description || '',
        amount: typeof t.amount === 'string'
          ? parseFloat(t.amount.replace(/[,\s]/g, '')) || 0
          : (typeof t.amount === 'number' ? t.amount : 0),
        category: t.category || 'Other',
        type: t.type || ((t.amount || 0) > 0 ? 'income' : 'expense'),
        confidence: t.confidence || 'medium',
      }))
      .filter(t => !isNaN(t.amount))
    if (parsed.transactions.length === 0)
      throw new Error('No valid transactions could be extracted. Please try a different file or format.')
    return parsed
  }
  const parseAIText = text => {
    console.log('AI response length:', text.length)
    console.log('AI response preview:', text.substring(0, 200))
    let t = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
    const start = t.indexOf('{')
    if (start === -1) throw new Error('AI did not return valid data. Please try with a smaller date range.')
    const jsonStr = t.substring(start)
    // Try clean parse first
    try { return validateAndClean(JSON.parse(jsonStr)) } catch (firstErr) {
      console.log('First parse failed, attempting repair:', firstErr.message)
    }
    // Repair: extract header fields + individual transaction objects
    const txStart = jsonStr.indexOf('"transactions"')
    if (txStart === -1) throw new Error('Could not find transactions in response. Please upload one month at a time.')
    const headerPart = jsonStr.substring(0, txStart)
    const arrayStart = jsonStr.indexOf('[', txStart)
    if (arrayStart === -1) throw new Error('No transactions array found.')
    const txObjects = extractCompleteObjects(jsonStr.substring(arrayStart))
    if (txObjects.length === 0) throw new Error('Could not extract any transactions. Please try PDF or CSV format.')
    console.log('Repaired JSON — salvaged transactions:', txObjects.length)
    return validateAndClean({
      bankName: extractField(headerPart, 'bankName') || 'Bank',
      currency: extractField(headerPart, 'currency') || 'KWD',
      statementMonth: extractField(headerPart, 'statementMonth') || new Date().toISOString().slice(0, 7),
      openingBalance: extractNumberField(headerPart, 'openingBalance'),
      closingBalance: extractNumberField(headerPart, 'closingBalance'),
      transactions: txObjects,
    })
  }

  const apiCall = async (msgContent, maxTokens = 8000) => {
    // Attach cache_control to the last text block so the prompt is cached
    const msgs = Array.isArray(msgContent)
      ? [{ role: 'user', content: msgContent.map((b, i, arr) => i === arr.length - 1 && b.type === 'text' ? { ...b, cache_control: { type: 'ephemeral' } } : b) }]
      : [{ role: 'user', content: [{ type: 'text', text: msgContent, cache_control: { type: 'ephemeral' } }] }]
    return anthropicMessages({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, messages: msgs })
  }

  const PASS1_PROMPT = `Extract ALL transactions from this bank statement.
Return ONLY valid JSON, no markdown:
{"bankName":"bank name","currency":"KWD or INR","statementMonth":"YYYY-MM","openingBalance":null,"closingBalance":null,"transactions":[{"date":"YYYY-MM-DD","description":"clean merchant name","amount":number,"type":"income or expense"}]}
Rules:
- negative=debit/expense, positive=credit/income
- date in YYYY-MM-DD; if no year use 2026
- amount must be a plain NUMBER — strip all commas and currency symbols (e.g. "KWD 1,250.500" → 1250.5); preserve decimal precision; do NOT round
- Indian number formatting uses lakhs: "1,25,000" = 125000
- If debit and credit are separate columns, debit = negative, credit = positive
- no text before { or after }`

  const extractInTwoPasses = async b64 => {
    setUploadProgress('Reading your bank statement…')
    const pass1 = await apiCall([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: PASS1_PROMPT },
    ], 8000)
    const basic = parseAIText(pass1.content?.[0]?.text || '')

    setUploadProgress(`Categorising ${basic.transactions.length} transactions…`)
    const BATCH = 50
    const categorised = []
    for (let i = 0; i < basic.transactions.length; i += BATCH) {
      const batch = basic.transactions.slice(i, i + BATCH)
      if (basic.transactions.length > BATCH)
        setUploadProgress(`Categorising transactions ${i + 1}–${Math.min(i + BATCH, basic.transactions.length)} of ${basic.transactions.length}…`)
      const catPrompt = `Categorise these bank transactions for an NRI in Kuwait/India. Return ONLY a JSON array, no other text.
Categories: Salary, Groceries, Dining, Transport, Utilities, Healthcare, Shopping, Entertainment, Remittance, Loan EMI, Credit Card Bill, Insurance, Investment, Savings, Travel, Subscription, Fees & Charges, ATM Withdrawal, Transfer, Other
Transactions: ${JSON.stringify(batch)}
Return: [{"date":"same","description":"same","amount":same,"type":"same","category":"from list","confidence":"high/medium/low"}]`
      try {
        const catRes = await apiCall(catPrompt, 4000)
        const catText = (catRes.content?.[0]?.text || '[]').replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim()
        const arrStart = catText.indexOf('['), arrEnd = catText.lastIndexOf(']')
        if (arrStart !== -1 && arrEnd !== -1) {
          const parsed = JSON.parse(catText.substring(arrStart, arrEnd + 1))
          categorised.push(...parsed)
        } else { categorised.push(...batch.map(t => ({ ...t, category: 'Other', confidence: 'low' }))) }
      } catch { categorised.push(...batch.map(t => ({ ...t, category: 'Other', confidence: 'low' }))) }
    }
    setUploadProgress('Almost done…')
    return { ...basic, transactions: categorised }
  }

  const processInvoiceFile = async () => {
    if (!file) { setError('Please select a file'); return }
    setError(''); setUploadError(null)
    setStep('processing'); setUploadProgress('Extracting invoice details…')
    try {
      const fname = file.name.toLowerCase()
      const ftype = file.type.toLowerCase()
      const isPDF = fname.endsWith('.pdf') || ftype === 'application/pdf'
      let msgContent
      if (isPDF) {
        const b64 = await readAsBase64(file)
        msgContent = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: TX_INVOICE_PROMPT }]
      } else {
        const b64 = await readAsBase64(file)
        const mtype = ftype.startsWith('image/') ? ftype : 'image/jpeg'
        msgContent = [{ type: 'image', source: { type: 'base64', media_type: mtype, data: b64 } }, { type: 'text', text: TX_INVOICE_PROMPT }]
      }
      const data = await apiCall(msgContent, 512)
      const raw = data.content?.[0]?.text || ''
      const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
      const s = clean.indexOf('{'), e2 = clean.lastIndexOf('}')
      if (s < 0 || e2 < 0) throw new Error('Could not parse response — try a clearer image')
      setInvoiceResult(JSON.parse(clean.slice(s, e2 + 1)))
      setStep('invoice_preview')
    } catch (e) {
      setUploadError(e.message || 'Could not process this file. Please try again.')
      setStep('upload')
    }
  }

  const processFile = async () => {
    if (!file) { setError('Please select a file'); return }
    setError(''); setUploadError(null); setUploadProgress('')
    setStep('processing')
    try {
      const fname = file.name.toLowerCase()
      const ftype = file.type.toLowerCase()
      const isCSV   = fname.endsWith('.csv') || ftype === 'text/csv'
      const isExcel = fname.endsWith('.xlsx') || fname.endsWith('.xls') || ftype.includes('excel') || ftype.includes('spreadsheet')
      const isPDF   = fname.endsWith('.pdf') || ftype === 'application/pdf'
      const isImage = ftype.startsWith('image/') || fname.endsWith('.jpg') || fname.endsWith('.jpeg') || fname.endsWith('.png') || fname.endsWith('.heic')

      let result
      if (isCSV) {
        setUploadProgress('Reading CSV statement…')
        const text = await readAsText(file)
        setUploadProgress('Extracting transactions…')
        const data = await apiCall(`This is a bank statement exported as CSV. Extract all transactions.\n\n${STATEMENT_EXTRACTION_PROMPT}\n\nStatement data:\n\n${text.substring(0, 30000)}`, 8000)
        result = parseAIText(data.content?.[0]?.text || '')
      } else if (isExcel) {
        setUploadProgress('Reading Excel statement…')
        const text = await parseExcelToText(file)
        setUploadProgress('Extracting transactions…')
        const data = await apiCall(`This is a bank statement exported as Excel. Extract all transactions.\n\n${STATEMENT_EXTRACTION_PROMPT}\n\nStatement data:\n\n${text.substring(0, 30000)}`, 8000)
        result = parseAIText(data.content?.[0]?.text || '')
      } else if (isPDF) {
        setUploadProgress('Reading PDF statement…')
        const b64 = await readAsBase64(file)
        if (file.size > 100000) {
          // Large PDF — two-pass for better coverage
          result = await extractInTwoPasses(b64)
        } else {
          setUploadProgress('Extracting transactions (this may take 30–60 seconds)…')
          const data = await apiCall([
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: STATEMENT_EXTRACTION_PROMPT },
          ], 8000)
          result = parseAIText(data.content?.[0]?.text || '')
        }
      } else if (isImage) {
        setUploadProgress('Extracting transactions from image…')
        const b64 = await readAsBase64(file)
        const unsupported = ['image/heic', 'image/heif', 'image/webp']
        const mtype = (!ftype || unsupported.includes(ftype)) ? 'image/jpeg' : ftype
        const data = await apiCall([
          { type: 'image', source: { type: 'base64', media_type: mtype, data: b64 } },
          { type: 'text', text: STATEMENT_EXTRACTION_PROMPT },
        ], 8000)
        result = parseAIText(data.content?.[0]?.text || '')
      } else {
        throw new Error('Unsupported file type. Please upload a PDF, Excel (.xlsx/.xls), CSV, JPG, or PNG file.')
      }

      setAiResult(result)

      // Auto-detect account if none selected: match by account number, then by unique currency
      let resolvedAccountId = accountId
      if (!resolvedAccountId) {
        const byAcctNum = result.accountNumber
          ? accounts.find(a => a.accountNumber && String(a.accountNumber).slice(-4) === String(result.accountNumber).slice(-4))
          : null
        if (byAcctNum) {
          resolvedAccountId = byAcctNum.id
          setAccountId(byAcctNum.id)
        } else if (result.currency) {
          const currencyMatches = accounts.filter(a => a.currency === result.currency)
          if (currencyMatches.length === 1) {
            resolvedAccountId = currencyMatches[0].id
            setAccountId(currencyMatches[0].id)
          }
        }
      }

      // Robust duplicate detection: fuzzy match on date + amount (±0.5% or ±5) + partial description
      const normDesc = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const existingTxs = transactions.filter(t => t.accountId === resolvedAccountId)
      const isDuplicate = tx => {
        const amt = Math.abs(tx.amount || 0)
        const tol = Math.max(5, amt * 0.005)
        const desc = normDesc(tx.description)
        return existingTxs.some(e => {
          if ((e.date || '') !== (tx.date || '')) return false           // must be same date
          if (Math.abs(Math.abs(e.amount || 0) - amt) > tol) return false // amount within tolerance
          // Description match: first 15 chars of normalised text overlap
          const eDesc = normDesc(e.description)
          const minLen = Math.min(15, desc.length, eDesc.length)
          return minLen === 0 || desc.slice(0, minLen) === eDesc.slice(0, minLen)
        })
      }
      const resolvedAccount = accounts.find(a => a.id === resolvedAccountId)
      const isWorkAcct = resolvedAccount?.country === 'foreign'
      const isHomeAcct = resolvedAccount?.country === 'home'

      const enriched = (result.transactions || []).map((tx, i) => {
        const amt = Math.abs(tx.amount || 0)
        let cat = applyRules(tx.description, normImportCat(tx.category))
        let type = tx.type
        let isExchangeTransfer = false
        let isPersonUPIFlag = false
        let matchedLoanId = null
        let isEMIFlag = false

        // Apply system rules (always override AI and user rules)
        // Priority: CC Interest > Loan EMI > CC Payment > Exchange Company > Person UPI
        // Also demote internal bank credits from income → transfer
        if (type === 'income' && isInternalBankCredit(tx.description)) {
          cat = 'Transfer'; type = 'transfer'
        }
        if (type !== 'income') {
          if (isCCInterest(tx.description)) {
            cat = 'Fees & Charges'; type = 'expense'
          } else if (isEMIPayment(tx.description)) {
            // EMI must be checked BEFORE exchange company — "Al Mulla Finance" is both
            cat = 'Loan EMI'; type = 'expense'
            const matched = matchLoanFromDesc(tx.description, loans)
            matchedLoanId = matched?.id || null
            isEMIFlag = true
          } else if (isCCPayment(tx.description)) {
            cat = 'Transfer'; type = 'transfer'
          } else if (isExchangeCompany(tx.description)) {
            cat = 'Transfer'; type = 'transfer'
            // Check if amount matches a known loan EMI — may be a loan payment via exchange co.
            const emiMatch = loans?.find(l => l.emi > 0 && Math.abs(l.emi - Math.abs(tx.amount || 0)) / l.emi < 0.05)
            if (emiMatch) {
              // Flag for user confirmation — could be loan EMI or home country transfer
              matchedLoanId = emiMatch.id
              isEMIFlag = true   // show loan EMI confirmation buttons
              isExchangeTransfer = false // don't show exchange transfer prompt simultaneously
            } else {
              isExchangeTransfer = isWorkAcct
            }
          } else if (isHomeAcct && isPersonUPI(tx.description)) {
            cat = 'Other'; type = 'expense'
            isPersonUPIFlag = true
          }
        }

        // Home country: detect salary/bonus/interest → force income
        if (isHomeAcct && tx.type !== 'expense' && isHomeIncome(tx.description)) {
          type = 'income'
          if (!['Salary','Other Income','Dividends','Rental Income'].includes(cat)) cat = 'Salary'
        }

        const isDup = isDuplicate({ ...tx, amount: amt })
        return { ...tx, id: uid(), amount: amt, category: cat, type, selected: !isDup, isDuplicate: isDup, isExchangeTransfer, isPersonUPI: isPersonUPIFlag, isEMI: isEMIFlag, matchedLoanId, idx: i }
      })
      setRows(enriched)
      // Auto-skip duplicates — user can still uncheck individually in the review screen
      if (enriched.some(r => r.isDuplicate)) setSkipDups(true)

      // Check if this exact statement (bank + month + account) was already imported
      const stmtKey = `${(result.bankName || '').toLowerCase()}|${result.statementMonth || ''}|${result.accountNumber || result.currency || ''}`
      const history = JSON.parse(localStorage.getItem('nri_importHistory') || '[]')
      const existingImport = history.find(h =>
        `${(h.bankName || '').toLowerCase()}|${h.statementMonth || ''}|${h.accountNumber || h.currency || ''}` === stmtKey
      )
      if (existingImport) {
        setDupStatement(existingImport)
        setReplaceMode(true)
        setStep('preview')
      } else {
        setStep('preview')
      }
    } catch (e) {
      console.error('Statement import error:', e)
      setUploadError(e.message || 'Could not process this file. Please try again.')
      setStep('upload')
    }
  }

  const selectedRows = rows.filter(r => r.selected && (!r.isDuplicate || !skipDups))
  const dupRows = rows.filter(r => r.isDuplicate)
  const skippedCount = rows.filter(r => r.selected && r.isDuplicate && skipDups).length
  const catSummary = selectedRows.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = { count: 0, total: 0 }
    acc[r.category].count++; acc[r.category].total += r.amount; return acc
  }, {})

  const doImport = () => {
    // Resolve the best account ID: explicit selection → account-number match → currency-unique match
    const effectiveAccountId = accountId
      || accounts.find(a =>
          aiResult?.accountNumber && a.accountNumber &&
          String(a.accountNumber).slice(-4) === String(aiResult.accountNumber).slice(-4)
        )?.id
      || (() => {
          const cur = aiResult?.currency
          if (!cur) return ''
          const matching = accounts.filter(a => a.currency === cur)
          return matching.length === 1 ? matching[0].id : ''
        })()
    const currency = aiResult?.currency || accounts.find(a => a.id === effectiveAccountId)?.currency || foreignCurrency
    const notesKey = `Imported: ${aiResult?.bankName || 'bank'} ${aiResult?.statementMonth || ''}`.trim()
    const txs = selectedRows.map(r => ({
      id: r.id, date: r.date, description: r.description,
      originalDescription: r.originalDescription || r.description,
      amount: r.amount, category: r.category,
      type: r.type === 'income' ? 'income' : r.type === 'transfer' ? 'transfer' : 'expense',
      accountId: effectiveAccountId, currency, amountINR: 0,
      notes: notesKey,
      isImported: true,
    }))

    // Exchange transfers confirmed as "To Home Country" — user can record them
    // manually in the Remittances section. No auto-creation to avoid wrong records.

    // Update loan outstanding balances for confirmed EMI transactions
    const confirmedEMIs = selectedRows.filter(r => r.matchedLoanId && r.category === 'Loan EMI')
    if (confirmedEMIs.length > 0 && setLoans) {
      setLoans(prev => prev.map(l => {
        const loanEMIs = confirmedEMIs.filter(r => r.matchedLoanId === l.id)
        if (!loanEMIs.length) return l
        // Estimate principal portion: EMI - interest for that month
        const totalPaid = loanEMIs.reduce((s, r) => s + r.amount, 0)
        const r = (l.rate || 0) / 100 / 12
        const interestPortion = (l.outstanding || 0) * r
        const principalPortion = Math.max(0, totalPaid - interestPortion)
        const newOutstanding = Math.max(0, (l.outstanding || 0) - principalPortion)
        const newRemaining = Math.max(0, (l.remainingMonths || 0) - loanEMIs.length)
        return { ...l, outstanding: Math.round(newOutstanding * 100) / 100, remainingMonths: newRemaining, asOfDate: today() }
      }))
    }

    const summary = {
      count: txs.length, bankName: aiResult?.bankName, statementMonth: aiResult?.statementMonth,
      closingBalance: aiResult?.closingBalance, currency: aiResult?.currency,
      catGroups: selectedRows.reduce((acc, r) => { acc[r.category] = (acc[r.category]||0)+1; return acc }, {}),
      ...(replaceMode ? { replaceNotes: notesKey, replaceAccountId: effectiveAccountId } : {}),
    }
    setImportSummary(summary)
    onImport(txs, aiResult, account, summary)

    // Record this import so future uploads of the same statement are flagged
    const history = JSON.parse(localStorage.getItem('nri_importHistory') || '[]')
    const stmtKey = `${(aiResult?.bankName || '').toLowerCase()}|${aiResult?.statementMonth || ''}|${aiResult?.accountNumber || aiResult?.currency || ''}`
    const deduped = history.filter(h =>
      `${(h.bankName || '').toLowerCase()}|${h.statementMonth || ''}|${h.accountNumber || h.currency || ''}` !== stmtKey
    )
    deduped.unshift({
      type: 'statement',
      fileName: file?.name || '',
      bankName: aiResult?.bankName || '',
      statementMonth: aiResult?.statementMonth || '',
      accountNumber: aiResult?.accountNumber || null,
      currency: aiResult?.currency || '',
      count: txs.length,
      importedAt: new Date().toISOString(),
    })
    localStorage.setItem('nri_importHistory', JSON.stringify(deduped.slice(0, 100)))

    setStep('success')
  }

  const updateRow = (idx, changes) => setRows(p => p.map(r => r.idx === idx ? { ...r, ...changes } : r))
  const confIcon = c => c === 'high' ? '🟢' : c === 'medium' ? '🟡' : '🔴'

  if (step === 'invoice_preview' && invoiceResult) return (
    <Modal title="Invoice Details" onClose={onClose} width={480}>
      <div style={{ background: C.green + '12', border: `1px solid ${C.green}33`, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>✅ Details extracted — review before saving</div>
        {[
          { label: 'Date', val: invoiceResult.date || '—' },
          { label: 'Amount', val: invoiceResult.amount ? `${invoiceResult.amount} ${invoiceResult.currency || ''}`.trim() : '—' },
          { label: 'Description', val: invoiceResult.description || '—' },
          { label: 'Category', val: invoiceResult.category || '—' },
          { label: 'Type', val: invoiceResult.type || 'expense' },
        ].map(({ label, val }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: C.muted }}>{label}</span>
            <span style={{ color: C.text, fontWeight: 600, textAlign: 'right', maxWidth: '65%' }}>{val}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn variant="ghost" onClick={() => { setInvoiceResult(null); setStep('upload') }} style={{ flex: 1 }}>← Re-scan</Btn>
        <Btn onClick={() => { console.log('[INVOICE] Fill button clicked, data:', invoiceResult); onInvoiceScan?.(invoiceResult); onClose() }} style={{ flex: 2 }}>✓ Fill Transaction Form</Btn>
      </div>
    </Modal>
  )

  if (step === 'processing') return (
    <Modal title="Processing Statement" onClose={onClose} width={500}>
      <div style={{ textAlign:'center', padding:'36px 0' }}>
        <div style={{ fontSize:42, marginBottom:14, animation:'spin 2s linear infinite', display:'inline-block' }}>⚙️</div>
        <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:8 }}>
          {uploadProgress || 'Analysing your statement…'}
        </div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>Please do not close this window</div>
        <div style={{ background:C.card2, borderRadius:10, padding:'11px 14px', fontSize:12, color:C.muted, textAlign:'left', lineHeight:1.7 }}>
          💡 Large statements (3 months / 100+ transactions) may take up to 2 minutes — they are processed in two passes for accuracy.
        </div>
      </div>
    </Modal>
  )

  if (step === 'success' && importSummary) {
    const catStr = Object.entries(importSummary.catGroups).slice(0,5).map(([c,n])=>`${c} (${n})`).join(', ')
    const moreCats = Object.keys(importSummary.catGroups).length - 5
    return (
      <Modal title="Import Complete" onClose={onClose} width={480}>
        <div style={{ textAlign:'center', padding:'12px 0' }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>
            {importSummary.count} transactions imported successfully
          </div>
          <div style={{ fontSize:12, color:C.muted, lineHeight:1.8, marginBottom:6 }}>
            Categories: {catStr}{moreCats > 0 ? ` +${moreCats} more` : ''}
          </div>
          {importSummary.closingBalance != null && (
            <div style={{ background:C.yellow+'15', border:`1px solid ${C.yellow}44`, borderRadius:10, padding:'10px 14px', margin:'14px 0', fontSize:12, color:C.mutedL, textAlign:'left', lineHeight:1.6 }}>
              Statement shows closing balance {fmt(importSummary.closingBalance, importSummary.currency)}. Go to Accounts to update your balance if needed.
            </div>
          )}
          <Btn onClick={() => { setActiveTab('transactions'); onClose() }} style={{ width:'100%', marginBottom:8, padding:'11px 0' }}>
            View Imported Transactions →
          </Btn>
          <Btn onClick={onClose} variant="ghost" style={{ width:'100%' }}>Close</Btn>
        </div>
      </Modal>
    )
  }

  if (step === 'preview') {
    const matchedAcct = account || accounts.find(a =>
      aiResult?.accountNumber && a.accountNumber &&
      String(a.accountNumber).slice(-4) === String(aiResult.accountNumber).slice(-4)
    )
    return (
      <Modal title="Review Imported Transactions" onClose={onClose} width={900}>
        <div style={{ background:C.card2, borderRadius:12, padding:'13px 16px', marginBottom:14, border:`1px solid ${C.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:C.text }}>
                📄 {aiResult?.bankName||'Bank'} Statement{aiResult?.statementMonth ? ` — ${aiResult.statementMonth}` : ''}
              </div>
              {aiResult?.accountNumber && <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Account: ****{String(aiResult.accountNumber).slice(-4)} · Currency: {aiResult?.currency||cur}</div>}
              {matchedAcct && <div style={{ fontSize:12, color:C.green, marginTop:4 }}>✅ Matched: {matchedAcct.name}</div>}
            </div>
            <div style={{ display:'flex', gap:18 }}>
              {aiResult?.openingBalance!=null && <div style={{ textAlign:'right' }}><div style={{ fontSize:10, color:C.muted }}>Opening</div><div style={{ fontSize:13, fontWeight:700, color:C.text }}>{fmt(aiResult.openingBalance, aiResult.currency)}</div></div>}
              {aiResult?.closingBalance!=null && <div style={{ textAlign:'right' }}><div style={{ fontSize:10, color:C.muted }}>Closing</div><div style={{ fontSize:13, fontWeight:700, color:C.text }}>{fmt(aiResult.closingBalance, aiResult.currency)}</div></div>}
              <div style={{ textAlign:'right' }}><div style={{ fontSize:10, color:C.muted }}>Found</div><div style={{ fontSize:13, fontWeight:700, color:C.text }}>{rows.length} tx</div></div>
            </div>
          </div>
        </div>

        {dupRows.length > 0 && (
          <div style={{ background:C.yellow+'15', border:`1px solid ${C.yellow}44`, borderRadius:10, padding:'10px 14px', marginBottom:12 }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.yellow, marginBottom:6 }}>⚠️ {dupRows.length} transaction{dupRows.length>1?'s':''} may already exist. Skip duplicates?</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setSkipDups(true)} style={{ padding:'5px 14px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, background:skipDups?C.yellow:C.card2, color:skipDups?'#000':C.mutedL }}>Yes, Skip</button>
              <button onClick={() => setSkipDups(false)} style={{ padding:'5px 14px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, background:!skipDups?C.accent:C.card2, color:!skipDups?'#fff':C.mutedL }}>Import Anyway</button>
            </div>
          </div>
        )}

        {rows.some(r => r.isExchangeTransfer) && (
          <div style={{ background:C.teal+'15', border:`1px solid ${C.teal}44`, borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, color:C.mutedL }}>
            💱 <strong style={{ color:C.teal }}>{rows.filter(r=>r.isExchangeTransfer).length} exchange company transaction{rows.filter(r=>r.isExchangeTransfer).length>1?'s':''} detected.</strong>
            {' '}These are set as <strong>Transfer</strong> by default. Confirm each one below — if the funds go to your home country, keep as Transfer.
          </div>
        )}

        {rows.some(r => r.isPersonUPI) && (
          <div style={{ background:C.purple+'15', border:`1px solid ${C.purple}44`, borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, color:C.mutedL }}>
            👤 <strong style={{ color:C.purple }}>{rows.filter(r=>r.isPersonUPI).length} UPI payment{rows.filter(r=>r.isPersonUPI).length>1?'s':''} to a person detected.</strong>
            {' '}These are set as <strong>Expense</strong> by default. If any are transfers to your own accounts, confirm below.
          </div>
        )}

        {rows.some(r => r.isEMI) && (
          <div style={{ background:C.gold+'15', border:`1px solid ${C.gold}44`, borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, color:C.mutedL }}>
            🏠 <strong style={{ color:C.gold }}>{rows.filter(r=>r.isEMI).length} Loan EMI payment{rows.filter(r=>r.isEMI).length>1?'s':''} detected.</strong>
            {' '}Confirm which loan each belongs to — outstanding balance will be updated automatically.
          </div>
        )}

        <div style={{ marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.text }}>Categories ({selectedRows.length} selected)</div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setRows(p => p.map(r=>({...r, selected:true})))} style={{ background:'none', border:'none', color:C.accent, fontSize:12, cursor:'pointer', fontWeight:600 }}>Select All</button>
              <button onClick={() => setRows(p => p.map(r=>({...r, selected:false})))} style={{ background:'none', border:'none', color:C.muted, fontSize:12, cursor:'pointer' }}>Deselect All</button>
            </div>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {Object.entries(catSummary).map(([cat,{count,total}]) => (
              <div key={cat} style={{ background:(CAT_COLORS[cat]||C.accent)+'22', border:`1px solid ${(CAT_COLORS[cat]||C.accent)}44`, borderRadius:7, padding:'3px 9px', fontSize:11 }}>
                <span style={{ color:CAT_COLORS[cat]||C.accent, fontWeight:600 }}>{cat}</span>
                <span style={{ color:C.muted }}> · {count} · {fmt(total, cur)}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden', marginBottom:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'28px 86px 1fr 158px 92px 22px', gap:4, padding:'7px 10px', background:C.card2, borderBottom:`1px solid ${C.border}`, fontSize:11, color:C.muted, fontWeight:600 }}>
            <div/><div>Date</div><div>Description</div><div>Category</div><div style={{ textAlign:'right' }}>Amount</div><div/>
          </div>
          <div style={{ maxHeight:340, overflowY:'auto' }}>
            {rows.map(r => {
              const dimmed = r.isDuplicate && skipDups
              return (
                <div key={r.idx} style={{ display:'grid', gridTemplateColumns:'28px 86px 1fr 158px 92px 22px', gap:4, padding:'6px 10px', borderBottom:`1px solid ${C.border}22`, alignItems:'center', opacity:dimmed?0.35:1 }}>
                  <input type="checkbox" checked={r.selected} onChange={e => updateRow(r.idx,{selected:e.target.checked})} />
                  <div style={{ fontSize:11, color:C.muted }}>{r.date}</div>
                  <div>
                    <div style={{ fontSize:12, color:C.text, fontWeight:500 }}>{r.description}</div>
                    {r.originalDescription && r.originalDescription!==r.description &&
                      <div style={{ fontSize:10, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }}>{r.originalDescription}</div>}
                    {r.isDuplicate && <div style={{ fontSize:10, color:C.yellow, fontWeight:600 }}>⚠️ duplicate</div>}
                    {r.isExchangeTransfer && (
                      <div style={{ display:'flex', gap:5, marginTop:4 }}>
                        <span style={{ fontSize:10, color:C.teal, fontWeight:700 }}>💱 Exchange transfer:</span>
                        <button onClick={() => updateRow(r.idx, { isExchangeTransfer:false, category:'Transfer', type:'transfer' })}
                          style={{ fontSize:10, padding:'1px 7px', borderRadius:4, border:`1px solid ${C.teal}`, background:r.category==='Transfer'?C.teal+'33':'transparent', color:C.teal, cursor:'pointer', fontWeight:600 }}>
                          ✓ To Home Country
                        </button>
                        <button onClick={() => updateRow(r.idx, { isExchangeTransfer:false, category:'Other', type:'expense' })}
                          style={{ fontSize:10, padding:'1px 7px', borderRadius:4, border:`1px solid ${C.border}`, background:'transparent', color:C.muted, cursor:'pointer' }}>
                          Direct Expense
                        </button>
                      </div>
                    )}
                    {r.isPersonUPI && (
                      <div style={{ display:'flex', gap:5, marginTop:4 }}>
                        <span style={{ fontSize:10, color:C.purple, fontWeight:700 }}>👤 UPI to person:</span>
                        <button onClick={() => updateRow(r.idx, { isPersonUPI:false, type:'expense' })}
                          style={{ fontSize:10, padding:'1px 7px', borderRadius:4, border:`1px solid ${C.purple}`, background:r.type==='expense'?C.purple+'33':'transparent', color:C.purple, cursor:'pointer', fontWeight:600 }}>
                          ✓ Expense
                        </button>
                        <button onClick={() => updateRow(r.idx, { isPersonUPI:false, category:'Transfer', type:'transfer' })}
                          style={{ fontSize:10, padding:'1px 7px', borderRadius:4, border:`1px solid ${C.border}`, background:'transparent', color:C.muted, cursor:'pointer' }}>
                          My Own Account
                        </button>
                      </div>
                    )}
                    {r.isEMI && (
                      <div style={{ display:'flex', gap:5, marginTop:4, flexWrap:'wrap', alignItems:'center' }}>
                        <span style={{ fontSize:10, color:C.gold, fontWeight:700 }}>🏠 Loan EMI or transfer?</span>
                        {loans?.map(l => (
                          <button key={l.id} onClick={() => updateRow(r.idx, { matchedLoanId: l.id, isEMI:false, category:'Loan EMI', type:'expense' })}
                            style={{ fontSize:10, padding:'1px 7px', borderRadius:4, border:`1px solid ${r.matchedLoanId===l.id?C.gold:C.border}`, background:r.matchedLoanId===l.id?C.gold+'33':'transparent', color:r.matchedLoanId===l.id?C.gold:C.muted, cursor:'pointer', fontWeight:r.matchedLoanId===l.id?700:400 }}>
                            {r.matchedLoanId===l.id?'✓ ':''}EMI: {l.name}
                          </button>
                        ))}
                        <button onClick={() => updateRow(r.idx, { matchedLoanId:null, isEMI:false, category:'Transfer', type:'transfer' })}
                          style={{ fontSize:10, padding:'1px 7px', borderRadius:4, border:`1px solid ${C.teal}`, background:'transparent', color:C.teal, cursor:'pointer' }}>
                          💱 To Home Country
                        </button>
                        <button onClick={() => updateRow(r.idx, { matchedLoanId:null, isEMI:false, category:'Other', type:'expense' })}
                          style={{ fontSize:10, padding:'1px 7px', borderRadius:4, border:`1px solid ${C.border}`, background:'transparent', color:C.muted, cursor:'pointer' }}>
                          Direct Expense
                        </button>
                      </div>
                    )}
                  </div>
                  <select value={r.category}
                    onChange={e => { updateRow(r.idx,{category:e.target.value}); saveRule(r.description, e.target.value) }}
                    style={{ ...inputStyle, fontSize:11, padding:'3px 6px', color:CAT_COLORS[r.category]||C.text }}>
                    {TX_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div style={{ fontSize:12, fontWeight:700, textAlign:'right', color:r.type==='income'?C.green:C.red }}>
                    {r.type==='income'?'+':'-'}{fmt(r.amount, cur)}
                  </div>
                  <div title={`Confidence: ${r.confidence||'medium'}`} style={{ fontSize:11, textAlign:'center' }}>{confIcon(r.confidence||'medium')}</div>
                </div>
              )
            })}
          </div>
        </div>

        <Btn onClick={doImport} disabled={selectedRows.length===0} style={{ width:'100%', padding:'11px 0', fontSize:14 }}>
          Import {selectedRows.length} transaction{selectedRows.length!==1?'s':''}{skippedCount>0?` (${skippedCount} skipped as duplicates)`:''}
        </Btn>
      </Modal>
    )
  }

  const handleFileChange = f => {
    setFile(f); setError(''); setUploadError(null)
    if (mode === 'statement') {
      setUploadWarning(f.size > 500000 ? 'This is a large file (possibly multiple months). For best results upload one month at a time.' : null)
      const prev = checkFileHistory(f.name)
      setFileAlreadyImported(prev)
      if (prev) setReplaceMode(true)
    }
  }

  return (
    <Modal title={mode === 'invoice' ? 'Scan Invoice or Receipt' : 'Upload or Scan Document'} onClose={onClose} width={520}>
      {/* Mode toggle */}
      <div style={{ display:'flex', gap:4, background:C.card2, borderRadius:10, padding:4, marginBottom:16 }}>
        <button onClick={() => { setMode('statement'); setFile(null); setError(''); setUploadError(null) }}
          style={{ flex:1, padding:'8px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, background:mode==='statement'?C.card:'transparent', color:mode==='statement'?C.text:C.muted, transition:'background 0.15s' }}>
          📄 Bank Statement
        </button>
        <button onClick={() => { setMode('invoice'); setFile(null); setError(''); setUploadError(null) }}
          style={{ flex:1, padding:'8px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, background:mode==='invoice'?C.card:'transparent', color:mode==='invoice'?C.text:C.muted, transition:'background 0.15s' }}>
          🧾 Invoice / Receipt
        </button>
      </div>

      {mode === 'statement' && (
        <Field label="Account (optional — helps with matching)">
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={inputStyle}>
            <option value="">Auto-detect from statement</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
      )}

      <Field label={mode === 'invoice' ? 'Invoice or Receipt File' : 'Bank Statement File'}>
        <div onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f) }}
          style={{ border:`2px dashed ${file?C.accent:C.border}`, borderRadius:12, padding:'22px 20px', textAlign:'center', cursor:'pointer', background:file?C.accent+'10':C.card2, transition:'border-color 0.15s' }}>
          <div style={{ fontSize:32, marginBottom:8 }}>{file ? (mode==='invoice'?'🧾':'📄') : (mode==='invoice'?'🧾':'⬆️')}</div>
          {file
            ? <><div style={{ fontSize:14, fontWeight:600, color:C.text }}>{file.name}</div><div style={{ fontSize:12, color:C.muted, marginTop:4 }}>{(file.size/1024).toFixed(0)} KB · Click to change</div></>
            : mode === 'invoice'
              ? <>
                  <div style={{ fontSize:14, fontWeight:600, color:C.mutedL, marginBottom:4 }}>Drop file here or click to browse</div>
                  <div style={{ fontSize:12, color:C.muted }}>PDF · JPG · PNG · Maximum 10 MB</div>
                </>
              : <>
                  <div style={{ fontSize:14, fontWeight:600, color:C.mutedL, marginBottom:6 }}>Drag and drop or click to upload</div>
                  <div style={{ display:'flex', justifyContent:'center', gap:14, marginBottom:6 }}>
                    {[['📄','PDF'],['📊','Excel'],['📋','CSV'],['🖼️','Image']].map(([ic,lb]) => (
                      <div key={lb} style={{ fontSize:11, color:C.muted }}><span style={{ fontSize:18 }}>{ic}</span><br/>{lb}</div>
                    ))}
                  </div>
                  <div style={{ fontSize:12, color:C.muted }}>PDF · XLS / XLSX · CSV · JPG · PNG · Maximum 10 MB</div>
                </>
          }
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.heic,image/*"
            style={{ display:'none' }}
            onChange={e => { if (e.target.files[0]) handleFileChange(e.target.files[0]) }} />
        </div>
        {/* Camera label — wraps input directly so browser opens camera without JS intermediary */}
        {mode === 'invoice' && (
          <label style={{ width:'100%', marginTop:10, padding:'10px', border:`1px solid ${C.border}`, borderRadius:8, background:C.card2, color:C.text, cursor:'pointer', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxSizing:'border-box' }}>
            📷 Take a Photo
            <input type="file" accept="image/*" capture="environment" style={{ display:'none' }}
              onChange={e => { if (e.target.files[0]) handleFileChange(e.target.files[0]) }} />
          </label>
        )}
      </Field>

      {mode === 'statement' && (
        <>
          <div style={{ background:C.accent+'15', border:`1px solid ${C.accent}33`, borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, color:C.mutedL, lineHeight:1.7 }}>
            <div>Supported banks: NBK, KFH, Burgan, Gulf Bank, HDFC, SBI, Axis, ICICI and most major banks. Upload PDF or Excel/CSV export for best accuracy.</div>
            <div style={{ marginTop:5 }}>🏷️ <strong>Heads up on categorisation:</strong> AI assigns categories automatically — you can review and fix every one before importing.</div>
            <div style={{ marginTop:5 }}>🔒 <strong>Privacy Notice:</strong> Your file is sent securely to Anthropic's AI for extraction only. No data is stored externally.</div>
          </div>
          {fileAlreadyImported && (
            <div style={{ background:C.yellow+'15', border:`1px solid ${C.yellow}44`, borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, lineHeight:1.6 }}>
              <div style={{ fontWeight:700, color:C.yellow, marginBottom:3 }}>🔄 Previous import will be replaced</div>
              <div style={{ color:C.mutedL }}>
                <strong style={{ color:C.textS }}>{fileAlreadyImported.fileName}</strong> was previously imported on{' '}
                <strong style={{ color:C.textS }}>{new Date(fileAlreadyImported.importedAt).toLocaleDateString('default', { day:'numeric', month:'short', year:'numeric' })}</strong>.
                {' '}Re-importing will remove the old transactions and replace them with the new ones.
              </div>
            </div>
          )}
          {uploadWarning && (
            <div style={{ background:C.yellow+'18', border:`1px solid ${C.yellow}44`, borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, color:C.yellow, lineHeight:1.6 }}>
              ⚠️ {uploadWarning}
            </div>
          )}
        </>
      )}

      {mode === 'invoice' && (
        <div style={{ background:C.accent+'15', border:`1px solid ${C.accent}33`, borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, color:C.mutedL, lineHeight:1.6 }}>
          Upload a receipt, invoice, or bill. Claude AI will extract the date, amount, description, and category — you can edit before saving.
        </div>
      )}

      {error &&<div style={{ color:C.red, fontSize:13, marginBottom:12, padding:'8px 12px', background:C.red+'15', borderRadius:8 }}>{error}</div>}
      {uploadError && (
        <div style={{ background:C.red+'18', border:`1px solid ${C.red}44`, borderRadius:10, padding:'12px 14px', marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.red, marginBottom:4 }}>⚠️ Processing Failed</div>
          <div style={{ fontSize:13, color:C.redL, marginBottom:8 }}>{uploadError}</div>
          {mode === 'statement' && (
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>
              💡 Tips: Use PDF or Excel/CSV export from your bank. Scanned image PDFs may not work well.
            </div>
          )}
          <button onClick={() => { setUploadError(null); setFile(null) }}
            style={{ padding:'5px 12px', background:C.accent, color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700 }}>
            Try Again
          </button>
        </div>
      )}
      <Btn onClick={mode === 'invoice' ? processInvoiceFile : processFile} disabled={!file} style={{ width:'100%', padding:'11px 0', fontSize:14 }}>
        {file ? `✨ Extract from "${file.name.length>28?file.name.slice(0,25)+'…':file.name}"` : 'Select a file to continue'}
      </Btn>
    </Modal>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────
// Self-contained subscription status + manage button for Settings.
function SubscriptionCard() {
  const [sub, setSub] = useState(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    import('./subscription.js').then(async ({ getSubscription }) => setSub(await getSubscription() ?? null))
  }, [])
  const manage = async () => {
    setBusy(true)
    try { const { openPortal } = await import('./subscription.js'); await openPortal() }
    catch { setBusy(false) }
  }
  const label = sub === undefined ? 'Loading…'
    : !sub ? 'No active subscription'
    : sub.status === 'trialing' ? 'Free trial active'
    : sub.status === 'active' ? 'Active'
    : sub.status
  const ends = sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const col = sub?.status === 'active' || sub?.status === 'trialing' ? C.green : C.muted
  return (
    <Card title="Subscription" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ends ? 6 : 0 }}>
        <span style={{ fontSize: 13, color: C.muted }}>Status</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: col }}>{label}</span>
      </div>
      {ends && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: C.muted }}>{sub?.cancel_at_period_end ? 'Ends on' : 'Renews on'}</span>
          <span style={{ fontSize: 13, color: C.textS }}>{ends}</span>
        </div>
      )}
      {sub && <Btn variant="ghost" onClick={manage} disabled={busy} style={{ width: '100%' }}>{busy ? 'Opening…' : '💳 Manage subscription'}</Btn>}
    </Card>
  )
}

function Settings({ homeCurrency, setHomeCurrency, foreignCurrency, setForeignCurrency, primaryCurrency, setPrimaryCurrency, exchangeRate, setExchangeRate, setSetupComplete, setAccounts, setTransactions, setBills, setRemittances, setInvestments, setGoals, setAllocations, setLoans, setFamilyMembers, setTemplates, setWkBudgets, setHmBudgets, setBudgetMonth, setGoalContribs, setSavedScenarios, accounts, transactions, bills, remittances, investments, goals, loans, familyMembers, templates, smartRules, setSmartRules }) {
  const [showClearModal, setShowClearModal] = useState(false)
  const [clearText, setClearText] = useState('')
  const [showImportConfirm, setShowImportConfirm] = useState(false)
  const [pendingImport, setPendingImport] = useState(null)
  const fileRef = useRef(null)

  const clearNriKeys = () => {
    Object.keys(localStorage).filter(k => k.startsWith('nri_')).forEach(k => localStorage.removeItem(k))
  }

  const handleClearData = () => {
    if (clearText !== 'DELETE') return
    clearNriKeys()
    setAccounts(DEFAULT_ACCOUNTS)
    setTransactions(DEFAULT_TRANSACTIONS)
    setBills(DEFAULT_BILLS)
    setRemittances(DEFAULT_REMITTANCES)
    setInvestments(DEFAULT_INVESTMENTS)
    setGoals(DEFAULT_GOALS.map(g => ({ ...g })))
    setAllocations(DEFAULT_ALLOCATIONS)
    setLoans(DEFAULT_LOANS)
    setFamilyMembers(DEFAULT_FAMILY_MEMBERS)
    setTemplates(DEFAULT_TEMPLATES)
    setWkBudgets(DEFAULT_WK_BUDGETS.map(b => ({ ...b })))
    setHmBudgets(DEFAULT_HM_BUDGETS.map(b => ({ ...b })))
    setGoalContribs([])
    setSavedScenarios([])
    setBudgetMonth(new Date().toISOString().slice(0, 7))
    setShowClearModal(false)
    setClearText('')
    setSetupComplete(false)
  }

  const exportJSON = () => {
    const data = { accounts, transactions, bills, remittances, investments, goals, loans, familyMembers, templates, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const date = new Date().toISOString().slice(0, 10)
    const a = document.createElement('a'); a.href = url; a.download = `nri-finance-backup-${date}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const data = JSON.parse(evt.target.result)
        setPendingImport(data)
        setShowImportConfirm(true)
      } catch { alert('Invalid JSON file. Please select a valid backup file.') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const confirmImport = () => {
    if (!pendingImport) return
    if (pendingImport.accounts)      setAccounts(pendingImport.accounts)
    if (pendingImport.transactions)  setTransactions(pendingImport.transactions)
    if (pendingImport.bills)         setBills(pendingImport.bills)
    if (pendingImport.remittances)   setRemittances(pendingImport.remittances)
    if (pendingImport.investments)   setInvestments(pendingImport.investments)
    if (pendingImport.goals)         setGoals(pendingImport.goals)
    if (pendingImport.loans)         setLoans(pendingImport.loans)
    if (pendingImport.familyMembers) setFamilyMembers(pendingImport.familyMembers)
    if (pendingImport.templates)     setTemplates(pendingImport.templates)
    setPendingImport(null)
    setShowImportConfirm(false)
  }

  const exportCSV = (data, filename) => {
    if (!data || !data.length) return
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={pg}>
      <h2 style={{ ...pgTitle, marginBottom: 24 }}>Settings</h2>

      <Card title="Currency Settings" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 14 }}>
          <CurrencySel label="Home Country Currency" value={homeCurrency} onChange={e => setHomeCurrency(e.target.value)} />
          <CurrencySel label="Working Country Currency" value={foreignCurrency} onChange={e => setForeignCurrency(e.target.value)} exclude={['INR']} />
          <CurrencySel label="Primary Display Currency" value={primaryCurrency} onChange={e => setPrimaryCurrency(e.target.value)} />
          <Field label={`1 ${foreignCurrency} = ? ${homeCurrency}`}>
            <input type="number" step="0.01" value={exchangeRate} onChange={e => setExchangeRate(parseFloat(e.target.value) || 0)} style={inputStyle} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Btn variant="ghost" onClick={() => setSetupComplete(false)}>⚙️ Re-run Currency Setup Wizard</Btn>
        </div>
      </Card>

      <Card title="AI Features" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
          The AI Advisor and document scanning use Claude, processed securely on
          the server — no API key is stored in your browser. AI features are
          available whenever you're signed in. 🔒
        </p>
      </Card>

      <SubscriptionCard />

      <Card title="Smart Rules (learned from your corrections)" style={{ marginBottom: 16 }}>
        {Object.keys(smartRules || {}).length === 0
          ? <div style={{ fontSize:13, color:C.muted }}>No rules yet. Change a category while reviewing an imported statement and the app will remember it for next time.</div>
          : Object.entries(smartRules).map(([merchant, category]) => (
            <div key={merchant} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:C.card2, borderRadius:8, padding:'8px 12px', marginBottom:6 }}>
              <div style={{ fontSize:13, color:C.text }}>
                <span style={{ color:C.mutedL }}>{merchant}</span>
                <span style={{ color:C.muted }}> → </span>
                <span style={{ color:CAT_COLORS[category]||C.accent, fontWeight:600 }}>{category}</span>
              </div>
              <button onClick={() => setSmartRules(p => { const u={...p}; delete u[merchant]; persist('nri_smartRules',u); return u })}
                style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:13, padding:'0 4px' }}>🗑️</button>
            </div>
          ))
        }
      </Card>

      <Card title="NRI Quick Reference" style={{ marginBottom: 16 }} accent={C.accent}>
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 8 }}>
          {[
            { icon: '🏦', t: 'NRE Account', d: 'Tax-free in India. Freely repatriable. For foreign-earned income.', color: C.green },
            { icon: '🏦', t: 'NRO Account', d: 'Taxable in India. Repatriation up to USD 1M/year. For India income.', color: C.yellow },
            { icon: '💱', t: 'FEMA Rules', d: 'RBI regulates cross-border money flows. Keep records of all remittances.', color: C.teal },
            { icon: '📋', t: 'DTAA', d: 'India has tax treaties with 90+ countries to avoid double taxation.', color: C.purple },
            { icon: '📝', t: 'ITR Filing', d: 'File Indian ITR if you have taxable income in India (NRO interest, rent, etc.).', color: C.accent },
          ].map(item => (
            <div key={item.t} style={{ display: 'flex', gap: 10, background: C.card2, borderRadius: 10, padding: '10px 12px', borderLeft: `3px solid ${item.color}` }}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: item.color, marginBottom: 2 }}>{item.t}</div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{item.d}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Export & Backup" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>Download all your financial data for backup or transfer.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Btn onClick={exportJSON} variant="ghost">⬇ Export All Data (JSON)</Btn>
          <Btn onClick={() => exportCSV(transactions, 'transactions.csv')} variant="ghost">⬇ Transactions CSV</Btn>
          <Btn onClick={() => exportCSV(accounts, 'accounts.csv')} variant="ghost">⬇ Accounts CSV</Btn>
          <Btn onClick={() => exportCSV(investments, 'investments.csv')} variant="ghost">⬇ Investments CSV</Btn>
          <Btn onClick={() => exportCSV(loans, 'loans.csv')} variant="ghost">⬇ Loans CSV</Btn>
        </div>
      </Card>

      <Card title="Import Backup" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>Restore data from a previously exported JSON backup file.</p>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
        <Btn variant="ghost" onClick={() => fileRef.current?.click()}>⬆ Import Backup (JSON)</Btn>
        {showImportConfirm && (
          <div style={{ marginTop: 14, background: C.card2, borderRadius: 10, padding: 16, border: `1px solid ${C.yellow}44` }}>
            <div style={{ fontSize: 13, color: C.yellow, marginBottom: 12 }}>⚠️ This will replace all current data. Continue?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={confirmImport}>Yes, Import</Btn>
              <Btn variant="ghost" onClick={() => { setShowImportConfirm(false); setPendingImport(null) }}>Cancel</Btn>
            </div>
          </div>
        )}
      </Card>

      <Card title="Danger Zone">
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Permanently delete all financial data and reset the app. This cannot be undone.</p>
        <Btn variant="danger" onClick={() => setShowClearModal(true)}>🗑️ Clear All Data</Btn>
        {showClearModal && (
          <div style={{ marginTop: 16, background: C.card2, borderRadius: 12, padding: 20, border: `1px solid ${C.red}44` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginBottom: 8 }}>⚠️ Permanently delete ALL data?</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
              This will permanently delete ALL your financial data including accounts, transactions, loans, investments and goals. This cannot be undone.
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Type <strong style={{ color: C.red }}>DELETE</strong> to confirm:</div>
            <input
              value={clearText}
              onChange={e => setClearText(e.target.value)}
              placeholder="Type DELETE"
              style={{ ...inputStyle, marginBottom: 12, borderColor: clearText === 'DELETE' ? C.red : C.border }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="danger" onClick={handleClearData} disabled={clearText !== 'DELETE'}>Confirm Delete All</Btn>
              <Btn variant="ghost" onClick={() => { setShowClearModal(false); setClearText('') }}>Cancel</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── What-If Simulator ────────────────────────────────────────────────────────
function WhatIfSimulator({ loans, transactions, accounts, savedScenarios, setSavedScenarios }) {
  const mon = new Date().toISOString().slice(0, 7)
  const monTx = transactions.filter(t => (t.date || '').startsWith(mon))
  const monIn = monTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.amountINR || t.amount || 0), 0)
  const monEx = monTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amountINR || t.amount || 0), 0)
  const currentSavings = monIn - monEx

  const [incomeChange, setIncomeChange] = useState(0)
  const [loanId, setLoanId] = useState(loans[0]?.id || '')
  const [extraEMI, setExtraEMI] = useState(0)
  const [investType, setInvestType] = useState('Mutual Fund')
  const [extraInvest, setExtraInvest] = useState(0)
  const [horizon, setHorizon] = useState(5)
  const [scenarioName, setScenarioName] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [copied, setCopied] = useState(false)

  const newIncome = monIn * (1 + incomeChange / 100)
  const newSavings = newIncome - monEx
  const savingsDelta = newSavings - currentSavings
  const wealthDelta12 = savingsDelta * 12
  const wealthDelta60 = savingsDelta * 60

  const selLoan = loans.find(l => l.id === loanId)
  const calcPayoff = (outstanding, emi, rate, extra = 0) => {
    if (!emi || emi <= 0) return null
    const payment = emi + extra
    const mr = (rate || 0) / 100 / 12
    if (mr === 0) return { months: Math.ceil(outstanding / payment), interest: 0 }
    if (payment <= outstanding * mr) return null
    let bal = outstanding, interest = 0, months = 0
    while (bal > 0.01 && months < 600) { const ic = bal * mr; interest += ic; bal = bal + ic - payment; months++ }
    return { months, interest: Math.round(interest) }
  }
  const basePayoff = selLoan ? calcPayoff(selLoan.outstanding || 0, selLoan.emi || 0, selLoan.rate || 0) : null
  const extraPayoff = selLoan ? calcPayoff(selLoan.outstanding || 0, selLoan.emi || 0, selLoan.rate || 0, extraEMI) : null
  const monthsSaved = basePayoff && extraPayoff ? basePayoff.months - extraPayoff.months : 0
  const interestSaved = basePayoff && extraPayoff ? basePayoff.interest - extraPayoff.interest : 0

  const annualRate = INVEST_RETURNS[investType] / 100
  const mr = annualRate / 12
  const totalMonths = horizon * 12
  const fv = extraInvest > 0 ? extraInvest * ((Math.pow(1 + mr, totalMonths) - 1) / mr) * (1 + mr) : 0
  const totalInvested2 = extraInvest * totalMonths
  const investReturns = fv - totalInvested2
  const combinedImpact = wealthDelta12 + interestSaved + investReturns

  const incomeChartData = Array.from({ length: 12 }, (_, i) => ({ base: currentSavings * (i + 1), newVal: newSavings * (i + 1) }))
  const maxW = Math.max(...incomeChartData.map(d => Math.max(Math.abs(d.base), Math.abs(d.newVal))), 1)
  const chartH = 100, chartW = 360
  const chartPt = (val, idx) => {
    const x = (idx / 11) * (chartW - 30) + 15
    const y = chartH - 10 - (Math.max(0, val) / maxW) * (chartH - 20)
    return `${x},${y}`
  }

  const investChartData = Array.from({ length: horizon }, (_, i) => {
    const m = (i + 1) * 12
    const v = extraInvest > 0 ? extraInvest * ((Math.pow(1 + mr, m) - 1) / mr) * (1 + mr) : 0
    return { corpus: Math.round(v), invested: extraInvest * m }
  })
  const maxInvest = Math.max(...investChartData.map(d => d.corpus), 1)

  const saveScenario = () => {
    if (!scenarioName.trim()) return
    setSavedScenarios(p => [...p, { id: uid(), name: scenarioName, date: today(), incomeChange, extraEMI, loanName: selLoan?.name || '', investType, extraInvest, horizon, combinedImpact: Math.round(combinedImpact) }])
    setShowSaveModal(false); setScenarioName('')
  }

  const shareScenario = () => {
    const text = `Personal Finance Management for NRI's & Expats — What-If Scenario:\n• Income ${incomeChange > 0 ? '+' : ''}${incomeChange}% → ${fmt(Math.round(newIncome))}/mo, saving ${fmt(Math.round(newSavings))}/mo\n• Loan prepay +${fmt(extraEMI)}/mo → ${monthsSaved}mo saved, ${fmt(interestSaved)} interest saved\n• Extra SIP ${fmt(extraInvest)}/mo in ${investType} for ${horizon}yr → ${fmt(Math.round(fv))} corpus\n• Combined: +${fmt(Math.round(combinedImpact))} wealth impact`
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div><h2 style={pgTitle}>What-If Simulator</h2><div style={{ fontSize: 13, color: C.muted }}>Model scenarios and see their impact on your wealth</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={shareScenario}>{copied ? '✓ Copied!' : '📋 Share'}</Btn>
          <Btn onClick={() => setShowSaveModal(true)}>💾 Save Scenario</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-3, repeat(3,1fr))', gap: 14, marginBottom: 18 }}>
        {/* Income Change */}
        <Card title="Scenario 1 — Income Change">
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 6 }}>
              <span>Change: <strong style={{ color: incomeChange >= 0 ? C.green : C.red }}>{incomeChange > 0 ? '+' : ''}{incomeChange}%</strong></span>
              <span>{fmt(Math.round(newIncome))}/mo</span>
            </div>
            <input type="range" min={-50} max={100} step={5} value={incomeChange} onChange={e => setIncomeChange(Number(e.target.value))} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginTop: 2 }}><span>-50%</span><span>+100%</span></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 6, marginBottom: 12 }}>
            {[
              { label: 'New Income', value: fmt(Math.round(newIncome)), color: C.text },
              { label: 'New Savings/mo', value: fmt(Math.round(newSavings)), color: newSavings >= 0 ? C.green : C.red },
              { label: '12-mo Impact', value: (wealthDelta12 >= 0 ? '+' : '') + fmt(Math.round(wealthDelta12)), color: wealthDelta12 >= 0 ? C.green : C.red },
              { label: '5-yr Impact', value: (wealthDelta60 >= 0 ? '+' : '') + fmt(Math.round(wealthDelta60)), color: wealthDelta60 >= 0 ? C.green : C.red },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.card2, borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
          {monIn > 0 && (
            <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: chartH }}>
              <polyline fill="none" stroke={C.muted + '66'} strokeWidth="1.5" points={incomeChartData.map((d, i) => chartPt(d.base, i)).join(' ')} />
              <polyline fill="none" stroke={newSavings >= currentSavings ? C.green : C.red} strokeWidth="2" points={incomeChartData.map((d, i) => chartPt(d.newVal, i)).join(' ')} />
              <text x={15} y={chartH - 2} fontSize={8} fill={C.muted}>Mo 1</text>
              <text x={chartW - 15} y={chartH - 2} fontSize={8} fill={C.muted} textAnchor="end">Mo 12</text>
            </svg>
          )}
        </Card>

        {/* Loan Prepayment */}
        <Card title="Scenario 2 — Loan Prepayment">
          {loans.length === 0
            ? <Empty icon="🏠" title="No loans" sub="Add loans in the Loans tab" />
            : <>
              <Sel label="Select loan" value={loanId} onChange={e => setLoanId(e.target.value)}
                options={loans.map(l => ({ value: l.id, label: `${l.name} (${fmt(l.outstanding || 0)})` }))} />
              {selLoan && <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 6 }}>
                    <span>Extra EMI: <strong style={{ color: C.accent }}>{fmt(extraEMI)}/mo</strong></span>
                    <span>Total: {fmt((selLoan.emi || 0) + extraEMI)}/mo</span>
                  </div>
                  <input type="range" min={0} max={Math.max(50000, (selLoan.emi || 0) * 2)} step={500}
                    value={extraEMI} onChange={e => setExtraEMI(Number(e.target.value))} style={{ width: '100%' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 6, marginBottom: 12 }}>
                  {[
                    { label: 'Loan Name', value: selLoan.name, color: C.text },
                    { label: 'Rate', value: `${selLoan.rate || 0}% p.a.`, color: C.text },
                    { label: 'Base Payoff', value: basePayoff ? `${basePayoff.months}mo` : '—', color: C.muted },
                    { label: 'With Extra', value: extraPayoff ? `${extraPayoff.months}mo` : '—', color: C.accent },
                    { label: 'Months Saved', value: `${monthsSaved}mo`, color: monthsSaved > 0 ? C.green : C.muted },
                    { label: 'Interest Saved', value: fmt(interestSaved), color: interestSaved > 0 ? C.green : C.muted },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: C.card2, borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>
                {interestSaved > 0 && (
                  <div style={{ background: C.green + '15', border: `1px solid ${C.green}33`, borderRadius: 8, padding: 10, fontSize: 12, color: C.green }}>
                    ✅ Save {fmt(interestSaved)} interest · finish {monthsSaved}mo early
                  </div>
                )}
              </>}
            </>
          }
        </Card>

        {/* Extra Investment */}
        <Card title="Scenario 3 — Extra Investment">
          <Sel label="Investment type" value={investType} onChange={e => setInvestType(e.target.value)} options={INVEST_TYPES_SIM} />
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 6 }}>
              <span>Monthly SIP: <strong style={{ color: C.purple }}>{fmt(extraInvest)}</strong></span>
              <span>{INVEST_RETURNS[investType]}% p.a.</span>
            </div>
            <input type="range" min={0} max={100000} step={1000} value={extraInvest} onChange={e => setExtraInvest(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
          <Field label={`Time horizon: ${horizon} years`}>
            <input type="range" min={1} max={30} step={1} value={horizon} onChange={e => setHorizon(Number(e.target.value))} style={{ width: '100%' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 6, marginBottom: 10 }}>
            {[
              { label: 'Monthly SIP', value: fmt(extraInvest), color: C.purple },
              { label: 'Total Invested', value: fmt(totalInvested2), color: C.text },
              { label: 'Est. Returns', value: fmt(Math.round(investReturns)), color: C.green },
              { label: `${horizon}yr Corpus`, value: fmt(Math.round(fv)), color: C.yellow },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.card2, borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
          {extraInvest > 0 && investChartData.length > 0 && (
            <svg viewBox="0 0 360 90" style={{ width: '100%', height: 90 }}>
              <defs>
                <linearGradient id="ig" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.purple} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={C.purple} stopOpacity="0.03" />
                </linearGradient>
              </defs>
              {(() => {
                const pts = investChartData.map((d, i) => { const x = (i / Math.max(investChartData.length - 1, 1)) * 330 + 15; const y = 80 - (d.corpus / maxInvest) * 70; return `${x},${y}` })
                const [fx] = pts[0].split(','); const [lx] = pts[pts.length - 1].split(',')
                return <>
                  <polygon fill="url(#ig)" points={`${fx},80 ${pts.join(' ')} ${lx},80`} />
                  <polyline fill="none" stroke={C.purple} strokeWidth="2" points={pts.join(' ')} />
                </>
              })()}
              <text x={15} y={88} fontSize={8} fill={C.muted}>Yr 1</text>
              <text x={345} y={88} fontSize={8} fill={C.muted} textAnchor="end">Yr {horizon}</text>
            </svg>
          )}
        </Card>
      </div>

      <Card title="Combined Wealth Impact" accent={C.gold} style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[
            { label: '12-mo Income Effect', value: (wealthDelta12 >= 0 ? '+' : '') + fmt(Math.round(wealthDelta12)), color: wealthDelta12 >= 0 ? C.green : C.red },
            { label: 'Loan Interest Saved', value: fmt(interestSaved), color: interestSaved > 0 ? C.green : C.muted },
            { label: `${horizon}-yr Investment Return`, value: fmt(Math.round(investReturns)), color: investReturns > 0 ? C.purple : C.muted },
            { label: 'Total Wealth Impact', value: (combinedImpact >= 0 ? '+' : '') + fmt(Math.round(combinedImpact)), color: combinedImpact >= 0 ? C.gold : C.red, highlight: true },
          ].map(({ label, value, color, highlight }) => (
            <div key={label} style={{ background: highlight ? `linear-gradient(135deg, ${C.gold}18, ${C.gold}08)` : C.card2, border: `1px solid ${highlight ? C.gold + '44' : C.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>{label}</div>
              <div className="num" style={{ fontSize: highlight ? 20 : 17, fontWeight: 800, color, letterSpacing: '-0.03em' }}>{value}</div>
            </div>
          ))}
        </div>
      </Card>

      {savedScenarios.length > 0 && (
        <Card title="Saved Scenarios">
          {savedScenarios.map(s => (
            <div key={s.id} style={{ ...rowSep, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{s.date} · Income {s.incomeChange > 0 ? '+' : ''}{s.incomeChange}% · SIP {fmt(s.extraInvest)}/mo</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: s.combinedImpact >= 0 ? C.green : C.red }}>{s.combinedImpact >= 0 ? '+' : ''}{fmt(s.combinedImpact)}</span>
                <IconBtn onClick={() => setSavedScenarios(p => p.filter(x => x.id !== s.id))}>🗑️</IconBtn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {showSaveModal && (
        <Modal title="Save Scenario" onClose={() => setShowSaveModal(false)} width={400}>
          <Input label="Scenario name" value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="e.g. Conservative 2026 Plan" />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => setShowSaveModal(false)} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={saveScenario} style={{ flex: 1 }}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Auth UI ────────────────────────────────────────────────────────────────
// Minimal splash shown while the session is being resolved (avoids a flash of
// the sign-in screen for already-authenticated users on reload).
function AuthSplash() {
  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(1200px 800px at 30% 20%, #0d1b2e 0%, ${C.bg} 60%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div role="img" aria-label="logo" style={{ width: 72, height: 72, borderRadius: 18, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 3px 16px rgba(255,136,0,0.5))', animation: 'pulse 1.4s ease-in-out infinite' }} />
    </div>
  )
}

const GoogleGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>
  </svg>
)

// Full-screen sign-in. One action: Continue with Google.
function AuthScreen() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('signin')   // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')     // success / info message (e.g. verify email)

  const handleGoogle = async () => {
    setLoading(true); setError(''); setNotice('')
    try {
      const { signInWithGoogle } = await import('./auth.js')
      await signInWithGoogle() // navigates away to Google
    } catch (e) {
      setError(e.message || 'Could not start sign-in. Please try again.')
      setLoading(false)
    }
  }

  const handleEmailAuth = async (e) => {
    e.preventDefault()
    setError(''); setNotice('')
    if (!email || !password) { setError('Please enter your email and password.'); return }
    if (mode === 'signup' && password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    try {
      const auth = await import('./auth.js')
      if (mode === 'signup') {
        const { needsVerification } = await auth.signUpWithEmail(email, password)
        if (needsVerification) {
          setNotice(`We've sent a verification link to ${email}. Click it to activate your account, then sign in.`)
          setMode('signin')
        }
        // if no verification required, onAuthChange will sign them straight in
      } else {
        await auth.signInWithEmail(email, password)
        // onAuthChange handles the rest
      }
    } catch (err) {
      const msg = err.message || 'Something went wrong.'
      // Friendlier message for the common unverified-email case
      if (/email not confirmed/i.test(msg)) setError('Please verify your email first — check your inbox for the link.')
      else setError(msg)
    }
    setLoading(false)
  }

  const handleForgot = async () => {
    if (!email) { setError('Enter your email above first, then tap "Forgot password".'); return }
    setError(''); setNotice('')
    try {
      const { resetPassword } = await import('./auth.js')
      await resetPassword(email)
      setNotice(`Password reset link sent to ${email}.`)
    } catch (err) { setError(err.message || 'Could not send reset email.') }
  }

  const features = [
    ['🌍', 'Money across borders', 'Track your home-country and working-country finances in one place.'],
    ['💱', 'Multi-currency, live rates', 'Balances and net worth always shown in the currency you think in.'],
    ['📸', 'AI receipt & statement scan', 'Snap a bill or upload a statement — details are extracted for you.'],
  ]
  const inp = { width: '100%', padding: '11px 13px', borderRadius: 9, border: `1px solid ${C.borderL}`, background: C.card2, color: C.text, fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }

  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(1200px 800px at 28% 18%, #0d1b2e 0%, ${C.bg} 60%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Brand lockup */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div role="img" aria-label="NRI's & Expat's" style={{ width: 84, height: 84, margin: '0 auto 16px', borderRadius: 20, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 4px 18px rgba(255,136,0,0.5))' }} />
          <div style={{ fontSize: 24, fontWeight: 900, color: C.text, letterSpacing: '-0.03em' }}>NRI's &amp; Expat's</div>
          <div style={{ fontSize: 11, color: C.gold, letterSpacing: '0.14em', textTransform: 'uppercase', fontStyle: 'italic', marginTop: 3 }}>Beyond Borders</div>
        </div>

        {/* Card */}
        <div style={{ background: C.card, border: `1px solid ${C.borderL}`, borderRadius: 20, padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 4 }}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 18, lineHeight: 1.5 }}>
            {mode === 'signup'
              ? 'Sign up to start tracking your finances across borders.'
              : 'Sign in to access your personal finances — synced across your devices.'}
          </div>

          {error && (
            <div style={{ background: C.red + '15', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.redL }}>
              {error}
            </div>
          )}
          {notice && (
            <div style={{ background: C.green + '15', border: `1px solid ${C.green}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.greenL, lineHeight: 1.5 }}>
              ✉️ {notice}
            </div>
          )}

          {/* Email / password form */}
          <form onSubmit={handleEmailAuth}>
            <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" style={inp} />
            <input type="password" placeholder={mode === 'signup' ? 'Create a password (min 6 chars)' : 'Password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} style={inp} />
            {mode === 'signin' && (
              <div style={{ textAlign: 'right', marginBottom: 12 }}>
                <button type="button" onClick={handleForgot} style={{ background: 'none', border: 'none', color: C.accentL, fontSize: 11, cursor: 'pointer', padding: 0 }}>Forgot password?</button>
              </div>
            )}
            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: C.accent, color: '#fff', cursor: loading ? 'wait' : 'pointer', fontSize: 14, fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
              {loading ? '⏳ Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {/* Toggle sign in / sign up */}
          <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: C.muted }}>
            {mode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
            <button onClick={() => { setMode(m => m === 'signup' ? 'signin' : 'signup'); setError(''); setNotice('') }}
              style={{ background: 'none', border: 'none', color: C.accentL, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
              {mode === 'signup' ? 'Sign in' : 'Sign up'}
            </button>
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
            <div style={{ flex: 1, height: 1, background: C.border }} />
            <span style={{ fontSize: 11, color: C.muted }}>or</span>
            <div style={{ flex: 1, height: 1, background: C.border }} />
          </div>

          <button onClick={handleGoogle} disabled={loading}
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${C.borderL}`, background: '#fff', color: '#1f1f1f', cursor: loading ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s' }}>
            {loading ? '⏳ Opening Google…' : <><GoogleGlyph /> Continue with Google</>}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
            🔒 Your data is private to your account. We never store your password in plain text.
          </div>
        </div>

        {/* Value props */}
        <div style={{ marginTop: 22 }}>
          {features.map(([ic, title, desc]) => (
            <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 4px' }}>
              <div style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.3 }}>{ic}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textS }}>{title}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
          By continuing you agree to keep your financial data accurate for your own use.<br />
          This app is a personal finance tool, not financial advice.
        </div>
      </div>
    </div>
  )
}

// ─── Paywall / subscription screen ────────────────────────────────────────────
// Shown when a signed-in user has no active subscription/trial. Starts Stripe
// Checkout (14-day free trial, card required).
function PaywallScreen({ sub, onSignOut }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const subscribe = async () => {
    setLoading(true); setError('')
    try {
      const { startCheckout } = await import('./subscription.js')
      await startCheckout() // redirects to Stripe
    } catch (e) { setError(e.message || 'Could not start checkout.'); setLoading(false) }
  }

  const expired = sub && (sub.status === 'past_due' || sub.status === 'canceled' || sub.status === 'unpaid')
  const perks = [
    'Track money across home & working countries',
    'Live multi-currency balances & net worth',
    'AI receipt & bank-statement scanning',
    'Estelle — your AI finance advisor',
    'Synced securely across all your devices',
  ]

  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(1200px 800px at 28% 18%, #0d1b2e 0%, ${C.bg} 60%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div role="img" aria-label="logo" style={{ width: 72, height: 72, margin: '0 auto 14px', borderRadius: 18, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 4px 18px rgba(255,136,0,0.5))' }} />
          <div style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: '-0.03em' }}>NRI's &amp; Expat's</div>
          <div style={{ fontSize: 11, color: C.gold, letterSpacing: '0.14em', textTransform: 'uppercase', fontStyle: 'italic', marginTop: 3 }}>Beyond Borders</div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.borderL}`, borderRadius: 20, padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 6 }}>
            {expired ? 'Your subscription has ended' : 'Start your 14-day free trial'}
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 18, lineHeight: 1.5 }}>
            {expired
              ? 'Renew to regain access to your finances and all features.'
              : 'Try everything free for 14 days. Cancel anytime before it ends and you won’t be charged.'}
          </div>

          <div style={{ background: C.card2, borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
            {perks.map(p => (
              <div key={p} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, color: C.textS, padding: '4px 0' }}>
                <span style={{ color: C.green, flexShrink: 0 }}>✓</span>{p}
              </div>
            ))}
          </div>

          {error && (
            <div style={{ background: C.red + '15', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.redL }}>{error}</div>
          )}

          <button onClick={subscribe} disabled={loading}
            style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: C.accent, color: '#fff', cursor: loading ? 'wait' : 'pointer', fontSize: 15, fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
            {loading ? '⏳ Opening secure checkout…' : expired ? 'Renew subscription' : 'Start free trial'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
            🔒 Secure payment by Stripe. We never see your card details.
          </div>
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button onClick={onSignOut} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer' }}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // session === undefined → still checking (show splash, avoid auth-screen flash)
  // session === null      → signed out (show AuthScreen)
  // session === object    → signed in
  const [session, setSession] = useState(undefined)
  const user = session?.user || null

  // ── Subscription gate ───────────────────────────────────────────────────────
  // sub === undefined → still loading; null → never subscribed; object → has row.
  const [sub, setSub] = useState(undefined)
  const [subEntitled, setSubEntitled] = useState(false)

  // Setup (home/working country) is per-account. It's only "complete" when the
  // user explicitly finished the wizard (nri_setupComplete === true), which
  // syncs from Supabase for the signed-in account. A brand-new account has no
  // such flag, so the country/currency wizard runs for them. We intentionally
  // do NOT auto-skip based on stray local data, so new accounts always set up
  // their countries.
  const [setupComplete, setSetupComplete] = useState(() => load('nri_setupComplete', false))
  const [homeCurrency, setHomeCurrency] = useState(() => load('nri_homeCurrency', DEFAULT_HOME_CURRENCY))
  const [foreignCurrency, setForeignCurrency] = useState(() => load('nri_foreignCurrency', DEFAULT_FOREIGN_CURRENCY))
  const [primaryCurrency, setPrimaryCurrency] = useState(() => load('nri_primaryCurrency', DEFAULT_PRIMARY_CURRENCY))
  const [exchangeRate, setExchangeRate] = useState(() => load('nri_exchangeRate', 22.7))
  const [rates, setRates] = useState(() => load('nri_rates', {}))
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState(() => load('nri_ratesUpdatedAt', null))
  const [ratesFetching, setRatesFetching] = useState(false)

  const [accounts, setAccounts] = useState(() => {
    const txs = load('nri_transactions', DEFAULT_TRANSACTIONS)
    const stored = load('nri_accounts', null)
    // Migrate: if stored accounts are the old KFH/Axis defaults, replace with current defaults
    const OLD_IDS = new Set([1, 2, 3, 4])
    const OLD_NAMES = ['KFH Salary Account', 'KFH Credit Card', 'Axis Credit Card', 'SBI Savings Account']
    const isOldDefaults = stored && stored.length > 0 &&
      stored.every(a => OLD_IDS.has(a.id) && OLD_NAMES.includes(a.name))
    const base = (!stored || isOldDefaults) ? DEFAULT_ACCOUNTS : stored
    return base.map(acc => {
      if (acc.setupBalance !== undefined) return acc
      // Migrate: derive setupBalance so that setupBalance + all transactions = current balance
      const isCC = acc.type === 'Credit Card'
      const txDelta = txs.filter(t => t.accountId === acc.id).reduce((s, t) => s + calcTxDelta(t, isCC), 0)
      return { ...acc, setupBalance: (acc.balance || 0) - txDelta, setupDate: today() }
    })
  })
  const [transactions, setTransactions] = useState(() => load('nri_transactions', DEFAULT_TRANSACTIONS))
  const [bills, setBills] = useState(() => {
    const stored = load('nri_bills', null)
    const OLD_BILL_NAMES = ['Apartment Rent', 'MEW Electricity & Water', 'Zain Internet', 'Mobile Postpaid', 'Health Insurance', 'Car Insurance', 'Home Electricity India', 'House Loan EMI']
    const isOldDefaults = stored && stored.every(b => OLD_BILL_NAMES.includes(b.name))
    return (!stored || isOldDefaults) ? DEFAULT_BILLS : stored
  })
  const [remittances, setRemittances] = useState(() => {
    const stored = load('nri_remittances', null)
    // Clear old sample remittances (IDs 1-2 with Wall Street/Al Mulla)
    const isOldDefaults = stored && stored.length === 2 && stored.every(r => [1, 2].includes(r.id))
    return (!stored || isOldDefaults) ? DEFAULT_REMITTANCES : stored
  })
  const [investments, setInvestments] = useState(() => {
    const stored = load('nri_investments', null)
    const isOldDefaults = stored && stored.every(i => ['SBI Mutual Fund', 'NPS Tier 1', 'Fixed Deposit - SBI', 'Gold', 'KFH Shares'].includes(i.name))
    return (!stored || isOldDefaults) ? DEFAULT_INVESTMENTS : stored
  })
  const [goals, setGoals] = useState(() => load('nri_goals', DEFAULT_GOALS.map(g => ({ ...g }))))
  const [goalContribs, setGoalContribs] = useState(() => load('nri_goalContribs', []))
  const [savedScenarios, setSavedScenarios] = useState(() => load('nri_savedScenarios', []))
  const [allocations, setAllocations] = useState(() => load('nri_allocations', DEFAULT_ALLOCATIONS))
  const [loans, setLoans] = useState(() => {
    const stored = load('nri_loans', null)
    const isOldDefaults = stored && stored.length === 2 && stored.every(l => ['House Loan - SBI', 'Car Loan - KFH'].includes(l.name))
    return (!stored || isOldDefaults) ? DEFAULT_LOANS : stored
  })
  const [familyMembers, setFamilyMembers] = useState(() => load('nri_family', DEFAULT_FAMILY_MEMBERS))
  const [templates, setTemplates] = useState(() => load('nri_templates', DEFAULT_TEMPLATES))
  const [wkBudgets, setWkBudgets] = useState(() => load('nri_wkBudgets', DEFAULT_WK_BUDGETS.map(b => ({ ...b }))))
  const [hmBudgets, setHmBudgets] = useState(() => load('nri_hmBudgets', DEFAULT_HM_BUDGETS.map(b => ({ ...b }))))
  const [budgetMonth, setBudgetMonth] = useState(() => load('nri_budgetMonth', new Date().toISOString().slice(0, 7)))

  // Restore UI state after a camera-induced page reload on mobile.
  // When the native camera opens (capture="environment"), the OS can unload
  // and reload the PWA tab, wiping in-memory React state. We stash the
  // "scan in progress" context in sessionStorage so we can reopen the modal.
  const scanRestore = (() => {
    try { const s = sessionStorage.getItem('nri_scanInProgress'); return s ? JSON.parse(s) : null } catch { return null }
  })()

  const [activeTab, setActiveTab] = useState(scanRestore?.activeTab || 'dashboard')
  const [aiMessages, setAiMessages] = useState([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const [showImport, setShowImport] = useState(!!scanRestore?.showImport)
  const [importAccountId, setImportAccountId] = useState(scanRestore?.importAccountId || null)
  const [importMode, setImportMode] = useState(scanRestore?.importMode || 'statement')
  const [lastImport, setLastImport] = useState(() => load('nri_lastImport', null))
  const [smartRules, setSmartRules] = useState(() => load('nri_smartRules', {}))
  const [invoicePrefill, setInvoicePrefill] = useState(null)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [showRates, setShowRates] = useState(false) // collapsed by default so nav items stay visible
  const mainScrollRef = useRef(null)

  // Keep the camera-reload restore snapshot in sync with the import modal.
  // When the native camera opens on mobile, the OS can unload and reload the
  // PWA tab, wiping in-memory state. While the modal is open we stash enough
  // context in sessionStorage to reopen it after such a reload; once it closes
  // we clear the snapshot so a normal reload behaves normally.
  useEffect(() => {
    try {
      if (showImport) {
        sessionStorage.setItem('nri_scanInProgress', JSON.stringify({ showImport: true, importMode, importAccountId, activeTab }))
      } else {
        sessionStorage.removeItem('nri_scanInProgress')
      }
    } catch { /* sessionStorage unavailable — ignore */ }
  }, [showImport, importMode, importAccountId, activeTab])

  // ── Auth bootstrap ─────────────────────────────────────────────────────────
  // Read the current session once, then subscribe to changes (sign-in/out,
  // token refresh, and the OAuth redirect return). Setting `session` drives
  // the AuthGate below and re-keys the data-sync effect.
  useEffect(() => {
    let unsub = () => {}
    import('./auth.js').then(({ getSession, onAuthChange }) => {
      getSession().then(s => setSession(s ?? null))
      unsub = onAuthChange(s => setSession(s ?? null))
    })
    return () => unsub()
  }, [])

  // Load the subscription whenever the signed-in user changes. Re-checks on
  // window focus too, so returning from Stripe Checkout reflects the new status.
  useEffect(() => {
    if (!user) { setSub(undefined); setSubEntitled(false); return }
    let alive = true
    const check = () => import('./subscription.js').then(async ({ getSubscription, isEntitled }) => {
      const s = await getSubscription()
      if (!alive) return
      setSub(s ?? null)
      setSubEntitled(isEntitled(s))
    })
    check()
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.removeEventListener('focus', onFocus) }
  }, [user?.id])

  // ── Clear cached data when the signed-in user changes ───────────────────────
  // Initial state is seeded from localStorage (the `load()` calls above). On a
  // shared device that cache could belong to a *different* user, so whenever the
  // account changes (including sign-out) we wipe the nri_* cache and reload, so
  // the next account starts from its own cloud data rather than someone else's.
  const prevUserIdRef = useRef(undefined)
  useEffect(() => {
    if (session === undefined) return // still resolving — don't act yet
    const uid = session?.user?.id || null
    const prev = prevUserIdRef.current
    if (prev !== undefined && prev !== uid) {
      try {
        Object.keys(localStorage).filter(k => k.startsWith('nri_')).forEach(k => localStorage.removeItem(k))
      } catch { /* ignore */ }
      // Reload so every useState initialiser re-reads a clean cache.
      window.location.reload()
      return
    }
    prevUserIdRef.current = uid
  }, [session])

  // ── Auto session timeout ───────────────────────────────────────────────────
  // Sign the user out after a period of inactivity so an abandoned or stolen
  // device doesn't stay logged into their finances.
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
  useEffect(() => {
    if (!user) return
    let timer
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        import('./auth.js').then(({ signOut }) => signOut().catch(() => {}))
      }, SESSION_TIMEOUT_MS)
    }
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [user, SESSION_TIMEOUT_MS])

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // ── sync ─────────────────────────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState('checking') // 'checking'|'synced'|'syncing'|'offline'|'unavailable'

  useEffect(() => {
    if (!user) { setSyncStatus('unavailable'); return }
    let channel = null
    setSyncStatus('checking')
    import('./supabase.js').then(({ loadFromSupabase, saveToSupabase, subscribeToChanges, SYNC_KEYS }) => {
      // Wire persist() to Supabase
      _syncPush = supabasePush

      const applyData = remoteData => {
        if (!remoteData) return
        const keys = Object.keys(remoteData)
        keys.forEach(k => _remoteKeys.add(k))
        setTimeout(() => keys.forEach(k => _remoteKeys.delete(k)), 600)

        if ('nri_setupComplete'  in remoteData) setSetupComplete(remoteData.nri_setupComplete)
        if ('nri_homeCurrency'   in remoteData) setHomeCurrency(remoteData.nri_homeCurrency)
        if ('nri_foreignCurrency' in remoteData) setForeignCurrency(remoteData.nri_foreignCurrency)
        if ('nri_primaryCurrency' in remoteData) setPrimaryCurrency(remoteData.nri_primaryCurrency)
        if ('nri_exchangeRate'   in remoteData) setExchangeRate(remoteData.nri_exchangeRate)
        if ('nri_accounts' in remoteData) setAccounts(prev => {
          const localMap = Object.fromEntries((prev || []).map(a => [a.id, a]))
          return (remoteData.nri_accounts || []).map(ra => ({
            ...localMap[ra.id], ...ra,
            creditLimit: ra.creditLimit ?? localMap[ra.id]?.creditLimit ?? 0,
            apr:         ra.apr         ?? localMap[ra.id]?.apr         ?? 0,
            dueDay:      ra.dueDay      ?? localMap[ra.id]?.dueDay      ?? 0,
            minPayment:  ra.minPayment  ?? localMap[ra.id]?.minPayment  ?? 0,
          }))
        })
        if ('nri_transactions'   in remoteData) setTransactions(remoteData.nri_transactions)
        if ('nri_bills'          in remoteData) setBills(remoteData.nri_bills)
        if ('nri_remittances'    in remoteData) setRemittances(remoteData.nri_remittances)
        if ('nri_investments'    in remoteData) setInvestments(remoteData.nri_investments)
        if ('nri_goals'          in remoteData) setGoals(remoteData.nri_goals)
        if ('nri_goalContribs'   in remoteData) setGoalContribs(remoteData.nri_goalContribs)
        if ('nri_allocations'    in remoteData) setAllocations(remoteData.nri_allocations)
        if ('nri_loans'          in remoteData) setLoans(remoteData.nri_loans)
        if ('nri_family'         in remoteData) setFamilyMembers(remoteData.nri_family)
        if ('nri_templates'      in remoteData) setTemplates(remoteData.nri_templates)
        if ('nri_wkBudgets'      in remoteData) setWkBudgets(remoteData.nri_wkBudgets)
        if ('nri_hmBudgets'      in remoteData) setHmBudgets(remoteData.nri_hmBudgets)
        if ('nri_budgetMonth'    in remoteData) setBudgetMonth(remoteData.nri_budgetMonth)
        if ('nri_savedScenarios' in remoteData) setSavedScenarios(remoteData.nri_savedScenarios)
        if ('nri_lastImport'     in remoteData) setLastImport(remoteData.nri_lastImport)
        if ('nri_smartRules'     in remoteData) setSmartRules(remoteData.nri_smartRules)
      }

      // Load this user's data from Supabase on sign-in.
      loadFromSupabase().then(remoteData => {
        if (remoteData && Object.keys(remoteData).length > 0) {
          applyData(remoteData)
        } else {
          // New account with no cloud rows yet — seed it from whatever is in
          // localStorage on this device (e.g. data created before sign-in).
          // TODO(data-migration): decide whether the first user should also
          // claim the legacy user_id='default' rows. Left intentionally manual.
          SYNC_KEYS.forEach(k => {
            try { const v = localStorage.getItem(k); if (v) saveToSupabase(k, JSON.parse(v)) } catch {}
          })
        }
        setSyncStatus('synced')
      }).catch(() => setSyncStatus('offline'))

      // Real-time updates from this user's other devices (async — RLS-scoped).
      subscribeToChanges((key, value) => {
        _remoteKeys.add(key); setTimeout(() => _remoteKeys.delete(key), 600)
        applyData({ [key]: value })
        setSyncStatus('synced')
      }).then(ch => { channel = ch })
    })

    return () => { channel?.unsubscribe(); _syncPush = null }
  }, [user?.id])

  useEffect(() => {
    // Legacy local sync kept as fallback (no-op if Supabase is active)
    import('./sync.js').then(sync => {
      if (!_syncPush) { _syncPush = sync.push; sync.init(setSyncStatus, () => {}) }
    })
    return () => {}
  // eslint-disable-next-line
  }, [])


  // ── persistence ─────────────────────────────────────────────────────────────
  useEffect(() => { persist('nri_setupComplete', setupComplete) }, [setupComplete])
  useEffect(() => { persist('nri_homeCurrency', homeCurrency) }, [homeCurrency])
  useEffect(() => { persist('nri_foreignCurrency', foreignCurrency) }, [foreignCurrency])
  useEffect(() => { persist('nri_primaryCurrency', primaryCurrency) }, [primaryCurrency])
  useEffect(() => { persist('nri_exchangeRate', exchangeRate); window._nriExchangeRate = exchangeRate }, [exchangeRate])
  useEffect(() => { persist('nri_accounts', accounts) }, [accounts])
  useEffect(() => { persist('nri_transactions', transactions) }, [transactions])
  useEffect(() => { persist('nri_bills', bills) }, [bills])
  useEffect(() => { persist('nri_remittances', remittances) }, [remittances])
  useEffect(() => { persist('nri_investments', investments) }, [investments])
  useEffect(() => { persist('nri_goals', goals) }, [goals])
  useEffect(() => { persist('nri_allocations', allocations) }, [allocations])
  useEffect(() => { persist('nri_loans', loans) }, [loans])
  useEffect(() => { persist('nri_family', familyMembers) }, [familyMembers])
  useEffect(() => { persist('nri_templates', templates) }, [templates])
  useEffect(() => { persist('nri_rates', rates) }, [rates])
  useEffect(() => { persist('nri_ratesUpdatedAt', ratesUpdatedAt) }, [ratesUpdatedAt])
  useEffect(() => { persist('nri_wkBudgets', wkBudgets) }, [wkBudgets])
  useEffect(() => { persist('nri_hmBudgets', hmBudgets) }, [hmBudgets])
  useEffect(() => { persist('nri_budgetMonth', budgetMonth) }, [budgetMonth])
  useEffect(() => { persist('nri_goalContribs', goalContribs) }, [goalContribs])
  useEffect(() => { persist('nri_savedScenarios', savedScenarios) }, [savedScenarios])
  useEffect(() => { persist('nri_lastImport', lastImport) }, [lastImport])
  useEffect(() => { persist('nri_smartRules', smartRules) }, [smartRules])

  // ── startup: fix country field + recompute balances from setupBalance + transactions ──
  useEffect(() => {
    setAccounts(prev => {
      // Fix country field
      const fixed = prev.map(acc => ({ ...acc, country: getAccountCountry(acc.currency) }))
      // Recompute live balances so they always reflect latest transactions
      return recomputeAllBalances(fixed, transactions)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── startup verification ─────────────────────────────────────────────────────
  useEffect(() => {
    console.log('=== NRI Finance App Started ===')
    console.log('Home Currency:', homeCurrency)
    console.log('Foreign Currency:', foreignCurrency)
    console.log('Setup Complete:', setupComplete)
    console.log('Accounts loaded:', accounts.length)
    console.log('Transactions loaded:', transactions.length)
    console.log('Loans loaded:', loans.length)
    console.log('Investments loaded:', investments.length)
    console.log('Goals loaded:', goals.length)
    console.log('Bills loaded:', bills.length)
    console.log('==============================')
  }, [])

  // ── live exchange rates ───────────────────────────────────────────────────────
  const fetchRates = async () => {
    setRatesFetching(true)
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD')
      const data = await res.json()
      if (data.result === 'success' && data.rates) {
        setRates(data.rates)
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        setRatesUpdatedAt(now)
        if (data.rates.INR && data.rates[foreignCurrency]) {
          const live = parseFloat((data.rates.INR / data.rates[foreignCurrency]).toFixed(4))
          setExchangeRate(live)
        }
      }
    } catch { /* keep last cached rates */ }
    setRatesFetching(false)
  }

  useEffect(() => {
    fetchRates()
    const id = setInterval(fetchRates, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (rates.INR && rates[foreignCurrency]) {
      setExchangeRate(parseFloat((rates.INR / rates[foreignCurrency]).toFixed(4)))
    }
  }, [foreignCurrency, rates])

  // ── toINR: convert any amount+currency to INR using live rates ───────────────
  const toINR = (amount, currency) => {
    if (!amount || !currency || currency === 'INR') return amount || 0
    if (rates.INR && rates[currency]) return (amount * rates.INR) / rates[currency]
    if (currency === foreignCurrency) return amount * exchangeRate
    return amount
  }

  // ── computed ─────────────────────────────────────────────────────────────────
  const totalINR = accounts.filter(a => a.currency === 'INR').reduce((s, a) => s + (a.balance || 0), 0)
  const totalForeign = accounts.filter(a => a.currency !== 'INR').reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0)
  const totalInvested = investments.reduce((s, i) => s + toINR(i.currentValue || 0, i.currency), 0)
  const totalLoanBalance = loans.reduce((s, l) => s + (l.outstanding || 0), 0)
  // Net worth = assets − liabilities, everything converted to INR. Mirror the
  // Dashboard's computation so the sidebar and dashboard always agree:
  // assets = non-credit/non-loan accounts + investments; liabilities = credit
  // card balances + loan outstanding.
  const nwAssetsINR = accounts
      .filter(a => a.type !== 'Credit Card' && a.type !== 'Loan Account')
      .reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0)
    + totalInvested
  const nwLiabINR = accounts
      .filter(a => a.type === 'Credit Card')
      .reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0)
    + totalLoanBalance
  const netWorth = nwAssetsINR - nwLiabINR
  const monthlyEMI = loans.reduce((s, l) => s + (l.emi || 0), 0)

  // ── Estelle financial context builder ────────────────────────────────────────
  const buildEstelleContext = () => {
    const aiMon = new Date().toISOString().slice(0, 7)
    const aiMonName = new Date(aiMon + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })
    const wkAccIds = new Set(accounts.filter(a => a.country === 'foreign').map(a => a.id))
    const hmAccIds = new Set(accounts.filter(a => a.country === 'home').map(a => a.id))
    const monTxs = transactions.filter(t => (t.date || '').startsWith(aiMon))
    const wkIn = monTxs.filter(t => t.type === 'income' && wkAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const wkEx = monTxs.filter(t => t.type === 'expense' && wkAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const wkRemit = monTxs.filter(t => t.type === 'remittance' && wkAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const wkSaved = wkIn - wkEx
    const hmIn = monTxs.filter(t => t.type === 'income' && hmAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const hmEx = monTxs.filter(t => t.type === 'expense' && hmAccIds.has(t.accountId)).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const hmRemitsRec = (remittances || []).filter(r => (r.date || '').startsWith(aiMon)).reduce((s, r) => s + (r.received || ((r.amount || 0) * (r.rate || 0))), 0)
    const hmTotal = hmIn + hmRemitsRec
    const hmSaved = hmTotal - hmEx
    const wkBudgetStatus = (wkBudgets || []).map(b => {
      const spent = monTxs.filter(t => t.type === 'expense' && wkAccIds.has(t.accountId) && (t.category || '').toLowerCase() === b.name.toLowerCase()).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
      return { name: b.name, limit: b.limit, spent: Math.round(spent * 100) / 100, remaining: Math.round((b.limit - spent) * 100) / 100, pct: b.limit > 0 ? Math.round(spent / b.limit * 100) : 0 }
    })
    const totalAssetsINR = accounts.filter(a => a.type !== 'Credit Card' && a.type !== 'Loan Account').reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0) + investments.reduce((s, i) => s + toINR(i.currentValue || 0, i.currency), 0)
    const totalLiabINR = accounts.filter(a => a.type === 'Credit Card').reduce((s, a) => s + toINR(a.balance || 0, a.currency), 0) + loans.reduce((s, l) => s + (l.outstanding || 0), 0)
    return {
      currentMonth: aiMonName,
      currencies: { home: homeCurrency, working: foreignCurrency, exchangeRate: `1 ${foreignCurrency} = ${exchangeRate} ${homeCurrency}` },
      workingCountry: {
        currency: foreignCurrency, income: wkIn, expenses: wkEx, remittancesSent: wkRemit, savings: wkSaved,
        savingsRate: wkIn > 0 ? (wkSaved / wkIn * 100).toFixed(1) + '%' : 'N/A',
        accounts: accounts.filter(a => a.country === 'foreign').map(a => ({ name: a.name, type: a.type, balance: `${a.balance} ${a.currency}` })),
        budgetStatus: wkBudgetStatus,
      },
      homeCountry: {
        currency: homeCurrency, directIncome: hmIn, remittancesReceived: hmRemitsRec, expenses: hmEx, savings: hmSaved,
        savingsRate: hmTotal > 0 ? (hmSaved / hmTotal * 100).toFixed(1) + '%' : 'N/A',
        accounts: accounts.filter(a => a.country === 'home').map(a => ({ name: a.name, type: a.type, balance: `${a.balance} ${a.currency}` })),
      },
      loans: loans.map(l => ({ name: l.name, outstanding: l.outstanding, emi: l.emi, rate: l.rate, remainingMonths: l.remainingMonths, currency: l.currency })),
      investments: investments.map(i => ({ name: i.name, type: i.type, currentValue: i.currentValue, currency: i.currency, expectedReturn: i.expectedReturn })),
      goals: goals.map(g => ({ name: g.name, target: g.target, saved: g.saved || 0, currency: g.currency, deadline: g.deadline, progress: g.target > 0 ? Math.round((g.saved || 0) / g.target * 100) + '%' : '0%' })),
      upcomingBills: (bills || []).filter(b => !b.paid).slice(0, 5).map(b => ({ name: b.name, amount: b.amount, currency: b.currency, dueDay: b.dueDay })),
      netWorth: { total: fmt(totalAssetsINR - totalLiabINR), assets: fmt(totalAssetsINR), liabilities: fmt(totalLiabINR) },
    }
  }

  // ── Estelle sendAI ────────────────────────────────────────────────────────────
  const sendAI = async (overrideText = null, imageFile = null) => {
    const text = overrideText ?? aiInput.trim()
    if (!text && !imageFile) return
    if (aiLoading) return

    let imageUrl = null
    let base64Data = null
    let mediaType = null

    if (imageFile) {
      imageUrl = URL.createObjectURL(imageFile)
      const buf = await imageFile.arrayBuffer()
      base64Data = btoa(String.fromCharCode(...new Uint8Array(buf)))
      mediaType = imageFile.type || 'image/jpeg'
    }

    const userMsg = { role: 'user', content: text || 'I want to buy this item. Should I based on my budget and financial goals?', imageUrl }
    const history = [...aiMessages, userMsg]
    setAiMessages(history)
    setAiInput('')
    setAiLoading(true)

    const systemPrompt = ESTELLE_SYSTEM_PROMPT.replace('{FINANCIAL_CONTEXT}', JSON.stringify(buildEstelleContext(), null, 2))

    // Build API messages — only current message can have image; history uses text only
    const apiMessages = history.map((m, idx) => {
      const isLast = idx === history.length - 1
      if (isLast && imageFile && base64Data) {
        return {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: m.content },
          ],
        }
      }
      return { role: m.role, content: m.content }
    })

    try {
      let data
      try {
        data = await anthropicMessages({
          model: 'claude-sonnet-4-5',
          max_tokens: 1536,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: apiMessages,
        })
      } catch (apiErr) {
        setAiMessages(m => [...m, { role: 'assistant', content: `⚠️ ${apiErr.message}` }])
        data = null
      }
      if (data) {
        const reply = data.content?.[0]?.text || 'Empty response from API.'
        setAiMessages(m => [...m, { role: 'assistant', content: reply }])
      }
    } catch (err) {
      setAiMessages(m => [...m, { role: 'assistant', content: `⚠️ Network error: ${err.message}` }])
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setAiLoading(false)
  }

  const sidebarImportRef = useRef(null)

  // ── Auth gate ───────────────────────────────────────────────────────────────
  // Sits in front of the setup wizard and the app. While the session is being
  // resolved we show a minimal splash to avoid flashing the sign-in screen.
  if (session === undefined) {
    return <AuthSplash />
  }
  if (session === null) {
    return <AuthScreen />
  }

  // Subscription gate: after auth, before setup/app. Off by default — only
  // active when VITE_ENABLE_BILLING is 'true', so the app isn't locked until
  // Stripe is fully set up. When enabled: show splash while loading, then the
  // paywall if the user has no active trial/subscription.
  if (import.meta.env.VITE_ENABLE_BILLING === 'true') {
    if (sub === undefined) {
      return <AuthSplash />
    }
    if (!subEntitled) {
      return <PaywallScreen sub={sub} onSignOut={() => import('./auth.js').then(({ signOut }) => signOut())} />
    }
  }

  if (!setupComplete) {
    return (
      <SetupWizardComponent
        homeCurrency={homeCurrency} setHomeCurrency={setHomeCurrency}
        foreignCurrency={foreignCurrency} setForeignCurrency={setForeignCurrency}
        primaryCurrency={primaryCurrency} setPrimaryCurrency={setPrimaryCurrency}
        exchangeRate={exchangeRate} setExchangeRate={setExchangeRate}
        onComplete={() => setSetupComplete(true)}
      />
    )

  }

  const openImport = (accountId = null, mode = 'statement') => { setImportAccountId(accountId || null); setImportMode(mode); setShowImport(true) }
  const handleImport = (txs, aiResult, _account, summary) => {
    const base = summary?.replaceNotes
      ? transactions.filter(t => !(t.notes === summary.replaceNotes && t.accountId === summary.replaceAccountId))
      : transactions
    const newTxs = [...txs, ...base]
    setTransactions(newTxs)
    setAccounts(prev => {
      const accountId = summary?.replaceAccountId || txs[0]?.accountId

      // If the statement has an opening balance, set it as the account's setupBalance
      // so that balance = openingBalance + all transaction deltas (correct carry-forward)
      let updated = prev.map(a => {
        if (a.id !== accountId) return a
        const updates = {}
        // Apply opening balance as setupBalance if statement provides it
        // Only update if: account setupBalance is 0 OR this is the earliest statement
        if (aiResult?.openingBalance != null && aiResult.openingBalance !== 0) {
          // Find the earliest transaction date in this import to anchor the setupBalance
          const earliestDate = txs.map(t => t.date || '').filter(Boolean).sort()[0]
          if (earliestDate) {
            // setupBalance = opening balance of the statement period
            // This means: balance at start of statement = openingBalance
            // So setupBalance (balance before any transactions) = openingBalance
            // but we need to subtract all existing transactions BEFORE earliestDate
            const txsBefore = newTxs.filter(t => t.accountId === accountId && (t.date || '') < earliestDate)
            const isCC = a.type === 'Credit Card'
            const deltaBefore = txsBefore.reduce((s, t) => s + calcTxDelta(t, isCC), 0)
            updates.setupBalance = aiResult.openingBalance - deltaBefore
            updates.setupDate = earliestDate
          }
        }
        // Apply credit card details if present
        if (aiResult?.creditLimit != null) updates.creditLimit = aiResult.creditLimit
        if (aiResult?.apr != null) updates.apr = aiResult.apr
        if (aiResult?.minPayment != null) updates.minPayment = aiResult.minPayment
        if (aiResult?.dueDay != null) updates.dueDay = aiResult.dueDay
        return { ...a, ...updates }
      })

      return recomputeAllBalances(updated, newTxs)
    })
    setLastImport({
      bankName: aiResult?.bankName || 'Bank',
      statementMonth: aiResult?.statementMonth || '',
      count: txs.length,
      date: today(),
    })
  }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: '⊞' },
    { id: 'accounts', label: 'Accounts', icon: '🏦' },
    { id: 'transactions', label: 'Transactions', icon: '↕' },
    { id: 'remittances', label: 'Remittances', icon: '✈️' },
    { id: 'bills', label: 'Bills', icon: '📋' },
    { id: 'investments', label: 'Investments', icon: '📈' },
    { id: 'goals', label: 'Goals', icon: '🎯' },
    { id: 'loans', label: 'Loans', icon: '🏠' },
    { id: 'budget', label: 'Budget', icon: '📊' },
    { id: 'trends', label: 'Trends', icon: '📉' },
    { id: 'tax', label: 'Tax Estimator', icon: '🧾' },
    { id: 'family', label: 'Family', icon: '👨‍👩‍👧' },
    { id: 'simulator', label: 'What-If', icon: '💡' },
    { id: 'advisor', label: 'Estelle', icon: '💅' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  const shared = { accounts, transactions, bills, remittances, investments, goals, allocations, loans, familyMembers, templates, wkBudgets, hmBudgets, budgetMonth, goalContribs, savedScenarios, exchangeRate, foreignCurrency, homeCurrency, primaryCurrency, rates, toINR, ratesFetching, ratesUpdatedAt, fetchRates }
  const setters = { setAccounts, setTransactions, setBills, setRemittances, setInvestments, setGoals, setAllocations, setLoans, setFamilyMembers, setTemplates, setWkBudgets, setHmBudgets, setBudgetMonth, setGoalContribs, setSavedScenarios }

  const exportJSON = async () => {
    // Re-auth gate: exporting ALL data is sensitive. If the session isn't
    // fresh, ask the user to confirm (and offer a re-sign-in) before dumping
    // their entire financial history to a file — blocks a walk-up attacker.
    try {
      const { assertFreshSession, signInWithGoogle } = await import('./auth.js')
      const fresh = await assertFreshSession()
      if (!fresh) {
        const ok = window.confirm('For your security, please confirm it\'s you before exporting all your data.\n\nClick OK to re-verify with Google, or Cancel to abort.')
        if (!ok) return
        await signInWithGoogle() // redirects; export can be re-tried after return
        return
      }
    } catch { /* if auth module unavailable, fall through to export */ }

    const data = { accounts, transactions, bills, remittances, investments, goals, loans, familyMembers, templates, wkBudgets, hmBudgets, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `nri-finance-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const importJSON = e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const d = JSON.parse(evt.target.result)
        const dateStr = d.exportedAt ? new Date(d.exportedAt).toLocaleString() : 'this file'
        if (!confirm(`Restore backup from ${dateStr}?\n\nThis will replace ALL current data.`)) return
        if (d.accounts)      setAccounts(d.accounts)
        if (d.transactions)  setTransactions(d.transactions)
        if (d.bills)         setBills(d.bills)
        if (d.remittances)   setRemittances(d.remittances)
        if (d.investments)   setInvestments(d.investments)
        if (d.goals)         setGoals(d.goals)
        if (d.loans)         setLoans(d.loans)
        if (d.familyMembers) setFamilyMembers(d.familyMembers)
        if (d.templates)     setTemplates(d.templates)
        if (d.wkBudgets)     setWkBudgets(d.wkBudgets)
        if (d.hmBudgets)     setHmBudgets(d.hmBudgets)
        setSetupComplete(true)
      } catch { alert('Invalid backup file. Please select a valid nri-finance-backup-*.json file.') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const navGroups = [
    { label: 'OVERVIEW',   ids: ['dashboard', 'accounts', 'transactions'] },
    { label: 'CASH FLOW',  ids: ['remittances', 'bills', 'budget'] },
    { label: 'WEALTH',     ids: ['investments', 'goals', 'loans'] },
    { label: 'INSIGHTS',   ids: ['trends', 'tax', 'simulator'] },
    { label: 'TOOLS',      ids: ['family', 'advisor', 'settings'] },
  ]

  const upcomingBillCount = bills.filter(b => {
    const d = new Date(b.dueDate), now = new Date()
    return d >= now && d <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  }).length

  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, overflow: 'hidden' }}>

      {/* ── Sidebar: hidden on mobile, icon-only on tablet, full on desktop ── */}
      <aside className="sidebar" style={{ width: 232, background: C.card, borderRight: `1px solid ${C.border}` }}>

        {/* Logo */}
        <div style={{ padding: '18px 18px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            {/* App Logo */}
            <div role="img" aria-label="NRI's & Expat's" style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 14, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 3px 14px rgba(255,136,0,0.6))' }} />
            <div className="sidebar-text">
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, letterSpacing: '-0.02em', lineHeight: 1.25 }}>NRI's & Expat's</div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.04em' }}>Personal Finance</div>
              <div style={{ fontSize: 8, color: C.gold, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2, fontStyle: 'italic' }}>Beyond Borders</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="sidebar-text" style={{ fontSize: 10, color: C.muted }}>
              {ratesFetching
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: `2px solid ${C.accent}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} /> Updating…</span>
                : ratesUpdatedAt ? `Rates: ${ratesUpdatedAt}` : 'Loading rates…'}
            </div>
            <button onClick={fetchRates} disabled={ratesFetching} title="Refresh rates"
              style={{ background: 'none', border: 'none', color: ratesFetching ? C.muted : C.accentL, cursor: 'pointer', fontSize: 14, padding: '2px 3px', borderRadius: 5, lineHeight: 1 }}>⟳</button>
          </div>
        </div>

        {/* Live Rates Ticker — collapsible so the navigation stays visible */}
        <div className="sidebar-rates" style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button onClick={() => setShowRates(v => !v)} title="Toggle live exchange rates"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 14px', color: C.muted }}>
            <span className="sidebar-text" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>💱 Live Rates</span>
            <span style={{ fontSize: 10 }}>{showRates ? '▴' : '▾'}</span>
          </button>
          {showRates && [
            { label: 'Arab Nations → ₹', currencies: ARAB_CURRENCIES },
            { label: 'South Asia & SE Asia → ₹', currencies: ['PKR', 'BDT', 'LKR', 'NPR', 'PHP'] },
            { label: 'World Markets → ₹', currencies: ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CNY', 'SGD', 'CAD', 'AUD', 'HKD'] },
          ].map(section => (
            <div key={section.label} style={{ padding: '8px 14px 8px' }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>{section.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 3, columnGap: 4 }}>
                {section.currencies.map(cur => {
                  const rate = rates.INR && rates[cur] ? (rates.INR / rates[cur]) : null
                  const rateStr = rate == null ? '—' : rate >= 1000 ? `₹${(rate/1000).toFixed(1)}k` : rate >= 1 ? `₹${rate.toFixed(2)}` : rate >= 0.01 ? `₹${rate.toFixed(3)}` : `₹${rate.toFixed(4)}`
                  return (
                    <div key={cur} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                      <span style={{ color: C.muted }}>{cur}</span>
                      <span className="num" style={{ color: rate ? C.textS : C.muted, fontWeight: 600 }}>{rateStr}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '6px 0 6px' }}>
          {navGroups.map(group => (
            <div key={group.label} style={{ marginBottom: 2 }}>
              <div className="sidebar-group-label" style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.09em', padding: '10px 18px 4px', textTransform: 'uppercase' }}>
                {group.label}
              </div>
              {group.ids.map(tid => {
                const t = tabs.find(x => x.id === tid)
                if (!t) return null
                const isActive = activeTab === tid
                return (
                  <button key={tid} className={isActive ? '' : 'nav-btn'} onClick={() => setActiveTab(tid)} style={{
                    display: 'flex', alignItems: 'center', width: '100%', padding: '8px 18px',
                    background: isActive ? `${C.accent}1c` : 'none', border: 'none',
                    borderLeft: `3px solid ${isActive ? C.accent : 'transparent'}`,
                    color: isActive ? C.accentL : C.muted,
                    fontSize: 13, cursor: 'pointer', textAlign: 'left',
                    fontWeight: isActive ? 600 : 400, letterSpacing: '-0.01em',
                  }}>
                    {tid === 'advisor'
                      ? <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', border: `1.5px solid ${isActive ? C.accentL : C.gold}`, flexShrink: 0 }}>
                          <img src="/estelle-avatar.jpg" alt="E" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }}
                            onError={e => { e.target.style.display = 'none'; e.target.parentElement.textContent = 'E' }} />
                        </div>
                      : <span style={{ fontSize: 14, opacity: isActive ? 1 : 0.55, flexShrink: 0 }}>{t.icon}</span>
                    }
                    <span className="sidebar-text" style={{ marginLeft: 9, overflow: 'hidden' }}>{t.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Export / Import Backup — compact icon row to save vertical space */}
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', gap: 6 }}>
          <input ref={sidebarImportRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importJSON} />
          <button onClick={exportJSON} title="Export Backup — download full data as JSON"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 8px', background: `${C.green}12`, border: `1px solid ${C.green}33`, borderRadius: 9, color: C.green, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💾</span>
            <span className="sidebar-text">Export</span>
          </button>
          <button onClick={() => sidebarImportRef.current?.click()} title="Import Backup — restore data from a JSON file"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 8px', background: `${C.teal}12`, border: `1px solid ${C.teal}33`, borderRadius: 9, color: C.teal, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>📂</span>
            <span className="sidebar-text">Import</span>
          </button>
        </div>

        {/* Bottom Net Worth + Sync status */}
        <div style={{ padding: '14px 18px', borderTop: `1px solid ${C.border}`, background: C.card2, flexShrink: 0 }}>
          {syncStatus !== 'unavailable' && syncStatus !== 'checking' && (
            <div className="sidebar-text" style={{ display:'flex', alignItems:'center', gap:5, marginBottom:8 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
                background: syncStatus==='synced' ? C.green : syncStatus==='syncing' ? C.yellow : C.red }} />
              <span style={{ fontSize:9, color:C.muted, fontWeight:600 }}>
                {syncStatus==='synced' ? 'Synced across devices' : syncStatus==='syncing' ? 'Syncing…' : 'Offline — saved locally'}
              </span>
            </div>
          )}
          <div className="sidebar-text" style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Net Worth</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 900, color: C.gold, letterSpacing: '-0.04em', lineHeight: 1 }}>{fmt(netWorth)}</div>
          <div className="sidebar-text" style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>All accounts + investments</div>

          {/* Account row */}
          {user && (
            <div style={{ position: 'relative', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <button onClick={() => setShowAccountMenu(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                {user.user_metadata?.avatar_url
                  ? <img src={user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, border: `1px solid ${C.borderL}` }} />
                  : <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: C.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{(user.user_metadata?.full_name || user.email || '?')[0].toUpperCase()}</div>}
                <div className="sidebar-text" style={{ overflow: 'hidden', flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textS, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.user_metadata?.full_name || 'Account'}</div>
                  <div style={{ fontSize: 9, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
                </div>
                <span className="sidebar-text" style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>{showAccountMenu ? '▴' : '▾'}</span>
              </button>

              {showAccountMenu && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 8, background: C.card3, border: `1px solid ${C.borderL}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 -8px 24px rgba(0,0,0,0.4)', zIndex: 20 }}>
                  <button onClick={() => { setShowAccountMenu(false); import('./auth.js').then(({ signOut }) => signOut().catch(() => {})) }}
                    style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.textS, cursor: 'pointer', fontSize: 12, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
                    ↩︎ Sign out
                  </button>
                  <button onClick={() => { setShowAccountMenu(false); if (window.confirm('Sign out of ALL devices? Any device currently signed into this account will be logged out.')) import('./auth.js').then(({ signOutEverywhere }) => signOutEverywhere().catch(() => {})) }}
                    style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: C.redL, cursor: 'pointer', fontSize: 12, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
                    🛡️ Sign out everywhere
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content wrapper ─────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Mobile top bar */}
        <div className="mobile-topbar">
          <button onClick={() => setDrawerOpen(true)} style={{ background: 'none', border: 'none', color: C.text, fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}>☰</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div role="img" aria-label="logo" style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 12, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 2px 10px rgba(255,136,0,0.5))' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, letterSpacing: '-0.02em', lineHeight: 1.3 }}>NRI's & Expat's</div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.04em', lineHeight: 1.3 }}>Personal Finance</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 8, fontWeight: 500, color: C.gold, letterSpacing: '0.08em', textTransform: 'uppercase', fontStyle: 'italic' }}>Beyond Borders</span>
                {syncStatus !== 'unavailable' && syncStatus !== 'checking' && (
                  <span title={syncStatus === 'synced' ? 'Synced across devices' : syncStatus === 'syncing' ? 'Syncing…' : 'Offline — changes saved locally'}
                    style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                      background: syncStatus === 'synced' ? C.green : syncStatus === 'syncing' ? C.yellow : C.red,
                      boxShadow: syncStatus === 'syncing' ? `0 0 4px ${C.yellow}` : 'none' }} />
                )}
              </div>
            </div>
          </div>
          <button onClick={() => setActiveTab('bills')} style={{ background: `${C.accent}1c`, border: `1px solid ${C.accent}33`, borderRadius: 8, color: C.accentL, fontSize: 13, cursor: 'pointer', padding: '5px 10px', fontWeight: 700 }}>
            {upcomingBillCount > 0 ? `🔔 ${upcomingBillCount}` : '📋'}
          </button>
        </div>

        {/* Page */}
        <main ref={mainScrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', width: '100%', minWidth: 0, background: C.bg, position: 'relative' }} className={`page-enter${isMobile ? ' mobile-main' : ''}`}>
          {activeTab === 'dashboard' && <Dashboard {...shared} netWorth={netWorth} totalINR={totalINR} totalForeign={totalForeign} totalLoanBalance={totalLoanBalance} monthlyEMI={monthlyEMI} setActiveTab={setActiveTab} setBudgetMonth={setBudgetMonth} onOpenImport={openImport} lastImport={lastImport} onAddSalary={() => { setInvoicePrefill({ type: 'income', category: 'Salary', description: 'Salary' }); setActiveTab('transactions') }} />}
          {activeTab === 'accounts' && <Accounts {...shared} {...setters} onOpenImport={openImport} />}
          {activeTab === 'transactions' && <Transactions {...shared} {...setters} setAccounts={setAccounts} onOpenImport={openImport} invoicePrefill={invoicePrefill} onClearInvoicePrefill={() => setInvoicePrefill(null)} />}
          {activeTab === 'remittances' && <Remittances {...shared} {...setters} />}
          {activeTab === 'bills' && <Bills {...shared} {...setters} />}
          {activeTab === 'investments' && <Investments {...shared} {...setters} />}
          {activeTab === 'goals' && <Goals {...shared} {...setters} />}
          {activeTab === 'loans' && <Loans {...shared} {...setters} />}
          {activeTab === 'budget' && <Budget transactions={transactions} accounts={accounts} wkBudgets={wkBudgets} setWkBudgets={setWkBudgets} hmBudgets={hmBudgets} setHmBudgets={setHmBudgets} budgetMonth={budgetMonth} setBudgetMonth={setBudgetMonth} foreignCurrency={foreignCurrency} homeCurrency={homeCurrency} setActiveTab={setActiveTab} remittances={remittances} loans={loans} />}
          {activeTab === 'trends' && <Trends transactions={transactions} accounts={accounts} remittances={remittances} foreignCurrency={foreignCurrency} homeCurrency={homeCurrency} toINR={toINR} />}
          {activeTab === 'tax' && <TaxEstimator transactions={transactions} investments={investments} remittances={remittances} foreignCurrency={foreignCurrency} homeCurrency={homeCurrency} exchangeRate={exchangeRate} toINR={toINR} />}
          {activeTab === 'family' && <FamilyComponent familyMembers={familyMembers} setFamilyMembers={setFamilyMembers} remittances={remittances} foreignCurrency={foreignCurrency} />}
          {activeTab === 'simulator' && <WhatIfSimulator loans={loans} transactions={transactions} accounts={accounts} savedScenarios={savedScenarios} setSavedScenarios={setSavedScenarios} />}
          {activeTab === 'advisor' && <Estelle aiMessages={aiMessages} aiInput={aiInput} setAiInput={setAiInput} aiLoading={aiLoading} sendAI={sendAI} financialContext={buildEstelleContext()} />}
          {activeTab === 'settings' && <Settings {...shared} {...setters} setSetupComplete={setSetupComplete} homeCurrency={homeCurrency} setHomeCurrency={setHomeCurrency} foreignCurrency={foreignCurrency} setForeignCurrency={setForeignCurrency} primaryCurrency={primaryCurrency} setPrimaryCurrency={setPrimaryCurrency} exchangeRate={exchangeRate} setExchangeRate={setExchangeRate} smartRules={smartRules} setSmartRules={setSmartRules} />}
        </main>

        {/* Scroll-to-top / scroll-to-bottom floating arrows (bottom-right) */}
        <ScrollArrows scrollRef={mainScrollRef} isMobile={isMobile} />
      </div>

      {/* ── Bottom Nav (mobile only, fixed) ─────────────────── */}
      <nav className="bottom-nav">
        {[
          { id: 'dashboard',    icon: '⊞',  label: 'Home' },
          { id: 'accounts',     icon: '🏦', label: 'Accounts' },
          { id: 'transactions', icon: '↕',  label: 'Txns' },
          { id: 'remittances',  icon: '✈️', label: 'Send' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', color: activeTab === tab.id ? C.accentL : C.muted,
            cursor: 'pointer', gap: 2, padding: '6px 0',
          }}>
            <span style={{ fontSize: 18 }}>{tab.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 600 }}>{tab.label}</span>
          </button>
        ))}
        <button onClick={() => setActiveTab('advisor')} style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', color: activeTab === 'advisor' ? C.accentL : C.muted, cursor: 'pointer', gap: 2, padding: '6px 0',
        }}>
          <span style={{ width: 20, height: 20, borderRadius: '50%', overflow: 'hidden', border: `1.5px solid ${activeTab === 'advisor' ? C.accentL : '#c9a961'}`, display: 'block' }}>
            <img src="/estelle-avatar.jpg" alt="Estelle" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }} />
          </span>
          <span style={{ fontSize: 9, fontWeight: 600 }}>Estelle</span>
        </button>
        <button onClick={() => setMoreOpen(true)} style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', color: C.muted, cursor: 'pointer', gap: 2, padding: '6px 0',
        }}>
          <span style={{ fontSize: 20, lineHeight: 1, fontWeight: 700 }}>···</span>
          <span style={{ fontSize: 9, fontWeight: 600 }}>More</span>
        </button>
      </nav>

      {/* ── FAB (mobile only, on add-relevant sections) ──────── */}
      {['transactions', 'accounts', 'remittances', 'bills', 'goals', 'investments', 'loans'].includes(activeTab) && (
      <div className="fab-container">
        {fabOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 109 }} onClick={() => setFabOpen(false)} />
            <div className="fab-menu">
              {[
                { label: 'Add Transaction', icon: '↕',  tab: 'transactions' },
                { label: 'New Account',     icon: '🏦', tab: 'accounts' },
                { label: 'Send Money',      icon: '✈️', tab: 'remittances' },
                { label: 'Add Bill',        icon: '📋', tab: 'bills' },
                { label: 'Add Goal',        icon: '🎯', tab: 'goals' },
              ].map(item => (
                <button key={item.label} onClick={() => { setActiveTab(item.tab); setFabOpen(false) }} style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 16px',
                  background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`,
                  color: C.textS, cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left',
                }}>
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}
        <button className="fab" onClick={() => setFabOpen(f => !f)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 400, lineHeight: 1, color: '#fff' }}>{fabOpen ? '✕' : '+'}</span>
        </button>
      </div>
      )}

      {/* ── Hamburger Drawer (mobile) ─────────────────────────── */}
      {drawerOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />
          <div className="hamburger-drawer">
            <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div role="img" aria-label="logo" style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 12, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 2px 10px rgba(255,136,0,0.5))' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.text, letterSpacing: '-0.02em', lineHeight: 1.25 }}>NRI's & Expat's</div>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.04em' }}>Personal Finance</div>
                  <div style={{ fontSize: 8, color: C.gold, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 1, fontStyle: 'italic' }}>Beyond Borders</div>
                </div>
              </div>
              <button onClick={() => setDrawerOpen(false)} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.mutedL, fontSize: 14, cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, background: C.card2 }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Net Worth</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 900, color: C.gold, letterSpacing: '-0.04em' }}>{fmt(netWorth)}</div>
            </div>
            <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {navGroups.map(group => (
                <div key={group.label}>
                  <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.09em', padding: '10px 18px 4px', textTransform: 'uppercase' }}>{group.label}</div>
                  {group.ids.map(tid => {
                    const t = tabs.find(x => x.id === tid)
                    if (!t) return null
                    const isActive = activeTab === tid
                    return (
                      <button key={tid} onClick={() => { setActiveTab(tid); setDrawerOpen(false) }} style={{
                        display: 'flex', alignItems: 'center', width: '100%', padding: '11px 18px',
                        background: isActive ? `${C.accent}1c` : 'none', border: 'none',
                        borderLeft: `3px solid ${isActive ? C.accent : 'transparent'}`,
                        color: isActive ? C.accentL : C.muted,
                        fontSize: 14, cursor: 'pointer', textAlign: 'left', fontWeight: isActive ? 600 : 400,
                      }}>
                        <span style={{ marginRight: 10, fontSize: 16 }}>{t.icon}</span>
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>
          </div>
        </>
      )}

      {/* ── More Drawer (mobile) ──────────────────────────────── */}
      {moreOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setMoreOpen(false)} />
          <div className="more-drawer">
            <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>More</span>
              <button onClick={() => setMoreOpen(false)} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.mutedL, fontSize: 14, cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '14px 12px', gap: 10 }}>
              {tabs.filter(t => !['dashboard', 'accounts', 'transactions', 'remittances'].includes(t.id)).map(t => (
                <button key={t.id} onClick={() => { setActiveTab(t.id); setMoreOpen(false) }} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 8px',
                  background: activeTab === t.id ? `${C.accent}1c` : C.card2,
                  border: `1px solid ${activeTab === t.id ? C.accent : C.border}`,
                  borderRadius: 14, color: activeTab === t.id ? C.accentL : C.textS,
                  cursor: 'pointer', gap: 7, fontWeight: 600, fontSize: 11,
                }}>
                  <span style={{ fontSize: 24 }}>{t.icon}</span>
                  <span style={{ textAlign: 'center', lineHeight: 1.3 }}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Floating Estelle Doll */}
      <FloatingEstelle onOpen={() => setActiveTab('advisor')} />

      {showImport && (
        <BankStatementImport
          accounts={accounts}
          transactions={transactions}
          loans={loans}
          setLoans={setLoans}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
          preAccountId={importAccountId}
          initialMode={importMode}
          foreignCurrency={foreignCurrency}
          smartRules={smartRules}
          setSmartRules={setSmartRules}
          setActiveTab={setActiveTab}
          onInvoiceScan={data => {
            console.log('[INVOICE] onInvoiceScan received:', data)
            // Store in localStorage as backup in case state doesn't propagate before mount
            localStorage.setItem('nri_invoicePrefill', JSON.stringify(data))
            setInvoicePrefill(data)
            setShowImport(false)
            setActiveTab('transactions')
          }}
        />
      )}
    </div>
  )
}
