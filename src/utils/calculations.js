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
  // Honor balanceAnchorDate exactly like recomputeAllBalances does — count only
  // transactions on/after the anchor. Without this, the monthly Opening/Closing
  // figures summed ALL transactions while the account's live "Current Balance"
  // (a.balance) counted only anchored ones, so the two disagreed (e.g. closing
  // shown far higher than the current balance).
  const anchor = acc.balanceAnchorDate
  return txs
    .filter(t => t.accountId === accountId && t.date && t.date <= date && (!anchor || t.date >= anchor))
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

// ── Recurring-bill rollover ───────────────────────────────────────────────────
// Advance a YYYY-MM-DD date string by one period of the given frequency.
// Returns a new YYYY-MM-DD string. Unknown/One-time frequencies return null
// (they don't recur). Month arithmetic clamps to end-of-month (e.g. Jan 31 →
// Feb 28) so a 31st-of-month bill doesn't skip a month.
export const advanceBillDate = (dateStr, frequency) => {
  if (!dateStr) return null
  // Work entirely in UTC so the result never shifts by a day in non-UTC zones.
  const d = new Date(dateStr + 'T00:00:00Z')
  if (isNaN(d.getTime())) return null
  const day = d.getUTCDate()
  switch (frequency) {
    case 'Weekly':    d.setUTCDate(d.getUTCDate() + 7); break
    case 'Monthly':   d.setUTCMonth(d.getUTCMonth() + 1); if (d.getUTCDate() < day) d.setUTCDate(0); break
    case 'Quarterly': d.setUTCMonth(d.getUTCMonth() + 3); if (d.getUTCDate() < day) d.setUTCDate(0); break
    case 'Yearly':    d.setUTCFullYear(d.getUTCFullYear() + 1); break
    default: return null // One-time or unknown → does not recur
  }
  return d.toISOString().slice(0, 10)
}

// Roll a paid recurring bill forward into the current period, recording each
// completed period in `history`. Returns the updated bill (or the same object
// if no change). Catches up multiple missed periods.
//
// Trigger is CALENDAR-MONTH based (month-based rollover): a paid bill rolls once
// its due-date MONTH is earlier than the current month — so a bill paid in
// August shows "paid ✓" all through August and only becomes next-period pending
// on the 1st of September. (Weekly bills roll on the day, since a month boundary
// doesn't fit them.) An UNPAID bill never rolls — it stays as the pending period.
const monthKey = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth()
export const rollForwardBill = (bill, now = new Date()) => {
  if (!bill || !bill.dueDate) return bill
  const recurs = ['Weekly', 'Monthly', 'Quarterly', 'Yearly'].includes(bill.frequency)
  if (!recurs) return bill
  const nowMonth = monthKey(now)
  const nowTime = now.getTime()
  const shouldRoll = (dueStr, freq) => {
    if (freq === 'Weekly') return Date.parse(dueStr + 'T23:59:59Z') < nowTime // day-based
    // Month-based: roll only once the due month is fully behind us.
    const due = new Date(dueStr + 'T00:00:00Z')
    return monthKey(due) < nowMonth
  }
  let b = bill
  let guard = 0 // safety cap against runaway loops
  while (b.paid && b.dueDate && shouldRoll(b.dueDate, b.frequency) && guard < 240) {
    const nextDue = advanceBillDate(b.dueDate, b.frequency)
    if (!nextDue) break
    // Record the amount actually charged this period. For a variable bill that's
    // the actualAmount entered/auto-matched; for a fixed bill it's `amount`.
    const paidAmount = (b.variable && b.actualAmount != null && b.actualAmount !== '') ? Number(b.actualAmount) : b.amount
    const entry = {
      month: (b.dueDate || '').slice(0, 7),
      dueDate: b.dueDate,
      amount: b.amount,
      ...(b.variable ? { actualAmount: paidAmount } : {}),
      paidVia: b.autoPaid ? 'auto' : 'manual',
      ...(b.autoPaidTxId ? { txId: b.autoPaidTxId } : {}),
    }
    const history = [...(b.history || []), entry]
    b = { ...b, dueDate: nextDue, paid: false, history }
    // Variable bills: clear this period's actual (so the new month prompts for a
    // fresh figure) and refresh the estimate to the running average of history.
    if (b.variable) {
      const amts = history.map(h => Number(h.actualAmount ?? h.amount)).filter(n => !isNaN(n) && n > 0)
      b.actualAmount = null
      if (amts.length) b.amount = Math.round((amts.reduce((s, n) => s + n, 0) / amts.length) * 1000) / 1000
    }
    delete b.autoPaid; delete b.autoPaidTxId; delete b.autoSuppressed
    guard++
  }
  return b
}
