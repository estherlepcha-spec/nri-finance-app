import test from 'node:test'
import assert from 'node:assert/strict'
import { calcTxDelta, convertAmountToINR, recomputeAllBalances, getOpeningBalance, getClosingBalance, calculateBalanceAudit } from '../src/utils/calculations.js'

test('converts foreign-currency loan balances to INR using exchange rates', () => {
  const result = convertAmountToINR(1000, 'KWD', { INR: 100, KWD: 3.3 })
  assert.ok(Math.abs(result - 30303.030303030304) < 1e-9)
})

test('uses the fallback exchange rate when direct rates are unavailable', () => {
  const result = convertAmountToINR(250, 'AED', {}, 85)
  assert.equal(result, 21250)
})

test('computes credit card transaction deltas correctly', () => {
  assert.equal(calcTxDelta({ amount: 100, type: 'expense' }, true), 100)
  assert.equal(calcTxDelta({ amount: 100, type: 'income' }, true), -100)
})

test('recomputes account balances from setup balance and transactions', () => {
  const accounts = [
    { id: 'acc1', setupBalance: 100, type: 'Savings' },
    { id: 'acc2', setupBalance: 200, type: 'Credit Card' },
  ]
  const txs = [
    { accountId: 'acc1', type: 'income', amount: 50 },
    { accountId: 'acc2', type: 'expense', amount: 80 },
    { accountId: 'acc2', type: 'income', amount: 30 },
  ]
  const result = recomputeAllBalances(accounts, txs)
  assert.equal(result.find(a => a.id === 'acc1').balance, 150)
  assert.equal(result.find(a => a.id === 'acc2').balance, 250)
})

test('gets opening and closing balances by month boundary', () => {
  const accounts = [{ id: 'acc1', setupBalance: 100, type: 'Savings' }]
  const txs = [
    { accountId: 'acc1', type: 'income', amount: 25, date: '2024-05-31' },
    { accountId: 'acc1', type: 'expense', amount: 10, date: '2024-06-01' },
  ]
  assert.equal(getOpeningBalance(accounts, txs, 'acc1', '2024-06'), 125)
  assert.equal(getClosingBalance(accounts, txs, 'acc1', '2024-06'), 115)
})

test('calculates audit totals for a home account including unlinked remittances', () => {
  const account = { id: 'acc1', setupBalance: 100, type: 'Savings', currency: 'INR', country: 'home' }
  const txs = [
    { accountId: 'acc1', type: 'income', amount: 50, date: '2024-06-05' },
    { accountId: 'acc1', type: 'expense', amount: 20, date: '2024-06-10' },
  ]
  const remittances = [
    { toCurrency: 'INR', amount: 160, rate: 1, date: '2024-06-15' },
  ]
  const audit = calculateBalanceAudit(account, txs, remittances, 'INR')
  assert.equal(audit.calcBalance, 130)
  assert.equal(audit.unlinkedTotal, 160)
  assert.equal(audit.expectedBalance, 290)
  assert.equal(audit.increaseLabel, 'Income Transactions')
  assert.equal(audit.decreaseLabel, 'Expense Transactions')
})

test('calculates audit totals for a credit card account', () => {
  const account = { id: 'acc2', setupBalance: 300, type: 'Credit Card', currency: 'INR', country: 'home' }
  const txs = [
    { accountId: 'acc2', type: 'expense', amount: 120, date: '2024-06-05' },
    { accountId: 'acc2', type: 'income', amount: 50, date: '2024-06-10' },
  ]
  const audit = calculateBalanceAudit(account, txs, [], 'INR')
  assert.equal(audit.calcBalance, 370)
  assert.equal(audit.increaseLabel, 'Card charges')
  assert.equal(audit.decreaseLabel, 'Card payments')
  assert.equal(audit.totalIncreases, 120)
  assert.equal(audit.totalDecreases, 50)
})
