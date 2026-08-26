'use client'

// DEMO-VARIANT van app/team/page.tsx — zelfde structuur/UX (rooster,
// hover-foto, inline-editbare capaciteit, werkdagen-toggle, contacten),
// maar 100% lokaal: geen Supabase-calls, geen echte contactgegevens.
//
// Databronnen vervangen t.o.v. de echte pagina:
//   - teamData.json (echte namen)      → useTeam() (levert al DEMO_MEMBERS
//     op via TeamContext zodra we op /demo zitten — geen eigen databron nodig)
//   - lib/teamPageStore.ts (capaciteit/contacten, gedeelde localStorage-keys)
//     → lib/demoTeamPageStore.ts (eigen 'yoko-demo-team-*' keys)
//   - lib/profileDaysOff.ts (werkdagen, gedeelde key + best-effort Supabase-
//     push naar /api/team/days-off) → lib/demoTeamPageStore.ts se getDaysOff/
//     setDaysOff (puur localStorage, geen backend-call)
//   - lib/teamExtras.ts (leden toevoegen/verwijderen via /team-admin) → niet
//     van toepassing: de demo heeft geen /team-admin, dus geen extra's
//   - data/contacts.json (echte klant-/teamcontacten) → DEMO_CONTACT_GROUPS
//     (verzonnen contacten bij de nep-klanten Noorderlicht Media/Kaap Studio)
// useTeamPhotos()/useProfile() zijn al demo-veilig (zie TeamPhotosContext/
// ProfileContext) en worden ongewijzigd hergebruikt.
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useTeam } from '@/components/TeamContext'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { useProfile } from '@/components/ProfileContext'
import { IconUsers, IconSearch } from '@/components/Icon'
import {
  getCapacities, setCapacity, onCapacitiesChange,
  getContacts, saveContacts, onContactsChange,
  getDaysOff, setDaysOff, onDaysOffChange,
  DEMO_CONTACT_GROUPS,
  type ContactGroup as StoredGroup,
} from '@/lib/demoTeamPageStore'

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
    img.crossOrigin = 'anonymous'
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
const DAY_LABELS_SHORT = ['M', 'D', 'W', 'D', 'V']
const DAY_KEYS         = ['mon', 'tue', 'wed', 'thu', 'fri'] as const

function TeamMemberCard({ member, capacity, daysOff, compact, onDaysOffChange, onCapacityChange }: {
  member: { id: string; name: string; color?: string; email?: string; weeklyCapacity?: number }
  capacity: number
  daysOff: string[]
  compact?: boolean
  onDaysOffChange: (next: string[]) => void
  onCapacityChange: (cap: number) => void
}) {
  // Compact-modus (freelancers): half-size kaart, net als de echte pagina.
  const AV     = compact ? 40 : 72
  const CARD_W = compact ? 88 : 140
  const CARD_P = compact ? '10px 8px' : '20px 16px'
  const DOT    = compact ? 12 : 18
  const NAME_FS = compact ? 11 : 13.5
  const CAP_FS  = compact ? 10 : 11.5
  const { getPhoto, setPhoto }  = useTeamPhotos()
  const { profile }             = useProfile()
  const isMe    = profile?.memberId === member.id
  const photo   = isMe ? (profile?.photo ?? null) : getPhoto(member.id)
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
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 6 : 10,
      padding: CARD_P, background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, width: CARD_W, flexShrink: 0,
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
                style={{ width: AV, height: AV, borderRadius: '50%', objectFit: 'cover', border: `${compact ? 2 : 3}px solid ${member.color}`, display: 'block' }} />
            ) : (
              <div style={{
                width: AV, height: AV, borderRadius: '50%', flexShrink: 0,
                background: member.color + '25', border: `${compact ? 2 : 3}px solid ${member.color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: compact ? 14 : 22, fontWeight: 700, color: member.color,
              }}>
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

          {/* Naam + capaciteit (inline-editbaar) */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: NAME_FS, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{member.name}</div>
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
                  fontSize: CAP_FS, color: 'var(--text-secondary)', fontWeight: 600, borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {capacity}u/week
              </button>
            )}
          </div>
          {/* Werkdagen-rij: 5 dots (Ma-Vr). Klik op een dag → toggle
              werkdag/vrij voor dít teamlid. Puur lokaal in de demo. */}
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}
            title="Klik op een dag om te wisselen tussen werkdag/vrije dag">
            {DAY_KEYS.map((k, i) => {
              const isOff = daysOff.includes(k)
              return (
                <button key={k}
                  onClick={() => {
                    const next = isOff ? daysOff.filter(d => d !== k) : [...daysOff, k]
                    onDaysOffChange(next)
                  }}
                  title={`${DAY_LABELS_SHORT[i]} · ${isOff ? 'vrij — klik om werkdag te maken' : 'werkdag — klik om vrij te maken'}`}
                  style={{
                    width: DOT, height: DOT, borderRadius: 4,
                    background: isOff ? 'var(--overlay-faint)' : (member.color ?? 'var(--accent)') + 'cc',
                    color: isOff ? 'var(--text-muted)' : '#fff',
                    fontSize: compact ? 8 : 9, fontWeight: 700,
                    border: 'none', cursor: 'pointer', padding: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    opacity: isOff ? 0.5 : 1,
                    transition: 'opacity 0.12s',
                  }}>{DAY_LABELS_SHORT[i]}</button>
              )
            })}
          </div>
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DemoTeamPage() {
  // Vaste nep-teamleden via TeamContext (levert DEMO_MEMBERS op zodra we
  // op /demo zitten — zie components/TeamContext.tsx).
  const { members: liveMembers } = useTeam()

  // Capaciteiten: gedeeld met /demo/planning binnen dezelfde demo-sessie
  // via lib/demoTeamPageStore (eigen 'yoko-demo-team-*' keys, nooit de
  // echte 'yoko-capacities').
  const initialCaps: Record<string, number> = Object.fromEntries(
    liveMembers.map(m => [m.id, m.weeklyCapacity ?? 0])
  )
  const [caps, setCaps] = useState<Record<string, number>>(initialCaps)
  useEffect(() => {
    const refresh = () => setCaps({ ...initialCaps, ...getCapacities() })
    refresh()
    return onCapacitiesChange(refresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Werkdagen per teamlid — puur lokaal (lib/demoTeamPageStore), geen
  // Supabase-push zoals de echte pagina (die post naar /api/team/days-off).
  const [daysOffByMember, setDaysOffByMember] = useState<Record<string, string[]>>({})
  useEffect(() => {
    const refresh = () => setDaysOffByMember(getDaysOff())
    refresh()
    return onDaysOffChange(refresh)
  }, [])

  // Contacten leven in localStorage (demo-eigen key) en starten met de
  // verzonnen seed-contacten i.p.v. de echte data/contacts.json.
  const [groups, setGroups] = useState<Group[]>(DEMO_CONTACT_GROUPS)
  useEffect(() => {
    const refresh = () => setGroups(getContacts(DEMO_CONTACT_GROUPS as unknown as StoredGroup[]) as unknown as Group[])
    refresh()
    return onContactsChange(refresh)
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
          type Card = { id: string; name: string; color?: string; email?: string; weeklyCapacity?: number }
          const yokoCards:     Card[] = liveMembers.filter(m => m.kind === 'yoko' && !m.inactive)
          const freeCards:     Card[] = liveMembers.filter(m => m.kind === 'freelance' && !m.inactive)
          const inactiveCards: Card[] = liveMembers.filter(m => m.inactive)

          const renderCard = (m: Card, compact: boolean) => (
            <div key={m.id} style={{ position: 'relative' }}>
              <TeamMemberCard member={m}
                capacity={caps[m.id] ?? m.weeklyCapacity ?? 0}
                daysOff={daysOffByMember[m.id] ?? []}
                compact={compact}
                onDaysOffChange={next => { setDaysOffByMember(p => ({ ...p, [m.id]: next })); setDaysOff(m.id, next) }}
                onCapacityChange={cap => { setCaps(p => ({ ...p, [m.id]: cap })); setCapacity(m.id, cap) }} />
            </div>
          )

          return (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
                Studio Yoko · {yokoCards.length}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
                {yokoCards.map(m => renderCard(m, false))}
              </div>
              {freeCards.length > 0 && (
                <>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
                    Freelance · {freeCards.length}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: inactiveCards.length > 0 ? 24 : 0 }}>
                    {freeCards.map(m => renderCard(m, true))}
                  </div>
                </>
              )}
              {inactiveCards.length > 0 && (
                <>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
                    Inactief · {inactiveCards.length}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', opacity: 0.7 }}>
                    {inactiveCards.map(m => renderCard(m, true))}
                  </div>
                </>
              )}
            </>
          )
        })()}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          Hover over een foto om te wijzigen · klik op de uren/week om de capaciteit aan te passen (gedeeld met Planning) · indeling Yoko/Freelance/Inactief wijzig je via <Link href="/team-admin" style={{ color: 'var(--accent)' }}>Team beheren</Link>
        </p>
      </div>

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
