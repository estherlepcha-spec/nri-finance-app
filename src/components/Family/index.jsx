import { useState } from 'react'
import { C, RELATIONS } from '../../utils/constants.js'
import { fmt, uid } from '../../utils/formatting.jsx'
import { Btn, Card, Modal, Input, Sel, Badge, IconBtn, Empty, pg, pgTitle } from '../shared/index.jsx'

export default function Family({ familyMembers, setFamilyMembers, remittances, foreignCurrency }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const blank = { name: '', relation: 'Parent', city: '', phone: '' }
  const [form, setForm] = useState(blank)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = () => {
    if (!form.name) return
    const item = { ...form, id: editing?.id || uid() }
    setFamilyMembers(p => editing ? p.map(m => m.id === editing.id ? item : m) : [...p, item])
    setShowAdd(false); setEditing(null); setForm(blank)
  }

  const edit = m => { setForm({ ...m }); setEditing(m); setShowAdd(true) }
  const del  = id => setFamilyMembers(p => p.filter(m => m.id !== id))
  const sentTo = name => (remittances || []).filter(r => r.recipient === name).reduce((s, r) => s + (r.amount || 0), 0)
  const relIcon = r => ({ Parent: '👴', Spouse: '💑', Child: '👶', Sibling: '👤' }[r] || '👤')

  return (
    <div style={pg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={pgTitle}>Family Members</h2>
        <Btn onClick={() => setShowAdd(true)}>+ Add Member</Btn>
      </div>

      {familyMembers.length === 0
        ? <Empty icon="👨‍👩‍👧" title="No family members" sub="Add family members to track remittances" />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {familyMembers.map(m => {
              const sent = sentTo(m.name)
              return (
                <Card key={m.id} lift accent={C.purple}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}33, ${C.purple}18)`, border: `1.5px solid ${C.purple}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                      {relIcon(m.relation)}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <IconBtn onClick={() => edit(m)}>✏️</IconBtn>
                      <IconBtn onClick={() => del(m.id)}>🗑️</IconBtn>
                    </div>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>{m.name}</div>
                  <Badge color={C.purple}>{m.relation}</Badge>
                  {m.city  && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>📍 {m.city}</div>}
                  {m.phone && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>📞 {m.phone}</div>}
                  {sent > 0 && (
                    <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}33`, borderRadius: 10, padding: '10px 12px', marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total remitted</div>
                      <div className="num" style={{ fontSize: 15, fontWeight: 800, color: C.green }}>{fmt(sent, foreignCurrency)}</div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )
      }

      {showAdd && (
        <Modal title={editing ? 'Edit Family Member' : 'Add Family Member'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <Input label="Name" value={form.name} onChange={f('name')} placeholder="e.g. Mom, Dad" />
          <Sel label="Relation" value={form.relation} onChange={f('relation')} options={RELATIONS} />
          <Input label="City (optional)" value={form.city} onChange={f('city')} placeholder="e.g. Mumbai" />
          <Input label="Phone (optional)" value={form.phone} onChange={f('phone')} placeholder="+91 98765 43210" />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={save} style={{ flex: 1 }}>{editing ? 'Update Member' : 'Add Member'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
