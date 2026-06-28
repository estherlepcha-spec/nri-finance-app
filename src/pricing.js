const DEFAULT_PLAN = {
  name: 'Pro',
  monthlyUsd: 5.99,
  annualUsd: 59,
  currency: 'USD',
  monthlyAmount: 5.99,
  annualAmount: 59,
  billingCurrency: 'USD',
  priceKey: 'pro_usd_monthly',
  exact: true,
}

const EXACT_REGION_PRICES = {
  IN: {
    currency: 'INR',
    monthlyAmount: 299,
    annualAmount: 2999,
    billingCurrency: 'INR',
    priceKey: 'pro_inr_monthly',
  },
  US: {
    currency: 'USD',
    monthlyAmount: 5.99,
    annualAmount: 59,
    billingCurrency: 'USD',
    priceKey: 'pro_usd_monthly',
  },
}

const APPROX_REGION_PRICES = {
  AE: { currency: 'AED', rateFromUsd: 3.67 },
  BH: { currency: 'BHD', rateFromUsd: 0.38 },
  CA: { currency: 'CAD', rateFromUsd: 1.37 },
  GB: { currency: 'GBP', rateFromUsd: 0.79 },
  KW: { currency: 'KWD', rateFromUsd: 0.31 },
  OM: { currency: 'OMR', rateFromUsd: 0.38 },
  QA: { currency: 'QAR', rateFromUsd: 3.64 },
  SA: { currency: 'SAR', rateFromUsd: 3.75 },
}

const TIMEZONE_REGION_HINTS = [
  [/\/Kolkata$/, 'IN'],
  [/\/Calcutta$/, 'IN'],
  [/\/Kuwait$/, 'KW'],
  [/\/Dubai$/, 'AE'],
  [/\/Riyadh$/, 'SA'],
  [/\/Qatar$/, 'QA'],
  [/\/Bahrain$/, 'BH'],
  [/\/Muscat$/, 'OM'],
  [/^America\//, 'US'],
  [/^Europe\/London$/, 'GB'],
]

function inferRegion() {
  const locale = navigator.language || navigator.languages?.[0] || ''
  const localeRegion = locale.match(/-([A-Z]{2})\b/i)?.[1]?.toUpperCase()
  if (localeRegion) return localeRegion

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  const match = TIMEZONE_REGION_HINTS.find(([pattern]) => pattern.test(timeZone))
  return match?.[1] || 'US'
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount)
}

export function getProPriceDisplay(region = inferRegion()) {
  const exact = EXACT_REGION_PRICES[region]
  if (exact) {
    return {
      ...DEFAULT_PLAN,
      ...exact,
      region,
      exact: true,
      monthlyLabel: `${formatMoney(exact.monthlyAmount, exact.currency)}/month`,
      annualLabel: `${formatMoney(exact.annualAmount, exact.currency)}/year`,
      checkoutNote: `You will be charged in ${exact.billingCurrency}.`,
    }
  }

  const approx = APPROX_REGION_PRICES[region]
  if (approx) {
    const monthlyAmount = DEFAULT_PLAN.monthlyUsd * approx.rateFromUsd
    const annualAmount = DEFAULT_PLAN.annualUsd * approx.rateFromUsd
    return {
      ...DEFAULT_PLAN,
      region,
      currency: approx.currency,
      monthlyAmount,
      annualAmount,
      exact: false,
      monthlyLabel: `${formatMoney(monthlyAmount, approx.currency)}/month`,
      annualLabel: `${formatMoney(annualAmount, approx.currency)}/year`,
      checkoutNote: `Approximate local price. You will be charged ${formatMoney(DEFAULT_PLAN.monthlyUsd, 'USD')}/month in USD.`,
    }
  }

  return {
    ...DEFAULT_PLAN,
    region,
    monthlyLabel: `${formatMoney(DEFAULT_PLAN.monthlyAmount, DEFAULT_PLAN.currency)}/month`,
    annualLabel: `${formatMoney(DEFAULT_PLAN.annualAmount, DEFAULT_PLAN.currency)}/year`,
    checkoutNote: 'You will be charged in USD.',
  }
}
