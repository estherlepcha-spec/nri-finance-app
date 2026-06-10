import { useState } from 'react'
import { C } from '../../utils/constants.js'
import { Flag } from '../../utils/formatting.jsx'
import { Btn, Field, CurrencySel, inputStyle } from '../shared/index.jsx'

export default function SetupWizard({ homeCurrency, setHomeCurrency, foreignCurrency, setForeignCurrency, primaryCurrency, setPrimaryCurrency, exchangeRate, setExchangeRate, onComplete }) {
  const [step, setStep] = useState(0)
  const steps = [
    {
      title: "Welcome to NRI's & Expat's Personal Finance Manager",
      sub: "Let's configure your currencies",
      body: (
        <>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
            As an NRI you manage money across countries. Tell us your currencies to get started.
          </p>
          <CurrencySel label="Home currency (India)" value={homeCurrency} onChange={e => setHomeCurrency(e.target.value)} />
          <CurrencySel label="Foreign currency (country of residence)" value={foreignCurrency} onChange={e => setForeignCurrency(e.target.value)} exclude={['INR']} />
          <CurrencySel label="Primary display currency" value={primaryCurrency} onChange={e => setPrimaryCurrency(e.target.value)} />
        </>
      ),
    },
    {
      title: 'Set Exchange Rate',
      sub: "Enter today's rate — update anytime in Settings",
      body: (
        <>
          <Field label={`1 ${foreignCurrency} = ? ${homeCurrency}`}>
            <input type="number" step="0.01" min="0" value={exchangeRate}
              onChange={e => setExchangeRate(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, fontSize: 20, fontWeight: 700 }} />
          </Field>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>For USD→INR, this is typically 83–85.</p>
        </>
      ),
    },
    {
      title: "You're all set!",
      sub: 'Start tracking your NRI finances',
      body: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <div style={{ background: C.card2, borderRadius: 10, padding: 16, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, color: C.text, display:'flex', alignItems:'center', gap:6 }}><Flag currency={homeCurrency} size={14} />Home: <strong>{homeCurrency}</strong></div>
            <div style={{ fontSize: 13, color: C.text, display:'flex', alignItems:'center', gap:6 }}><Flag currency={foreignCurrency} size={14} />Foreign: <strong>{foreignCurrency}</strong></div>
            <div style={{ fontSize: 13, color: C.text }}>💱 Rate: <strong>1 {foreignCurrency} = {exchangeRate} {homeCurrency}</strong></div>
          </div>
        </div>
      ),
    },
  ]

  const cur = steps[step]
  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <img src="/app-icon.png" alt="logo" style={{ width: 42, height: 42, borderRadius: 13, objectFit: 'cover' }} />
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
            {step > 0 && <Btn variant="ghost" onClick={() => setStep(s => s - 1)} style={{ flex: 1 }}>← Back</Btn>}
            <Btn onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : onComplete()} style={{ flex: 1 }}>
              {step < steps.length - 1 ? 'Continue →' : '🚀 Get Started'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
