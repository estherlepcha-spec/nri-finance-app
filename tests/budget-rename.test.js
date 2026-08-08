import test from 'node:test'
import assert from 'node:assert/strict'
import { renameBudgetCategory } from '../src/utils/calculations.js'

test('renames the matching category and updates its limit (Car Loan → Installment)', () => {
  const budgets = [
    { id: 'a', name: 'Deema - Ras Gym Membership EMI', limit: 75 },
    { id: 'b', name: 'Groceries', limit: 150 },
  ]
  const out = renameBudgetCategory(budgets, 'Deema - Ras Gym Membership EMI', 'Deema - Ras Gym Membership Installment', 75)
  assert.equal(out.find(b => b.id === 'a').name, 'Deema - Ras Gym Membership Installment')
  assert.equal(out.find(b => b.id === 'a').limit, 75)
  assert.equal(out.find(b => b.id === 'b').name, 'Groceries') // untouched
})

test('is case-insensitive when finding the old category', () => {
  const budgets = [{ id: 'a', name: 'AL MULLA EMI', limit: 96 }]
  const out = renameBudgetCategory(budgets, 'Al Mulla EMI', 'Al Mulla EMI', 100)
  assert.equal(out[0].limit, 100)
})

test('creates the category if the old one is not found', () => {
  const out = renameBudgetCategory([{ id: 'x', name: 'Rent', limit: 200 }], 'Missing EMI', 'New Loan EMI', 50)
  assert.equal(out.length, 2)
  assert.ok(out.some(b => b.name === 'New Loan EMI' && b.limit === 50))
})

test('does not duplicate when the new name already exists and old is missing', () => {
  const budgets = [{ id: 'x', name: 'New Loan EMI', limit: 50 }]
  const out = renameBudgetCategory(budgets, 'Missing EMI', 'New Loan EMI', 50)
  assert.equal(out.length, 1)
})
