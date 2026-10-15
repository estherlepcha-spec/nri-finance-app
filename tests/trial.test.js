import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInFreeTrial, trialDaysLeft, FREE_TRIAL_DAYS } from '../src/trial.js'

const DAY = 86_400_000
const created = '2026-10-01T00:00:00.000Z'
const at = (days) => Date.parse(created) + days * DAY

test('inside the window on day 0 and day 13', () => {
  assert.equal(isInFreeTrial(created, at(0)), true)
  assert.equal(isInFreeTrial(created, at(13.9)), true)
})

test('window closes at exactly 14 days', () => {
  assert.equal(isInFreeTrial(created, at(FREE_TRIAL_DAYS)), false)
  assert.equal(isInFreeTrial(created, at(60)), false)
})

test('days left counts down and floors at 0', () => {
  assert.equal(trialDaysLeft(created, at(0)), 14)
  assert.equal(trialDaysLeft(created, at(13.5)), 1)
  assert.equal(trialDaysLeft(created, at(30)), 0)
})

test('depends only on created_at — not on any local/browser state', () => {
  globalThis.localStorage = { getItem: () => String(at(100)), setItem() { throw new Error('blocked') } }
  assert.equal(isInFreeTrial(created, at(30)), false)
  delete globalThis.localStorage
})

test('missing or invalid creation date fails closed', () => {
  for (const bad of [undefined, null, '', 'garbage']) {
    assert.equal(isInFreeTrial(bad), false)
    assert.equal(trialDaysLeft(bad), 0)
  }
})
