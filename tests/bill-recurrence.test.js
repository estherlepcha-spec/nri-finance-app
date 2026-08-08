import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceBillDate, rollForwardBill } from '../src/utils/calculations.js'

test('advanceBillDate advances by each frequency', () => {
  assert.equal(advanceBillDate('2026-07-15', 'Weekly'), '2026-07-22')
  assert.equal(advanceBillDate('2026-07-15', 'Monthly'), '2026-08-15')
  assert.equal(advanceBillDate('2026-07-15', 'Quarterly'), '2026-10-15')
  assert.equal(advanceBillDate('2026-07-15', 'Yearly'), '2027-07-15')
})

test('advanceBillDate clamps month-end (Jan 31 -> Feb 28, no skipped month)', () => {
  assert.equal(advanceBillDate('2026-01-31', 'Monthly'), '2026-02-28')
})

test('advanceBillDate returns null for One-time / unknown', () => {
  assert.equal(advanceBillDate('2026-07-15', 'One-time'), null)
  assert.equal(advanceBillDate('2026-07-15', 'Whatever'), null)
  assert.equal(advanceBillDate('', 'Monthly'), null)
})

test('rollForwardBill: a PAID past monthly bill rolls to the next month, unpaid', () => {
  const bill = { id: 'b1', name: 'Utilities', frequency: 'Monthly', dueDate: '2026-07-15', amount: 50, paid: true, autoPaid: true, autoPaidTxId: 'tx1' }
  const now = new Date('2026-08-10T00:00:00')
  const rolled = rollForwardBill(bill, now)
  assert.equal(rolled.dueDate, '2026-08-15')
  assert.equal(rolled.paid, false)
  assert.equal(rolled.autoPaid, undefined)
  assert.equal(rolled.history.length, 1)
  assert.equal(rolled.history[0].month, '2026-07')
  assert.equal(rolled.history[0].paidVia, 'auto')
})

test('rollForwardBill: an UNPAID past bill does NOT roll (stays the pending period)', () => {
  const bill = { id: 'b2', name: 'Rent', frequency: 'Monthly', dueDate: '2026-07-15', amount: 900, paid: false }
  const rolled = rollForwardBill(bill, new Date('2026-08-10T00:00:00'))
  assert.equal(rolled, bill) // unchanged reference
})

test('rollForwardBill: a paid bill rolls to the NEXT (oldest unpaid) period only', () => {
  // A paid May bill rolls to June and stops — June is now the pending period.
  // It only advances further once June is also marked paid (we can't assume the
  // intervening months were paid). This surfaces the oldest unpaid period.
  const bill = { id: 'b3', name: 'Internet', frequency: 'Monthly', dueDate: '2026-05-01', amount: 30, paid: true }
  const rolled = rollForwardBill(bill, new Date('2026-08-10T00:00:00'))
  assert.equal(rolled.dueDate, '2026-06-01')
  assert.equal(rolled.paid, false)
  assert.deepEqual(rolled.history.map(h => h.month), ['2026-05'])
})

test('rollForwardBill: a paid bill whose due date is still in the future does NOT roll', () => {
  const bill = { id: 'b4', name: 'Insurance', frequency: 'Yearly', dueDate: '2026-12-01', amount: 500, paid: true }
  const rolled = rollForwardBill(bill, new Date('2026-08-10T00:00:00'))
  assert.equal(rolled, bill)
})

test('rollForwardBill: non-recurring (One-time) paid bill never rolls', () => {
  const bill = { id: 'b5', name: 'Deposit', frequency: 'One-time', dueDate: '2026-06-01', amount: 200, paid: true }
  const rolled = rollForwardBill(bill, new Date('2026-08-10T00:00:00'))
  assert.equal(rolled, bill)
})
