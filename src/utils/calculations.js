// ─── Balance Calculation Helpers ──────────────────────────────────────────────
// Pure functions — take accounts/transactions arrays as params.
// setupBalance is the account balance at setupDate (immutable after creation).
// All transaction effects since setupDate are layered on top.

export const calcTxDelta = (t, isCC) => {
  const amt = Math.abs(t.amount || 0)
  // CC: income (payment) decreases balance, expense (purchase) increases balance
  // Regular: income increases balance, expense decreases balance
  return isCC ? (t.type === 'income' ? -amt : amt) : (t.type === 'income' ? amt : -amt)
}

export const getAccountBalanceAtDate = (accs, txs, accountId, date) => {
  const acc = accs.find(a => a.id === accountId)
  if (!acc) return 0
  const setupBal = acc.setupBalance ?? 0
  const isCC = acc.type === 'Credit Card'
  return txs
    .filter(t => t.accountId === accountId && t.date && t.date <= date)
    .reduce((bal, t) => bal + calcTxDelta(t, isCC), setupBal)
}

const formatYMD = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const getOpeningBalance = (accs, txs, accountId, month) => {
  const [yr, mo] = month.split('-').map(Number)
  const prevDate = formatYMD(new Date(yr, mo - 1, 0))
  return getAccountBalanceAtDate(accs, txs, accountId, prevDate)
}

export const getClosingBalance = (accs, txs, accountId, month) => {
  const [yr, mo] = month.split('-').map(Number)
  const lastDate = formatYMD(new Date(yr, mo, 0))
  return getAccountBalanceAtDate(accs, txs, accountId, lastDate)
}

// Recompute every account's live balance from setupBalance + all transactions.
// Call this after any transaction add/edit/delete.
export const recomputeAllBalances = (accs, txs) =>
  accs.map(acc => {
    if (acc.setupBalance === undefined) return acc
    const isCC = acc.type === 'Credit Card'
    const balance = txs
      .filter(t => t.accountId === acc.id)
      .reduce((bal, t) => bal + calcTxDelta(t, isCC), acc.setupBalance)
    return { ...acc, balance }
  })

export const getAccountCountry = (currency) => {
  const HOME    = ['INR', 'PKR', 'BDT', 'LKR', 'PHP', 'NPR']
  const FOREIGN = ['KWD', 'AED', 'SAR', 'QAR', 'OMR', 'BHD', 'USD', 'GBP', 'EUR']
  if (HOME.includes(currency))    return 'home'
  if (FOREIGN.includes(currency)) return 'foreign'
  return 'home'
}

export const calculateBalanceAudit = (account, txs, remittances = [], homeCurrency = 'INR') => {
  const isHome = account.country === 'home' || getAccountCountry(account.currency) === 'home'
  const isCC = account.type === 'Credit Card'
  const allTxs = txs
    .filter(t => t.accountId === account.id)
    .sort((x, y) => (x.date||'').localeCompare(y.date||''))
  const txDeltas = allTxs.map(t => calcTxDelta(t, isCC))
  const totalIncreases = txDeltas.reduce((s, delta) => s + (delta > 0 ? delta : 0), 0)
  const totalDecreases = txDeltas.reduce((s, delta) => s + (delta < 0 ? -delta : 0), 0)
  const calcBalance = (account.setupBalance || 0) + txDeltas.reduce((s, delta) => s + delta, 0)
  const increaseLabel = isCC ? 'Card charges' : 'Income Transactions'
  const decreaseLabel = isCC ? 'Card payments' : 'Expense Transactions'
  const increaseCount = txDeltas.filter(d => d > 0).length
  const decreaseCount = txDeltas.filter(d => d < 0).length

  const acctRemits = isHome
    ? remittances.filter(r => r.toCurrency === account.currency || (!r.toCurrency && account.currency === homeCurrency))
    : []
  const linkedRemits = acctRemits.filter(r => {
    const received = r.received || (r.amount || 0) * (r.rate || 0)
    const tolerance = Math.max(50, received * 0.01)
    const month = (r.date || '').slice(0, 7)
    return allTxs.some(t =>
      (t.type === 'income' || t.type === 'remittance') &&
      Math.abs(t.amount - received) <= tolerance &&
      (t.date || '').startsWith(month)
    )
  })
  const unlinkedRemits = acctRemits.filter(r => !linkedRemits.includes(r))
  const unlinkedTotal = unlinkedRemits.reduce((s, r) => s + (r.received || (r.amount || 0) * (r.rate || 0)), 0)
  const expectedBalance = calcBalance + unlinkedTotal

  return {
    allTxs,
    txDeltas,
    totalIncreases,
    totalDecreases,
    calcBalance,
    increaseLabel,
    decreaseLabel,
    increaseCount,
    decreaseCount,
    acctRemits,
    linkedRemits,
    unlinkedRemits,
    unlinkedTotal,
    expectedBalance,
  }
}

export const convertAmountToINR = (amount, currency, rates = {}, fallbackExchangeRate = 0) => {
  const value = Number(amount || 0)
  if (!currency || currency === 'INR') return value
  if (rates.INR && rates[currency]) return (value * rates.INR) / rates[currency]
  if (fallbackExchangeRate > 0 && currency !== 'INR') return value * fallbackExchangeRate
  return value
}
