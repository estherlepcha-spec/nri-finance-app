export const ESTELLE_SPECIALISTS = [
  { id: 'auto', label: 'Auto (recommended)' },
  { id: 'general', label: 'General Estelle' },
  { id: 'budget', label: 'Budget & cash flow' },
  { id: 'goals', label: 'Goals & savings' },
  { id: 'loans', label: 'Loans & debt' },
  { id: 'investments', label: 'Investments' },
  { id: 'remittances', label: 'Remittances' },
]

const SPECIALIST_INSTRUCTIONS = {
  general: 'You are handling this as General Estelle. Answer the user’s question using only the supplied financial context.',
  budget: 'Act as Estelle’s budget and cash-flow specialist. Focus on this month’s income, expenses, savings, and budget status. Do not infer transaction details that are not provided.',
  goals: 'Act as Estelle’s goals and savings specialist. Focus on goal progress, target amounts, deadlines, and realistic savings pace. State when contribution history is not available.',
  loans: 'Act as Estelle’s loans and debt specialist. Focus on outstanding balances, EMIs, rates, and repayment scenarios. Label estimates as illustrative, not lender quotes.',
  investments: 'Act as Estelle’s investment-summary specialist. Explain the supplied holdings and values at a high level. Do not promise returns or recommend specific securities.',
  remittances: 'Act as Estelle’s remittance specialist. Focus on amounts sent/received, fees, and the supplied exchange rate. Do not invent provider quotes or live rates.',
}

const SPECIALIST_CONTEXT_KEYS = {
  goals: ['currentMonth', 'currencies', 'goals', 'netWorth'],
  loans: ['currencies', 'loans', 'netWorth'],
  investments: ['currencies', 'investments', 'netWorth'],
}

export function routeEstelleSpecialist(text, requested = 'auto', hasImage = false) {
  if (requested && requested !== 'auto' && SPECIALIST_INSTRUCTIONS[requested]) return requested
  if (hasImage) return 'general'

  const message = String(text || '').toLowerCase()
  if (/\b(remit|remittance|transfer(?:red)? home|exchange rate|fx rate|transfer fee)\b/.test(message)) return 'remittances'
  if (/\b(goal|savings goal|save(?:d|ing)? for|on track|target amount)\b/.test(message)) return 'goals'
  if (/\b(loan|emi|mortgage|debt|payoff|pay off|interest rate)\b/.test(message)) return 'loans'
  if (/\b(invest(?:ment|ments|ing)?|portfolio|mutual fund|stocks?|fixed deposit|fd\b|gold holdings)\b/.test(message)) return 'investments'
  if (/\b(budget|cash ?flow|spend(?:ing)?|expenses?|income|where is my money going|savings rate|how am i doing|this month|financial health)\b/.test(message)) return 'budget'
  return 'general'
}

export function getSpecialistContext(context, specialist) {
  if (!context) return {}
  if (specialist === 'budget') {
    const working = context.workingCountry || {}
    const home = context.homeCountry || {}
    return {
      currentMonth: context.currentMonth,
      currencies: context.currencies,
      workingCountry: pick(working, ['currency', 'income', 'expenses', 'remittancesSent', 'savings', 'savingsRate', 'budgetStatus']),
      homeCountry: pick(home, ['currency', 'directIncome', 'remittancesReceived', 'expenses', 'savings', 'savingsRate']),
      upcomingBills: context.upcomingBills,
    }
  }
  if (specialist === 'remittances') {
    return {
      currentMonth: context.currentMonth,
      currencies: context.currencies,
      remittances: {
        sent: context.workingCountry?.remittancesSent,
        received: context.homeCountry?.remittancesReceived,
      },
    }
  }
  if (!SPECIALIST_CONTEXT_KEYS[specialist]) return context
  return Object.fromEntries(
    SPECIALIST_CONTEXT_KEYS[specialist]
      .filter(key => Object.hasOwn(context, key))
      .map(key => [key, context[key]]),
  )
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]))
}

export function getSpecialistInstruction(specialist) {
  return SPECIALIST_INSTRUCTIONS[specialist] || SPECIALIST_INSTRUCTIONS.general
}
