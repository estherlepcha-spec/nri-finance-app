import { useState, useEffect, useRef } from 'react'
import { C } from '../../utils/constants.js'
import { inputStyle } from '../shared/index.jsx'

const GOLD = '#c9a961'
const NAVY = '#0c1929'
const PANEL = '#152035'

// ─── Estelle Avatar ───────────────────────────────────────────────────────────
export function EstelleAvatar({ size = 40 }) {
  const s = typeof size === 'number' ? size : parseInt(size)
  return (
    <div style={{ width: s, height: s, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '2px solid #c9a961', boxShadow: '0 0 0 2px #0c1929, 0 0 0 4px #c9a961', backgroundColor: '#c9a961' }}>
      <img src="/estelle-avatar.svg" alt="Estelle"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={e => {
          e.target.style.display = 'none'
          e.target.parentElement.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:${Math.round(s * 0.45)}px;font-weight:900;color:#0c1929">E</div>`
        }}
      />
    </div>
  )
}

// ─── Floating Estelle Doll ────────────────────────────────────────────────────
export function FloatingEstelle({ onOpen }) {
  const [showBubble, setShowBubble] = useState(false)
  const [tipIdx, setTipIdx] = useState(0)
  const tips = ["Hey! 💅 Tap to chat!", "Check your budget ✨", "How's your savings? 📊", "Got a money question? 💕", "I've got money tips! 🤑"]

  useEffect(() => {
    if (!document.getElementById('estelle-float-css')) {
      const s = document.createElement('style')
      s.id = 'estelle-float-css'
      s.textContent = `
        @keyframes eFloat { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
        @keyframes eNod { 0%,100%{transform:rotate(0deg)} 15%{transform:rotate(-7deg) translateY(-3px)} 35%{transform:rotate(5deg)} 55%{transform:rotate(-4deg) translateY(-2px)} 75%{transform:rotate(4deg)} }
        @keyframes eGlow { 0%,100%{box-shadow:0 0 0 3px #c9a96188,0 8px 28px rgba(0,0,0,0.5)} 50%{box-shadow:0 0 0 10px rgba(201,169,97,0),0 8px 28px rgba(0,0,0,0.5)} }
        @keyframes eLidTop { 0%,88%,100%{height:0%} 92%,96%{height:100%} }
        @keyframes eLidBot { 0%,88%,100%{height:0%} 92%,96%{height:60%} }
        @keyframes eBubble { 0%{opacity:0;transform:scale(0.7) translateY(8px)} 12%,88%{opacity:1;transform:scale(1) translateY(0)} 100%{opacity:0;transform:scale(0.7) translateY(8px)} }
      `
      document.head.appendChild(s)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setShowBubble(true), 2000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!showBubble) return
    const t = setTimeout(() => {
      setShowBubble(false)
      const t2 = setTimeout(() => { setTipIdx(i => (i + 1) % tips.length); setShowBubble(true) }, 5000)
      return () => clearTimeout(t2)
    }, 4000)
    return () => clearTimeout(t)
  }, [showBubble])

  return (
    <div style={{ position: 'fixed', bottom: 90, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, pointerEvents: 'none' }}>
      {showBubble && (
        <div style={{ background: GOLD, color: NAVY, padding: '9px 14px', borderRadius: '14px 14px 4px 14px', fontSize: 12, fontWeight: 700, maxWidth: 160, textAlign: 'center', pointerEvents: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', animation: 'eBubble 4s ease forwards', position: 'relative' }}>
          {tips[tipIdx]}
          <div style={{ position: 'absolute', bottom: -7, right: 14, width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `7px solid ${GOLD}` }} />
        </div>
      )}
      <div onClick={onOpen} style={{ width: 72, height: 72, position: 'relative', cursor: 'pointer', pointerEvents: 'all', animation: 'eFloat 3.2s ease-in-out infinite' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', animation: 'eGlow 2s ease-in-out infinite', position: 'absolute', top: 0, left: 0 }} />
        <div style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', border: `3px solid ${GOLD}`, background: GOLD, position: 'relative', animation: 'eNod 2.6s ease-in-out infinite', transformOrigin: '50% 85%' }}>
          <img src="/estelle-avatar.svg" alt="Estelle" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', display: 'block' }}
            onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="font-size:32px;font-weight:900;color:#0c1929">E</span>' }} />
          {['22%', '56%'].map((left, idx) => (
            <div key={idx}>
              <div style={{ position: 'absolute', top: '34%', left, width: '22%', height: '14%', overflow: 'hidden', pointerEvents: 'none', borderRadius: '0 0 50% 50%' }}>
                <div style={{ width: '100%', background: 'rgba(120,80,50,0.92)', borderRadius: '0 0 50% 50%', animation: 'eLidTop 3.8s ease-in-out infinite', transformOrigin: 'top center' }} />
              </div>
              <div style={{ position: 'absolute', top: '46%', left, width: '22%', height: '8%', overflow: 'hidden', pointerEvents: 'none', borderRadius: '50% 50% 0 0', transform: 'scaleY(-1)', transformOrigin: 'top center' }}>
                <div style={{ width: '100%', background: 'rgba(120,80,50,0.75)', borderRadius: '0 0 50% 50%', animation: 'eLidBot 3.8s ease-in-out infinite', transformOrigin: 'top center' }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: '50%', background: GOLD, border: `2px solid ${NAVY}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>💅</div>
      </div>
    </div>
  )
}

// ─── Estelle Chat ─────────────────────────────────────────────────────────────
export default function Estelle({ aiMessages, aiInput, setAiInput, aiLoading, sendAI, financialContext }) {
  const endRef = useRef(null)
  const [purchaseFile, setPurchaseFile] = useState(null)
  const [purchasePreview, setPurchasePreview] = useState(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  const handleSend = () => {
    const text = aiInput.trim() || (purchaseFile ? 'I want to buy this item. Should I based on my budget and financial goals?' : '')
    if (!text && !purchaseFile) return
    sendAI(text, purchaseFile)
    setAiInput('')
    setPurchaseFile(null)
    if (purchasePreview) { URL.revokeObjectURL(purchasePreview); setPurchasePreview(null) }
  }

  const handlePhoto = e => {
    const f = e.target.files[0]
    if (!f) return
    if (purchasePreview) URL.revokeObjectURL(purchasePreview)
    setPurchaseFile(f)
    setPurchasePreview(URL.createObjectURL(f))
    e.target.value = ''
  }

  const quickChips = [
    { icon: '💰', text: 'How am I doing this month?' },
    { icon: '📸', text: 'Should I buy this?' },
    { icon: '🎯', text: 'Am I on track with my goals?' },
    { icon: '💸', text: 'Where is my money going?' },
    { icon: '🏦', text: 'Explain my loans' },
    { icon: '📊', text: 'Give me a full financial health breakdown' },
    { icon: '🎲', text: 'Surprise me with a money tip!' },
  ]

  const { workingCountry, goals, loans, upcomingBills, currentMonth } = financialContext || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)', gap: 0, background: C.bg }}>

      {/* Header */}
      <div style={{ background: NAVY, borderBottom: `2px solid ${GOLD}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <EstelleAvatar size={56} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: GOLD, letterSpacing: '-0.02em' }}>Estelle</span>
            <span style={{ fontSize: 16 }}>💅</span>
            <span style={{ fontSize: 10, background: '#10b98122', color: '#10b981', border: '1px solid #10b98144', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>🟢 Online</span>
          </div>
          <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Your Finance BFF — always honest, never boring ✨</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: C.muted }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
          <div>Financial BFF Mode</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {aiMessages.length === 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <EstelleAvatar size={34} />
            <div style={{ flex: 1, maxWidth: '88%' }}>
              <div style={{ background: PANEL, border: `1px solid ${GOLD}33`, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 16px 16px 16px', padding: '16px 20px', fontSize: 13, lineHeight: 1.85, color: C.text, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: GOLD, marginBottom: 8 }}>Hey gorgeous! I'm Estelle 💅 — your personal finance bestie!</div>
                <div>I know everything about your money situation and I'm here to help you make every Dinar and Rupee count.</div>
                {financialContext && (
                  <div style={{ marginTop: 14, background: NAVY, borderRadius: 12, padding: '14px 16px', border: `1px solid ${GOLD}44` }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: GOLD, marginBottom: 10 }}>📊 Your {currentMonth || 'Monthly'} Vibe Check:</div>
                    {workingCountry?.income > 0 && <div style={{ fontSize: 12, color: C.textS, marginBottom: 5 }}>💼 Working income: <strong>{workingCountry.income.toFixed(0)} {workingCountry.currency}</strong> · savings: <strong style={{ color: parseFloat(workingCountry.savingsRate) >= 20 ? '#10b981' : C.red }}>{workingCountry.savingsRate || '—'}</strong></div>}
                    {loans?.length > 0 && <div style={{ fontSize: 12, color: C.textS, marginBottom: 5 }}>🏠 Loans: <strong>{loans.length} active</strong> · EMI {loans.reduce((s, l) => s + (l.emi || 0), 0).toFixed(0)} {loans[0]?.currency || ''}/mo</div>}
                    {goals?.length > 0 && <div style={{ fontSize: 12, color: C.textS, marginBottom: 5 }}>🎯 <strong>{goals.length} goal{goals.length !== 1 ? 's' : ''}</strong> · top goal <strong style={{ color: GOLD }}>{Math.round((goals[0]?.saved || 0) / Math.max(1, goals[0]?.target || 1) * 100)}%</strong> done</div>}
                    {upcomingBills?.length > 0 && <div style={{ fontSize: 12, color: C.yellow }}>⏰ <strong>{upcomingBills.length} bill{upcomingBills.length !== 1 ? 's' : ''}</strong> coming up</div>}
                    {!workingCountry?.income && !loans?.length && !goals?.length && <div style={{ fontSize: 12, color: C.muted }}>No transactions yet — add your salary to get started! 💪</div>}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>Ask me anything, show me something you want to buy, or just say hi! 😂</div>
              </div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Quick questions</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {quickChips.map(c => (
                  <button key={c.text}
                    onClick={() => { if (c.text === 'Should I buy this?') { document.getElementById('estelle-photo-input')?.click() } else { setAiInput(c.text); setTimeout(() => document.getElementById('estelle-input')?.focus(), 50) } }}
                    style={{ background: PANEL, border: `1px solid ${GOLD}44`, borderRadius: 20, padding: '7px 14px', color: C.textS, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                    {c.icon} {c.text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {aiMessages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 10, alignItems: 'flex-start' }}>
            {m.role === 'assistant' && <EstelleAvatar size={30} />}
            <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.imageUrl && <img src={m.imageUrl} alt="purchase" style={{ maxWidth: 160, maxHeight: 160, borderRadius: 12, objectFit: 'cover', border: `2px solid ${GOLD}` }} />}
              <div style={{ padding: '12px 16px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '0 16px 16px 16px', fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', background: m.role === 'user' ? GOLD : PANEL, color: m.role === 'user' ? NAVY : C.text, borderLeft: m.role === 'assistant' ? `3px solid ${GOLD}` : 'none', fontWeight: m.role === 'user' ? 700 : 400 }}>
                {m.role === 'assistant' && <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, marginBottom: 6 }}>Estelle 💅</div>}
                {m.content}
              </div>
            </div>
          </div>
        ))}

        {aiLoading && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <EstelleAvatar size={36} />
            <div style={{ background: PANEL, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 16px 16px 16px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: C.muted, fontStyle: 'italic' }}>{purchaseFile ? "Ooh let me see what you're eyeing... 🤓✨" : 'Estelle is thinking...'}</span>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: GOLD, display: 'inline-block', animation: `pulse 1s ${i * 0.22}s infinite` }} />)}
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Photo preview */}
      {purchasePreview && (
        <div style={{ padding: '10px 20px', background: NAVY, borderTop: `1px solid ${GOLD}44`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <img src={purchasePreview} alt="preview" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8, border: `2px solid ${GOLD}` }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>📸 Photo attached</div>
            <div style={{ fontSize: 11, color: C.muted }}>Estelle will analyse this purchase for you</div>
          </div>
          <button onClick={() => { setPurchaseFile(null); if (purchasePreview) { URL.revokeObjectURL(purchasePreview); setPurchasePreview(null) } }} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
      )}

      {/* Input bar */}
      <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, background: C.card, display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <label htmlFor="estelle-photo-input" style={{ width: 42, height: 42, borderRadius: 11, background: `${GOLD}22`, border: `1px solid ${GOLD}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 20 }}>
          📸
          <input id="estelle-photo-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />
        </label>
        <input id="estelle-input" value={aiInput} onChange={e => setAiInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Ask Estelle anything..."
          style={{ flex: 1, ...inputStyle, padding: '12px 16px', borderRadius: 12, fontSize: 13 }}
          disabled={aiLoading} />
        <button onClick={handleSend} disabled={aiLoading || (!aiInput.trim() && !purchaseFile)}
          style={{ background: aiLoading || (!aiInput.trim() && !purchaseFile) ? C.card2 : GOLD, color: aiLoading || (!aiInput.trim() && !purchaseFile) ? C.muted : NAVY, border: 'none', borderRadius: 12, padding: '12px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
          Send →
        </button>
      </div>
    </div>
  )
}
