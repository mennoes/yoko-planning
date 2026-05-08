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
import { VacationModal } from '@/components/VacationModal'

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
  vacation_from?:     string | null
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

  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

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
  const visibleFields = EDITABLE_FIELDS.filter(f => fieldHasValue(data, f) || revealedKeys.has(f.key as string))
  const hiddenFields  = EDITABLE_FIELDS.filter(f => !fieldHasValue(data, f) && !revealedKeys.has(f.key as string))

  // Group fields into sections for the redesign
  const FIELD_SECTIONS: { label: string; keys: string[] }[] = [
    { label: 'Werk',           keys: ['role', 'office'] },
    { label: 'Contact',        keys: ['email', 'phone', 'slack_handle', 'linkedin'] },
    { label: 'Persoonlijk',    keys: ['birthday', 'pronouns', 'languages'] },
    { label: 'Beschikbaarheid',keys: ['days_off', 'vacation_until'] },
    { label: 'Nood',           keys: ['emergency_contact', 'emergency_phone'] },
    { label: 'Extra',          keys: ['fun_fact'] },
  ]

  const onVacationNow = !!data?.vacation_until && new Date(data.vacation_until).getTime() > Date.now()

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: isMobile ? '24px 16px 80px' : '40px 36px 100px' }}>

      {/* Banner card with photo + meta */}
      <div style={{
        position: 'relative',
        background: `linear-gradient(135deg, ${color}28, ${color}08)`,
        border: '1px solid var(--border-light)', borderRadius: 18,
        padding: isMobile ? '24px 18px 18px' : '32px 28px 24px',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 16 : 22, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <ClickableAvatar
            photo={photo}
            name={name}
            color={color}
            editable={isMe}
            onPicked={async (dataUrl) => {
              if (myProfile) {
                if (supabase && await getCurrentUserId()) {
                  await supabase.from('profiles').update({ photo: dataUrl }).eq('member_id', memberId)
                }
                setData(d => ({ ...(d ?? {}), photo: dataUrl }))
              }
            }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              Studio Yoko · Teamlid
            </div>
            <h1 style={{ fontSize: isMobile ? 28 : 40, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.035em', lineHeight: 1 }}>
              {name}
            </h1>
            {data?.role && <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>{data.role}{data.office ? ` · ${data.office}` : ''}</div>}
            {onVacationNow && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,123,36,0.18)', color: '#a05400', fontSize: 12, fontWeight: 700 }}>
                🏝 Op vakantie {data?.vacation_from ? `${fmtDate(data.vacation_from)} – ${fmtDate(data.vacation_until!)}` : `tot ${fmtDate(data.vacation_until!)}`}
              </div>
            )}
            {isMe && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button onClick={openEdit}
                  style={{ padding: '8px 14px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg-card)',
                    color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600,
                    cursor: 'pointer' }}>
                  Bewerk profiel
                </button>
                <VacationButton from={data?.vacation_from ?? null} until={data?.vacation_until ?? null}
                  onSave={(f, u) => persistField({ vacation_from: f, vacation_until: u })} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {(data?.bio || isMe) && (
        <BioField value={data?.bio ?? ''} editable={isMe}
          onSave={v => persistField({ bio: v })} />
      )}

      {/* Sectioned field grid */}
      {visibleFields.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
          {FIELD_SECTIONS.map(section => {
            const fields = visibleFields.filter(f => section.keys.includes(f.key as string))
            if (fields.length === 0) return null
            return (
              <div key={section.label}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 6px 6px' }}>
                  {section.label}
                </div>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden' }}>
                  {fields.map((f, i, arr) => (
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
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!isMe && !hasAnyValue && !data?.bio && (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 14, marginTop: 24 }}>
          Dit teamlid heeft nog geen extra info ingevuld.
        </div>
      )}

      {isMe && hiddenFields.length > 0 && (
        <AddFieldPicker fields={hiddenFields} onPick={k => setRevealedKeys(s => new Set(s).add(k))} />
      )}

      {/* Password (own profile, when supabase auth is enabled) */}
      {isMe && supabase && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 6px 6px' }}>
            Wachtwoord
          </div>
          <PasswordResetCard />
        </div>
      )}

      {isMe && myMinutesThisWeek !== null && (
        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          Jij hebt deze week {fmtMinutes(myMinutesThisWeek)} gelogd via de timer.
        </div>
      )}
    </div>
  )
}

function PasswordResetCard() {
  const [open,    setOpen]    = useState(false)
  const [pw,      setPw]      = useState('')
  const [pw2,     setPw2]     = useState('')
  const [busy,    setBusy]    = useState(false)
  const [msg,     setMsg]     = useState<{ text: string; ok: boolean } | null>(null)

  async function save() {
    if (!supabase) return
    if (pw.length < 6) { setMsg({ text: 'Minimaal 6 tekens.', ok: false }); return }
    if (pw !== pw2)    { setMsg({ text: 'Wachtwoorden komen niet overeen.', ok: false }); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) { setMsg({ text: error.message, ok: false }); return }
    setMsg({ text: 'Wachtwoord opgeslagen.', ok: true })
    setPw(''); setPw2('')
    setTimeout(() => { setMsg(null); setOpen(false) }, 1500)
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 14 }}>
      {!open ? (
        <button onClick={() => setOpen(true)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-hover)',
            color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
          Stel een nieuw wachtwoord in
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
            Zo log je in zonder mailtje.
          </span>
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)}
            placeholder="Nieuw wachtwoord (min 6 tekens)"
            style={{ width: '100%', padding: '9px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="Herhaal wachtwoord"
            style={{ width: '100%', padding: '9px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setOpen(false); setPw(''); setPw2(''); setMsg(null) }}
              style={{ flex: 1, padding: '8px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Annuleer
            </button>
            <button onClick={save} disabled={busy}
              style={{ flex: 2, padding: '8px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
          {msg && (
            <div style={{ padding: '7px 10px', borderRadius: 6, fontSize: 12,
              background: msg.ok ? 'rgba(0,200,117,0.12)' : 'rgba(196,69,58,0.12)',
              color: msg.ok ? '#037f4c' : '#C4453A' }}>
              {msg.text}
            </div>
          )}
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

const linkStyle: React.CSSProperties = { color: 'var(--text-primary)', textDecoration: 'underline', textDecorationColor: 'var(--accent)', textDecorationThickness: 2, textUnderlineOffset: 3, fontWeight: 500 }

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
  // Werk
  { key: 'role',              label: 'Functie',         type: 'text' },
  { key: 'office',            label: 'Kantoor',         type: 'text' },
  // Contact
  { key: 'email',             label: 'Email',           type: 'email' },
  { key: 'phone',             label: 'Telefoon',        type: 'tel' },
  { key: 'slack_handle',      label: 'Slack',           type: 'text' },
  { key: 'linkedin',          label: 'LinkedIn',        type: 'url' },
  // Persoonlijk
  { key: 'birthday',          label: 'Verjaardag',      type: 'date' },
  { key: 'pronouns',          label: 'Voornaamwoorden', type: 'text' },
  { key: 'languages',         label: 'Talen',           type: 'text' },
  // Beschikbaarheid
  { key: 'days_off',          label: 'Werkdagen',       type: 'days' },
  { key: 'vacation_until',    label: 'Vakantie tot',    type: 'date' },
  // Nood
  { key: 'emergency_contact', label: 'Noodcontact',     type: 'text' },
  { key: 'emergency_phone',   label: 'Noodnummer',      type: 'tel' },
  // Extra
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
  if (f.type === 'days')   {
    if (!Array.isArray(v)) return String(v)
    const ALL = ['mon','tue','wed','thu','fri','sat','sun']
    const work = ALL.filter(x => !(v as string[]).includes(x))
    return work.map(d => DAY_LABELS[d]).join(', ')
  }
  return String(v)
}

// Inline editable cell — click to edit, blur to save
function EditableValue({ field, data, onSave }: {
  field: FieldDef; data: ExtendedProfile | null; onSave: (patch: Partial<ExtendedProfile>) => void
}) {
  const [editing, setEditing] = useState(false)
  const raw = data?.[field.key]

  if (field.type === 'days') {
    // Storage stays in `days_off` (= days NOT working). UI shows the COMPLEMENT
    // as "Werkdagen": user toggles the days they work; we save the rest.
    const ALL_DAYS = ['mon','tue','wed','thu','fri','sat','sun'] as const
    const offSet  = new Set<string>(Array.isArray(raw) ? (raw as string[]) : [])
    const workSet = new Set(ALL_DAYS.filter(d => !offSet.has(d)))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Selecteer dagen waarop je werkt.</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {ALL_DAYS.map(d => {
          const on = workSet.has(d)
          return (
            <button key={d} onClick={() => {
                const nextWork = new Set(workSet); on ? nextWork.delete(d) : nextWork.add(d)
                const nextOff  = ALL_DAYS.filter(x => !nextWork.has(x))
                onSave({ days_off: nextOff })
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

function VacationButton({ from, until, onSave }: { from: string | null; until: string | null; onSave: (from: string | null, until: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [fromDraft,  setFromDraft]  = useState(from  ?? '')
  const [untilDraft, setUntilDraft] = useState(until ?? '')
  const onVacation = !!until && new Date(until).getTime() > Date.now()
  const fmt = (d: string) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  const label = onVacation
    ? (from ? `🏝 ${fmt(from)} – ${fmt(until!)}` : `🏝 Vakantie tot ${fmt(until!)}`)
    : '🏝 Vakantie aangeven'

  return (
    <>
      <button onClick={() => { setFromDraft(from ?? ''); setUntilDraft(until ?? ''); setOpen(true) }}
        style={{ padding: '7px 14px', borderRadius: 8,
          border: `1px solid ${onVacation ? 'rgba(255,123,36,0.4)' : 'var(--border)'}`,
          background: onVacation ? 'rgba(255,123,36,0.12)' : 'var(--bg-card)',
          color: onVacation ? '#a05400' : 'var(--text-secondary)',
          fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
        {label}
      </button>

      {open && <VacationModal
        fromDraft={fromDraft} setFromDraft={setFromDraft}
        untilDraft={untilDraft} setUntilDraft={setUntilDraft}
        canClear={!!from || !!until}
        onClose={() => setOpen(false)}
        onSave={() => { onSave(fromDraft || null, untilDraft || null); setOpen(false) }}
        onClear={() => { onSave(null, null); setOpen(false) }} />}
    </>
  )
}


function AddFieldPicker({ fields, onPick }: { fields: FieldDef[]; onPick: (k: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 12, position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ padding: '8px 14px', borderRadius: 8,
          border: '1px dashed var(--border)', background: 'transparent',
          color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600,
          cursor: 'pointer' }}>
        + Veld toevoegen
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{ position: 'absolute', top: 38, left: 0, zIndex: 51,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 6, minWidth: 200, maxHeight: 280, overflowY: 'auto',
            boxShadow: '0 14px 40px rgba(0,0,0,0.25)',
            display: 'flex', flexDirection: 'column', gap: 2 }}>
            {fields.map(f => (
              <button key={f.key} onClick={() => { onPick(f.key as string); setOpen(false) }}
                style={{ background: 'transparent', border: 'none', textAlign: 'left',
                  padding: '7px 10px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  color: 'var(--text-primary)', cursor: 'pointer' }}>
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
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
