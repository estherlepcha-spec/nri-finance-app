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
