// ─── Balance Calculation Helpers ──────────────────────────────────────────────
// Pure functions — take accounts/transactions arrays as params.
// setupBalance is the account balance at setupDate (immutable after creation).
// All transaction effects since setupDate are layered on top.

export const calcTxDelta = (t, isCC) => {
  const amt = Math.abs(t.amount || 0)
  // CC: income (payment) decreases balance, expense (purchase) increases balance
  if (isCC) return t.type === 'income' ? -amt : amt
  // Regular account:
  //  - income increases balance
  //  - a TRANSFER has a direction: money can move IN or OUT. transferDir === 1
  //    means inflow (adds), -1 means outflow (subtracts). This matters because an
  //    incoming credit (e.g. "Transfer from …", "WAMD Payment From …") is demoted
  //    from income to transfer for reporting, but it still ADDED money — treating
  //    every transfer as an outflow flipped such credits negative and corrupted
  //    the balance. Unmarked transfers default to outflow (-1) as before.
  if (t.type === 'transfer') return (t.transferDir === 1 ? amt : -amt)
  //  - everything else (expense) decreases balance
  return t.type === 'income' ? amt : -amt
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
//
// A missing setupBalance is seeded from the account's existing balance (its
// manually-entered starting point), NOT skipped and NOT defaulted to 0.
//
// Previously `setupBalance === undefined` short-circuited and returned the
// account untouched — so legacy accounts created before setupBalance existed
// had their card balance FROZEN: transactions imported fine but the balance
// never recomputed. Defaulting the seed to 0 instead would WIPE a legacy
// account's manually-set balance (e.g. 500 with no transactions → 0). Seeding
// from the current balance is correct on both counts: with no transactions the
// balance is unchanged; with transactions it builds from that baseline. The
// seeded setupBalance is persisted so the account is migrated going forward.
// balanceAnchorDate (optional): when set, the balance is setupBalance plus only
// the transactions dated ON OR AFTER it — so an older statement uploaded after a
// newer one adds history without pulling the current balance off the newer
// statement's opening balance ("latest statement wins"). When absent (all
// existing accounts), every transaction is summed exactly as before, so this is
// backward-compatible and only affects accounts an import has explicitly anchored.
export const recomputeAllBalances = (accs, txs) =>
  accs.map(acc => {
    const setupBalance = acc.setupBalance ?? (acc.balance ?? 0)
    const isCC = acc.type === 'Credit Card'
    const anchor = acc.balanceAnchorDate
    const balance = txs
      .filter(t => t.accountId === acc.id && (!anchor || (t.date || '') >= anchor))
      .reduce((bal, t) => bal + calcTxDelta(t, isCC), setupBalance)
    return { ...acc, setupBalance, balance }
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
