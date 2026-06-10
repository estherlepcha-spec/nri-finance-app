// ─── App Theme Colors ─────────────────────────────────────────────────────────
export const C = {
  bg: '#060e1a', card: '#0c1929', card2: '#112236', card3: '#162b43',
  border: '#1a3050', borderL: '#254565',
  accent: '#3b82f6', accentL: '#60a5fa', accentD: '#2563eb',
  green: '#10b981', greenL: '#34d399',
  red: '#f43f5e', redL: '#fb7185',
  yellow: '#f59e0b', yellowL: '#fcd34d',
  purple: '#8b5cf6', purpleL: '#a78bfa',
  teal: '#06b6d4', tealL: '#22d3ee',
  gold: '#d4a84b', goldL: '#e8c86e',
  text: '#f0f6ff', textS: '#c4d4e8',
  muted: '#4a6080', mutedL: '#6a80a0',
}

// ─── Currencies ───────────────────────────────────────────────────────────────
export const HOME_CURRENCIES    = ['INR', 'PKR', 'BDT', 'LKR', 'PHP', 'NPR']
export const FOREIGN_CURRENCIES = ['KWD', 'AED', 'SAR', 'QAR', 'OMR', 'BHD', 'USD', 'GBP', 'EUR']
export const GCC_CURRENCIES     = ['AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR']
export const ARAB_CURRENCIES    = ['AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'EGP', 'IQD', 'LBP', 'LYD', 'MAD', 'TND', 'DZD', 'YER', 'MRU', 'DJF']

export const CURRENCY_SYMBOLS = {
  KWD: 'KD', BHD: 'BD', OMR: 'OMR', QAR: 'QR', SAR: 'SR',
  AED: 'AED', USD: '$', EUR: '€', GBP: '£', INR: '₹',
}

export const CURRENCY_FULL_NAMES = {
  INR: 'Indian Rupee',
  AED: 'UAE Dirham', SAR: 'Saudi Riyal', KWD: 'Kuwaiti Dinar', QAR: 'Qatari Riyal', BHD: 'Bahraini Dinar', OMR: 'Omani Rial',
  JOD: 'Jordanian Dinar', EGP: 'Egyptian Pound', IQD: 'Iraqi Dinar', LBP: 'Lebanese Pound',
  LYD: 'Libyan Dinar', MAD: 'Moroccan Dirham', TND: 'Tunisian Dinar', DZD: 'Algerian Dinar',
  YER: 'Yemeni Rial', MRU: 'Mauritanian Ouguiya', DJF: 'Djiboutian Franc',
  USD: 'US Dollar', CAD: 'Canadian Dollar', MXN: 'Mexican Peso', BRL: 'Brazilian Real', ARS: 'Argentine Peso', CLP: 'Chilean Peso',
  EUR: 'Euro', GBP: 'British Pound', CHF: 'Swiss Franc', NOK: 'Norwegian Krone', SEK: 'Swedish Krona',
  DKK: 'Danish Krone', PLN: 'Polish Zloty', CZK: 'Czech Koruna', HUF: 'Hungarian Forint', RUB: 'Russian Ruble',
  JPY: 'Japanese Yen', CNY: 'Chinese Yuan', HKD: 'Hong Kong Dollar', KRW: 'South Korean Won',
  SGD: 'Singapore Dollar', AUD: 'Australian Dollar', NZD: 'New Zealand Dollar', TWD: 'Taiwan Dollar',
  THB: 'Thai Baht', IDR: 'Indonesian Rupiah', PHP: 'Philippine Peso', MYR: 'Malaysian Ringgit', VND: 'Vietnamese Dong',
  PKR: 'Pakistani Rupee', BDT: 'Bangladeshi Taka', LKR: 'Sri Lankan Rupee', NPR: 'Nepalese Rupee',
  ILS: 'Israeli Shekel', TRY: 'Turkish Lira',
  ZAR: 'South African Rand', NGN: 'Nigerian Naira', KES: 'Kenyan Shilling', GHS: 'Ghanaian Cedi', ETB: 'Ethiopian Birr',
}

export const CURRENCY_GROUPS = {
  'Indian Rupee': ['INR'],
  'GCC — Gulf States': ['AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR'],
  'Arab Nations': ['JOD', 'EGP', 'IQD', 'LBP', 'LYD', 'MAD', 'TND', 'DZD', 'YER', 'MRU', 'DJF'],
  'Americas': ['USD', 'CAD', 'MXN', 'BRL', 'ARS', 'CLP'],
  'Europe': ['EUR', 'GBP', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'RUB'],
  'Asia-Pacific': ['JPY', 'CNY', 'HKD', 'KRW', 'SGD', 'AUD', 'NZD', 'TWD', 'THB', 'IDR', 'PHP', 'MYR', 'VND'],
  'South Asia': ['PKR', 'BDT', 'LKR', 'NPR'],
  'Middle East': ['ILS', 'TRY'],
  'Africa': ['ZAR', 'NGN', 'KES', 'GHS', 'ETB'],
}
export const CURRENCIES = Object.values(CURRENCY_GROUPS).flat()

export const CURRENCY_ISO2 = {
  KWD:'kw', INR:'in', AED:'ae', SAR:'sa', QAR:'qa', OMR:'om', BHD:'bh',
  USD:'us', GBP:'gb', EUR:'eu', SGD:'sg', AUD:'au', CAD:'ca',
  JPY:'jp', CNY:'cn', THB:'th', MYR:'my', PHP:'ph', IDR:'id', HKD:'hk',
  PKR:'pk', BDT:'bd', LKR:'lk', NPR:'np',
  JOD:'jo', EGP:'eg', IQD:'iq', LYD:'ly', MAD:'ma', TND:'tn', IRR:'ir',
  CHF:'ch', NOK:'no', SEK:'se', DKK:'dk', PLN:'pl', CZK:'cz',
  HUF:'hu', RUB:'ru', KRW:'kr', TWD:'tw', VND:'vn',
  ZAR:'za', NGN:'ng', KES:'ke', GHS:'gh', ETB:'et',
  MXN:'mx', BRL:'br', ARS:'ar', CLP:'cl', ILS:'il', TRY:'tr',
}

// ─── Account Types ────────────────────────────────────────────────────────────
export const HOME_ACCOUNT_TYPES  = ['NRE', 'NRO', 'FCNR', 'Savings Account', 'Current Account', 'Credit Card', 'Fixed Deposit', 'Loan Account', 'Investment Account']
export const WORK_ACCOUNT_TYPES  = ['Savings Account', 'Current Account', 'Salary Account', 'Credit Card', 'Loan Account', 'Fixed Deposit', 'Investment Account']
export const ACCOUNT_TYPES = [...new Set([...HOME_ACCOUNT_TYPES, ...WORK_ACCOUNT_TYPES])]

// ─── Transaction Categories ───────────────────────────────────────────────────
export const TX_CATEGORY_GROUPS = {
  'Daily Living':      ['Rent', 'Groceries', 'Dining', 'Transport', 'Utilities', 'Household'],
  'Family & Personal': ['Healthcare', 'Education', 'Personal Care', 'Shopping', 'Entertainment'],
  'Financial':         ['Remittance', 'Loan EMI', 'Credit Card Bill', 'Insurance', 'Investment', 'Savings'],
  'Work & Travel':     ['Travel', 'Subscription', 'Fees & Charges'],
  'Income':            ['Salary', 'Other Income', 'Rental Income', 'Dividends'],
  'Other':             ['ATM Withdrawal', 'Transfer', 'Other'],
}
export const TX_CATS = Object.values(TX_CATEGORY_GROUPS).flat()

export const CAT_COLORS = {
  Groceries: '#22c55e', Dining: '#f97316', Transport: '#3b82f6', Utilities: '#eab308',
  Household: '#d97706', Healthcare: '#ef4444', Education: '#6366f1', 'Personal Care': '#ec4899',
  Shopping: '#a855f7', Entertainment: '#8b5cf6', Remittance: '#14b8a6', 'Loan EMI': '#f97316',
  'Credit Card Bill': '#ef4444', Insurance: '#3b82f6', Investment: '#14b8a6', Savings: '#c9a961',
  Travel: '#0ea5e9', Subscription: '#8b5cf6', 'Fees & Charges': '#475569',
  Salary: '#c9a961', 'Other Income': '#22c55e', 'Rental Income': '#14b8a6', Dividends: '#c9a961',
  'ATM Withdrawal': '#94a3b8', Transfer: '#64748b', Other: '#64748b',
}

// ─── Investment & Goal Types ──────────────────────────────────────────────────
export const INVESTMENT_TYPES = ['Mutual Fund', 'Fixed Deposit', 'Stocks', 'PPF', 'NPS', 'Real Estate', 'Gold', 'Bonds', 'ETF']
export const GOAL_TYPES       = ['Home Down Payment', 'Children Education', 'Emergency Fund', 'Car Purchase', 'Wedding', 'Retirement', 'Travel/Holiday', 'Business Setup', 'Other']
export const GOAL_PRIORITIES  = ['High', 'Medium', 'Low']
export const LOAN_TYPES       = ['Home Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Business Loan', 'Other']
export const BILL_FREQS       = ['Weekly', 'Monthly', 'Quarterly', 'Yearly', 'One-time']
export const BILL_CATS        = ['Utilities', 'Rent', 'Insurance', 'Subscription', 'Internet', 'Phone', 'EMI', 'Other']
export const RELATIONS        = ['Parent', 'Spouse', 'Sibling', 'Child', 'In-laws', 'Relative', 'Other']
export const REMIT_PURPOSES   = ['Family Support', 'Property Purchase', 'Investment', 'Medical', 'Education', 'Business', 'Other']

export const INVEST_TYPES_SIM = ['Mutual Fund', 'Fixed Deposit', 'Stock Market', 'Gold', 'Mix']
export const INVEST_RETURNS   = { 'Mutual Fund': 12, 'Fixed Deposit': 7, 'Stock Market': 15, 'Gold': 9, 'Mix': 10 }

export const ALLOCATION_BUCKETS = {
  Essentials:    ['Groceries', 'Dining', 'Transport', 'Utilities', 'Household', 'Healthcare'],
  Remittance:    ['Remittance'],
  Investments:   ['Investment', 'Savings'],
  Discretionary: ['Shopping', 'Entertainment', 'Personal Care', 'Travel', 'Subscription'],
  Bills:         ['Loan EMI', 'Credit Card Bill', 'Insurance', 'Fees & Charges'],
  Buffer:        ['Other', 'ATM Withdrawal'],
}

// ─── Default Data ─────────────────────────────────────────────────────────────
export const DEFAULT_HOME_CURRENCY    = 'INR'
export const DEFAULT_FOREIGN_CURRENCY = 'KWD'
export const DEFAULT_PRIMARY_CURRENCY = 'INR'

export const DEFAULT_ACCOUNTS = [
  { id: 'acc-burgan-sav', name: 'Burgan Bank Savings', country: 'foreign', type: 'Salary Account', balance: 0, currency: 'KWD', setupBalance: 0 },
  { id: 'acc-qatar-cc',   name: 'Qatar Credit Card',   country: 'foreign', type: 'Credit Card',    balance: 0, currency: 'KWD', setupBalance: 0, creditLimit: 2000 },
  { id: 'acc-visa-cc',    name: 'Visa Credit Card',    country: 'foreign', type: 'Credit Card',    balance: 0, currency: 'KWD', setupBalance: 0, creditLimit: 1500 },
  { id: 'acc-sbi-sav',    name: 'SBI Savings Account', country: 'home',    type: 'NRE',            balance: 0, currency: 'INR', setupBalance: 0 },
]

export const DEFAULT_ALLOCATIONS = [
  { id: 'essentials',    name: 'Essentials',    percent: 40, color: '#b8645a' },
  { id: 'remittance',    name: 'Remittance',    percent: 20, color: '#7a92b0' },
  { id: 'investments',   name: 'Investments',   percent: 15, color: '#c9a961' },
  { id: 'savings',       name: 'Savings',       percent: 15, color: '#68a691' },
  { id: 'discretionary', name: 'Discretionary', percent: 7,  color: '#9b7eb5' },
  { id: 'buffer',        name: 'Buffer',        percent: 3,  color: '#7a8a9c' },
]

export const DEFAULT_WK_BUDGETS = [
  { id: 'wk-rent',      name: 'Rent',          limit: 250 },
  { id: 'wk-groc',      name: 'Groceries',     limit: 150 },
  { id: 'wk-dining',    name: 'Dining',         limit: 80  },
  { id: 'wk-transport', name: 'Transport',      limit: 60  },
  { id: 'wk-health',    name: 'Healthcare',     limit: 40  },
  { id: 'wk-care',      name: 'Personal Care',  limit: 30  },
  { id: 'wk-entertain', name: 'Entertainment',  limit: 50  },
  { id: 'wk-shopping',  name: 'Shopping',       limit: 80  },
  { id: 'wk-sub',       name: 'Subscription',   limit: 15  },
  { id: 'wk-fees',      name: 'Fees & Charges', limit: 10  },
  { id: 'wk-travel',    name: 'Travel',         limit: 100 },
  { id: 'wk-other',     name: 'Other',          limit: 30  },
]

export const DEFAULT_HM_BUDGETS = [
  { id: 'hm-homeloan',    name: 'Home Loan EMI',     limit: 35000 },
  { id: 'hm-electricity', name: 'Electricity',        limit: 5000  },
  { id: 'hm-water',       name: 'Water Bill',         limit: 1000  },
  { id: 'hm-internet',    name: 'Internet & Cable',   limit: 2000  },
  { id: 'hm-groceries',   name: 'Groceries (Family)', limit: 15000 },
  { id: 'hm-school',      name: 'School Fees',        limit: 10000 },
  { id: 'hm-health',      name: 'Healthcare',         limit: 5000  },
  { id: 'hm-insurance',   name: 'Insurance Premium',  limit: 8000  },
  { id: 'hm-household',   name: 'Household',          limit: 5000  },
  { id: 'hm-care',        name: 'Personal Care',      limit: 3000  },
  { id: 'hm-entertain',   name: 'Entertainment',      limit: 2000  },
  { id: 'hm-other',       name: 'Other',              limit: 5000  },
]

export const DEFAULT_BUDGETS = {
  Groceries: 15000, Dining: 8000, Transport: 5000, Utilities: 4000, Household: 3000,
  Healthcare: 5000, Education: 10000, 'Personal Care': 3000, Shopping: 8000, Entertainment: 3000,
  Remittance: 50000, 'Loan EMI': 20000, 'Credit Card Bill': 10000, Insurance: 3000, Investment: 20000, Savings: 15000,
  Travel: 10000, Subscription: 2000, 'Fees & Charges': 1000,
  Salary: 0, 'Other Income': 0, 'Rental Income': 0, Dividends: 0,
  'ATM Withdrawal': 5000, Transfer: 0, Other: 3000,
}

// Empty defaults
export const DEFAULT_TRANSACTIONS     = []
export const DEFAULT_LOANS            = []
export const DEFAULT_INVESTMENTS      = []
export const DEFAULT_BILLS            = []
export const DEFAULT_REMITTANCES      = []
export const DEFAULT_FAMILY_MEMBERS   = []
export const DEFAULT_TEMPLATES        = []
