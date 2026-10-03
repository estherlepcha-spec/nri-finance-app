import { useEffect, useState } from 'react'
import { Modal, Btn } from '../shared/index.jsx'

export default function ExitSurveyAdmin({ onClose = () => {} }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/exit-surveys')
      if (r.ok) setItems(await r.json())
    } catch (e) {
      console.log('Failed to load exit surveys', e)
    } finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [])

  return (
    <Modal title={`Exit surveys (${items.length})`} onClose={onClose} width={760}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#6b7280' }}>Recent responses from the onboarding exit survey.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={load}>Refresh</Btn>
          <Btn variant="ghost" onClick={() => { setItems([]) }}>Clear view</Btn>
        </div>
      </div>
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {loading && <div>Loading…</div>}
        {!loading && items.length === 0 && <div style={{ color: '#6b7280' }}>No entries yet.</div>}
        {items.map((it, i) => (
          <div key={i} style={{ padding: 12, borderBottom: '1px solid #eee', fontSize: 13 }}>
            <div style={{ marginBottom: 6, color: '#111' }}><strong>{it.q1 || '(no answer)'}</strong> → {it.q2 || '(no answer)'}</div>
            <div style={{ color: '#374151' }}>{it.comment || ''}</div>
            <div style={{ color: '#9ca3af', marginTop: 6, fontSize: 12 }}>{it.receivedAt || it.timestamp ? new Date(it.receivedAt || it.timestamp).toLocaleString() : 'Unknown time'}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
