'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import teamData from '@/data/team.json'
import { useProfile } from '@/components/ProfileContext'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { supabase } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/sync'
import { useIsMobile } from '@/lib/useIsMobile'
import { fmtMinutes, loadEntries } from '@/lib/timerStore'

type ExtendedProfile = {
  user_id?:           string
  member_id?:         string
  name?:              string
  color?:             string
  photo?:             string | null
  weekly_capacity?:   number
  email?:             string | null
  phone?:             string | null
  emergency_contact?: string | null
  emergency_phone?:   string | null
  role?:              string | null
  office?:            string | null
  birthday?:          string | null
  pronouns?:          string | null
  languages?:         string | null
  slack_handle?:      string | null
  linkedin?:          string | null
  days_off?:          string[] | null
  vacation_until?:    string | null
  fun_fact?:          string | null
  bio?:               string | null
}

const DAY_LABELS: Record<string, string> = {
  mon: 'Ma', tue: 'Di', wed: 'Wo', thu: 'Do', fri: 'Vr', sat: 'Za', sun: 'Zo',
}
const NL_MON = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']

function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate()} ${NL_MON[d.getMonth()]}${d.getFullYear() ? ` ${d.getFullYear()}` : ''}`
}

export default function PublicProfilePage() {
  const params = useParams<{ memberId: string }>()
  const memberId = params.memberId
  const { profile: myProfile, openEdit } = useProfile()
  const { getPhoto } = useTeamPhotos()
  const isMobile = useIsMobile()

  const [data, setData] = useState<ExtendedProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const baseMember = teamData.members.find(m => m.id === memberId)
  const isMe = myProfile?.memberId === memberId

  useEffect(() => {
    if (!supabase) { setLoaded(true); return }
    let cancelled = false
    async function pull() {
      const { data: rows } = await supabase!
        .from('profiles').select('*').eq('member_id', memberId).maybeSingle()
      if (cancelled) return
      setData(rows as ExtendedProfile | null)
      setLoaded(true)
    }
    pull()
    return () => { cancelled = true }
  }, [memberId])

  async function persistField(patch: Partial<ExtendedProfile>) {
    if (!supabase || !isMe) return
    const next = { ...(data ?? {}), ...patch }
    setData(next)
    await supabase.from('profiles').update(patch).eq('member_id', memberId)
  }

  if (!loaded) return null
  if (!baseMember) {
    return <div style={{ padding: 40 }}><h1>Onbekend teamlid</h1></div>
  }

  const name    = data?.name ?? baseMember.name
  const color   = data?.color ?? baseMember.color
  const photo   = data?.photo ?? (memberId ? getPhoto(memberId) : null) ?? `/team/${memberId}.jpg`
  const cap     = data?.weekly_capacity ?? baseMember.weeklyCapacity ?? 40

  // Time-tracking summary for this member's currently-running entries (only their own
  // entries are accessible; for others we just show capacity)
  const myMinutesThisWeek = isMe ? totalMinutesThisWeek() : null

  const hasAnyValue = EDITABLE_FIELDS.some(f => fieldHasValue(data, f))

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? '24px 16px 80px' : '52px 36px 100px' }}>

      {/* Hero */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginBottom: 24 }}>
        <ClickableAvatar
          photo={photo}
          name={name}
          color={color}
          editable={isMe}
          onPicked={async (dataUrl) => {
            // Save to profile + DB if available
            if (myProfile) {
              if (supabase && await getCurrentUserId()) {
                await supabase.from('profiles').update({ photo: dataUrl }).eq('member_id', memberId)
              }
              // also reflect immediately via context (profileSet not exposed here — fall back to localStorage)
              setData(d => ({ ...(d ?? {}), photo: dataUrl }))
            }
          }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Studio Yoko · Teamlid
          </div>
          <h1 style={{ fontSize: isMobile ? 30 : 40, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.03em', lineHeight: 1 }}>
            {name}
          </h1>
          {data?.role && <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text-secondary)' }}>{data.role}</div>}
          {isMe && (
            <button onClick={openEdit}
              style={{ marginTop: 12, padding: '7px 14px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600,
                cursor: 'pointer' }}>
              Bewerk profiel
            </button>
          )}
        </div>
      </div>

      {/* Bio */}
      {data?.bio && (
        <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)', margin: '0 0 24px', whiteSpace: 'pre-wrap' }}>
          {data.bio}
        </p>
      )}

      {/* Vacation banner */}
      {data?.vacation_until && new Date(data.vacation_until).getTime() > Date.now() && (
        <div style={{ background: 'rgba(255,123,36,0.12)', border: '1px solid rgba(255,123,36,0.3)', color: '#a05400', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
          Op vakantie tot {fmtDate(data.vacation_until)}
        </div>
      )}

      {/* Bio (editable when isMe) */}
      {(data?.bio || isMe) && (
        <BioField value={data?.bio ?? ''} editable={isMe}
          onSave={v => persistField({ bio: v })} />
      )}

      {/* Field grid */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 14, overflow: 'hidden', marginTop: 24 }}>
        {(isMe ? EDITABLE_FIELDS : EDITABLE_FIELDS.filter(f => fieldHasValue(data, f))).map((f, i, arr) => (
          <div key={f.key} style={{
            display: 'grid', gridTemplateColumns: isMobile ? '110px 1fr' : '160px 1fr',
            gap: 12, padding: '12px 18px',
            borderBottom: i < arr.length - 1 ? '1px solid var(--border-light)' : 'none',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</span>
            {isMe ? (
              <EditableValue field={f} data={data} onSave={persistField} />
            ) : (
              <span style={{ fontSize: 14, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                {renderReadValue(f, data)}
              </span>
            )}
          </div>
        ))}
        {!isMe && !hasAnyValue && !data?.bio && (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Dit teamlid heeft nog geen extra info ingevuld.
          </div>
        )}
      </div>

      {isMe && myMinutesThisWeek !== null && (
        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text-muted)' }}>
          Jij hebt deze week {fmtMinutes(myMinutesThisWeek)} gelogd via de timer.
        </div>
      )}
    </div>
  )
}

function totalMinutesThisWeek(): number {
  const start = new Date()
  const day = (start.getDay() + 6) % 7  // monday = 0
  start.setDate(start.getDate() - day); start.setHours(0,0,0,0)
  const startMs = start.getTime()
  return loadEntries()
    .filter(e => new Date(e.start).getTime() >= startMs)
    .reduce((s, e) => s + e.minutes, 0)
}

const linkStyle: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }

// ─── Clickable avatar with file-upload menu ──────────────────────────────────
function ClickableAvatar({ photo, name, color, editable, onPicked }: {
  photo: string; name: string; color: string; editable: boolean
  onPicked: (dataUrl: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hover, setHover] = useState(false)

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => { onPicked(String(e.target?.result ?? '')); setMenuOpen(false) }
    reader.readAsDataURL(file)
  }

  return (
    <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <img src={photo} alt={name}
        onClick={() => editable && setMenuOpen(o => !o)}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        style={{
          width: 110, height: 110, borderRadius: '50%',
          objectFit: 'cover', cursor: editable ? 'pointer' : 'default',
          background: 'var(--bg-card)',
        }} />
      {editable && (hover || menuOpen) && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          pointerEvents: 'none',
        }}>
          Wijzig foto
        </div>
      )}

      {menuOpen && editable && (
        <>
          <div onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{
            position: 'absolute', top: 118, left: 0, zIndex: 201,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 6, minWidth: 200,
            boxShadow: '0 14px 40px rgba(0,0,0,0.25)',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <button onClick={() => fileRef.current?.click()} style={menuItemStyle}>
              📤 Upload foto…
            </button>
            <button onClick={() => { onPicked(''); setMenuOpen(false) }}
              style={{ ...menuItemStyle, color: 'var(--text-muted)' }}>
              Verwijder foto
            </button>
          </div>
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', textAlign: 'left',
  padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500,
  color: 'var(--text-primary)', cursor: 'pointer',
}

// ─── Editable fields config ──────────────────────────────────────────────────
type FieldDef = {
  key:    keyof ExtendedProfile
  label:  string
  type:   'text' | 'email' | 'tel' | 'date' | 'url' | 'longtext' | 'days'
}
const EDITABLE_FIELDS: FieldDef[] = [
  { key: 'role',              label: 'Functie',         type: 'text' },
  { key: 'office',            label: 'Kantoor',         type: 'text' },
  { key: 'email',             label: 'Email',           type: 'email' },
  { key: 'phone',             label: 'Telefoon',        type: 'tel' },
  { key: 'birthday',          label: 'Verjaardag',      type: 'date' },
  { key: 'pronouns',          label: 'Voornaamwoorden', type: 'text' },
  { key: 'languages',         label: 'Talen',           type: 'text' },
  { key: 'slack_handle',      label: 'Slack',           type: 'text' },
  { key: 'linkedin',          label: 'LinkedIn',        type: 'url' },
  { key: 'days_off',          label: 'Werkdagen vrij',  type: 'days' },
  { key: 'vacation_until',    label: 'Vakantie tot',    type: 'date' },
  { key: 'emergency_contact', label: 'Noodcontact',     type: 'text' },
  { key: 'emergency_phone',   label: 'Noodnummer',      type: 'tel' },
  { key: 'fun_fact',          label: 'Fun fact',        type: 'text' },
]

function fieldHasValue(d: ExtendedProfile | null, f: FieldDef): boolean {
  if (!d) return false
  const v = d[f.key]
  if (Array.isArray(v)) return v.length > 0
  return !!v
}

function renderReadValue(f: FieldDef, d: ExtendedProfile | null): React.ReactNode {
  if (!d) return null
  const v = d[f.key]
  if (!v) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  if (f.type === 'email')  return <a href={`mailto:${v}`} style={linkStyle}>{String(v)}</a>
  if (f.type === 'tel')    return <a href={`tel:${String(v).replace(/\s/g,'')}`} style={linkStyle}>{String(v)}</a>
  if (f.type === 'url')    return <a href={String(v)} target="_blank" rel="noopener noreferrer" style={linkStyle}>profiel ↗</a>
  if (f.type === 'date')   return fmtDate(String(v))
  if (f.type === 'days')   return Array.isArray(v) ? v.map(d => DAY_LABELS[d as string] ?? d).join(', ') : String(v)
  return String(v)
}

// Inline editable cell — click to edit, blur to save
function EditableValue({ field, data, onSave }: {
  field: FieldDef; data: ExtendedProfile | null; onSave: (patch: Partial<ExtendedProfile>) => void
}) {
  const [editing, setEditing] = useState(false)
  const raw = data?.[field.key]

  if (field.type === 'days') {
    const set = new Set<string>(Array.isArray(raw) ? (raw as string[]) : [])
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(['mon','tue','wed','thu','fri','sat','sun'] as const).map(d => {
          const on = set.has(d)
          return (
            <button key={d} onClick={() => {
                const next = new Set(set); on ? next.delete(d) : next.add(d)
                onSave({ days_off: Array.from(next) })
              }}
              style={{ padding: '4px 9px', borderRadius: 6,
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border-light)'}`,
                background: on ? 'var(--accent-light)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {DAY_LABELS[d]}
            </button>
          )
        })}
      </div>
    )
  }

  if (!editing) {
    const display = raw
      ? (field.type === 'date' ? fmtDate(String(raw)) : String(raw))
      : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>+ Vul in</span>
    return (
      <span onClick={() => setEditing(true)}
        style={{ fontSize: 14, color: 'var(--text-primary)', cursor: 'text', minHeight: 20, display: 'inline-block' }}>
        {display}
      </span>
    )
  }
  const inputType = field.type === 'longtext' ? 'text'
    : field.type === 'email' ? 'email'
    : field.type === 'tel'   ? 'tel'
    : field.type === 'url'   ? 'url'
    : field.type === 'date'  ? 'date'
    : 'text'
  return (
    <input autoFocus type={inputType}
      defaultValue={raw ? String(raw) : ''}
      onBlur={e => { onSave({ [field.key]: e.currentTarget.value || null } as Partial<ExtendedProfile>); setEditing(false) }}
      onKeyDown={e => {
        if (e.key === 'Enter') { onSave({ [field.key]: e.currentTarget.value || null } as Partial<ExtendedProfile>); setEditing(false) }
        if (e.key === 'Escape') setEditing(false)
      }}
      style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--accent)',
        borderRadius: 6, padding: '6px 9px', color: 'var(--text-primary)',
        fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
  )
}

function BioField({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  if (!editable && !value) return null
  if (!editing) return (
    <p onClick={() => editable && setEditing(true)}
      style={{ fontSize: 15, lineHeight: 1.65, color: value ? 'var(--text-secondary)' : 'var(--text-muted)', margin: '0 0 24px', whiteSpace: 'pre-wrap', cursor: editable ? 'text' : 'default', fontStyle: value ? 'normal' : 'italic' }}>
      {value || '+ Schrijf een korte bio (optioneel)'}
    </p>
  )
  return (
    <textarea autoFocus value={draft} rows={4}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onSave(draft.trim()); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      placeholder="Korte bio…"
      style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 15, lineHeight: 1.6, outline: 'none', resize: 'vertical', marginBottom: 24, boxSizing: 'border-box', fontFamily: 'inherit' }} />
  )
}
