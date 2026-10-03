import { useEffect, useState } from 'react'
import { Modal, Btn } from '../shared/index.jsx'
import { supabase } from '../../supabase.js'

export default function SiteFeedbackAdmin({ onClose = () => {} }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in first.')
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/site-feedback-admin`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      setItems(data)
    } catch (err) {
      setError(err.message || 'Failed to load feedback')
    } finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [])

  const avgRating = items.length ? (items.reduce((s, it) => s + (it.rating || 0), 0) / items.length).toFixed(1) : null

  return (
    <Modal title={`Site feedback (${items.length})`} onClose={onClose} width={760}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#6b7280' }}>
          Customer feedback submitted from the marketing site.
          {avgRating && <strong style={{ color: '#111', marginLeft: 8 }}>★ {avgRating} avg</strong>}
        </div>
        <Btn variant="ghost" onClick={load}>Refresh</Btn>
      </div>
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: '#dc2626' }}>{error}</div>}
        {!loading && !error && items.length === 0 && <div style={{ color: '#6b7280' }}>No feedback yet.</div>}
        {items.map((it) => (
          <div key={it.id} style={{ padding: 12, borderBottom: '1px solid #eee', fontSize: 13 }}>
            <div style={{ marginBottom: 6, color: '#111' }}>
              <strong>{'★'.repeat(it.rating)}{'☆'.repeat(5 - it.rating)}</strong>
              {it.name && <span style={{ color: '#6b7280', marginLeft: 8 }}>{it.name}</span>}
              {it.email && <span style={{ color: '#9ca3af', marginLeft: 8 }}>({it.email})</span>}
            </div>
            {it.comment && <div style={{ color: '#374151' }}>{it.comment}</div>}
            <div style={{ color: '#9ca3af', marginTop: 6, fontSize: 12 }}>
              {it.created_at ? new Date(it.created_at).toLocaleString() : 'Unknown time'}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
