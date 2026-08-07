import { useState, useEffect } from 'react'
import { C, HOME_ACCOUNT_TYPES, WORK_ACCOUNT_TYPES } from '../../utils/constants.js'
import { Flag } from '../../utils/formatting.jsx'
import { Btn, Field, Sel, CurrencySel, inputStyle } from '../shared/index.jsx'

// Onboarding wizard. Guaranteed first stop for a new user (gated in App.jsx on
// "onboarding not completed"). Four steps:
//   0. Currencies      → home / foreign / primary (full currency list, all 60)
//   1. Exchange rate   → pre-filled live from `rates`, editable
//   2. First account   → add your real first account (skippable)
//   3. Done            → summary
export default function SetupWizard({
  homeCurrency, setHomeCurrency,
  foreignCurrency, setForeignCurrency,
  primaryCurrency, setPrimaryCurrency,
  exchangeRate, setExchangeRate,
  rates = {},
  onCreateAccount,
  onComplete,
}) {
  const [step, setStep] = useState(0)

  // Guided first-account fields.
  const [acctSide, setAcctSide] = useState('foreign') // 'foreign' (work) | 'home'
  const [acctName, setAcctName] = useState('')
  const [acctType, setAcctType] = useState('Salary Account')
  const [acctBalance, setAcctBalance] = useState('')
  const [acctCreditLimit, setAcctCreditLimit] = useState('')
  const [accountAdded, setAccountAdded] = useState(false)

  // Compute a live exchange rate (1 foreign = ? home) from the rates map, which
  // is keyed to USD. rate = homePerUsd / foreignPerUsd.
  const liveRate = (() => {
    const h = rates[homeCurrency], f = rates[foreignCurrency]
    if (h && f) return h / f
    return null
  })()
  const [rateAutoFilled, setRateAutoFilled] = useState(false)
  useEffect(() => {
    // Pre-fill the rate once, when entering the rate step, if we have a live one.
    if (step === 1 && liveRate && !rateAutoFilled) {
      setExchangeRate(Number(liveRate.toFixed(4)))
      setRateAutoFilled(true)
    }
  }, [step, liveRate, rateAutoFilled, setExchangeRate])

  const acctTypes = acctSide === 'home' ? HOME_ACCOUNT_TYPES : WORK_ACCOUNT_TYPES
  const acctCurrency = acctSide === 'home' ? homeCurrency : foreignCurrency
  const isCard = acctType === 'Credit Card'

  const addAccount = () => {
    if (!acctName.trim()) return
    onCreateAccount?.({
      id: `acc-${Date.now()}`,
      name: acctName.trim(),
      country: acctSide,
      type: acctType,
      currency: acctCurrency,
      balance: parseFloat(acctBalance) || 0,
      setupBalance: parseFloat(acctBalance) || 0,
      ...(isCard ? { creditLimit: parseFloat(acctCreditLimit) || 0 } : {}),
    })
    setAccountAdded(true)
    setStep(3)
  }

  // Home & foreign must be chosen and different.
  const canContinueRegion = !!homeCurrency && !!foreignCurrency && homeCurrency !== foreignCurrency

  const steps = [
    {
      title: "Welcome — let's set up your currencies",
      sub: 'Choose your home currency (where you send money) and the currency you earn in. All world currencies are available.',
      body: (
        <>
          <CurrencySel
            label="Home currency (where you're from)"
            value={homeCurrency}
            onChange={e => { setHomeCurrency(e.target.value); if (primaryCurrency === foreignCurrency || !primaryCurrency) setPrimaryCurrency(e.target.value) }}
          />
          <CurrencySel
            label="Foreign currency (where you live / work)"
            value={foreignCurrency}
            onChange={e => setForeignCurrency(e.target.value)}
            exclude={[homeCurrency]}
          />
          <CurrencySel label="Primary display currency" value={primaryCurrency} onChange={e => setPrimaryCurrency(e.target.value)} />
          {homeCurrency && foreignCurrency && homeCurrency === foreignCurrency && (
            <p style={{ color: C.red, fontSize: 12, marginTop: 4 }}>Home and foreign currency must be different.</p>
          )}
        </>
      ),
    },
    {
      title: 'Set your exchange rate',
      sub: liveRate ? 'We fetched a live rate — edit it if you prefer.' : "Enter today's rate — you can update it anytime in Settings.",
      body: (
        <>
          <Field label={`1 ${foreignCurrency} = ? ${homeCurrency}`}>
            <input type="number" step="0.0001" min="0" value={exchangeRate}
              onChange={e => setExchangeRate(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, fontSize: 20, fontWeight: 700 }} />
          </Field>
          {liveRate
            ? <p style={{ color: C.green, fontSize: 12, marginTop: 6 }}>✓ Live rate: 1 {foreignCurrency} ≈ {liveRate.toFixed(4)} {homeCurrency}</p>
            : <p style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>Tip: you can refresh live rates later from Settings.</p>}
        </>
      ),
    },
    {
      title: 'Add your first account',
      sub: 'Add a real account to start tracking — or skip and add it later.',
      body: (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <Btn variant={acctSide === 'foreign' ? 'primary' : 'subtle'} onClick={() => { setAcctSide('foreign'); setAcctType(WORK_ACCOUNT_TYPES[0]) }} style={{ flex: 1, justifyContent: 'center' }}>
              Work account ({foreignCurrency})
            </Btn>
            <Btn variant={acctSide === 'home' ? 'primary' : 'subtle'} onClick={() => { setAcctSide('home'); setAcctType(HOME_ACCOUNT_TYPES[0]) }} style={{ flex: 1, justifyContent: 'center' }}>
              Home account ({homeCurrency})
            </Btn>
          </div>
          <Field label="Account name">
            <input value={acctName} onChange={e => setAcctName(e.target.value)} placeholder="e.g. My Salary Account" style={inputStyle} />
          </Field>
          <Sel label="Type" value={acctType} onChange={e => setAcctType(e.target.value)} options={acctTypes} />
          <Field label={`Current balance (${acctCurrency})`}>
            <input type="number" step="0.01" value={acctBalance} onChange={e => setAcctBalance(e.target.value)} placeholder="0" style={inputStyle} />
          </Field>
          {isCard && (
            <Field label={`Credit limit (${acctCurrency})`}>
              <input type="number" step="0.01" value={acctCreditLimit} onChange={e => setAcctCreditLimit(e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
          )}
        </>
      ),
    },
    {
      title: "You're all set!",
      sub: 'Start tracking your finances across borders.',
      body: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <div style={{ background: C.card2, borderRadius: 10, padding: 16, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}><Flag currency={homeCurrency} size={14} />Home: <strong>{homeCurrency}</strong></div>
            <div style={{ fontSize: 13, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}><Flag currency={foreignCurrency} size={14} />Foreign: <strong>{foreignCurrency}</strong></div>
            <div style={{ fontSize: 13, color: C.text }}>💱 Rate: <strong>1 {foreignCurrency} = {exchangeRate} {homeCurrency}</strong></div>
            <div style={{ fontSize: 13, color: C.text }}>🏦 First account: <strong>{accountAdded ? acctName : 'add one anytime from Accounts'}</strong></div>
          </div>
        </div>
      ),
    },
  ]

  const cur = steps[step]
  const isRegion = step === 0
  const isAccountStep = step === 2
  const isLast = step === steps.length - 1

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div role="img" aria-label="logo" style={{ width: 56, height: 56, borderRadius: 14, backgroundImage: 'url(/app-logo-v5.png)', backgroundSize: '130%', backgroundPosition: '51% 33%', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 3px 12px rgba(255,136,0,0.5))' }} />
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
              NRI's & Expat's<br />
              <span style={{ fontSize: 14, fontWeight: 600, color: C.mutedL }}>Personal Finance Manager</span>
            </div>
          </div>
          <div style={{ color: C.muted, fontSize: 13 }}>Manage your money across borders — wherever you live and work</div>
          <div style={{ color: C.mutedL, fontSize: 11, marginTop: 6 }}>For Indians • Pakistanis • Filipinos • Bangladeshis • Sri Lankans • Nepalese • and all expats working abroad</div>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.borderL}`, borderRadius: 20, padding: 32, boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 26 }}>
            {steps.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 100, background: i <= step ? C.accent : C.border, transition: 'background 0.3s' }} />
            ))}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 6, letterSpacing: '-0.03em' }}>{cur.title}</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>{cur.sub}</p>
          {cur.body}
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {step > 0 && <Btn variant="ghost" onClick={() => setStep(s => s - 1)} style={{ flex: 1, justifyContent: 'center' }}>← Back</Btn>}
            {isAccountStep ? (
              <>
                <Btn variant="ghost" onClick={() => setStep(3)} style={{ flex: 1, justifyContent: 'center' }}>Skip for now</Btn>
                <Btn onClick={addAccount} disabled={!acctName.trim()} style={{ flex: 1, justifyContent: 'center' }}>Add account →</Btn>
              </>
            ) : (
              <Btn
                onClick={() => isLast ? onComplete() : setStep(s => s + 1)}
                disabled={isRegion && !canContinueRegion}
                style={{ flex: 1, justifyContent: 'center' }}>
                {isLast ? '🚀 Get Started' : 'Continue →'}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
