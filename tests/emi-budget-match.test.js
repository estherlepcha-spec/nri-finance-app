import test from 'node:test'
import assert from 'node:assert/strict'
import { emiTxMatchesLoan } from '../src/utils/calculations.js'

const alMulla = { id: 'L1', name: 'Retail Musawama - Al Mulla Finance', lender: 'Al Mulla', emi: 96, currency: 'KWD' }
const deema   = { id: 'L2', name: 'Installment Plan - deema', lender: '', emi: 75, currency: 'KWD' }

test('generic "Loan EMI" tx attaches to the loan whose EMI matches the amount', () => {
  const tx = { type: 'expense', category: 'Loan EMI', description: 'Payment', amount: 96, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, alMulla, true), true)
  // Same tx must NOT count toward the KD 75 loan (avoids cross-counting).
  assert.equal(emiTxMatchesLoan(tx, deema, true), false)
})

test('loan name in the description matches regardless of amount', () => {
  const tx = { type: 'expense', category: 'Transfer', description: 'AL MULLA FINANCE installment', amount: 100, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, alMulla, true), true)
})

test('explicit matchedLoanId always matches', () => {
  const tx = { type: 'expense', category: 'Other', description: 'x', amount: 5, currency: 'KWD', matchedLoanId: 'L2' }
  assert.equal(emiTxMatchesLoan(tx, deema, true), true)
})

test('generic EMI tx from a DIFFERENT country does not match', () => {
  const tx = { type: 'expense', category: 'Loan EMI', description: 'Payment', amount: 96, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, alMulla, false), false)
})

test('income transactions never match an EMI budget', () => {
  const tx = { type: 'income', category: 'Loan EMI', description: 'x', amount: 96, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, alMulla, true), false)
})

test('amount outside 5% of the loan EMI does not match on category alone', () => {
  const tx = { type: 'expense', category: 'Loan EMI', description: 'Payment', amount: 50, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, alMulla, true), false)
})

// Interest-free installment purchases match the "Installment/EMI Purchase"
// category, and must NOT be matched by a "Loan EMI" tx (they aren't loans).
const gym = { id: 'L3', name: 'Deema - Ras Gym Membership', lender: '', emi: 75, currency: 'KWD', type: 'Installment/Appliance' }

test('installment purchase matches an Installment/EMI Purchase tx by amount', () => {
  const tx = { type: 'expense', category: 'Installment/EMI Purchase', description: 'Deema installment', amount: 75, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, gym, true), true)
})

test('a "Loan EMI" tx does NOT match an installment purchase (not a loan)', () => {
  const tx = { type: 'expense', category: 'Loan EMI', description: 'Payment', amount: 75, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, gym, true), false)
})

test('a "Loan EMI" car-loan tx does NOT match on the installment category', () => {
  // Al Mulla is a formal loan; an Installment/EMI Purchase tx must not credit it.
  const tx = { type: 'expense', category: 'Installment/EMI Purchase', description: 'x', amount: 96, currency: 'KWD' }
  assert.equal(emiTxMatchesLoan(tx, alMulla, true), false)
})

test('a single EMI tx matching by BOTH name and amount is counted once (no double-count)', () => {
  // Reproduces the "KD 192 / 200%" bug: one KD 96 EMI matched by name AND amount
  // must total KD 96, not KD 192. Mirror the budget dedupe-by-id filter.
  const txs = [{ id: 't1', type: 'expense', category: 'Loan EMI', description: 'AL MULLA FINANCE EMI', amount: 96, currency: 'KWD' }]
  const seen = new Set()
  const matched = txs.filter(t => {
    if (!emiTxMatchesLoan(t, alMulla, true)) return false
    if (seen.has(t.id)) return false
    seen.add(t.id); return true
  })
  assert.equal(matched.length, 1)
  assert.equal(matched.reduce((s, t) => s + Math.abs(t.amount), 0), 96)
})
