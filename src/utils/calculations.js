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

export const getOpeningBalance = (accs, txs, accountId, month) => {
  const [yr, mo] = month.split('-').map(Number)
  const prevDate = new Date(yr, mo - 1, 0).toISOString().split('T')[0]
  return getAccountBalanceAtDate(accs, txs, accountId, prevDate)
}

export const getClosingBalance = (accs, txs, accountId, month) => {
  const [yr, mo] = month.split('-').map(Number)
  const lastDate = new Date(yr, mo, 0).toISOString().split('T')[0]
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
