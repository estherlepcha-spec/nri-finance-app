import test from 'node:test'
import assert from 'node:assert/strict'
import { lastFourOnly, maskFinancialIdentifiers, sanitizeAccounts } from '../src/services/aiPrivacy.js'
import {
  getSpecialistContext,
  getSpecialistInstruction,
  routeEstelleSpecialist,
} from '../src/services/estelleSpecialists.js'

test('account identifiers are stored as last four digits only', () => {
  assert.equal(lastFourOnly('4111 1111 1111 1234'), '1234')
  assert.equal(lastFourOnly('KW12 ABCD 1234 5678 9012 3456'), '3456')
  assert.equal(lastFourOnly(''), null)
})

test('financial identifiers in text are masked while ordinary dates remain readable', () => {
  const masked = maskFinancialIdentifiers(
    'Card 4111 1111 1111 1234, account 1234567890, IBAN KW12ABCD12345678901234567890, date 2026-04-08.',
  )
  assert.equal(masked, 'Card •••• 1234, account •••• 7890, IBAN •••• 7890, date 2026-04-08.')
})

test('account sanitation returns new account objects with no full account number', () => {
  const accounts = [{ id: 'a', accountNumber: '123456789012' }]
  const sanitized = sanitizeAccounts(accounts)
  assert.deepEqual(sanitized, [{ id: 'a', accountNumber: '9012' }])
  assert.notEqual(sanitized, accounts)
  assert.notEqual(sanitized[0], accounts[0])
})

test('automatic routing selects domain specialists and falls back to general', () => {
  assert.equal(routeEstelleSpecialist('How is my budget this month?'), 'budget')
  assert.equal(routeEstelleSpecialist('Am I on track with my goals?'), 'goals')
  assert.equal(routeEstelleSpecialist('How much interest is left on my EMI?'), 'loans')
  assert.equal(routeEstelleSpecialist('Summarize my investment portfolio'), 'investments')
  assert.equal(routeEstelleSpecialist('How much did I remit and what were the fees?'), 'remittances')
  assert.equal(routeEstelleSpecialist('How am I doing this month?'), 'budget')
  assert.equal(routeEstelleSpecialist('Hello Estelle'), 'general')
  assert.equal(routeEstelleSpecialist('Should I buy this?', 'auto', true), 'general')
})

test('manual specialist choice takes precedence and receives only its scoped context', () => {
  const fullContext = {
    currentMonth: 'October 2026',
    currencies: { home: 'INR', working: 'KWD' },
    workingCountry: { income: 1000, budgetStatus: [], remittancesSent: 200, accounts: [{ accountNumber: '1234567890' }] },
    homeCountry: { remittancesReceived: 200, accounts: [{ accountNumber: '0987654321' }] },
    upcomingBills: [{ name: 'Rent', amount: 300 }],
    goals: [{ name: 'Emergency fund' }],
    loans: [{ name: 'Home loan' }],
    investments: [{ name: 'Fund' }],
  }
  assert.equal(routeEstelleSpecialist('Tell me about my goal', 'loans'), 'loans')
  assert.deepEqual(getSpecialistContext(fullContext, 'loans'), {
    currencies: fullContext.currencies,
    loans: fullContext.loans,
  })
  assert.deepEqual(getSpecialistContext(fullContext, 'budget'), {
    currentMonth: fullContext.currentMonth,
    currencies: fullContext.currencies,
    workingCountry: { income: 1000, budgetStatus: [], remittancesSent: 200 },
    homeCountry: { remittancesReceived: 200 },
    upcomingBills: fullContext.upcomingBills,
  })
  assert.deepEqual(getSpecialistContext(fullContext, 'remittances'), {
    currentMonth: fullContext.currentMonth,
    currencies: fullContext.currencies,
    remittances: { sent: 200, received: 200 },
  })
  assert.match(getSpecialistInstruction('loans'), /read-only|illustrative|lender quotes/i)
})
