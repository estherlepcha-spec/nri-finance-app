import { useState } from 'react'
import { Btn, Modal, inputStyle } from './index.jsx'

export default function ExitSurvey({ onClose = () => {}, onSubmit = async () => {} }) {
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ q1, q2, comment, timestamp: Date.now() })
      setSubmitted(true)
      setTimeout(() => onClose(true), 1000)
    } catch (e) {
      // swallow — caller may log
      onClose(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Quick feedback — why did you skip?" onClose={() => onClose(false)} width={520}>
      <div style={{ color: 'var(--muted, #9aa0a6)', marginBottom: 12 }}>Two quick questions — helps us improve the signup flow.</div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>1) What stopped you from completing signup?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label><input type="radio" name="q1" value="bank_connect" checked={q1 === 'bank_connect'} onChange={() => setQ1('bank_connect')} /> Didn’t want to connect a bank account / privacy concerns</label>
          <label><input type="radio" name="q1" value="unclear_value" checked={q1 === 'unclear_value'} onChange={() => setQ1('unclear_value')} /> Couldn't see the value / unclear benefits</label>
          <label><input type="radio" name="q1" value="too_long" checked={q1 === 'too_long'} onChange={() => setQ1('too_long')} /> Signup took too long / too many steps</label>
          <label><input type="radio" name="q1" value="prefer_csv" checked={q1 === 'prefer_csv'} onChange={() => setQ1('prefer_csv')} /> Prefer manual import (CSV) or offline setup</label>
          <label><input type="radio" name="q1" value="other" checked={q1 === 'other'} onChange={() => setQ1('other')} /> Other (optional comment)</label>
          <input placeholder="Optional comment" value={comment} onChange={e => setComment(e.target.value)} style={{ ...inputStyle, marginTop: 8 }} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>2) Which change would most make you finish signup?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label><input type="radio" name="q2" value="bank_sync" checked={q2 === 'bank_sync'} onChange={() => setQ2('bank_sync')} /> Automatic bank/account sync (link bank)</label>
          <label><input type="radio" name="q2" value="csv_import" checked={q2 === 'csv_import'} onChange={() => setQ2('csv_import')} /> Manual CSV import or upload tool</label>
          <label><input type="radio" name="q2" value="clear_examples" checked={q2 === 'clear_examples'} onChange={() => setQ2('clear_examples')} /> Clearer examples of value</label>
          <label><input type="radio" name="q2" value="faster_flow" checked={q2 === 'faster_flow'} onChange={() => setQ2('faster_flow')} /> Faster/shorter signup flow</label>
          <label><input type="radio" name="q2" value="more_trust" checked={q2 === 'more_trust'} onChange={() => setQ2('more_trust')} /> More security/trust signals</label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
        <Btn variant="ghost" onClick={() => onClose(false)}>Skip & continue</Btn>
        <Btn onClick={handleSubmit} disabled={submitting || submitted}>{submitted ? 'Thanks ✓' : 'Submit & continue'}</Btn>
      </div>
    </Modal>
  )
}
