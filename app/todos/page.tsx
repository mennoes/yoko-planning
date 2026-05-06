'use client'

import { useState, useEffect } from 'react'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { useProfile } from '@/components/ProfileContext'
import { useMemberPopup } from '@/components/MemberPopup'
import { useUndo } from '@/components/UndoContext'
import initialData from '@/data/todos.json'
import teamData    from '@/data/team.json'

type TodoItem = { id: string; text: string; done: boolean }
type Section  = { id: string; title: string; emoji: string; items: TodoItem[] }

const STORAGE_KEY = 'yoko-todos'
const MEMBER_IDS  = new Set(teamData.members.map(m => m.id))

function loadSections(): Section[] {
  if (typeof window === 'undefined') return initialData.sections as Section[]
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? JSON.parse(s) : (initialData.sections as Section[])
  } catch { return initialData.sections as Section[] }
}
function saveSections(s: Section[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// ─── Member avatar ─────────────────────────────────────────────────────────────
function MemberAvatar({ memberId, size = 28 }: { memberId: string; size?: number }) {
  const { getPhoto }  = useTeamPhotos()
  const { profile }   = useProfile()
  const { showMember } = useMemberPopup()
  const member        = teamData.members.find(m => m.id === memberId)
  const isMe          = profile?.memberId === memberId
  const photo         = isMe ? (profile?.photo ?? getPhoto(memberId)) : getPhoto(memberId)
  const [staticFailed, setStaticFailed] = useState(false)
  const staticSrc     = `/team/${memberId}.jpg`
  const initials      = member?.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '?'
  const color         = member?.color ?? '#888'
  const style: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%',
    objectFit: 'cover', flexShrink: 0, cursor: 'pointer',
  }

  if (photo)          return <img src={photo} alt={member?.name} style={style} onClick={e => showMember(memberId, e)} title="Klik voor profiel" />
  if (!staticFailed)  return <img src={staticSrc} alt={member?.name} style={style} onError={() => setStaticFailed(true)} onClick={e => showMember(memberId, e)} title="Klik voor profiel" />
  return (
    <span
      style={{ ...style, border: `1px solid var(--border)`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: color + '22', fontSize: size * 0.36, fontWeight: 700, color }}
      onClick={e => showMember(memberId, e)} title="Klik voor profiel"
    >
      {initials}
    </span>
  )
}

// ─── Todo card ─────────────────────────────────────────────────────────────────
function TodoCard({
  section, isMember, onUpdate,
}: {
  section: Section
  isMember: boolean
  onUpdate: (s: Section, prev?: Section) => void
}) {
  const [newText, setNewText] = useState('')
  const [editId,  setEditId]  = useState<string | null>(null)
  const [editTxt, setEditTxt] = useState('')
  const member = teamData.members.find(m => m.id === section.id)

  function toggle(id: string) {
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: section.items.map(i => i.id === id ? { ...i, done: !i.done } : i) }, prev)
  }
  function add() {
    if (!newText.trim()) return
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: [...section.items, { id: Date.now().toString(), text: newText.trim(), done: false }] }, prev)
    setNewText('')
  }
  function remove(id: string) {
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: section.items.filter(i => i.id !== id) }, prev)
  }
  function saveEdit(id: string) {
    if (!editTxt.trim()) return
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: section.items.map(i => i.id === id ? { ...i, text: editTxt } : i) }, prev)
    setEditId(null)
  }

  const open = section.items.filter(i => !i.done)
  const done = section.items.filter(i => i.done)

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 9 }}>
        {isMember && member ? (
          <MemberAvatar memberId={section.id} size={28} />
        ) : (
          <span style={{ fontSize: 17 }}>{section.emoji}</span>
        )}
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0, flex: 1 }}>
          {section.title}
        </h2>
        {open.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderRadius: 10, padding: '1px 7px' }}>{open.length}</span>
        )}
      </div>

      {/* Open items */}
      <ul style={{ listStyle: 'none', padding: '6px 0 0', margin: 0 }}>
        {open.map(item => (
          <TodoRow key={item.id} item={item} memberId={section.id} isMember={isMember}
            editing={editId === item.id} editTxt={editTxt}
            onToggle={() => toggle(item.id)}
            onRemove={() => remove(item.id)}
            onEditStart={() => { setEditId(item.id); setEditTxt(item.text) }}
            onEditChange={setEditTxt}
            onEditSave={() => saveEdit(item.id)}
            onEditCancel={() => setEditId(null)}
          />
        ))}
      </ul>

      {/* Done items (collapsed) */}
      {done.length > 0 && (
        <details style={{ padding: '0 0 4px' }}>
          <summary style={{ listStyle: 'none', padding: '5px 16px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            ✓ {done.length} afgerond
          </summary>
          <ul style={{ listStyle: 'none', padding: '2px 0', margin: 0 }}>
            {done.map(item => (
              <TodoRow key={item.id} item={item} memberId={section.id} isMember={isMember}
                editing={false} editTxt=""
                onToggle={() => toggle(item.id)} onRemove={() => remove(item.id)}
                onEditStart={() => {}} onEditChange={() => {}} onEditSave={() => {}} onEditCancel={() => {}}
              />
            ))}
          </ul>
        </details>
      )}

      {/* Add */}
      <div style={{ padding: '6px 16px 12px' }}>
        <input
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="+ Voeg toe..."
          style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid transparent', color: 'var(--text-muted)', fontSize: 13, padding: '4px 0', outline: 'none', boxSizing: 'border-box' }}
          onFocus={e => { e.currentTarget.style.borderBottomColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          onBlur={e => { e.currentTarget.style.borderBottomColor = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
        />
      </div>
    </div>
  )
}

function TodoRow({ item, isMember, memberId, editing, editTxt, onToggle, onRemove, onEditStart, onEditChange, onEditSave, onEditCancel }: {
  item: TodoItem; isMember: boolean; memberId: string
  editing: boolean; editTxt: string
  onToggle: () => void; onRemove: () => void
  onEditStart: () => void; onEditChange: (v: string) => void; onEditSave: () => void; onEditCancel: () => void
}) {
  const member = teamData.members.find(m => m.id === memberId)
  const color  = member?.color ?? 'var(--accent)'
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 14px', position: 'relative' }}
      onMouseEnter={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (btn) btn.style.opacity = '1' }}
      onMouseLeave={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (btn) btn.style.opacity = '0' }}
    >
      <button onClick={onToggle} style={{ width: 16, height: 16, minWidth: 16, borderRadius: 4, border: item.done ? 'none' : '2px solid var(--border)', background: item.done ? color : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2, padding: 0, flexShrink: 0 }}>
        {item.done && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input autoFocus value={editTxt} onChange={e => onEditChange(e.target.value)}
            onBlur={onEditSave}
            onKeyDown={e => { if (e.key === 'Enter') onEditSave(); if (e.key === 'Escape') onEditCancel() }}
            style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none' }} />
        ) : (
          <span onDoubleClick={onEditStart} style={{ fontSize: 13.5, color: item.done ? 'var(--text-muted)' : 'var(--text-secondary)', textDecoration: item.done ? 'line-through' : 'none', cursor: 'text', display: 'block', lineHeight: 1.4 }}>
            {item.text}
          </span>
        )}
      </div>
      <button className="del-btn" onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', opacity: 0, flexShrink: 0 }}>×</button>
    </li>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function TodosPage() {
  const { pushUndo } = useUndo()
  const [sections, setSections] = useState<Section[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setSections(loadSections())
    setHydrated(true)
  }, [])

  function updateSection(updated: Section, prev?: Section) {
    const next = sections.map(s => s.id === updated.id ? updated : s)
    setSections(next)
    saveSections(next)
    if (prev) {
      pushUndo(() => {
        const reverted = sections.map(s => s.id === prev.id ? prev : s)
        setSections(reverted)
        saveSections(reverted)
      })
    }
  }

  const general  = sections.filter(s => !MEMBER_IDS.has(s.id))
  const personal = sections.filter(s =>  MEMBER_IDS.has(s.id))

  if (!hydrated) return null

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '44px 36px 80px' }}>
      <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 32px', letterSpacing: '-0.04em' }}>
        ✅ To do&apos;s
      </h1>

      {/* General */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, alignItems: 'start', marginBottom: 28 }}>
        {general.map(s => (
          <TodoCard key={s.id} section={s} isMember={false} onUpdate={updateSection} />
        ))}
      </div>

      {/* Divider */}
      {general.length > 0 && personal.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Persoonlijk</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
      )}

      {/* Personal */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
        {personal.map(s => (
          <TodoCard key={s.id} section={s} isMember={true} onUpdate={updateSection} />
        ))}
      </div>
    </div>
  )
}
