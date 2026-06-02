'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import contactsData from '@/data/contacts.json'
import teamData     from '@/data/team.json'
import { useTeam }  from '@/components/TeamContext'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { useProfile }    from '@/components/ProfileContext'
import { IconUsers, IconSearch } from '@/components/Icon'
import {
  getCapacities, setCapacity, onCapacitiesChange,
  getContacts, saveContacts, onContactsChange,
  type ContactGroup as StoredGroup,
} from '@/lib/teamPageStore'
import { addExtra, removeExtra, listExtras, onTeamUpdate } from '@/lib/teamExtras'

// ─── Contacts types ───────────────────────────────────────────────────────────
type Contact = { id: string; name: string; role: string; email: string; phone: string }
type Group   = { id: string; name: string; color: string; contacts: Contact[] }

// ─── Photo cropper ────────────────────────────────────────────────────────────
function PhotoCropper({ src, onDone, onCancel }: {
  src: string; onDone: (dataUrl: string) => void; onCancel: () => void
}) {
  const [zoom, setZoom]   = useState(1)
  const [pos,  setPos]    = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const SIZE = 200

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      setPos({ x: dragRef.current.ox + ev.clientX - dragRef.current.sx, y: dragRef.current.oy + ev.clientY - dragRef.current.sy })
    }
    function onUp() { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      setZoom(z => Math.min(4, Math.max(0.5, z - e.deltaY * 0.002)))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  function crop() {
    const canvas = document.createElement('canvas')
    canvas.width  = 200; canvas.height = 200
    const ctx = canvas.getContext('2d')!
    const img = new window.Image()
    img.onload = () => {
      const displayW = img.naturalWidth  * zoom
      const displayH = img.naturalHeight * zoom
      const offsetX  = (SIZE / 2 - displayW / 2) + pos.x
      const offsetY  = (SIZE / 2 - displayH / 2) + pos.y
      const scale    = img.naturalWidth  / displayW
      const srcX     = -offsetX * scale
      const srcY     = -offsetY * scale
      const srcW     = SIZE * scale
      const srcH     = SIZE * scale
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, 200, 200)
      onDone(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = src
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div ref={containerRef}
        onMouseDown={startDrag}
        style={{
          width: SIZE, height: SIZE, borderRadius: '50%', overflow: 'hidden',
          cursor: 'grab', userSelect: 'none', border: '2px solid var(--accent)',
          background: `var(--bg-hover) url(${src}) no-repeat`,
          backgroundSize: `${Math.round(zoom * 100)}%`,
          backgroundPosition: `calc(50% + ${pos.x}px) calc(50% + ${pos.y}px)`,
        }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <IconSearch size={14} />
        <input type="range" min={0.5} max={4} step={0.05} value={zoom} onChange={e => setZoom(+e.target.value)}
          style={{ width: 100 }} />
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>Sleep om te positioneren · scroll om in te zoomen</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={cancelBtnStyle}>Annuleren</button>
        <button onClick={crop} style={saveBtnStyle}>Opslaan</button>
      </div>
    </div>
  )
}

// ─── Team member card ─────────────────────────────────────────────────────────
function TeamMemberCard({ member, capacity, onCapacityChange }: {
  member: { id: string; name: string; color?: string; email?: string; weeklyCapacity?: number }
  capacity: number
  onCapacityChange: (cap: number) => void
}) {
  const { getPhoto, setPhoto }  = useTeamPhotos()
  const { profile }             = useProfile()
  const isMe    = profile?.memberId === member.id
  const photo   = isMe ? (profile?.photo ?? null) : getPhoto(member.id)
  const fallback = `/team/${member.id}.jpg`
  const [capEdit, setCapEdit] = useState(false)
  const [capDraft, setCapDraft] = useState(String(capacity))
  useEffect(() => { if (!capEdit) setCapDraft(String(capacity)) }, [capacity, capEdit])

  const [cropSrc,   setCropSrc]   = useState<string | null>(null)
  const [hover,     setHover]     = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = ev => setCropSrc(ev.target?.result as string)
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  const initials = member.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      padding: '20px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, width: 140, flexShrink: 0,
    }}>
      {cropSrc ? (
        <PhotoCropper src={cropSrc} onCancel={() => setCropSrc(null)}
          onDone={url => { setPhoto(member.id, url); setCropSrc(null) }} />
      ) : (
        <>
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
            {photo ? (
              <img src={photo} alt={member.name}
                style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${member.color}`, display: 'block' }} />
            ) : (
              <div style={{
                width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
                background: member.color + '25', border: `3px solid ${member.color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 700, color: member.color,
              }}>
                {/* Try static /team/ photo as fallback */}
                <img src={fallback} alt={member.name}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', position: 'absolute', top: 0, left: 0 }} />
                {initials}
              </div>
            )}
            {hover && !isMe && (
              <button onClick={() => fileRef.current?.click()} style={{
                position: 'absolute', inset: 0, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 11, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>📷</button>
            )}
            {isMe && hover && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 9.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 4,
              }}>profiel instelling</div>
            )}
          </div>

          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />

          {/* Name + capacity (capacity is inline-editable + gedeeld met Planning) */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{member.name}</div>
            {capEdit ? (
              <input autoFocus type="number" min={0} value={capDraft}
                onChange={e => setCapDraft(e.target.value)}
                onBlur={() => { const n = Math.max(0, parseFloat(capDraft) || 0); onCapacityChange(n); setCapEdit(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { const n = Math.max(0, parseFloat(capDraft) || 0); onCapacityChange(n); setCapEdit(false) }
                  if (e.key === 'Escape') { setCapDraft(String(capacity)); setCapEdit(false) }
                }}
                style={{ width: 70, marginTop: 4, padding: '3px 6px', fontSize: 12, textAlign: 'center',
                  background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 4,
                  color: 'var(--text-primary)', outline: 'none' }} />
            ) : (
              <button onClick={() => setCapEdit(true)} title="Klik om uren/week te wijzigen"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', marginTop: 2,
                  fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {capacity}u/week
              </button>
            )}
          </div>

          {/* Color dot */}
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: member.color, flexShrink: 0 }} />
        </>
      )}
    </div>
  )
}

// ─── Contact avatar ───────────────────────────────────────────────────────────
function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
      background: color + '25', border: `2px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700, color,
    }}>{initials}</div>
  )
}

// ─── Contact group ────────────────────────────────────────────────────────────
function ContactGroup({ group, onChange }: {
  group: Group
  onChange: (g: Group) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  function updateContact(id: string, patch: Partial<Contact>) {
    onChange({ ...group, contacts: group.contacts.map(c => c.id === id ? { ...c, ...patch } : c) })
  }
  function deleteContact(id: string) {
    const c = group.contacts.find(x => x.id === id)
    if (c && c.name && !confirm(`'${c.name}' verwijderen?`)) return
    onChange({ ...group, contacts: group.contacts.filter(c => c.id !== id) })
  }
  function addContact() {
    onChange({ ...group, contacts: [...group.contacts, { id: `c_${Date.now()}`, name: '', role: '', email: '', phone: '' }] })
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderLeft: `4px solid ${group.color}`,
        background: 'var(--overlay-subtle)', cursor: 'pointer',
      }} onClick={() => setCollapsed(c => !c)}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{collapsed ? '▶' : '▼'}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: group.color }}>{group.name}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{group.contacts.length} personen</span>
      </div>

      {!collapsed && (
        <div style={{ borderLeft: `4px solid ${group.color}` }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 160px 220px 160px 36px',
            background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)',
          }}>
            {['Naam', 'Functie', 'E-mail', 'Telefoon', ''].map((h, i) => (
              <div key={h || `e-${i}`} style={{
                padding: '6px 14px', fontSize: 11, fontWeight: 700,
                color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em',
                borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
              }}>{h}</div>
            ))}
          </div>
          {group.contacts.map(contact => (
            <ContactRow key={contact.id} contact={contact} color={group.color}
              onUpdate={u => updateContact(contact.id, u)}
              onDelete={() => deleteContact(contact.id)} />
          ))}
          <div style={{ padding: '8px 14px' }}>
            <button onClick={addContact}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
              + Voeg contact toe
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ContactRow({ contact, color, onUpdate, onDelete }: {
  contact: Contact; color: string
  onUpdate: (u: Partial<Contact>) => void
  onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 160px 220px 160px 36px',
      alignItems: 'center', minHeight: 44, borderBottom: '1px solid var(--border)',
      background: hover ? 'var(--overlay-hover)' : 'transparent', transition: 'background 0.1s',
    }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={contact.name} color={color} />
        <InlineField value={contact.name} placeholder="Naam" onSave={v => onUpdate({ name: v })}
          style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }} />
      </div>
      <div style={{ padding: '6px 14px', borderLeft: '1px solid var(--border)' }}>
        <InlineField value={contact.role} placeholder="Functie" onSave={v => onUpdate({ role: v })}
          style={{ fontSize: 13, color: 'var(--text-secondary)' }} />
      </div>
      <div style={{ padding: '6px 14px', borderLeft: '1px solid var(--border)' }}>
        <InlineField value={contact.email} placeholder="E-mail" type="email" onSave={v => onUpdate({ email: v })}
          style={{ fontSize: 13, color: contact.email ? 'var(--blue)' : 'var(--text-muted)' }} />
      </div>
      <div style={{ padding: '6px 14px', borderLeft: '1px solid var(--border)' }}>
        <InlineField value={contact.phone} placeholder="Telefoon" onSave={v => onUpdate({ phone: v })}
          style={{ fontSize: 13, color: 'var(--text-secondary)' }} />
      </div>
      <div style={{ borderLeft: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        {hover && (
          <button onClick={onDelete} title="Contact verwijderen"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '2px 6px', borderRadius: 3 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #e2445c)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
        )}
      </div>
    </div>
  )
}

// Klik op tekst → input; Enter/blur slaat op, Escape annuleert.
function InlineField({ value, placeholder, onSave, style, type = 'text' }: {
  value: string; placeholder: string; onSave: (v: string) => void
  style?: React.CSSProperties
  type?: 'text' | 'email' | 'tel'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  if (editing) return (
    <input autoFocus type={type} value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onSave(draft); setEditing(false) }}
      onKeyDown={e => {
        if (e.key === 'Enter') { onSave(draft); setEditing(false) }
        if (e.key === 'Escape') { setDraft(value); setEditing(false) }
      }}
      placeholder={placeholder}
      style={{ width: '100%', boxSizing: 'border-box',
        padding: '4px 6px', background: 'var(--bg-base)', border: '1px solid var(--accent)',
        borderRadius: 4, color: 'var(--text-primary)', outline: 'none', ...style, fontWeight: 500 }} />
  )
  return (
    <span onClick={() => setEditing(true)} title="Klik om te bewerken"
      style={{ cursor: 'text', display: 'inline-block', padding: '2px 0', minHeight: 18, ...style }}>
      {value || <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>}
    </span>
  )
}

// ─── + Lid toevoegen modal ─────────────────────────────────────────────────
const PALETTE = ['#579bfc','#9c7ee8','#e2445c','#00c875','#ffcb00','#ff7a00','#a25ddc','#26b3a4','#ec6e8b','#7a5af8','#1e8a4e','#1ab0d8']

function slugify(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || `lid-${Date.now().toString(36)}`
}

function AddMemberModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { members: liveMembers, refresh: refreshTeam } = useTeam()
  const [name, setName]   = useState('')
  const [email, setEmail] = useState('')
  const [cap, setCap]     = useState('40')
  const [color, setColor] = useState(PALETTE[Math.floor(Math.random() * PALETTE.length)])
  const [kind, setKind]   = useState<'yoko' | 'freelance'>('yoko')
  const [err, setErr]     = useState<string | null>(null)
  const [busy, setBusy]   = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    if (busy) return
    if (!name.trim()) { setErr('Naam is verplicht'); return }
    const id = slugify(name)
    const conflict =
      teamData.members.some(m => m.id === id) ||
      liveMembers.some(m => m.id === id)
    if (conflict) {
      setErr(`Er bestaat al een lid met id '${id}'`)
      return
    }
    setBusy(true)
    const weeklyCapacity = Math.max(0, parseFloat(cap) || 0)
    // Pushen naar Supabase team_members tabel (dezelfde bron als
    // /team-admin) zodat alles consistent op één plek leeft.
    const pos = Math.max(0, ...liveMembers.map(m => m.position)) + 1
    const { upsertTeamMember } = await import('@/lib/teamStore')
    const res = await upsertTeamMember({
      id, name: name.trim(), email: email.trim(),
      color, weeklyCapacity, position: pos, hidden: false, kind,
    })
    if (!res.ok) {
      setErr(`Opslaan mislukt: ${res.error}. Mogelijke oorzaak: Supabase-migratie 0017/0018 nog niet gedraaid.`)
      setBusy(false)
      return
    }
    if (res.error === 'kind_column_missing_run_0018') {
      setErr('Lid toegevoegd — maar run nog supabase/0018_team_members_kind.sql om de Yoko/Freelance-indeling te bewaren.')
    }
    await refreshTeam()
    // Stuur direct ook een Supabase auth-invite uit zodat de nieuwe
    // persoon meteen kan inloggen. Faalt stil — admin kan later via
    // de ✉ Invite knop op /team-admin opnieuw versturen.
    const inviteEmail = email.trim()
    if (inviteEmail) {
      try {
        const { supabase } = await import('@/lib/supabase')
        const sess = await supabase?.auth.getSession()
        const token = sess?.data.session?.access_token
        if (token) {
          await fetch('/api/team/invite', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: inviteEmail, name: name.trim() }),
          })
        }
      } catch { /* ignore */ }
    }
    onAdded()
    setBusy(false)
    onClose()
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 9001,
        width: 'min(440px, 92vw)', background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Lid toevoegen</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={modalLabel}>Naam
            <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              placeholder="Henk de Vries" style={modalInput} />
          </label>
          <div>
            <div style={{ ...modalLabel, marginBottom: 6 }}>Team</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { id: 'yoko',      label: 'Studio Yoko' },
                { id: 'freelance', label: 'Freelance'   },
              ] as { id: 'yoko' | 'freelance'; label: string }[]).map(opt => (
                <button key={opt.id} onClick={() => setKind(opt.id)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 7,
                    border: '1px solid ' + (kind === opt.id ? 'var(--accent)' : 'var(--border)'),
                    background: kind === opt.id ? 'var(--accent)' : 'transparent',
                    color: kind === opt.id ? '#fff' : 'var(--text-secondary)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>
          <label style={modalLabel}>E-mail (verstuurt invite zodat ze kunnen inloggen)
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="henk@studioyoko.nl" style={modalInput} />
          </label>
          <label style={modalLabel}>Uren per week
            <input type="number" min="0" step="0.5" value={cap} onChange={e => setCap(e.target.value)}
              style={modalInput} />
          </label>
          <div>
            <div style={{ ...modalLabel, marginBottom: 6 }}>Kleur</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PALETTE.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  style={{ width: 26, height: 26, borderRadius: 7, background: c,
                    border: color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                    cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
          </div>
          {err && <p style={{ margin: 0, color: 'var(--red, #e2445c)', fontSize: 12.5 }}>{err}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Annuleer
            </button>
            <button onClick={save} disabled={busy}
              style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Bezig…' : 'Toevoegen'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

const modalLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
}
const modalInput: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TeamPage() {
  // Live team-leden uit Supabase voor de kind-indeling (yoko/freelance).
  // Bij ontbreken vallen we terug op YOKO_IDS-set; zie de render hieronder.
  const { members: liveMembers } = useTeam()
  // Capaciteiten zijn gedeeld met de Planning-pagina via localStorage; we
  // luisteren ook live mee zodat een aanpassing in Planning hier direct
  // doorkomt (en andersom).
  const initialCaps: Record<string, number> = Object.fromEntries(
    teamData.members.map(m => [m.id, m.weeklyCapacity ?? 0])
  )
  const [caps, setCaps] = useState<Record<string, number>>(initialCaps)
  useEffect(() => {
    const refresh = () => {
      const ov = getCapacities()
      setCaps({ ...initialCaps, ...ov })
    }
    refresh()
    return onCapacitiesChange(refresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Trigger om de page te herrenderen wanneer iemand een lid toevoegt of
  // verwijdert via onze /team UI (mutatie op teamData.members gebeurt al
  // door de store; deze counter zorgt voor de React re-render).
  const [, bumpRender] = useState(0)
  useEffect(() => onTeamUpdate(() => bumpRender(x => x + 1)), [])
  const extraIds = new Set(listExtras().map(e => e.id))

  // Contacts leven in localStorage (override op data/contacts.json) en
  // worden via een custom event live ge-sync'd binnen dezelfde browser.
  const initialGroups = contactsData.groups as Group[]
  const [groups, setGroups] = useState<Group[]>(initialGroups)
  useEffect(() => {
    const refresh = () => setGroups(getContacts(initialGroups as unknown as StoredGroup[]) as unknown as Group[])
    refresh()
    return onContactsChange(refresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function updateGroup(next: Group) {
    const updated = groups.map(g => g.id === next.id ? next : g)
    setGroups(updated)
    saveContacts(updated as unknown as StoredGroup[])
  }

  return (
    <div style={{ padding: '32px 32px 64px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconUsers size={26} />Team
        </h1>
      </div>

      {/* ── Yoko team ── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
            Studio Yoko
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }} />
          <Link href="/team-admin"
            style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'var(--bg-card)', color: 'var(--text-secondary)',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}>
            ⚙ Beheer team
          </Link>
        </div>
        {(() => {
          // Bron-lijst: live team_members uit Supabase aangevuld met
          // teamData.members die nog niet in de DB staan (legacy/fallback).
          // Resultaat: alles wat via /team-admin OF de + Lid toevoegen-modal
          // is aangemaakt verschijnt hier zonder redeploy.
          const YOKO_IDS = new Set(['menno','vincent','odette','anne-fleur','kars'])
          type Card = { id: string; name: string; color?: string; email?: string; weeklyCapacity?: number }
          const seen = new Set<string>()
          const all: Card[] = []
          for (const m of liveMembers) {
            if (m.hidden) continue
            if (m.id === 'unassigned') continue
            seen.add(m.id)
            all.push({ id: m.id, name: m.name, color: m.color, email: m.email, weeklyCapacity: m.weeklyCapacity })
          }
          for (const m of teamData.members) {
            if (seen.has(m.id) || m.id === 'unassigned') continue
            seen.add(m.id)
            all.push({ id: m.id, name: m.name, color: m.color, email: m.email, weeklyCapacity: m.weeklyCapacity })
          }
          const kindOf = (id: string): 'yoko' | 'freelance' | 'unassigned' => {
            const fromDb = liveMembers.find(lm => lm.id === id)?.kind
            if (fromDb) return fromDb
            if (id === 'unassigned') return 'unassigned'
            return YOKO_IDS.has(id) ? 'yoko' : 'freelance'
          }
          const yokoCards = all.filter(m => kindOf(m.id) === 'yoko')
          const freeCards = all.filter(m => kindOf(m.id) === 'freelance')

          const renderCard = (m: Card) => (
            <div key={m.id} style={{ position: 'relative' }}>
              <TeamMemberCard member={m}
                capacity={caps[m.id] ?? m.weeklyCapacity ?? 0}
                onCapacityChange={cap => { setCaps(p => ({ ...p, [m.id]: cap })); setCapacity(m.id, cap) }} />
              {extraIds.has(m.id) && (
                <button onClick={() => {
                  if (confirm(`'${m.name}' verwijderen?`)) removeExtra(m.id)
                }} title="Lid verwijderen"
                  style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.45)', color: '#fff', border: 'none', cursor: 'pointer',
                    fontSize: 14, lineHeight: 1, padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              )}
            </div>
          )

          return (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
                Studio Yoko · {yokoCards.length}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
                {yokoCards.map(renderCard)}
              </div>
              {freeCards.length > 0 && (
                <>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
                    Freelance · {freeCards.length}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {freeCards.map(renderCard)}
                  </div>
                </>
              )}
            </>
          )
        })()}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          Hover over een foto om te wijzigen · klik op de uren/week om de capaciteit aan te passen (gedeeld met Planning) · indeling Yoko/Freelance wijzig je via <Link href="/team-admin" style={{ color: 'var(--accent)' }}>Team beheren</Link>
        </p>
      </div>

      {/* AddMemberModal verwijderd — toevoegen / bewerken / verwijderen
          gaat nu via /team-admin (één bron van waarheid). */}

      {/* ── Contacts ── */}
      {groups.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 16 }}>
            Contacten · {groups.reduce((s, g) => s + g.contacts.length, 0)} personen
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'visible' }}>
            {groups.map(group => (
              <ContactGroup key={group.id} group={group} onChange={updateGroup} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Shared styles ─────────────────────────────────────────────────────────────
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-hover)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
}
const saveBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700,
}
