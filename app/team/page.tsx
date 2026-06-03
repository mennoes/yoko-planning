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
import { loadDaysOff, setDaysOff, onDaysOffChange } from '@/lib/daysOffStore'

// ─── Vrije dagen rij — Ma t/m Vr toggle-knoppen onder elke kaart ──────────────
function DaysOffRow({ memberId, memberColor }: { memberId: string; memberColor: string }) {
  const [days, setDays] = useState<number[]>(() => loadDaysOff()[memberId] ?? [])
  useEffect(() => {
    const refresh = () => setDays(loadDaysOff()[memberId] ?? [])
    refresh()
    return onDaysOffChange(refresh)
  }, [memberId])

  function toggle(d: number) {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d]
    setDaysOff(memberId, next)  // emit-event triggert refresh hierboven
  }

  const LABELS: [number, string][] = [
    [1, 'M'], [2, 'D'], [3, 'W'], [4, 'D'], [5, 'V'],
  ]
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 4 }} title="Klik op een dag om 'm als vrije dag te markeren">
      {LABELS.map(([d, lbl]) => {
        const off = days.includes(d)
        return (
          <button key={d} onClick={() => toggle(d)}
            title={off ? `Markeer ${lbl} als werkdag` : `Markeer ${lbl} als vrije dag`}
            style={{
              width: 18, height: 18, padding: 0,
              borderRadius: 4, border: '1px solid ' + (off ? memberColor : 'var(--border)'),
              background: off ? memberColor : 'transparent',
              color: off ? '#fff' : 'var(--text-muted)',
              fontSize: 9.5, fontWeight: 700, lineHeight: 1, cursor: 'pointer',
            }}>{lbl}</button>
        )
      })}
    </div>
  )
}

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

          {/* Vrije dagen toggles — Ma t/m Vr. Klik om aan/uit te zetten;
              dat gaat naar daysOffStore (+ Supabase) en de werkdruk-
              distributie skipt deze weekdagen voor dit teamlid. */}
          <DaysOffRow memberId={member.id} memberColor={member.color ?? '#888'} />

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

// Legacy AddMemberModal volledig verwijderd — /team-admin is de enige
// plek voor team-beheer. Onderstaand placeholder zodat eventuele
// resterende verwijzingen niet onverwacht falen, maar 't bestand bevat
// 'm niet meer als gebruikt component.


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
