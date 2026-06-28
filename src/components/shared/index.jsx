/* eslint-disable react-refresh/only-export-components */
import { C } from '../../utils/constants.js'
import { CURRENCY_GROUPS, CURRENCY_FULL_NAMES, TX_CATEGORY_GROUPS } from '../../utils/constants.js'

// ─── Layout Styles ────────────────────────────────────────────────────────────
export const pg      = { padding: 'var(--pg, 24px 28px)', overflowY: 'auto', height: '100%' }
export const pgTitle = { fontSize: 'var(--title-fs, 24px)', fontWeight: 800, color: C.text, marginBottom: 4, letterSpacing: '-0.03em' }
export const grid2   = { display: 'grid', gridTemplateColumns: 'var(--rg-2, 1fr 1fr)', gap: 12 }
export const rowSep  = { padding: '12px 0', borderBottom: `1px solid ${C.border}` }
export const linkBtn = { background: 'none', border: 'none', color: C.accentL, fontSize: 12, cursor: 'pointer', fontWeight: 600, letterSpacing: '-0.01em' }
export const inputStyle = { width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 9, padding: '10px 13px', color: C.text, fontSize: 'var(--input-fs, 13px)', minHeight: 'var(--input-min-h, 40px)', outline: 'none', letterSpacing: '-0.01em', transition: 'border-color 0.15s, box-shadow 0.15s' }

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ title, action, children, style: s = {}, accent, lift }) {
  return (
    <div className={lift ? 'card-lift' : ''} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, position: 'relative', overflow: 'hidden', ...s }}>
      {accent && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accent}, ${accent}55, transparent)` }} />}
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          {title && <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────
export function Btn({ onClick, variant = 'primary', children, style: s = {}, disabled, size = 'md' }) {
  const sizes = { sm: { padding: '5px 12px', fontSize: 12 }, md: { padding: '8px 16px', fontSize: 13 }, lg: { padding: '11px 22px', fontSize: 14 } }
  const base = { border: 'none', borderRadius: 9, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, letterSpacing: '-0.01em', display: 'inline-flex', alignItems: 'center', gap: 5, ...sizes[size] }
  const vs = {
    primary: { background: `linear-gradient(135deg, ${C.accent}, ${C.accentD})`, color: '#fff', boxShadow: `0 2px 10px ${C.accent}44` },
    danger:  { background: `linear-gradient(135deg, ${C.red}, #dc2626)`,          color: '#fff', boxShadow: `0 2px 10px ${C.red}44` },
    ghost:   { background: 'transparent', color: C.mutedL, border: `1px solid ${C.border}` },
    success: { background: `linear-gradient(135deg, ${C.green}, #059669)`,        color: '#fff', boxShadow: `0 2px 10px ${C.green}44` },
    subtle:  { background: C.card2, color: C.textS, border: `1px solid ${C.border}` },
  }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...(vs[variant] || vs.primary), ...s }}>{children}</button>
}

// ─── Form Components ──────────────────────────────────────────────────────────
export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: C.mutedL, marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  )
}

export function Input({ label, ...props }) {
  const el = <input style={inputStyle} {...props} />
  return label ? <Field label={label}>{el}</Field> : el
}

export function Sel({ label, options, ...props }) {
  const el = (
    <select style={inputStyle} {...props}>
      {options.map(o => typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
  return label ? <Field label={label}>{el}</Field> : el
}

export function CurrencySel({ label, exclude = [], ...props }) {
  const el = (
    <select style={inputStyle} {...props}>
      {Object.entries(CURRENCY_GROUPS).map(([group, codes]) => {
        const filtered = codes.filter(c => !exclude.includes(c))
        if (!filtered.length) return null
        return (
          <optgroup key={group} label={group}>
            {filtered.map(code => (
              <option key={code} value={code}>{code} — {CURRENCY_FULL_NAMES[code] || code}</option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
  return label ? <Field label={label}>{el}</Field> : el
}

export function CatSel({ label, value, onChange, incomeOnly }) {
  const groups = incomeOnly ? { Income: TX_CATEGORY_GROUPS['Income'] } : TX_CATEGORY_GROUPS
  const el = (
    <select value={value} onChange={onChange} style={inputStyle}>
      {Object.entries(groups).map(([group, cats]) => (
        <optgroup key={group} label={group}>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      ))}
    </select>
  )
  return label ? <Field label={label}>{el}</Field> : el
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(5px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="modal-enter modal-sheet" style={{ background: C.card, border: `1px solid ${C.borderL}`, borderRadius: 18, padding: 26, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>{title}</h3>
          <button onClick={onClose} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.mutedL, fontSize: 14, cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Display Components ───────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color = C.accent, icon }) {
  return (
    <div className="card-lift" style={{ background: `linear-gradient(135deg, ${color}12, ${color}06)`, border: `1px solid ${color}2e`, borderRadius: 14, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, ${color}44)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
          <div className="stat-num" style={{ fontSize: 21, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1, wordBreak: 'break-all' }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{sub}</div>}
        </div>
        {icon && <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 6 }}>{icon}</div>}
      </div>
    </div>
  )
}

export function Badge({ children, color = C.accent }) {
  return <span style={{ background: color + '1a', color, border: `1px solid ${color}33`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600, display: 'inline-block', letterSpacing: '0.01em' }}>{children}</span>
}

export function ProgressBar({ value, max, color = C.accent, height = 7 }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0)
  const barColor = pct >= 100 ? C.green : color
  return (
    <div style={{ background: C.card2, borderRadius: 100, height, overflow: 'hidden' }}>
      <div className="progress-bar" style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)`, borderRadius: 100, boxShadow: `0 0 6px ${barColor}55` }} />
    </div>
  )
}

export function Empty({ icon, title, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '52px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.35 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.textS, marginBottom: 6, letterSpacing: '-0.01em' }}>{title}</div>
      <div style={{ fontSize: 12, color: C.muted, maxWidth: 240, margin: '0 auto', lineHeight: 1.6 }}>{sub}</div>
    </div>
  )
}

export function IconBtn({ onClick, children, danger }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: danger ? C.red : C.muted, padding: '3px 5px', borderRadius: 6, lineHeight: 1 }}>
      {children}
    </button>
  )
}

export function DonutChart({ segments, size = 72, thickness = 11, label }) {
  const total = segments.reduce((s, sg) => s + (sg.value || 0), 0)
  if (!total) return <div style={{ width: size, height: size, borderRadius: '50%', background: C.card2, border: `${thickness}px solid ${C.card3}` }} />
  const cx = size / 2, cy = size / 2, r = (size - thickness) / 2
  const arcs = segments.filter(s => s.value > 0).reduce((acc, seg) => {
    const sweep = (seg.value / total) * 2 * Math.PI
    const startAngle = acc.angle
    const endAngle = startAngle + sweep
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle)
    const large = sweep > Math.PI ? 1 : 0
    acc.angle = endAngle
    acc.paths.push({ d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, color: seg.color })
    return acc
  }, { angle: -Math.PI / 2, paths: [] }).paths
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ display: 'block' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.card2} strokeWidth={thickness} />
        {arcs.map((arc, i) => <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={thickness - 1} strokeLinecap="butt" />)}
      </svg>
      {label && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 1.2, maxWidth: size - thickness * 2 - 4 }}>{label}</div>
      </div>}
    </div>
  )
}

export function MiniBarChart({ data, color = C.accent, height = 36 }) {
  const max = Math.max(...data.map(d => d.value || 0), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {data.map((d, i) => (
        <div key={i} title={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
          <div style={{ width: '100%', height: Math.max((d.value / max) * height, d.value > 0 ? 3 : 0), background: color, borderRadius: '3px 3px 0 0', opacity: i === data.length - 1 ? 1 : 0.5 }} />
        </div>
      ))}
    </div>
  )
}
