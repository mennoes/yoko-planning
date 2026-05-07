'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import contactsData from '@/data/contacts.json'
import teamData     from '@/data/team.json'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { useProfile }    from '@/components/ProfileContext'
import { IconUsers, IconSearch } from '@/components/Icon'

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
function TeamMemberCard({ member }: { member: typeof teamData.members[number] }) {
  const { getPhoto, setPhoto }  = useTeamPhotos()
  const { profile }             = useProfile()
  const isMe    = profile?.memberId === member.id
  const photo   = isMe ? (profile?.photo ?? null) : getPhoto(member.id)
  const fallback = `/team/${member.id}.jpg`

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

          {/* Name + capacity */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{member.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{member.weeklyCapacity}u/week</div>
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
function ContactGroup({ group }: { group: Group }) {
  const [collapsed, setCollapsed] = useState(false)

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
            display: 'grid', gridTemplateColumns: '1fr 160px 220px 160px',
            background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)',
          }}>
            {['Naam', 'Functie', 'E-mail', 'Telefoon'].map(h => (
              <div key={h} style={{
                padding: '6px 14px', fontSize: 11, fontWeight: 700,
                color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em',
                borderLeft: h !== 'Naam' ? '1px solid var(--border)' : 'none',
              }}>{h}</div>
            ))}
          </div>
          {group.contacts.map(contact => (
            <ContactRow key={contact.id} contact={contact} color={group.color} />
          ))}
        </div>
      )}
    </div>
  )
}

function ContactRow({ contact, color }: { contact: Contact; color: string }) {
  const [hover, setHover] = useState(false)
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 160px 220px 160px',
      alignItems: 'center', minHeight: 44, borderBottom: '1px solid var(--border)',
      background: hover ? 'var(--overlay-hover)' : 'transparent', transition: 'background 0.1s',
    }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={contact.name} color={color} />
        <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary)' }}>{contact.name}</span>
      </div>
      <div style={{ padding: '6px 14px', borderLeft: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
        {contact.role || <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </div>
      <div style={{ padding: '6px 14px', borderLeft: '1px solid var(--border)', fontSize: 13 }}>
        {contact.email ? (
          <a href={`mailto:${contact.email}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>{contact.email}</a>
        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </div>
      <div style={{ padding: '6px 14px', borderLeft: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
        {contact.phone || <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TeamPage() {
  const groups = contactsData.groups as Group[]

  return (
    <div style={{ padding: '32px 32px 64px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconUsers size={26} />Team
        </h1>
      </div>

      {/* ── Yoko team ── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 16 }}>
          Studio Yoko
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {teamData.members.map(m => <TeamMemberCard key={m.id} member={m} />)}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          Hover over een foto om te wijzigen · je eigen profiel beheer je via de sidebar
        </p>
      </div>

      {/* ── Contacts ── */}
      {groups.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 16 }}>
            Contacten · {groups.reduce((s, g) => s + g.contacts.length, 0)} personen
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'visible' }}>
            {groups.map(group => <ContactGroup key={group.id} group={group} />)}
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
