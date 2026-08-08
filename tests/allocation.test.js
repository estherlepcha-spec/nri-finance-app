import test from 'node:test'
import assert from 'node:assert/strict'
import { amountToPct, fixedCommitmentSummary } from '../src/utils/calculations.js'

test('amountToPct converts an amount to a 1-decimal % of income', () => {
  assert.equal(amountToPct(250, 1000), 25)
  assert.equal(amountToPct(333, 1000), 33.3)
  assert.equal(amountToPct(0, 1000), 0)
})

test('amountToPct returns 0 when income is missing/zero (no divide-by-zero)', () => {
  assert.equal(amountToPct(250, 0), 0)
  assert.equal(amountToPct(250, null), 0)
})

test('fixedCommitmentSummary: healthy — commitments below income', () => {
  const s = fixedCommitmentSummary(600, 1000)
  assert.equal(s.fixedPct, 60)
  assert.equal(s.freeAmount, 400)
  assert.equal(s.freePct, 40)
  assert.equal(s.overBy, 0)
})

test('fixedCommitmentSummary: over-committed — rent+EMIs+bills exceed income', () => {
  // The exact "allocation over 100%" case the user hit.
  const s = fixedCommitmentSummary(1200, 1000)
  assert.equal(s.fixedPct, 120)
  assert.equal(s.overBy, 200) // 200 short — must cut fixed costs or earn more
  assert.equal(s.freeAmount, -200)
})

test('fixedCommitmentSummary: no income → all zeros (no crash)', () => {
  const s = fixedCommitmentSummary(500, 0)
  assert.deepEqual(s, { fixedPct: 0, freePct: 0, freeAmount: 0, overBy: 0 })
})
