'use client'

import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
// Note: bewust GEEN useSearchParams uit next/navigation — die zet de hele
// pagina in CSR-bailout en breekt `next build` voor de dynamische
// /projects/[slug] route. We zijn 'use client', dus window.location is
// veilig.
import teamData from '@/data/team.json'
import type { BoardItem, BoardGroup, ColumnDef, SubItem } from '@/lib/boards'
import { useProfile }     from './ProfileContext'
import { useTeamPhotos }  from './TeamPhotosContext'
import { useUndo }        from './UndoContext'
import Link from 'next/link'
import { GoogleBadge }    from './GoogleBadge'
import { IconComment, IconSearch, IconActivity } from './Icon'
import { createNotification } from '@/lib/notificationsStore'
import { logItemActivity }    from '@/lib/itemActivity'
import {
  loadCommentsFor, saveComment, newCommentId, onCommentsUpdate,
  toggleReaction, type CommentThread,
} from '@/lib/commentsStore'
import { addRule as addSubitemRule } from '@/lib/subitemRules'
import { MentionTextarea } from './MentionTextarea'
import { ReactionRow }     from './ReactionRow'
import { useIsMobile }     from '@/lib/useIsMobile'

// Cache van het lopende profiel zodat helpers buiten een hook ook de
// actor-id kunnen meegeven aan een notification.
let currentActorId: string | null = null
function setCurrentActor(id: string | null) { currentActorId = id }

// Notificeer alle owners (behalve de actor zelf) wanneer de status van
// een item verandert + log in de item-geschiedenis.
function notifyOwnersOfStatusChange(item: BoardItem, fromStatus: string, toStatus: string, boardOverride?: string) {
  if (fromStatus === toStatus) return
  logItemActivity(item.id, 'zette status', `${fromStatus || '—'} → ${toStatus || '—'}`).catch(() => {})
  const owners = (item.ownerIds ?? []).filter(id => id && id !== 'unassigned')
  for (const rid of owners) {
    if (rid === currentActorId) continue
    createNotification({
      recipientId: rid,
      actorId:     currentActorId,
      kind:        'comment',
      contextKind: 'board_item',
      contextId:   item.id,
      href:        boardOverride ? `/projects/${boardOverride}` : undefined,
      body:        `Status: ${toStatus || '—'} (was ${fromStatus || '—'}) · ${item.name}`,
    }).catch(() => {})
  }
}

// ─── Status opties ────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { label: '',              color: ''        },
  { label: 'Working on...', color: '#ff7b24' },
  { label: 'Done',          color: '#00c875' },
  { label: 'Stuck',         color: '#e2445c' },
  { label: 'Not started',   color: '#808080' },
  { label: 'Doorlopend',    color: '#579bfc' },
]

// ─── Groep kleurenpalet ───────────────────────────────────────────────────────
const PALETTE = [
  '#579bfc','#0086c0','#9c7ee8','#784bd1','#e2445c','#bb3354','#ff642e',
  '#ff7a00','#ffcb00','#cab641','#00c875','#037f4c','#ff5ac4','#9aadbd',
]

// ─── Groep context (kleur) ────────────────────────────────────────────────────
const GroupCtx = createContext<{ color: string }>({ color: '#579bfc' })

// ─── Datum helpers ────────────────────────────────────────────────────────────
const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getDate()} ${NL_MON[dt.getMonth()]}.`
}

function fmtRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return ''
  if (!start) return `→ ${fmtDate(end)}`
  if (!end)   return fmtDate(start)
  const d1 = new Date(start), d2 = new Date(end)
  if (d1.getMonth() === d2.getMonth())
    return `${NL_MON[d1.getMonth()]}. ${d1.getDate()} – ${d2.getDate()}`
  return `${d1.getDate()} ${NL_MON[d1.getMonth()]}. – ${d2.getDate()} ${NL_MON[d2.getMonth()]}.`
}

// ─── Portal-dropdown (ontsnapt aan overflow: hidden van de tabel) ─────────────
function PortalDropdown({ anchor, onClose, children }: {
  anchor:  React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const [pos, setPos]           = useState({ top: 0, left: 0 })
  const [ready, setReady]       = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function place() {
      if (!anchor.current || !dropRef.current) return
      const r = anchor.current.getBoundingClientRect()
      const d = dropRef.current.getBoundingClientRect()
      const margin = 8
      // Bij voorkeur ONDER de anchor; als 't niet past flippen we erboven.
      // Als 't ook erboven niet past, kleven we tegen de bovenrand met margin.
      let top = r.bottom + 3
      const wouldOverflowBottom = top + d.height + margin > window.innerHeight
      if (wouldOverflowBottom) {
        const flipped = r.top - d.height - 3
        top = flipped >= margin ? flipped : Math.max(margin, window.innerHeight - d.height - margin)
      }
      // Horizontaal: standaard links uitgelijnd; als rechts overflowt, schuif
      // naar links zodat het volledige paneel zichtbaar is.
      let left = r.left
      if (left + d.width + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - d.width - margin)
      }
      if (left < margin) left = margin
      setPos({ top, left })
      setReady(true)
    }
    // Eerst hidden renderen om de échte grootte te meten, dan plaatsen.
    place()
    // Herplaatsen bij resize / scroll zodat 't zichtbaar blijft als de
    // viewport verandert terwijl de popup open is.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    function onDown(e: MouseEvent) {
      if (!dropRef.current?.contains(e.target as Node) &&
          !anchor.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (typeof window === 'undefined') return null
  return createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
      visibility: ready ? 'visible' : 'hidden',
      maxHeight: `calc(100vh - 16px)`, overflowY: 'auto',
    }}>
      {children}
    </div>,
    document.body
  )
}

// ─── Generieke bewerkbare cel (single-click) ──────────────────────────────────
function EditableCell({
  value, inputType, onChange,
}: {
  value:     string | number | null | undefined
  inputType: 'text' | 'number' | 'date' | 'url'
  onChange:  (v: string | number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')

  function start() { setDraft(value?.toString() ?? ''); setEditing(true) }
  function save()  {
    if (inputType === 'number') onChange(parseFloat(draft) || 0)
    else if (inputType === 'date') onChange(draft || null)
    else onChange(draft)
    setEditing(false)
  }

  const display = inputType === 'date' ? fmtDate(value as string) : value

  if (editing) return (
    <input autoFocus
      type={inputType === 'url' ? 'text' : inputType}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
      style={editInput}
    />
  )

  return (
    <div onClick={start} style={{
      padding: '0 4px', cursor: 'pointer', fontSize: 13,
      color: display ? 'var(--text-secondary)' : 'var(--text-muted)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      userSelect: 'none', width: '100%',
    }} title={display?.toString() ?? ''}>
      {display?.toString() || '—'}
    </div>
  )
}

// ─── Status cel ───────────────────────────────────────────────────────────────
function StatusCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const opt = STATUS_OPTIONS.find(s => s.label === value) ?? STATUS_OPTIONS[0]

  return (
    <div>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} style={{
        padding: '3px 10px', borderRadius: 4, cursor: 'pointer', border: 'none',
        background: opt.color || 'var(--overlay-medium)',
        color: opt.color ? '#fff' : 'var(--text-muted)',
        fontSize: 12, fontWeight: opt.color ? 600 : 400,
        whiteSpace: 'nowrap', maxWidth: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value || '—'}
      </button>

      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 4, minWidth: 168,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}>
            {STATUS_OPTIONS.map(o => (
              <button key={o.label || '_'} onClick={() => { onChange(o.label); setOpen(false) }} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '7px 10px', borderRadius: 4,
                background: 'transparent', border: 'none',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
              }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: o.color || 'var(--border)' }} />
                {o.label || '(geen status)'}
              </button>
            ))}
          </div>
        </PortalDropdown>
      )}
    </div>
  )
}

// ─── Owners cel ───────────────────────────────────────────────────────────────
function MemberAvatar({ id, size = 24 }: { id: string; size?: number }) {
  const { profile }    = useProfile()
  const { getPhoto }   = useTeamPhotos()
  const m = teamData.members.find(t => t.id === id)
  if (!m) return null
  const isMe    = profile?.memberId === id
  const photo   = isMe ? (profile?.photo ?? getPhoto(id)) : getPhoto(id)
  const fallback = `/team/${id}.jpg`
  const initials = m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  if (photo) {
    return (
      <img src={photo} alt={m.name} title={m.name} style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${m.color}`, objectFit: 'cover',
      }} />
    )
  }
  return (
    <span title={m.name} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: m.color + '30', border: `2px solid ${m.color}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: m.color,
      position: 'relative', overflow: 'hidden',
    }}>
      <img src={fallback} alt={m.name}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
      {initials}
    </span>
  )
}

function OwnersCell({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const trigRef = useRef<HTMLDivElement>(null)
  const { profile } = useProfile()
  const team = teamData.members
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])

  // Yoko-collega's altijd bovenaan met grotere foto's zodat aanwijzen makkelijk
  // is. Freelancers / externe contactpersonen verschijnen pas wanneer je
  // begint te typen in het zoekveld eronder.
  const YOKO_IDS = new Set(['menno','vincent','odette','anne-fleur','kars'])
  const yokoMembers   = team.filter(m => YOKO_IDS.has(m.id))
  const otherMembers  = team.filter(m => !YOKO_IDS.has(m.id))
  const q             = query.trim().toLowerCase()
  const matchedOthers = q
    ? otherMembers.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    : []

  return (
    <div>
      <div ref={trigRef} onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{ display: 'flex', gap: 2, cursor: 'pointer', flexWrap: 'nowrap', minWidth: 24 }}>
        {value.length === 0
          ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</span>
          : value.map(id => <MemberAvatar key={id} id={id} size={34} />)
        }
      </div>

      {open && (
        <PortalDropdown anchor={trigRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 6, minWidth: 240,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}>
            {yokoMembers.map(m => {
              const active = value.includes(m.id)
              const isMe   = profile?.memberId === m.id
              return (
                <button key={m.id} onClick={() => toggle(m.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '7px 8px', borderRadius: 6,
                  background: active ? m.color + '22' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, textAlign: 'left',
                }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                  <MemberAvatar id={m.id} size={32} />
                  <span style={{ fontWeight: active ? 700 : 500 }}>
                    {m.name}{isMe ? ' (jij)' : ''}
                  </span>
                  {active && <span style={{ marginLeft: 'auto', color: m.color, fontSize: 13, fontWeight: 700 }}>✓</span>}
                </button>
              )
            })}

            <div style={{ height: 1, background: 'var(--border-light)', margin: '6px 4px 6px' }} />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Zoek freelancer of contact…"
              style={{ width: '100%', boxSizing: 'border-box',
                padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border-light)', background: 'var(--bg-base)',
                color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />

            {/* Externe leden: alleen tonen bij actieve match, of toon
                geselecteerde externen altijd zodat je 'm kunt deselecteren. */}
            {(() => {
              const showSelected = otherMembers.filter(m => value.includes(m.id) && !matchedOthers.find(o => o.id === m.id))
              const list = [...matchedOthers, ...showSelected]
              if (list.length === 0) {
                if (q) return <div style={{ padding: '8px 8px 4px', fontSize: 12, color: 'var(--text-muted)' }}>Geen match.</div>
                return null
              }
              return (
                <div style={{ marginTop: 4 }}>
                  {list.map(m => {
                    const active = value.includes(m.id)
                    return (
                      <button key={m.id} onClick={() => toggle(m.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '6px 8px', borderRadius: 6,
                        background: active ? m.color + '22' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
                      }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                        <MemberAvatar id={m.id} size={24} />
                        <span style={{ fontWeight: active ? 600 : 400 }}>{m.name}</span>
                        {active && <span style={{ marginLeft: 'auto', color: m.color, fontSize: 12 }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </PortalDropdown>
      )}
    </div>
  )
}

// ─── Kalender helpers ─────────────────────────────────────────────────────────
const NL_MONTHS_LONG = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']
const NL_DAYS_SHORT  = ['ma','di','wo','do','vr','za','zo']

function buildCalGrid(year: number, month: number): (string | null)[] {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // ma = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function diffDays(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

const navBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', fontSize: 11, padding: '3px 8px',
  borderRadius: 4,
}

// ─── Kalender range picker ────────────────────────────────────────────────────
function RangeCalendar({
  startDate, endDate, color, onChange,
}: {
  startDate: string | null; endDate: string | null; color: string
  onChange: (s: string | null, e: string | null) => void
}) {
  const initD   = startDate ? new Date(startDate) : new Date()
  const [vy, setVy] = useState(initD.getFullYear())
  const [vm, setVm] = useState(initD.getMonth())
  const [selA, setSelA] = useState<string | null>(startDate)
  const [selB, setSelB] = useState<string | null>(endDate)
  const [phase, setPhase] = useState<'A' | 'B'>('A')
  const [hov,   setHov]   = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]

  const ordA = selA && selB ? (selA <= selB ? selA : selB) : selA
  const ordB = selA && selB ? (selA <= selB ? selB : selA) : selB

  const prevA = phase === 'B' && selA && hov ? (selA <= hov ? selA : hov) : null
  const prevB = phase === 'B' && selA && hov ? (selA <= hov ? hov : selA) : null
  const effA = prevA ?? ordA
  const effB = prevB ?? ordB

  const days = selA && selB ? diffDays(ordA!, ordB!) + 1 : null

  function clickDay(d: string) {
    if (phase === 'A') {
      setSelA(d); setSelB(null); setPhase('B')
    } else {
      const [s, e] = selA! <= d ? [selA!, d] : [d, selA!]
      setSelA(s); setSelB(e); setPhase('A')
      onChange(s, e)
    }
  }

  function prevMonth() { vm === 0 ? (setVm(11), setVy(y => y - 1)) : setVm(m => m - 1) }
  function nextMonth() { vm === 11 ? (setVm(0), setVy(y => y + 1)) : setVm(m => m + 1) }

  const cells = buildCalGrid(vy, vm)

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 16, minWidth: 290,
      boxShadow: '0 10px 36px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Datums instellen</span>
        {days !== null && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--overlay-medium)', padding: '2px 7px', borderRadius: 10 }}>
            {days} dag{days !== 1 ? 'en' : ''}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
        <input type="date" value={selA ?? ''}
          onChange={e => { setSelA(e.target.value || null); if (selB) onChange(e.target.value || null, selB) }}
          style={{ ...editInput, flex: 1 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>→</span>
        <input type="date" value={selB ?? ''}
          onChange={e => { setSelB(e.target.value || null); if (selA) onChange(selA, e.target.value || null) }}
          style={{ ...editInput, flex: 1 }} />
      </div>

      {/* Snelkeuzes: hele maand selecteren met één klik. Vorige/Deze/
          Volgende dekt de meeste planning-vragen ('wat staat er deze
          maand?'). Stelt 1ste t/m laatste dag in, scrollt kalender mee. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([
          { label: 'Vorige maand', offset: -1 },
          { label: 'Deze maand',   offset:  0 },
          { label: 'Volgende maand', offset: 1 },
        ] as const).map(({ label, offset }) => (
          <button key={label} onClick={() => {
            const ref = new Date()
            ref.setDate(1)
            ref.setMonth(ref.getMonth() + offset)
            const y = ref.getFullYear(), m = ref.getMonth()
            const first = `${y}-${String(m + 1).padStart(2, '0')}-01`
            const lastDay = new Date(y, m + 1, 0).getDate()
            const last  = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
            setSelA(first); setSelB(last); setPhase('A')
            setVy(y); setVm(m)
            onChange(first, last)
          }}
            style={{ flex: 1, padding: '5px 8px', borderRadius: 6,
              border: '1px solid var(--border-light)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              transition: 'all 0.1s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={prevMonth} style={navBtnStyle}>◀</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {NL_MONTHS_LONG[vm]} {vy}
        </span>
        <button onClick={nextMonth} style={navBtnStyle}>▶</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 3 }}>
        {NL_DAYS_SHORT.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e-${i}`} style={{ height: 30 }} />
          const day    = parseInt(cell.split('-')[2])
          const isS    = cell === effA
          const isE    = cell === effB
          const inRng  = effA && effB && cell > effA && cell < effB
          const isTdy  = cell === today
          const isEdge = isS || isE
          return (
            <div key={cell}
              onClick={() => clickDay(cell)}
              onMouseEnter={() => setHov(cell)}
              onMouseLeave={() => setHov(null)}
              style={{
                height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, cursor: 'pointer', userSelect: 'none',
                borderRadius: isEdge ? 6 : 0,
                background: isEdge ? color : inRng ? color + '28' : 'transparent',
                color: isEdge ? '#fff' : isTdy ? color : inRng ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isEdge || isTdy ? 700 : 400,
                outline: isTdy && !isEdge ? `1px solid ${color}55` : undefined,
                outlineOffset: '-2px',
                transition: 'background 0.08s',
              }}>
              {day}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => { setSelA(null); setSelB(null); setPhase('A'); onChange(null, null) }}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
          Wissen
        </button>
        {phase === 'B' && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Klik einddatum</span>
        )}
      </div>
    </div>
  )
}

// ─── DateRange cel — pill + calendar picker ───────────────────────────────────
function DateRangeCell({
  startDate, endDate, onChange,
}: {
  startDate: string | null; endDate: string | null
  onChange: (s: string | null, e: string | null) => void
}) {
  const { color } = useContext(GroupCtx)
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const today   = new Date().toISOString().split('T')[0]
  const isLate  = !!endDate && endDate < today
  const hasAny  = startDate || endDate
  const pillClr = isLate ? '#e2445c' : color

  // Progress bar: how far we are through the project's timeline.
  // 0% = before start, 100% = at/past end. Late items fill 100% in red.
  let progress = 1
  if (startDate && endDate && !isLate) {
    const s = new Date(startDate).getTime()
    const e = new Date(endDate).getTime() + 86400000  // include the end day
    const n = Date.now()
    if (n < s) progress = 0
    else if (n >= e) progress = 1
    else progress = (n - s) / (e - s)
  }
  const progressPct = Math.round(progress * 100)

  return (
    <div style={{ width: '100%' }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} style={{
        position: 'relative', overflow: 'hidden',
        width: '100%', textAlign: 'left', cursor: 'pointer',
        border: hasAny ? `1px solid ${pillClr}55` : 'none',
        borderRadius: 4, padding: '3px 8px',
        background: hasAny ? pillClr + '22' : 'transparent',
        display: 'flex', alignItems: 'center', gap: 5, minHeight: 26,
      }}>
        {hasAny && (
          <span style={{
            position: 'absolute', inset: 0, width: `${progressPct}%`,
            background: pillClr + 'cc', borderRadius: 3,
            transition: 'width 0.4s ease', pointerEvents: 'none', zIndex: 0,
          }} />
        )}
        {hasAny ? (
          <>
            {isLate && (
              <span style={{
                position: 'relative', zIndex: 1,
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                background: 'rgba(0,0,0,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 900, color: '#fff',
              }}>!</span>
            )}
            <span title={`${progressPct}% verstreken`}
              style={{ position: 'relative', zIndex: 1, fontSize: 13, fontWeight: 600,
                color: progressPct > 35 ? '#fff' : 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textShadow: progressPct > 35 ? '0 1px 1px rgba(0,0,0,0.2)' : 'none' }}>
              {fmtRange(startDate, endDate)}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
        )}
      </button>

      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <RangeCalendar
            startDate={startDate} endDate={endDate} color={color}
            onChange={(s, e) => onChange(s, e)}
          />
        </PortalDropdown>
      )}
    </div>
  )
}

// ─── URL cel ──────────────────────────────────────────────────────────────────
function UrlCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')

  if (editing) return (
    <input autoFocus type="text" value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onChange(draft); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
      style={editInput} />
  )

  if (!value) return (
    <span onClick={() => { setDraft(''); setEditing(true) }}
      style={{ fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>—</span>
  )

  return (
    <a href={value} target="_blank" rel="noopener noreferrer"
      style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none', whiteSpace: 'nowrap' }}
      onDoubleClick={e => { e.preventDefault(); setDraft(value); setEditing(true) }}>
      {value.replace(/^https?:\/\//, '')}
    </a>
  )
}

// ─── Effective hours/days helpers ─────────────────────────────────────────────
// When subitems exist they are the source of truth; the parent's stored
// estHours is ignored. Days are always derived from hours at 8h/day.
export function effectiveHours(item: BoardItem): number {
  const subs = item.subitems ?? []
  if (subs.length > 0) return subs.reduce((s, si) => s + (Number(si.estHours) || 0), 0)
  return Number(item.estHours) || 0
}
export function effectiveDays(item: BoardItem): number {
  return Math.round((effectiveHours(item) / 8) * 10) / 10
}

// ─── Pro-rated hours/days in een datum-window ────────────────────────────────
// Wanneer de gebruiker een periode-filter zet, wil het totaal alléén de uren
// optellen die binnen dat window vallen — niet de volledige itemduur. We
// pro-raten lineair: als een item 28 mrt – 24 mei (58 dagen, 20u) loopt en
// het filter is 1–31 mei, dan tellen we 24/58 × 20 ≈ 8.3u mee.
//
// Items met subitems behandelen we per subitem (zelfde pro-ratie). Items
// zonder timeline (geen startDate/endDate) tellen volledig mee — daar kunnen
// we geen window-overlap berekenen, maar ze horen wel bij het filter
// (anders waren ze niet in de result-set beland).
function daysInclusive(startISO: string | null | undefined, endISO: string | null | undefined): number {
  if (!startISO) return 0
  const start = Date.parse(startISO)
  const end   = endISO ? Date.parse(endISO) : start
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(1, Math.round((end - start) / 86400000) + 1)
}
function overlapDays(
  startISO: string | null | undefined, endISO: string | null | undefined,
  fromTs: number | null, untilTs: number | null,
): number {
  if (!startISO) return 0
  const start = Date.parse(startISO)
  const end   = endISO ? Date.parse(endISO) : start
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  const lo = fromTs  != null ? Math.max(start, fromTs)  : start
  const hi = untilTs != null ? Math.min(end,   untilTs) : end
  if (hi < lo) return 0
  return Math.round((hi - lo) / 86400000) + 1
}
function hoursInRange(item: BoardItem, fromTs: number | null, untilTs: number | null): number {
  if (fromTs == null && untilTs == null) return effectiveHours(item)
  const subs = item.subitems ?? []
  if (subs.length > 0) {
    return subs.reduce((s, si) => {
      const hours = Number(si.estHours) || 0
      const span  = daysInclusive(si.startDate, si.endDate)
      if (span === 0) return s + hours
      const overlap = overlapDays(si.startDate, si.endDate, fromTs, untilTs)
      return s + hours * (overlap / span)
    }, 0)
  }
  const hours = Number(item.estHours) || 0
  const span  = daysInclusive(item.startDate, item.endDate)
  if (span === 0) return hours
  const overlap = overlapDays(item.startDate, item.endDate, fromTs, untilTs)
  return hours * (overlap / span)
}

// ─── Cel dispatcher ───────────────────────────────────────────────────────────
function Cell({ item, col, onUpdate }: {
  item: BoardItem; col: ColumnDef; onUpdate: (u: Partial<BoardItem>) => void
}) {
  if (col.type === 'owners')    return <OwnersCell    value={item.ownerIds} onChange={v => onUpdate({ ownerIds: v })} />
  if (col.type === 'status')    return <StatusCell    value={item.status}   onChange={v => {
    onUpdate({ status: v })
    notifyOwnersOfStatusChange(item, item.status, v)
  }} />
  if (col.type === 'daterange') return <DateRangeCell startDate={item.startDate} endDate={item.endDate} onChange={(s,e) => onUpdate({ startDate: s, endDate: e })} />
  if (col.type === 'url')       return <UrlCell       value={(item[col.key] as string) ?? ''} onChange={v => onUpdate({ [col.key]: v })} />

  const hasSubs = (item.subitems?.length ?? 0) > 0

  // estHours: when subitems exist, show their sum (read-only).
  if (col.key === 'estHours' && hasSubs) {
    const sum = effectiveHours(item)
    return <span title="Som van subitems" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{sum}u</span>
  }
  // dagen: always computed from estHours (or sum of subs), read-only.
  if (col.key === 'dagen') {
    const days = effectiveDays(item)
    return <span title="Auto: uren ÷ 8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{days || ''}</span>
  }

  return (
    <EditableCell
      value={item[col.key] as string | number | null}
      inputType={col.type === 'currency' ? 'number' : col.type as 'text' | 'number' | 'date'}
      onChange={v => onUpdate({ [col.key]: col.type === 'currency' ? (v as number) : v })}
    />
  )
}

// ─── Subitem grid template ────────────────────────────────────────────────────

// ─── Subitem rij ──────────────────────────────────────────────────────────────
function SubItemRow({ subitem, cols, gridTemplate, rail, selected, onToggleSelect, isLast, parentItemId, fromGroupId, onUpdate, onDelete }: {
  subitem: SubItem; cols: ColumnDef[]; gridTemplate: string
  rail?: string
  selected?: boolean
  onToggleSelect?: () => void
  isLast?: boolean
  // Voor drag-to-unnest: we slepen de subitem naar een andere groep waar
  // 'ie als top-level item belandt. Bewaar parent + bron-groep in
  // dataTransfer zodat de drop-handler de juiste oudere kan strippen.
  parentItemId?: string
  fromGroupId?: string
  onUpdate: (u: Partial<SubItem>) => void; onDelete: () => void
}) {
  const [hover,     setHover]     = useState(false)
  const [editName,  setEditName]  = useState(false)
  const [nameDraft, setNameDraft] = useState(subitem.name)

  const cellBorder: React.CSSProperties = {
    borderLeft: '1px solid var(--border-light)', height: '100%',
    display: 'flex', alignItems: 'center', padding: '3px 8px', overflow: 'hidden',
  }

  // Render one subitem cell per parent column key. Columns the subitem
  // doesn't carry data for (deadline, dagen, custom fields) stay empty so
  // the row stays visually aligned with the parent grid.
  function renderCol(c: ColumnDef) {
    switch (c.key) {
      case 'owner':
      case 'ownerIds':
        return <div style={cellBorder}><OwnersCell value={subitem.ownerIds} onChange={v => onUpdate({ ownerIds: v })} /></div>
      case 'status':
        return <div style={cellBorder}><StatusCell value={subitem.status} onChange={v => onUpdate({ status: v })} /></div>
      case 'timeline':
        return <div style={cellBorder}><DateRangeCell startDate={subitem.startDate} endDate={subitem.endDate} onChange={(s,e) => onUpdate({ startDate: s, endDate: e })} /></div>
      case 'estHours':
        return <div style={cellBorder}><EditableCell value={subitem.estHours || null} inputType="number" onChange={v => onUpdate({ estHours: (v as number) ?? 0 })} /></div>
      case 'echtGewerkt':
        return <div style={cellBorder}><EditableCell value={subitem.echtGewerkt ?? null} inputType="number" onChange={v => onUpdate({ echtGewerkt: v != null ? (v as number) : undefined })} /></div>
      default:
        return <div style={cellBorder} />
    }
  }

  const [isDraggingMe, setIsDraggingMe] = useState(false)
  return (
    <div
      draggable={!editName && !!parentItemId && !!fromGroupId}
      onDragStart={e => {
        if (!parentItemId || !fromGroupId) return
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-yoko-subitem', JSON.stringify({
          subitemId: subitem.id, parentItemId, fromGroupId,
        }))
        setIsDraggingMe(true)
        // Broadcast: alle groepen op het bord moeten 'oplichten' als
        // potentieel drop-doel zodat de gebruiker direct ziet waar 'ie
        // de subitem heen kan slepen.
        window.dispatchEvent(new CustomEvent('yoko-subitem-drag-start', { detail: { subitemId: subitem.id, name: subitem.name } }))
      }}
      onDragEnd={() => {
        setIsDraggingMe(false)
        window.dispatchEvent(new CustomEvent('yoko-subitem-drag-end'))
      }}
      style={{
      display: 'grid', gridTemplateColumns: gridTemplate,
      alignItems: 'center', minHeight: 40,
      borderBottom: '1px solid var(--border-light)',
      background: isDraggingMe ? 'var(--accent-light)' : (selected ? 'var(--accent-light)' : (hover ? 'var(--overlay-hover)' : 'transparent')),
      opacity:    isDraggingMe ? 0.5 : 1,
      transform:  isDraggingMe ? 'scale(0.985)' : 'none',
      transition: 'background 0.1s, opacity 0.1s, transform 0.1s',
      cursor: !editName && parentItemId ? (isDraggingMe ? 'grabbing' : 'grab') : 'default',
    }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* Eerste kolom: checkbox + boom-connector (verticale lijn met
          horizontale elbow per rij — als een Monday/file-tree). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%', paddingRight: 0, position: 'relative' }}>
        {onToggleSelect && (
          <input type="checkbox" checked={!!selected} onChange={onToggleSelect}
            onClick={e => e.stopPropagation()}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 13, height: 13,
              opacity: selected || hover ? 1 : 0.4, transition: 'opacity 0.15s', flexShrink: 0, zIndex: 1 }} />
        )}
        {/* Boom-connector: top-half is altijd zichtbaar (verbindt met boven),
            bottom-half is verborgen op de laatste rij (eindigt bij elbow). */}
        <div aria-hidden style={{ position: 'absolute', right: 4, top: 0, bottom: isLast ? '50%' : 0, width: 2, background: rail ?? 'var(--accent)' }} />
        {/* Horizontale elbow naar de eerste cel. */}
        <div aria-hidden style={{ position: 'absolute', right: 0, top: '50%', width: 6, height: 2, background: rail ?? 'var(--accent)' }} />
      </div>
      <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', minWidth: 0 }}>
        {editName ? (
          <input autoFocus value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => { onUpdate({ name: nameDraft }); setEditName(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onUpdate({ name: nameDraft }); setEditName(false) }
              if (e.key === 'Escape') setEditName(false)
            }}
            style={{ ...editInput, flex: 1 }} />
        ) : (
          <span onClick={() => { setNameDraft(subitem.name); setEditName(true) }}
            style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {subitem.name}
          </span>
        )}
      </div>
      {cols.map(c => <div key={c.key}>{renderCol(c)}</div>)}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-light)', height: '100%' }}>
        {hover && (
          <button onClick={onDelete} title="Verwijderen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px', borderRadius: 3 }}>×</button>
        )}
      </div>
    </div>
  )
}

// ─── Subitems sectie ──────────────────────────────────────────────────────────
function SubItemsSection({ subitems, cols, gridTemplate, accentColor, selectedIds, onToggleSelect, parentItemId, fromGroupId, onUpdate }: {
  subitems: SubItem[]; cols: ColumnDef[]; gridTemplate: string
  accentColor?: string
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  parentItemId?: string
  fromGroupId?: string
  onUpdate: (u: SubItem[]) => void
}) {
  function updateOne(id: string, u: Partial<SubItem>) {
    // Bulk-bewustzijn: als deze subitem in een grotere selectie zit, pas de
    // wijziging op alle geselecteerde subitems binnen dit item toe. Zo kun
    // je alle subitems aanvinken en met één klik op 'Done' alles meenemen.
    const bulk = !!selectedIds && selectedIds.size > 1 && selectedIds.has(id)
    onUpdate(subitems.map(s => {
      if (bulk ? selectedIds!.has(s.id) : s.id === id) return { ...s, ...u }
      return s
    }))
  }
  function deleteOne(id: string) { onUpdate(subitems.filter(s => s.id !== id)) }
  function addOne() {
    onUpdate([...subitems, { id: Date.now().toString(), name: 'Nieuw subitem', ownerIds: [], status: '', startDate: null, endDate: null, estHours: 0 }])
  }
  const rail = accentColor ?? 'var(--accent)'
  const hdrCell: React.CSSProperties = { padding: '6px 8px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--border-light)' }

  // Subitem-only header labels per known column key. Falls back to the
  // parent column label so custom columns get something sensible.
  const headerLabelFor = (key: string, fallback: string) => {
    if (key === 'owner')       return 'Owner'
    if (key === 'status')      return 'Status'
    if (key === 'timeline')    return 'Timeline'
    if (key === 'estHours')    return 'Est.'
    if (key === 'echtGewerkt') return 'Echt gewerkt'
    return fallback
  }

  // Monday-stijl: korte rail-segmentjes per rij (geen doorlopende balk),
  // links uitgelijnd net naast de eerste cel. Header & content delen de
  // parent grid-template zodat kolombreedtes matchen.
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '4px 18px 8px 30px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-light)' }}>
        <div />
        <div style={{ padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subitem</div>
        {cols.map(c => (
          <div key={c.key} style={hdrCell}>{headerLabelFor(c.key, c.label)}</div>
        ))}
        <div style={{ borderLeft: '1px solid var(--border-light)' }} />
      </div>
      <SubitemRows subitems={subitems} cols={cols} gridTemplate={gridTemplate}
        rail={rail}
        selectedIds={selectedIds} onToggleSelect={onToggleSelect}
        parentItemId={parentItemId} fromGroupId={fromGroupId}
        updateOne={updateOne} deleteOne={deleteOne} />
      <div style={{ padding: '6px 10px 6px 60px' }}>
        <button onClick={addOne} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
          + Voeg subitem toe
        </button>
      </div>
    </div>
  )
}

// Subitem-rijen met Done-subgroep collapse. Active eerst (vroegste datum
// bovenaan), daarna een inklapbare "Done (N)" sectie.
function SubitemRows({ subitems, cols, gridTemplate, rail, selectedIds, onToggleSelect, parentItemId, fromGroupId, updateOne, deleteOne }: {
  subitems: SubItem[]; cols: ColumnDef[]; gridTemplate: string; rail: string
  selectedIds?: Set<string>; onToggleSelect?: (id: string) => void
  parentItemId?: string
  fromGroupId?: string
  updateOne: (id: string, u: Partial<SubItem>) => void
  deleteOne: (id: string) => void
}) {
  const [doneOpen, setDoneOpen] = useState(false)
  const sortByStart = (a: SubItem, b: SubItem) => {
    const av = a.startDate ?? ''
    const bv = b.startDate ?? ''
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return av.localeCompare(bv)
  }
  const active = subitems.filter(s => s.status !== 'Done').sort(sortByStart)
  const done   = subitems.filter(s => s.status === 'Done').sort(sortByStart)
  // 'Laatste' = bepaalt of de verticale connector na deze rij doorloopt.
  // Wanneer Done bestaat is de Done-header de laatste; anders de laatste
  // actieve rij. Bij geopende Done is de laatste done-rij de finale.
  const lastActiveIdx = active.length - 1
  const hasDone = done.length > 0
  const lastDoneIdx  = done.length - 1
  return (
    <>
      {active.map((sub, idx) => (
        <SubItemRow key={sub.id} subitem={sub} cols={cols} gridTemplate={gridTemplate}
          rail={rail}
          selected={selectedIds?.has(sub.id) ?? false}
          onToggleSelect={onToggleSelect ? () => onToggleSelect(sub.id) : undefined}
          isLast={!hasDone && idx === lastActiveIdx}
          parentItemId={parentItemId} fromGroupId={fromGroupId}
          onUpdate={u => updateOne(sub.id, u)} onDelete={() => deleteOne(sub.id)} />
      ))}
      {hasDone && (
        <>
          <button onClick={() => setDoneOpen(o => !o)}
            style={{
              width: '100%', textAlign: 'left',
              background: 'var(--overlay-faint)', border: 'none',
              borderBottom: '1px solid var(--border-light)',
              padding: '7px 14px 7px 56px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              position: 'relative',
            }}>
            {/* Tree-connector voor de Done-header: verticale lijn + elbow.
                Eindigt hier wanneer Done dicht is, loopt door wanneer open. */}
            <span aria-hidden style={{ position: 'absolute', left: 36 - 4 - 2, top: 0, bottom: doneOpen ? 0 : '50%', width: 2, background: rail }} />
            <span aria-hidden style={{ position: 'absolute', left: 36 - 4, top: '50%', width: 6, height: 2, background: rail }} />
            <span style={{ fontSize: 9, lineHeight: 1, display: 'inline-block', width: 10 }}>{doneOpen ? '▼' : '▶'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: '#00c875' }} />
              Done ({done.length})
            </span>
          </button>
          {doneOpen && done.map((sub, idx) => (
            <SubItemRow key={sub.id} subitem={sub} cols={cols} gridTemplate={gridTemplate}
              rail={rail}
              selected={selectedIds?.has(sub.id) ?? false}
              onToggleSelect={onToggleSelect ? () => onToggleSelect(sub.id) : undefined}
              isLast={idx === lastDoneIdx}
              parentItemId={parentItemId} fromGroupId={fromGroupId}
              onUpdate={u => updateOne(sub.id, u)} onDelete={() => deleteOne(sub.id)} />
          ))}
        </>
      )}
    </>
  )
}

// ─── Notes preview cel ──────────────────────────────────────────────────────
// Klik opent het item-detail-drawer met een echt textarea. Strippen we de
// HTML-tags die uit oudere imports (Google-beschrijvingen) kunnen komen,
// anders zie je <p>…</p> letterlijk in de cel.
function NotesPreview({ value, onOpen }: { value: string; onOpen: () => void }) {
  const plain = (value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    <div onClick={e => { e.stopPropagation(); onOpen() }}
      title={plain || 'Klik om notitie toe te voegen'}
      style={{
        cursor: 'pointer', fontSize: 13, padding: '0 4px',
        color: plain ? 'var(--text-secondary)' : 'var(--text-muted)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        width: '100%', userSelect: 'none',
      }}>
      {plain || '—'}
    </div>
  )
}

// ─── Item rij ─────────────────────────────────────────────────────────────────
function BoardRow({ item, cols, gridTemplate, selected, accentColor, onToggleSelect, selectedIds, onToggleSubitem, groupId, reorderMode, isFirst, isLast, onMoveUp, onMoveDown, onUpdate, onDelete }: {
  item: BoardItem; cols: ColumnDef[]; gridTemplate: string
  selected: boolean
  accentColor?: string
  selectedIds?: Set<string>
  onToggleSubitem?: (id: string) => void
  // Voor subitem-drag-to-unnest: subitems moeten weten welke parent + groep
  // ze verlaten zodat de drop-handler kan opruimen.
  groupId?: string
  onToggleSelect: () => void
  reorderMode: boolean
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onUpdate: (u: Partial<BoardItem>) => void; onDelete: () => void
}) {
  const [hover,     setHover]     = useState(false)
  const [editName,  setEditName]  = useState(false)
  const [nameDraft, setNameDraft] = useState(item.name)
  const [expanded,  setExpanded]  = useState(false)
  const subitems    = item.subitems ?? []
  const hasSubitems = subitems.length > 0

  // Comments per board-item — leeft naast 'journal' in de DetailPanel,
  // maar bereikbaar via een knop direct op de rij.
  const [commentCount, setCommentCount] = useState(0)
  const [showDetail, setShowDetail] = useState(false)
  useEffect(() => {
    const refresh = () => {
      const threads = loadCommentsFor('board-item:' + item.id)
      setCommentCount(threads.reduce((s, t) => s + t.thread.length, 0))
    }
    refresh()
    return onCommentsUpdate(refresh)
  }, [item.id])

  // ?drawer=<itemId> in de URL = deeplink vanuit een andere view (bv. de
  // werkdruk-widget op de homepage) die direct het detail wil openen
  // wanneer deze rij rendert. Lees één keer op mount en wis de param uit
  // de URL zodat ie niet bij elke pageload opnieuw triggert.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const wantId = params.get('drawer')
    if (wantId && wantId === item.id) {
      setShowDetail(true)
      params.delete('drawer')
      const qs = params.toString()
      const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
      window.history.replaceState(null, '', next)
    }
  }, [item.id])

  // Auto-rollup: als parent een veld leeg laat én er zijn subitems, dan
  // afleiden uit subitems. Hours doen we al verderop in de Cell-dispatcher
  // (read-only sum). Hier: timeline + owners. Schrijf-actie van de gebruiker
  // overschrijft de derived waarde — om weer auto te krijgen moet je 't
  // veld op de parent leegmaken.
  let effectiveItem: BoardItem = item
  if (hasSubitems) {
    const updates: Partial<BoardItem> = {}
    // Voorkeur: actieve (niet-Done) subitems voor de afgeleide timeline. Een
    // recurring meeting met 7 Done en 4 openstaande heeft een 'live' bereik
    // van de 4 openstaande, niet feb–jul. Pas als alles Done is val terug
    // op alle subitems zodat de range nog ergens op slaat.
    const activeSubs = subitems.filter(s => s.status !== 'Done')
    const dateSubs   = activeSubs.length > 0 ? activeSubs : subitems
    const subStarts = dateSubs.map(s => s.startDate).filter(Boolean) as string[]
    const subEnds   = dateSubs.map(s => s.endDate).filter(Boolean) as string[]
    if (!item.startDate && subStarts.length > 0) updates.startDate = [...subStarts].sort()[0]
    if (!item.endDate   && subEnds.length   > 0) updates.endDate   = [...subEnds].sort().slice(-1)[0]
    const parentOwnersEmpty = !item.ownerIds || item.ownerIds.length === 0
      || (item.ownerIds.length === 1 && item.ownerIds[0] === 'unassigned')
    if (parentOwnersEmpty) {
      const subOwners = new Set<string>()
      for (const s of subitems) for (const oid of (s.ownerIds ?? [])) if (oid && oid !== 'unassigned') subOwners.add(oid)
      if (subOwners.size > 0) updates.ownerIds = [...subOwners]
    }
    // Status NIET auto-rollen. Done subitems blijven gewoon in het
    // parent-item zichtbaar; pas wanneer jij het item zelf op Done zet
    // verhuist 't naar de Done-groep. Voorkomt dat een item ongewenst
    // wegspringt zodra de laatste subitem klaar is.
    if (Object.keys(updates).length > 0) effectiveItem = { ...item, ...updates }
  }

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: gridTemplate,
        alignItems: 'center', minHeight: 40,
        borderBottom: expanded ? 'none' : '1px solid var(--border-light)',
        background: selected ? 'var(--accent-light)' : (hover ? 'var(--overlay-hover)' : 'transparent'),
        transition: 'background 0.1s',
      }}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>

        {/* Selection checkbox */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect}
            onClick={e => e.stopPropagation()}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 15, height: 15,
              opacity: selected || hover ? 1 : 0.5, transition: 'opacity 0.15s' }} />
        </div>

        <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <button onClick={() => setExpanded(e => !e)}
            title={hasSubitems ? `${subitems.length} subitems` : 'Subitems toevoegen'}
            style={{
              background: 'none', border: 'none', padding: '1px 2px', cursor: 'pointer',
              fontSize: 8, lineHeight: 1,
              color: hasSubitems ? (expanded ? 'var(--text-secondary)' : 'var(--text-muted)') : hover ? 'rgba(122,132,160,0.4)' : 'transparent',
              flexShrink: 0, width: 13, textAlign: 'center', transition: 'color 0.1s',
            }}>{expanded ? '▼' : '▶'}</button>

          {hasSubitems && (
            // Subitem-tellen tonen we nu altijd (Monday-stijl) ipv alleen bij
            // collapsed — kort overzicht van 'hoe groot is dit item'.
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              background: 'var(--bg-hover)', borderRadius: 999,
              padding: '1px 8px', flexShrink: 0, minWidth: 18, textAlign: 'center' }}>
              {subitems.length}
            </span>
          )}

          {item.source === 'google' && <GoogleBadge href={item.externalLink} />}

          {editName && item.source !== 'google' ? (
            <input autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={() => { onUpdate({ name: nameDraft }); setEditName(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { onUpdate({ name: nameDraft }); setEditName(false) }
                if (e.key === 'Escape') setEditName(false)
              }}
              style={{ ...editInput, flex: 1 }} />
          ) : (
            <>
              <span
                onClick={() => {
                  // Monday-stijl: klik op de naam start rename direct voor
                  // handmatige items — geen omweg via dubbelklik of menu.
                  // Google-items zijn read-only qua naam, daar valt 't terug
                  // op de detail-drawer als gewone klik-actie.
                  if (item.source === 'google') { setShowDetail(true); return }
                  setNameDraft(item.name); setEditName(true)
                }}
                onDoubleClick={e => {
                  if (item.source === 'google') return
                  e.stopPropagation()
                  setNameDraft(item.name); setEditName(true)
                }}
                title={item.source === 'google'
                  ? 'Bewerk in Google Calendar'
                  : 'Klik om naam te bewerken'}
                // I-beam cursor voor handmatige items zodat 'rename-baar'
                // visueel duidelijk is — net als in Monday. Google-items
                // krijgen een gewone pointer omdat ze read-only zijn qua naam.
                style={{ fontSize: 14.5, color: 'var(--text-primary)', fontWeight: 600,
                  letterSpacing: '-0.005em',
                  cursor: item.source === 'google' ? 'pointer' : 'text',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {item.name}
              </span>
              {hover && item.source !== 'google' && (
                <button
                  onClick={e => { e.stopPropagation(); setShowDetail(true) }}
                  title="Details openen"
                  aria-label="Details openen"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', padding: '2px 6px', fontSize: 14, lineHeight: 1,
                    borderRadius: 4, flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  ↗
                </button>
              )}
            </>
          )}

          {/* Comments-knop — opent het detail-drawer en scrolt naar opmerkingen.
              Felle pill bij ≥1 opmerking, anders een subtiele outline-icon. */}
          <button onClick={(e) => { e.stopPropagation(); setShowDetail(true) }}
            title={commentCount > 0 ? `${commentCount} opmerking${commentCount === 1 ? '' : 'en'}` : 'Plaats opmerking'}
            style={commentCount > 0 ? {
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 11px', borderRadius: 999,
              background: 'var(--accent)',
              border: '1px solid var(--accent)',
              color: '#000',
              fontSize: 13, fontWeight: 700,
              cursor: 'pointer', flexShrink: 0, lineHeight: 1,
            } : {
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              color: 'var(--accent)',
              padding: '4px 8px', borderRadius: 999, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              opacity: 1, transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              if (commentCount === 0) {
                e.currentTarget.style.background = 'var(--accent-light)'
              }
            }}
            onMouseLeave={e => {
              if (commentCount === 0) {
                e.currentTarget.style.background = 'var(--bg-card)'
              }
            }}>
            <IconComment size={22} strokeWidth={1.8} />
            {commentCount > 0 && <span style={{ minWidth: 8, textAlign: 'center' }}>{commentCount}</span>}
          </button>
        </div>

        {cols.map(col => (
          <div key={col.key} style={{ padding: '4px 8px', borderLeft: '1px solid var(--border)', height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
            {col.key === 'notes' ? (
              // Notes is een vrije-tekst-veld dat al snel niet meer in één
              // cel past. Klikken opent het detail-drawer met een groot
              // textarea + eventuele opmerkingen ernaast.
              <NotesPreview value={item.notes ?? ''} onOpen={() => setShowDetail(true)} />
            ) : (
              <Cell item={effectiveItem} col={col} onUpdate={onUpdate} />
            )}
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border)', height: '100%', gap: 2 }}>
          {reorderMode ? (
            <>
              <button onClick={onMoveUp} disabled={isFirst} title="Omhoog"
                style={{ background: isFirst ? 'transparent' : 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 4, color: isFirst ? 'var(--text-muted)' : 'var(--text-primary)', cursor: isFirst ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, padding: '1px 4px', opacity: isFirst ? 0.4 : 1 }}>↑</button>
              <button onClick={onMoveDown} disabled={isLast} title="Omlaag"
                style={{ background: isLast ? 'transparent' : 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 4, color: isLast ? 'var(--text-muted)' : 'var(--text-primary)', cursor: isLast ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, padding: '1px 4px', opacity: isLast ? 0.4 : 1 }}>↓</button>
            </>
          ) : hover && item.source !== 'google' ? (
            <button onClick={onDelete} title="Verwijderen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '2px 6px', borderRadius: 3 }}>×</button>
          ) : null}
        </div>
      </div>

      {expanded && (
        <SubItemsSection subitems={subitems} cols={cols} gridTemplate={gridTemplate}
          accentColor={accentColor}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSubitem}
          parentItemId={item.id} fromGroupId={groupId}
          onUpdate={updated => onUpdate({ subitems: updated })} />
      )}
      {showDetail && (
        <ItemDetailDrawer item={item} cols={cols} accentColor={accentColor}
          onUpdate={onUpdate} onClose={() => setShowDetail(false)} />
      )}
    </>
  )
}

// ─── Dedup modal: dubbele items opsporen + opruimen ──────────────────────────
function DedupModal({ groups, onClose, onDelete }: {
  groups: BoardGroup[]
  onClose: () => void
  onDelete: (idsToDelete: Set<string>) => void
}) {
  // Groepeer alle items op naam (case-insensitive, trimmed). Sets met
  // meer dan 1 entry = potentiële duplicaten.
  const dupGroups = useMemo(() => {
    const byName = new Map<string, BoardItem[]>()
    for (const g of groups) for (const i of g.items) {
      const key = (i.name ?? '').trim().toLowerCase()
      if (!key) continue
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(i)
    }
    return [...byName.values()].filter(arr => arr.length > 1)
  }, [groups])

  // Per duplicate-set: welk item houden we? Default = eerste (meestal de
  // oudste, of de Google-versie als er een is).
  const [keep, setKeep] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const arr of dupGroups) {
      // Voorkeur: Google-item houden als er één bij zit, anders het eerste
      const preferred = arr.find(i => i.source === 'google') ?? arr[0]
      out[(arr[0].name ?? '').trim().toLowerCase()] = preferred.id
    }
    return out
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toDelete = new Set<string>()
  for (const arr of dupGroups) {
    const key = (arr[0].name ?? '').trim().toLowerCase()
    const keepId = keep[key]
    for (const i of arr) if (i.id !== keepId) toDelete.add(i.id)
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, backdropFilter: 'blur(4px)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(620px, 92vw)', maxHeight: '85vh', zIndex: 9001,
        background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>🧹 Schoonmaken</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              {dupGroups.length === 0
                ? 'Geen duplicaten gevonden — alles is uniek.'
                : `${dupGroups.length} naam${dupGroups.length === 1 ? '' : 'en'} komen meerdere keren voor. Kies per groep welk item je wil houden, de rest wordt verwijderd.`}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {dupGroups.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>👌 Niks te doen.</p>
          ) : dupGroups.map((arr) => {
            const key = (arr[0].name ?? '').trim().toLowerCase()
            return (
              <div key={key} style={{ marginBottom: 16, border: '1px solid var(--border-light)', borderRadius: 8 }}>
                <div style={{ padding: '8px 12px', background: 'var(--overlay-faint)', borderBottom: '1px solid var(--border-light)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  &ldquo;{arr[0].name}&rdquo; <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {arr.length}× gevonden</span>
                </div>
                {arr.map(i => {
                  const isKept = keep[key] === i.id
                  return (
                    <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: '1px solid var(--border-light)', cursor: 'pointer',
                      background: isKept ? 'var(--accent-light)' : 'transparent' }}>
                      <input type="radio" name={`dup-${key}`} checked={isKept}
                        onChange={() => setKeep(prev => ({ ...prev, [key]: i.id }))}
                        style={{ accentColor: 'var(--accent)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {i.source === 'google' && <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>G</span>}
                          {i.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {i.startDate ? `${i.startDate} → ${i.endDate ?? i.startDate}` : 'geen datums'} · {i.estHours ?? 0}u
                          {i.ownerIds && i.ownerIds.length > 0 && ` · ${i.ownerIds.filter(o => o !== 'unassigned').map(o => teamData.members.find(m => m.id === o)?.name?.split(' ')[0] ?? o).join(', ')}`}
                        </div>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: isKept ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {isKept ? 'BEHOUDEN' : 'verwijderen'}
                      </span>
                    </label>
                  )
                })}
              </div>
            )
          })}
        </div>

        {dupGroups.length > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {toDelete.size} item{toDelete.size === 1 ? '' : 's'} worden verwijderd.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Annuleer</button>
              <button onClick={() => onDelete(toDelete)} disabled={toDelete.size === 0}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: toDelete.size > 0 ? '#e2445c' : 'var(--bg-hover)',
                  color: toDelete.size > 0 ? '#fff' : 'var(--text-muted)',
                  fontSize: 12.5, fontWeight: 700, cursor: toDelete.size > 0 ? 'pointer' : 'not-allowed' }}>
                Verwijder {toDelete.size}
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}

// ─── Item-detail drawer ─ rechts-uitschuivend paneel met info + groot ──────
// commentaar-veld, zoals Monday's item-modal. Klik op item-naam = open.
function ItemDetailDrawer({ item, cols, accentColor, onUpdate, onClose }: {
  item: BoardItem; cols: ColumnDef[]; accentColor?: string
  onUpdate: (u: Partial<BoardItem>) => void
  onClose: () => void
}) {
  const itemId   = item.id
  const itemText = item.name
  const { profile } = useProfile()
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [newReply, setNewReply] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [editName, setEditName] = useState(false)
  const [nameDraft, setNameDraft] = useState(item.name)

  useEffect(() => {
    const refresh = () => setThreads(loadCommentsFor('board-item:' + itemId))
    refresh()
    return onCommentsUpdate(refresh)
  }, [itemId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !editName) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editName])

  const thread = threads[0]
  const replies = thread?.thread ?? []

  function addReply() {
    const body = newReply.trim()
    if (!body) return
    const reply = {
      id:        newCommentId(),
      author:    profile?.name ?? 'Iemand',
      authorId:  profile?.memberId,
      body,
      createdAt: new Date().toISOString(),
    }
    if (thread) {
      saveComment({ ...thread, thread: [...thread.thread, reply] })
    } else {
      saveComment({
        id:        newCommentId(),
        contextId: 'board-item:' + itemId,
        quote:     itemText,
        thread:    [reply],
        resolved:  false,
        createdAt: new Date().toISOString(),
      })
    }
    for (const rid of mentionIds) {
      createNotification({
        recipientId: rid,
        actorId:     profile?.memberId ?? null,
        kind:        'mention',
        contextKind: 'board_item',
        contextId:   itemId,
        href:        undefined,
        body:        body.length > 90 ? body.slice(0, 90) + '…' : body,
      }).catch(() => {})
    }
    setNewReply('')
    setMentionIds([])
  }

  function deleteReply(replyId: string) {
    if (!thread) return
    const next = thread.thread.filter(r => r.id !== replyId)
    saveComment({ ...thread, thread: next })
  }

  const accent = accentColor ?? '#579bfc'
  const isGoogle = item.source === 'google'

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, backdropFilter: 'blur(3px)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(760px, 96vw)', zIndex: 9001,
        background: 'var(--bg-base)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 22px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
          background: 'var(--bg-card)',
        }}>
          <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 3, background: accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Item</span>
              {isGoogle && <span style={{ background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3 }}>GOOGLE</span>}
            </div>
            {editName && !isGoogle ? (
              <input autoFocus value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => { onUpdate({ name: nameDraft }); setEditName(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { onUpdate({ name: nameDraft }); setEditName(false) }
                  if (e.key === 'Escape') { setNameDraft(item.name); setEditName(false) }
                }}
                style={{ ...editInput, fontSize: 20, fontWeight: 700, width: '100%' }} />
            ) : (
              <h2 onClick={() => { if (!isGoogle) { setNameDraft(item.name); setEditName(true) } }}
                title={isGoogle ? 'Bewerk in Google Calendar' : 'Klik om te bewerken'}
                style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)',
                  cursor: isGoogle ? 'default' : 'text', lineHeight: 1.25 }}>
                {item.name}
              </h2>
            )}
          </div>
          <button onClick={onClose} title="Sluiten (Esc)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>

        {/* Body: properties + comments */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 22px' }}>
          {/* Properties grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px 18px', marginBottom: 24 }}>
            {cols.map(col => (
              <div key={col.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {col.label}
                </span>
                <div style={{ minHeight: 28, display: 'flex', alignItems: 'center' }}>
                  <Cell item={item} col={col} onUpdate={onUpdate} />
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          {(typeof item.notes === 'string' || item.notes === undefined) && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Notities
              </div>
              <textarea
                defaultValue={item.notes ?? ''}
                onBlur={e => { if (e.target.value !== (item.notes ?? '')) onUpdate({ notes: e.target.value }) }}
                placeholder="Voeg notities toe…"
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'inherit',
                  resize: 'vertical', outline: 'none',
                }} />
            </div>
          )}

          {/* Comments */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Opmerkingen
              </div>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {replies.length} {replies.length === 1 ? 'reactie' : 'reacties'}
              </span>
            </div>

            {replies.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', margin: '8px 0 14px' }}>Nog geen opmerkingen. Wees de eerste!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
                {[...replies].reverse().map(r => {
                  const mine = !!profile?.memberId && r.authorId === profile.memberId
                  return (
                    <div key={r.id} style={{
                      position: 'relative',
                      background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                      borderRadius: 10, padding: '12px 14px',
                    }}
                      onMouseEnter={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.cmt-del'); if (btn) btn.style.opacity = '1' }}
                      onMouseLeave={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.cmt-del'); if (btn) btn.style.opacity = '0' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                        <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{r.author}</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(r.createdAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>
                        {r.body}
                      </div>
                      {profile?.memberId && thread && (
                        <ReactionRow
                          reactions={r.reactions}
                          currentMemberId={profile.memberId}
                          onToggle={emoji => {
                            const updatedReply = toggleReaction(r, emoji, profile.memberId!)
                            saveComment({
                              ...thread,
                              thread: thread.thread.map(x => x.id === r.id ? updatedReply : x),
                            })
                          }}
                        />
                      )}
                      {mine && (
                        <button className="cmt-del" onClick={() => deleteReply(r.id)}
                          title="Verwijder opmerking"
                          style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: '2px 6px', borderRadius: 4, opacity: 0, transition: 'opacity 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #e2445c)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                          ×
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div>
              <MentionTextarea
                value={newReply}
                onChange={setNewReply}
                onMentionsChange={setMentionIds}
                onSubmit={addReply}
                placeholder="Schrijf een opmerking… (typ @ om iemand te taggen, ⌘+Enter om te plaatsen)"
                rows={3}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button onClick={addReply} disabled={!newReply.trim()}
                  style={{ padding: '8px 16px', borderRadius: 6, border: 'none',
                    background: newReply.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                    color: newReply.trim() ? '#000' : 'var(--text-muted)',
                    fontSize: 13, fontWeight: 700, cursor: newReply.trim() ? 'pointer' : 'not-allowed' }}>
                  Plaats opmerking
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── Groep ────────────────────────────────────────────────────────────────────
function BoardGroupSection({ boardId, group, cols, colWidths, gridTemplate, selectedIds, onToggleSelect, onSelectGroup, sortBy, onToggleSort, reorderMode, onUpdateGroup, onMoveItemHere, onNestItem, onUnnestSubitemHere, onDeleteGroup, onResizeCol }: {
  boardId: string
  group: BoardGroup; cols: ColumnDef[]; colWidths: Record<string, number>; gridTemplate: string
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectGroup: (groupId: string, allSelected: boolean) => void
  sortBy: { key: string; dir: 'asc' | 'desc' } | null
  onToggleSort: (key: string) => void
  reorderMode: boolean
  onUpdateGroup: (g: BoardGroup) => void
  onMoveItemHere: (itemId: string, fromGroupId: string) => void
  onNestItem:     (sourceId: string, fromGroupId: string, targetId: string) => void
  onUnnestSubitemHere: (subitemId: string, parentItemId: string, fromGroupId: string, toGroupId: string) => void
  onDeleteGroup: () => void
  onResizeCol: (key: string, width: number) => void
}) {
  const [dropHover, setDropHover] = useState(false)
  // 'Ghost mode': zodra ergens op het bord een subitem versleept wordt,
  // krijgt elke groep een opvallende drop-zone-stijl zodat de gebruiker
  // direct ziet WAAR 'ie kan loslaten. Reset bij dragend.
  const [subDragName, setSubDragName] = useState<string | null>(null)
  useEffect(() => {
    function onStart(e: Event) {
      const ce = e as CustomEvent<{ name?: string }>
      setSubDragName(ce.detail?.name ?? 'Subitem')
    }
    function onEnd() { setSubDragName(null); setDropHover(false) }
    window.addEventListener('yoko-subitem-drag-start', onStart)
    window.addEventListener('yoko-subitem-drag-end',   onEnd)
    return () => {
      window.removeEventListener('yoko-subitem-drag-start', onStart)
      window.removeEventListener('yoko-subitem-drag-end',   onEnd)
    }
  }, [])
  const { pushUndo, showToast } = useUndo()
  // Collapsed-state komt rechtstreeks uit de group-data (gestored in
  // localStorage + Supabase via boardStore). Toggle persisteert via
  // onUpdateGroup, dus refresh onthoudt je keuze.
  const collapsed = group.collapsed ?? false
  const toggleCollapsed = () => onUpdateGroup({ ...group, collapsed: !collapsed })
  const [headerHover,  setHeaderHover]  = useState(false)
  const [editName,     setEditName]     = useState(false)
  const [nameDraft,    setNameDraft]    = useState(group.name)
  const [colorPicker,  setColorPicker]  = useState(false)
  const colorBtnRef  = useRef<HTMLButtonElement>(null)
  const dragRowRef   = useRef<number | null>(null)

  function saveName() {
    onUpdateGroup({ ...group, name: nameDraft })
    setEditName(false)
  }

  function updateItem(itemId: string, updates: Partial<BoardItem>) {
    // Multi-select: als het item in een groter selectie zit, pas de
    // wijziging op alle geselecteerde items binnen deze groep toe. Cross-
    // group bulk (zelden gebruikt) blijft per-groep.
    const bulk = selectedIds.size > 1 && selectedIds.has(itemId)
    // Google-items zijn grotendeels read-only: bij elke sync worden naam,
    // timeline, uren, deadline etc. overschreven dus lokale edits daarop
    // verdwijnen toch. Subitem-edits en status zijn wél toegestaan — de
    // sync's resolveStatus respecteert door de gebruiker gezette Done/Stuck/
    // Working etc., en subitem-state bewaren we expliciet.
    const sourceItem = group.items.find(i => i.id === itemId)
    if (sourceItem?.source === 'google') {
      const keys = Object.keys(updates)
      const allowed = keys.every(k => k === 'subitems' || k === 'status')
      if (!allowed) {
        showToast('Bewerk dit item in Google Calendar — wijzigingen hier worden bij de volgende sync overschreven')
        return
      }
    }
    // Snapshot voor undo — alleen bij geen-bulk en als er daadwerkelijk
    // iets verandert. Subitem-edits (onUpdate met subitems-array) doen we
    // ook mee, anders is een uren-correctie niet terug te draaien.
    const snapshot = { ...group, items: group.items.map(i => ({ ...i, subitems: i.subitems ? [...i.subitems] : i.subitems })) }
    onUpdateGroup({
      ...group,
      items: group.items.map(i => {
        if (bulk ? selectedIds.has(i.id) : i.id === itemId) return { ...i, ...updates }
        return i
      }),
    })
    // Toast + undo. Cell-handlers zelf zijn silent, dus we maken hier per
    // type een leesbare regel.
    const item = group.items.find(i => i.id === itemId)
    const target = bulk
      ? `${group.items.filter(g => selectedIds.has(g.id)).length} items`
      : (item ? `'${item.name}'` : 'Item')
    let label = ''
    if ('status' in updates) {
      label = `${target} → ${updates.status || '(geen status)'}`
      showToast(label)
    } else if ('ownerIds' in updates) {
      const next = (updates.ownerIds ?? []).filter(id => id !== 'unassigned')
      const names = next.map(id => teamData.members.find(m => m.id === id)?.name?.split(' ')[0] ?? id)
      label = names.length === 0 ? `${target} niet meer toegewezen` : `${target} → ${names.join(', ')}`
      showToast(label)
    } else if ('startDate' in updates || 'endDate' in updates) {
      label = `Datums bijgewerkt op ${target}`
      showToast(label)
    } else if ('estHours' in updates) {
      label = `${target} → ${Number(updates.estHours) || 0}u`
    } else if ('dagen' in updates) {
      label = `${target} → ${Number(updates.dagen) || 0} dagen`
    } else if ('name' in updates) {
      label = `${target} hernoemd`
    } else if ('subitems' in updates) {
      label = `Subitem bijgewerkt`
    } else {
      label = `${target} bijgewerkt`
    }
    // Niet bij bulk — daar is undo via BulkActionBar al iets aparts.
    if (!bulk) pushUndo(() => onUpdateGroup(snapshot), label)
  }
  function deleteItem(itemId: string) {
    const removed = group.items.find(i => i.id === itemId)
    const idx = group.items.findIndex(i => i.id === itemId)
    const snapshot = { ...group, items: [...group.items] }
    onUpdateGroup({ ...group, items: group.items.filter(i => i.id !== itemId) })
    pushUndo(() => onUpdateGroup(snapshot), removed ? `'${removed.name}' verwijderd` : 'Item verwijderd')
    void idx
  }
  function moveItem(itemId: string, dir: -1 | 1) {
    const idx = group.items.findIndex(i => i.id === itemId)
    const next = idx + dir
    if (idx < 0 || next < 0 || next >= group.items.length) return
    const items = [...group.items]
    items[idx] = items[next]; items[next] = group.items[idx]
    onUpdateGroup({ ...group, items })
  }

  // Sorted view of items — does not mutate saved order
  function sortValue(item: BoardItem, key: string): string | number | null {
    if (key === 'name')      return item.name?.toLowerCase() ?? ''
    if (key === 'ownerIds') {
      const id = item.ownerIds?.[0]
      const m  = id ? teamData.members.find(t => t.id === id) : null
      return (m?.name ?? '~').toLowerCase()
    }
    if (key === 'status')    return STATUS_OPTIONS.findIndex(o => o.label === item.status)
    if (key === 'estHours' || key === 'dagen' || key === 'nummers') return Number(item[key] ?? 0)
    if (key === 'startDate' || key === 'endDate' || key === 'deadline' || key === 'uitzenddag' || key === 'timeline') {
      const dKey = key === 'timeline' ? 'startDate' : key
      let v = item[dKey] as string | null
      // Auto-rollup voor sortering: parent zonder eigen datum pakt 't
      // vroegste subitem (voor start) of laatste (voor end), zodat 'ie
      // op de juiste plek in de tijdlijn komt te staan.
      if (!v && (dKey === 'startDate' || dKey === 'endDate')) {
        const allSubs = (item.subitems ?? []) as Array<{ status?: string; startDate?: string | null; endDate?: string | null }>
        const activeSubs = allSubs.filter(s => s.status !== 'Done')
        const subs = activeSubs.length > 0 ? activeSubs : allSubs
        const dates = subs.map(s => dKey === 'startDate' ? s.startDate : s.endDate).filter(Boolean) as string[]
        if (dates.length > 0) {
          dates.sort()
          v = dKey === 'startDate' ? dates[0] : dates[dates.length - 1]
        }
      }
      // null laten doorvallen — de outer sort gooit null altijd onderaan,
      // ongeacht asc/desc. (MAX_SAFE_INTEGER zou items zonder datum in DESC
      // bovenaan zetten, wat raar oogt.)
      return v ? new Date(v).getTime() : null
    }
    const v = item[key]
    if (v == null) return ''
    return typeof v === 'number' ? v : String(v).toLowerCase()
  }
  const renderItems = sortBy
    ? [...group.items].sort((a, b) => {
        const av = sortValue(a, sortBy.key)
        const bv = sortValue(b, sortBy.key)
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        if (av < bv) return sortBy.dir === 'asc' ? -1 : 1
        if (av > bv) return sortBy.dir === 'asc' ? 1 : -1
        return 0
      })
    : group.items
  function addItem() {
    onUpdateGroup({ ...group, items: [...group.items, {
      id: Date.now().toString(), name: 'Nieuw item', ownerIds: [], status: '',
      startDate: null, endDate: null, deadline: null, estHours: 0, dagen: 0,
    }] })
  }

  const totHours = group.items.reduce((s, i) => s + effectiveHours(i), 0)
  const totDagen = Math.round((totHours / 8) * 10) / 10

  // Cross-group drag-and-drop. Een item kan vanuit een andere groep hier
  // gedropt worden — we accepteren alleen onze eigen dataTransfer type
  // zodat externe drags (afbeeldingen e.d.) genegeerd worden.
  function onContainerDragOver(e: React.DragEvent) {
    if (
      !e.dataTransfer.types.includes('application/x-yoko-item') &&
      !e.dataTransfer.types.includes('application/x-yoko-subitem')
    ) return
    e.preventDefault()
    if (!dropHover) setDropHover(true)
  }
  function onContainerDragLeave(e: React.DragEvent) {
    // alleen weghalen als we de container echt verlaten, niet bij child-overgangen
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false)
  }
  function onContainerDrop(e: React.DragEvent) {
    setDropHover(false)
    // Top-level item naar deze groep
    const rawItem = e.dataTransfer.getData('application/x-yoko-item')
    if (rawItem) {
      try {
        const { itemId, fromGroupId } = JSON.parse(rawItem) as { itemId: string; fromGroupId: string }
        if (itemId && fromGroupId && fromGroupId !== group.id) {
          e.preventDefault()
          onMoveItemHere(itemId, fromGroupId)
        }
      } catch {}
      return
    }
    // Subitem uit een ander item → un-nesten naar deze groep als top-level item
    const rawSub = e.dataTransfer.getData('application/x-yoko-subitem')
    if (rawSub) {
      try {
        const { subitemId, parentItemId, fromGroupId } = JSON.parse(rawSub) as { subitemId: string; parentItemId: string; fromGroupId: string }
        if (subitemId && parentItemId && fromGroupId) {
          e.preventDefault()
          onUnnestSubitemHere(subitemId, parentItemId, fromGroupId, group.id)
        }
      } catch {}
    }
    setSubDragName(null)
  }

  // Visual states bij subitem-drag:
  //  - subDragName !== null = ergens op het bord wordt iets gesleept
  //    → álle groepen krijgen een subtiele animerende stippel-rand
  //      ("hier kan je loslaten")
  //  - dropHover = je hovert nú boven deze groep → opvallend accent
  const isDropTarget = !!subDragName
  return (
    <GroupCtx.Provider value={{ color: group.color }}>
      <div style={{
        marginBottom: 20, borderRadius: 10, position: 'relative',
        outline: dropHover
          ? `3px solid ${group.color}`
          : isDropTarget
            ? `2px dashed ${group.color}88`
            : '2px dashed transparent',
        outlineOffset: -2,
        background: dropHover ? group.color + '12' : 'transparent',
        transition: 'outline 0.12s, background 0.12s',
      }}
        onDragOver={onContainerDragOver}
        onDragLeave={onContainerDragLeave}
        onDrop={onContainerDrop}>
        {/* Drop-indicator: 'Laat los om hier te plaatsen' verschijnt prominent
            in het midden zodra je boven deze groep zweeft tijdens een drag. */}
        {dropHover && subDragName && (
          <div style={{
            position: 'absolute', top: 4, right: 4, zIndex: 30,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999,
            background: group.color, color: '#fff',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>↓</span>
            <span>Verplaats &lsquo;{subDragName}&rsquo; naar {group.name}</span>
          </div>
        )}

        {/* Groep header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderLeft: `4px solid ${group.color}`, background: 'var(--overlay-subtle)' }}
          onMouseEnter={() => setHeaderHover(true)} onMouseLeave={() => setHeaderHover(false)}>

          {/* Drag-handle voor group-reorder. Alleen dit element initieert
              de drag; klikken op andere header-elementen (kleur, naam, ×)
              blijft gewoon werken zonder per ongeluk een drag te starten. */}
          <span
            draggable
            onDragStart={e => {
              e.stopPropagation()
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-yoko-group', JSON.stringify({ groupId: group.id, fromBoard: boardId }))
            }}
            title="Sleep om volgorde te wijzigen"
            style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0, opacity: headerHover ? 1 : 0.4, transition: 'opacity 0.12s', userSelect: 'none' }}>
            ⋮⋮
          </span>

          <button onClick={toggleCollapsed} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            {collapsed ? '▶' : '▼'}
          </button>

          <button ref={colorBtnRef} onClick={e => { e.stopPropagation(); setColorPicker(o => !o) }}
            title="Kleur wijzigen"
            style={{ width: 14, height: 14, borderRadius: 3, background: group.color, border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0 }} />

          {colorPicker && (
            <PortalDropdown anchor={colorBtnRef} onClose={() => setColorPicker(false)}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Groepskleur</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
                  {PALETTE.map(c => (
                    <button key={c} onClick={() => { onUpdateGroup({ ...group, color: c }); setColorPicker(false) }} style={{
                      width: 24, height: 24, borderRadius: 5, background: c,
                      border: group.color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                      cursor: 'pointer', padding: 0,
                    }} />
                  ))}
                </div>
              </div>
            </PortalDropdown>
          )}

          {editName ? (
            <input autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditName(false); setNameDraft(group.name) } }}
              style={{ ...editInput, fontSize: 14, fontWeight: 700, color: group.color, background: 'transparent', border: '1px solid ' + group.color, width: 160 }}
            />
          ) : (
            <span onClick={() => { setNameDraft(group.name); setEditName(true) }}
              style={{ fontSize: 14, fontWeight: 700, color: group.color, cursor: 'text' }}>
              {group.name}
            </span>
          )}

          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {group.items.length} items
          </span>

          {/* Group-level select-all + verwijder. Selectie-checkbox vinkt
              alle items in de groep aan/uit (handig voor bulk-acties of
              bulk-slepen). Verwijder-knop is altijd zichtbaar met label
              zodat 't niet meer raden is. */}
          {!editName && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label title="Alle items in deze groep selecteren"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={group.items.length > 0 && group.items.every(i => selectedIds.has(i.id))}
                  ref={el => { if (el) {
                    const some = group.items.some(i => selectedIds.has(i.id))
                    const all  = group.items.length > 0 && group.items.every(i => selectedIds.has(i.id))
                    el.indeterminate = some && !all
                  }}}
                  onChange={e => onSelectGroup(group.id, e.target.checked)}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                selecteer alles
              </label>
              <button onClick={e => {
                  e.stopPropagation()
                  const count = group.items.length
                  if (count > 0 && !confirm(`Groep '${group.name}' verwijderen met ${count} item${count === 1 ? '' : 's'}?`)) return
                  onDeleteGroup()
                }}
                title="Verwijder groep"
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '3px 9px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                × Verwijder
              </button>
            </div>
          )}
        </div>

        {/* Voortgangsbalk */}
        {group.items.length > 0 && (() => {
          const total   = group.items.length
          const done    = group.items.filter(i => i.status === 'Done').length
          const working = group.items.filter(i => i.status === 'Working on...').length
          const stuck   = group.items.filter(i => i.status === 'Stuck').length
          const pct     = Math.round(done / total * 100)
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 14px 6px', borderLeft: `4px solid ${group.color}` }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--overlay-medium)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${done / total * 100}%`, background: 'var(--green)', transition: 'width 0.3s' }} />
                <div style={{ width: `${working / total * 100}%`, background: '#ff7b24', transition: 'width 0.3s' }} />
                <div style={{ width: `${stuck / total * 100}%`, background: 'var(--red)', transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0, minWidth: 28 }}>{pct}%</span>
            </div>
          )
        })()}

        {!collapsed && (
          <div style={{ borderLeft: `4px solid ${group.color}` }}>
            {/* Kolom headers */}
            <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input type="checkbox"
                  checked={group.items.length > 0 && group.items.every(i => selectedIds.has(i.id))}
                  ref={el => { if (el) el.indeterminate = group.items.some(i => selectedIds.has(i.id)) && !group.items.every(i => selectedIds.has(i.id)) }}
                  onChange={e => onSelectGroup(group.id, e.target.checked)}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 15, height: 15 }} />
              </div>
              <div style={{ position: 'relative', display: 'flex' }}>
                <button onClick={() => onToggleSort('name')}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', fontSize: 11, fontWeight: 800, color: sortBy?.key === 'name' ? 'var(--text-primary)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>
                  Item
                  {sortBy?.key === 'name' && (
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>{sortBy.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </button>
                <div title="Sleep om Item-kolom te verbreden of versmallen"
                  style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }}
                  onMouseDown={e => {
                    e.preventDefault(); e.stopPropagation()
                    const startX = e.clientX
                    const startW = colWidths['name'] ?? 200
                    function onMove(ev: MouseEvent) { onResizeCol('name', startW + ev.clientX - startX) }
                    function onUp() {
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }} />
              </div>
              {cols.map(col => (
                <div key={col.key} style={{ position: 'relative', padding: '6px 8px', fontSize: 11, fontWeight: 800, color: sortBy?.key === col.key ? 'var(--text-primary)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--border)', userSelect: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  onClick={() => onToggleSort(col.key)}>
                  {col.label}
                  {sortBy?.key === col.key && (
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>{sortBy.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                  <div
                    title="Kolom breder/smaller slepen"
                    style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }}
                    onMouseDown={e => {
                      e.preventDefault(); e.stopPropagation()
                      const startX = e.clientX
                      const startW = colWidths[col.key] ?? col.width
                      function onMove(ev: MouseEvent) { onResizeCol(col.key, startW + ev.clientX - startX) }
                      function onUp() {
                        document.removeEventListener('mousemove', onMove)
                        document.removeEventListener('mouseup', onUp)
                      }
                      document.addEventListener('mousemove', onMove)
                      document.addEventListener('mouseup', onUp)
                    }}
                  />
                </div>
              ))}
              <div style={{ borderLeft: '1px solid var(--border)' }} />
            </div>

            {renderItems.map((item) => {
              const realIdx = group.items.findIndex(i => i.id === item.id)
              return (
              <div key={item.id} data-item-id={item.id} draggable={!reorderMode}
                onDragStart={e => {
                  dragRowRef.current = realIdx
                  e.dataTransfer.effectAllowed = 'move'
                  // Geef ook expliciet door welke groep + item we slepen,
                  // zodat een andere BoardGroupSection het in de drop kan oppakken.
                  e.dataTransfer.setData('application/x-yoko-item', JSON.stringify({ itemId: item.id, fromGroupId: group.id, fromBoard: boardId }))
                }}
                onDragOver={e => {
                  const raw = e.dataTransfer.types.includes('application/x-yoko-item')
                  if (raw && dragRowRef.current === null) return
                  if (dragRowRef.current === null || dragRowRef.current === realIdx) {
                    e.currentTarget.style.outline = ''
                    return
                  }
                  // Drop-zone-detectie: middelste 50% van de rij = nest;
                  // bovenste/onderste 25% = reorder. Geeft een natuurlijke
                  // "drop on item" vs "drop between items" gesture zonder
                  // dat je een modifier-key hoeft te kennen.
                  const r = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - r.top
                  const nestZone = y > r.height * 0.25 && y < r.height * 0.75
                  if (nestZone) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    e.currentTarget.style.outline = '2px dashed var(--accent)'
                    e.currentTarget.style.outlineOffset = '-2px'
                    return
                  }
                  e.currentTarget.style.outline = ''
                  // Bij actieve sort zou handmatig reorderen toch onzichtbaar
                  // zijn — sla within-group reorder over.
                  if (sortBy) return
                  e.preventDefault()
                  const next = [...group.items]
                  const [moved] = next.splice(dragRowRef.current, 1)
                  next.splice(realIdx, 0, moved)
                  dragRowRef.current = realIdx
                  onUpdateGroup({ ...group, items: next })
                }}
                onDragLeave={e => { e.currentTarget.style.outline = '' }}
                onDrop={e => {
                  e.currentTarget.style.outline = ''
                  const raw = e.dataTransfer.getData('application/x-yoko-item')
                  if (!raw) return
                  // Alleen nesten als de drop in de nest-zone (middelste
                  // 50%) gebeurt; randen leveren al de reorder af.
                  const r = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - r.top
                  const nestZone = y > r.height * 0.25 && y < r.height * 0.75
                  if (!nestZone) return
                  try {
                    const data = JSON.parse(raw) as { itemId: string; fromGroupId: string; fromBoard?: string }
                    if (!data.itemId || data.itemId === item.id) return
                    if (data.fromBoard && data.fromBoard !== boardId) return  // alleen binnen hetzelfde bord
                    e.preventDefault()
                    onNestItem(data.itemId, data.fromGroupId, item.id)
                  } catch {}
                }}
                onDragEnd={() => { dragRowRef.current = null }}>
                <BoardRow item={item} cols={cols} gridTemplate={gridTemplate} groupId={group.id}
                  selected={selectedIds.has(item.id)}
                  accentColor={group.color}
                  onToggleSelect={() => onToggleSelect(item.id)}
                  selectedIds={selectedIds}
                  onToggleSubitem={onToggleSelect}
                  reorderMode={reorderMode}
                  isFirst={realIdx === 0}
                  isLast={realIdx === group.items.length - 1}
                  onMoveUp={() => moveItem(item.id, -1)}
                  onMoveDown={() => moveItem(item.id, 1)}
                  onUpdate={u => updateItem(item.id, u)} onDelete={() => deleteItem(item.id)} />
              </div>
              )
            })}

            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
              <button onClick={addItem} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                + Voeg item toe
              </button>
            </div>

            {group.items.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, borderBottom: '2px solid var(--border)', background: 'var(--overlay-faint)' }}>
                <div />
                <div style={{ padding: '5px 14px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Som</div>
                {cols.map(col => (
                  <div key={col.key} style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderLeft: '1px solid var(--border)', fontWeight: 600 }}>
                    {col.key === 'estHours' ? `${totHours}u` : col.key === 'dagen' ? totDagen : ''}
                  </div>
                ))}
                <div style={{ borderLeft: '1px solid var(--border)' }} />
              </div>
            )}
          </div>
        )}
      </div>
    </GroupCtx.Provider>
  )
}

// ─── Auto-move "Done" items into a dedicated "Done" group ───────────────────
// Items with status === 'Done' that are currently in a non-Done group get
// pulled into the Done group (created on first use). Items that are already
// in the Done group are LEFT ALONE — preserves manually placed items + items
// imported with localized status labels (e.g. "Klaar").
//
// Omgekeerd: items DIE in de Done-groep staan en waarvan de status weer
// !== 'Done' is gezet, worden teruggestuurd naar hun oorspronkelijke groep
// (opgeslagen in item.originGroupId bij de heenweg). Bestaat die groep niet
// meer? Dan landen ze in de eerste niet-Done groep.
function autoMoveDoneItems(next: BoardGroup[]): BoardGroup[] {
  const doneIdx   = next.findIndex(g => g.name.toLowerCase() === 'done')
  const doneGroup = doneIdx >= 0 ? next[doneIdx] : null

  const additions: BoardItem[] = []
  // Map van itemId → groep waar 'ie heen moet bij terug-uit-Done.
  const restorations = new Map<string, { item: BoardItem; targetGroupId: string }>()

  let updated = next.map(g => {
    if (doneGroup && g.id === doneGroup.id) {
      // In de Done-groep: items waarvan de status NIET meer 'Done' is gaan terug.
      const keep: BoardItem[] = []
      for (const i of g.items) {
        if (i.status !== 'Done') {
          const originId = (i as { originGroupId?: string }).originGroupId
          const target = originId && next.some(g2 => g2.id === originId && g2.id !== doneGroup.id)
            ? originId
            : (next.find(g2 => g2.id !== doneGroup.id)?.id ?? doneGroup.id)
          if (target === doneGroup.id) { keep.push(i); continue }
          const { originGroupId: _drop, ...clean } = i as BoardItem & { originGroupId?: string }
          void _drop
          restorations.set(i.id, { item: clean as BoardItem, targetGroupId: target })
        } else {
          keep.push(i)
        }
      }
      return keep.length === g.items.length ? g : { ...g, items: keep }
    }
    const stay = g.items.filter(i => {
      if (i.status === 'Done') {
        // Stempel waar 'ie vandaan kwam zodat we later kunnen terugkeren.
        const tagged = { ...i, originGroupId: (i as { originGroupId?: string }).originGroupId ?? g.id } as BoardItem
        additions.push(tagged)
        return false
      }
      return true
    })
    return stay.length === g.items.length ? g : { ...g, items: stay }
  })

  // Pas eventuele restoraties toe — zet items terug in hun originele groep.
  if (restorations.size > 0) {
    updated = updated.map(g => {
      const back = [...restorations.values()].filter(r => r.targetGroupId === g.id).map(r => r.item)
      if (back.length === 0) return g
      return { ...g, items: [...g.items, ...back] }
    })
  }

  if (additions.length === 0) return restorations.size > 0 ? updated : next

  if (doneGroup) {
    return updated.map(g =>
      g.id === doneGroup.id
        ? { ...g, items: [...g.items, ...additions.filter(a => !g.items.some(b => b.id === a.id))] }
        : g
    )
  }
  return [...updated, {
    id: `g_done_${Date.now()}`, name: 'Done', color: '#9aa39a', collapsed: false,
    items: additions,
  }]
}

// ─── Periode-filter knop ─ chic pill die RangeCalendar opent ─────────────────
function PeriodFilterButton({ from, until, color, onChange }: {
  from: string; until: string; color: string
  onChange: (from: string | null, until: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const hasAny = !!(from || until)

  const label = (() => {
    if (!hasAny) return 'Periode'
    if (from && until) return fmtRange(from, until)
    if (from)          return `vanaf ${fmtDate(from)}`
    return `tot ${fmtDate(until)}`
  })()

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        title="Filter op periode (overlap met timeline)"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderRadius: 8,
          border: hasAny ? `1px solid ${color}66` : '1px solid var(--border)',
          background: hasAny ? color + '18' : 'var(--bg-card)',
          color: hasAny ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: 14, cursor: 'pointer', outline: 'none', fontWeight: hasAny ? 600 : 400,
        }}>
        <span aria-hidden style={{ display: 'inline-flex' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <line x1="16" y1="3" x2="16" y2="7" />
            <line x1="8" y1="3" x2="8" y2="7" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <span>{label}</span>
      </button>
      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <RangeCalendar
            startDate={from || null} endDate={until || null} color={color}
            onChange={(s, e) => onChange(s, e)}
          />
        </PortalDropdown>
      )}
    </>
  )
}

// ─── BoardTable (hoofd component) ─────────────────────────────────────────────
type BoardTableProps = {
  boardId: string
  title: string; emoji: string; color: string
  columns: ColumnDef[]; groups: BoardGroup[]
  onChange: (groups: BoardGroup[]) => void
  onRenameTitle?: (label: string) => void
}

export default function BoardTable({ boardId, title, emoji, color, columns, groups, onChange: rawOnChange, onRenameTitle }: BoardTableProps) {
  const storageKey = `board-col-widths-${title}`
  const onChange = (next: BoardGroup[]) => rawOnChange(autoMoveDoneItems(next))
  const { profile } = useProfile()
  const { pushUndo } = useUndo()
  useEffect(() => { setCurrentActor(profile?.memberId ?? null) }, [profile?.memberId])

  // Focus-from-link: een planning-popup of #item-mention kan linken naar
  // `?focus=<itemId>`. Klap de groep open als-ie dicht zit, scroll naar
  // de rij, en flash 'em zodat je oog er heen wordt getrokken.
  // window.location.search ipv useSearchParams() — zie import-blok hierboven.
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    function read() {
      if (typeof window === 'undefined') return null
      return new URLSearchParams(window.location.search).get('focus')
    }
    setFocusId(read())
    const onNav = () => setFocusId(read())
    window.addEventListener('popstate', onNav)
    return () => window.removeEventListener('popstate', onNav)
  }, [])
  const lastFocusedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusId || lastFocusedRef.current === focusId) return
    const targetGroup = groups.find(g => g.items.some(i => i.id === focusId))
    if (!targetGroup) return  // item bestaat nog niet (of staat in een ander bord)
    lastFocusedRef.current = focusId
    if (targetGroup.collapsed) {
      rawOnChange(groups.map(g => g.id === targetGroup.id ? { ...g, collapsed: false } : g))
    }
    // Wacht twee frames zodat de eventueel-uitgeklapte groep gerenderd is.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(focusId)}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('yoko-focus-flash')
      setTimeout(() => el.classList.remove('yoko-focus-flash'), 2400)
    }))
  // We willen alleen reageren op focusId-wijzigingen, niet op groups-changes
  // die anders een retrigger zouden veroorzaken na het uitklappen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  function initWidths(): Record<string, number> {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return Object.fromEntries(columns.map(c => [c.key, c.width]))
  }

  const [colWidths,     setColWidths]    = useState<Record<string, number>>(initWidths)
  const [search,        setSearch]       = useState('')
  const [filterOwner,   setFilterOwner]  = useState('')
  const [filterStatus,  setFilterStatus] = useState('')
  const [filterFrom,    setFilterFrom]   = useState('')  // YYYY-MM-DD
  const [filterUntil,   setFilterUntil]  = useState('')
  const [editingTitle,  setEditingTitle] = useState(false)
  const [selectedIds,   setSelectedIds]  = useState<Set<string>>(new Set())
  // Default sort: timeline-asc — items met vroegste startdatum komen
  // boven, zodat je in één oogopslag ziet wat eerst aan de beurt is.
  // Klik op een kolom-header overschrijft dit.
  const [sortBy,        setSortBy]       = useState<{ key: string; dir: 'asc' | 'desc' } | null>({ key: 'timeline', dir: 'asc' })
  const [reorderMode,   setReorderMode]  = useState(false)
  const [titleDraft,    setTitleDraft]   = useState(title)
  const [dedupOpen,     setDedupOpen]    = useState(false)

  function resizeCol(key: string, newWidth: number) {
    const updated = { ...colWidths, [key]: Math.max(60, newWidth) }
    setColWidths(updated)
    try { localStorage.setItem(storageKey, JSON.stringify(updated)) } catch { /* ignore */ }
  }

  function addGroup() {
    onChange([...groups, { id: Date.now().toString(), name: 'Nieuwe groep', color, collapsed: false, items: [] }])
  }

  const hasFilter = !!(search || filterOwner || filterStatus || filterFrom || filterUntil)

  const filteredGroups = useMemo(() => {
    if (!hasFilter) return groups
    const from = filterFrom ? new Date(filterFrom).getTime() : null
    const until = filterUntil ? new Date(filterUntil).getTime() + 86400000 - 1 : null
    const overlapsRange = (s: string | null | undefined, e: string | null | undefined) => {
      if (!s) return false
      const ms = new Date(s).getTime()
      const me = e ? new Date(e).getTime() + 86400000 - 1 : ms + 86400000 - 1
      if (from  !== null && me < from)  return false
      if (until !== null && ms > until) return false
      return true
    }
    return groups.map(g => ({
      ...g,
      items: g.items
        .filter(item => {
          if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
          if (filterOwner && !item.ownerIds.includes(filterOwner)) return false
          if (filterStatus && item.status !== filterStatus) return false
          // Periode-filter: item moet OVERLAPPEN met de gekozen range.
          // Subitems tellen ook mee — een parent zonder eigen datum maar met
          // subitems in maart hoort óók in het maart-filter te verschijnen.
          if (from !== null || until !== null) {
            const parentOver = overlapsRange(item.startDate, item.endDate)
            const subOver    = (item.subitems ?? []).some(s => overlapsRange(s.startDate, s.endDate))
            if (!parentOver && !subOver) return false
          }
          return true
        })
        .map(item => {
          // Subitems die buiten het filter-bereik vallen verbergen we; je
          // wil alleen de instances zien die in de gekozen periode zitten.
          if ((from === null && until === null) || !item.subitems || item.subitems.length === 0) return item
          const visibleSubs = item.subitems.filter(s => overlapsRange(s.startDate, s.endDate))
          // Parent had subitems EN er zijn alleen niet-zichtbare → toon alle
          // subitems alsnog zodat de rij niet leeg oogt (kan alleen wanneer
          // de parent zelf op datum matchte).
          if (visibleSubs.length === 0) return item
          if (visibleSubs.length === item.subitems.length) return item
          return { ...item, subitems: visibleSubs }
        }),
    })).filter(g => g.items.length > 0)
  }, [groups, search, filterOwner, filterStatus, filterFrom, filterUntil, hasFilter])

  const allOwners = useMemo(() => {
    const ids = new Set<string>()
    groups.forEach(g => g.items.forEach(i => i.ownerIds.forEach(id => ids.add(id))))
    return Array.from(ids)
  }, [groups])

  // Quick-filter chips & dropdown tonen alleen Yoko-collega's (de mensen
  // die echt aan de planning werken). Externe contactpersonen die soms in
  // owner_ids belanden via gcal-sync zijn voor filteren niet relevant en
  // maken de chip-rij op mobiel veel te druk.
  const yokoOwners = useMemo(() => {
    return allOwners.filter(id => {
      const m = teamData.members.find(t => t.id === id)
      return !!m?.email && m.email.toLowerCase().endsWith('@studioyoko.nl')
    })
  }, [allOwners])

  const isMobile = useIsMobile()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreBtnRef = useRef<HTMLButtonElement>(null)

  // Un-nest een subitem terug naar een top-level item in de gekozen groep.
  // Subitem verdwijnt uit z'n parent.subitems en verschijnt als nieuw
  // BoardItem onderaan de doel-groep.
  function unnestSubitemHere(subitemId: string, parentItemId: string, fromGroupId: string, toGroupId: string) {
    const fromGroup = groups.find(g => g.id === fromGroupId)
    const parent    = fromGroup?.items.find(i => i.id === parentItemId)
    const sub       = parent?.subitems?.find(s => s.id === subitemId)
    if (!fromGroup || !parent || !sub) return
    const promoted: BoardItem = {
      id:         sub.id,
      name:       sub.name,
      ownerIds:   sub.ownerIds ?? [],
      status:     sub.status ?? '',
      startDate:  sub.startDate ?? null,
      endDate:    sub.endDate ?? null,
      deadline:   null,
      estHours:   Number(sub.estHours) || 0,
      dagen:      0,
      startTime:  (sub as { startTime?: string | null }).startTime ?? null,
      endTime:    (sub as { endTime?:   string | null }).endTime   ?? null,
    } as BoardItem
    onChange(groups.map(g => {
      // BELANGRIJK: een groep kan tegelijk de bron-groep én de doel-groep
      // zijn (subitem in dezelfde groep terugplaatsen). Daarom apply'en we
      // beide transformaties cumulatief op dezelfde `next`-kopie ipv te
      // early-returnen — anders verdwijnt 't item bij same-group unnest.
      let next = g
      if (g.id === fromGroupId) {
        next = {
          ...next,
          items: next.items.map(i =>
            i.id === parentItemId
              ? { ...i, subitems: (i.subitems ?? []).filter(s => s.id !== subitemId) }
              : i
          ),
        }
      }
      if (g.id === toGroupId) {
        const exists = next.items.some(i => i.id === promoted.id)
        if (!exists) next = { ...next, items: [...next.items, promoted] }
      }
      return next
    }))
  }

  // Sleep een item van de ene groep naar de andere. Aangeroepen vanuit de
  // drop-handler op de doel-groep zodra een item er overheen wordt gelaten.
  function moveItemBetweenGroups(itemId: string, fromGroupId: string, toGroupId: string) {
    if (fromGroupId === toGroupId) return
    const fromGroup = groups.find(g => g.id === fromGroupId)
    const item = fromGroup?.items.find(i => i.id === itemId)
    if (!item) return
    onChange(groups.map(g => {
      if (g.id === fromGroupId) return { ...g, items: g.items.filter(i => i.id !== itemId) }
      if (g.id === toGroupId)   return { ...g, items: [...g.items, item] }
      return g
    }))
  }

  // Nest source-item ALS subitem van target-item. Source verdwijnt uit z'n
  // groep, target krijgt 'm onderaan z'n subitems-lijst. Alleen relevante
  // velden gaan mee (subitem-schema is een subset van item-schema).
  function nestItemUnder(sourceId: string, fromGroupId: string, targetId: string) {
    if (sourceId === targetId) return
    const fromGroup = groups.find(g => g.id === fromGroupId)
    const source    = fromGroup?.items.find(i => i.id === sourceId)
    if (!source) return
    const sub: SubItem = {
      id:        source.id,
      name:      source.name,
      ownerIds:  source.ownerIds ?? [],
      status:    source.status ?? '',
      startDate: source.startDate ?? null,
      endDate:   source.endDate ?? null,
      // Tijden meenemen — anders vallen Google-events zonder reden in het
      // 'De hele dag'-blok van de Week-view zodra ze als subitem genest zijn.
      startTime: (source as { startTime?: string | null }).startTime ?? null,
      endTime:   (source as { endTime?:   string | null }).endTime   ?? null,
      estHours:  Number(source.estHours) || 0,
    }
    // Onthoud de nesting-keuze voor Google-items: een volgende episode met
    // vergelijkbare naam plaatsen we dan automatisch onder dezelfde parent.
    if (source.source === 'google') {
      const target = groups.flatMap(g => g.items).find(i => i.id === targetId)
      if (target) addSubitemRule(source.name, boardId, targetId, target.name)
    }
    onChange(groups.map(g => {
      let items = g.items
      if (g.id === fromGroupId) items = items.filter(i => i.id !== sourceId)
      items = items.map(i => {
        if (i.id !== targetId) return i
        const exists = (i.subitems ?? []).some(s => s.id === sub.id)
        if (exists) return i
        return { ...i, subitems: [...(i.subitems ?? []), sub] }
      })
      return { ...g, items }
    }))
  }

  function handleUpdateGroup(updatedGroup: BoardGroup) {
    if (!hasFilter) {
      onChange(groups.map(g => g.id === updatedGroup.id ? updatedGroup : g))
      return
    }
    onChange(groups.map(orig => {
      if (orig.id !== updatedGroup.id) return orig
      const filteredItems = filteredGroups.find(fg => fg.id === orig.id)?.items ?? []
      const updatedById   = new Map(updatedGroup.items.map(i => [i.id, i]))
      const removedIds    = new Set(filteredItems.filter(i => !updatedById.has(i.id)).map(i => i.id))
      return {
        ...updatedGroup,
        items: [
          ...orig.items.filter(i => !removedIds.has(i.id)).map(i => updatedById.get(i.id) ?? i),
          ...updatedGroup.items.filter(i => !orig.items.find(o => o.id === i.id)),
        ],
      }
    }))
  }

  function handleDeleteGroup(id: string) {
    onChange(groups.filter(g => g.id !== id))
  }

  function exportCSV() {
    const rows: string[][] = [['Item', ...columns.map(c => c.label)]]
    groups.forEach(g => {
      rows.push([`--- ${g.name} ---`, ...columns.map(() => '')])
      g.items.forEach(i => {
        rows.push([
          i.name,
          ...columns.map(c => {
            if (c.type === 'owners')    return (i.ownerIds as string[]).join(', ')
            if (c.type === 'daterange') return `${i.startDate ?? ''} → ${i.endDate ?? ''}`
            return String(i[c.key] ?? '')
          }),
        ])
      })
    })
    const csv  = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${title}.csv`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const nameW = colWidths['name'] ?? 200
  const gridTemplate = `36px ${nameW}px ${columns.map(c => `${colWidths[c.key] ?? c.width}px`).join(' ')} 36px`

  const resultCount = filteredGroups.reduce((s, g) => s + g.items.length, 0)

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectGroup(groupId: string, allSelected: boolean) {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    setSelectedIds(prev => {
      const n = new Set(prev)
      for (const i of group.items) {
        if (allSelected) n.add(i.id); else n.delete(i.id)
      }
      return n
    })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  function bulkUpdate(patch: Partial<BoardItem>) {
    if (selectedIds.size === 0) return
    // Notificeer bij bulk-status-wijziging (alleen voor top-level items)
    if (patch.status !== undefined) {
      for (const g of groups) for (const i of g.items) {
        if (selectedIds.has(i.id) && i.status !== patch.status) {
          notifyOwnersOfStatusChange(i, i.status, patch.status)
        }
      }
    }
    // Subitem-velden zijn een subset van BoardItem-velden — alleen de
    // velden die het SubItem-schema kent kopiëren we mee.
    const subPatch: Partial<SubItem> = {}
    if ('status'    in patch) subPatch.status    = patch.status as string
    if ('ownerIds'  in patch) subPatch.ownerIds  = patch.ownerIds as string[]
    if ('startDate' in patch) subPatch.startDate = patch.startDate as string | null
    if ('endDate'   in patch) subPatch.endDate   = patch.endDate as string | null
    if ('estHours'  in patch) subPatch.estHours  = patch.estHours as number
    const hasSubPatch = Object.keys(subPatch).length > 0
    onChange(groups.map(g => ({
      ...g,
      items: g.items.map(i => {
        let nextItem = selectedIds.has(i.id) ? { ...i, ...patch } : i
        if (hasSubPatch && nextItem.subitems && nextItem.subitems.length > 0) {
          const subs = nextItem.subitems.map(s => selectedIds.has(s.id) ? { ...s, ...subPatch } : s)
          if (subs.some((s, idx) => s !== nextItem.subitems![idx])) nextItem = { ...nextItem, subitems: subs }
        }
        return nextItem
      }),
    })))
  }
  function bulkDelete() {
    if (selectedIds.size === 0) return
    // Geen confirm-dialog meer — undo-toast vangt vergissingen op.
    const snapshot = groups.map(g => ({ ...g, items: [...g.items.map(i => ({ ...i, subitems: i.subitems ? [...i.subitems] : i.subitems }))] }))
    const count = selectedIds.size
    onChange(groups.map(g => ({
      ...g,
      items: g.items
        .filter(i => !selectedIds.has(i.id))
        .map(i => i.subitems && i.subitems.some(s => selectedIds.has(s.id))
          ? { ...i, subitems: i.subitems.filter(s => !selectedIds.has(s.id)) }
          : i),
    })))
    pushUndo(() => onChange(snapshot), `${count} item${count === 1 ? '' : 's'} verwijderd`)
    clearSelection()
  }
  function toggleSort(key: string) {
    // Tweetallig: nieuwe kolom start op asc (eerstvolgende eerst), volgende
    // klik flipt naar desc, daarna weer asc. Geen 'geen sortering'-stand —
    // de tabel is altijd op iets gesorteerd.
    setSortBy(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  function bulkMoveTo(targetGroupId: string) {
    if (selectedIds.size === 0) return
    const moved: BoardItem[] = []
    const stripped = groups.map(g => ({
      ...g,
      items: g.items.filter(i => {
        if (!selectedIds.has(i.id)) return true
        moved.push(i); return false
      }),
    }))
    onChange(stripped.map(g => g.id === targetGroupId ? { ...g, items: [...g.items, ...moved] } : g))
    clearSelection()
  }

  return (
    <div style={{ padding: '32px 32px 64px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Agenda</span>
          <span style={{ color: 'var(--border)', margin: '0 8px' }}>/</span>
          {editingTitle ? (
            <input autoFocus value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => { const v = titleDraft.trim() || title; onRenameTitle?.(v); setEditingTitle(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = titleDraft.trim() || title; onRenameTitle?.(v); setEditingTitle(false) } if (e.key === 'Escape') setEditingTitle(false) }}
              style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', background: 'transparent', border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none', padding: '0 2px', width: Math.max(120, titleDraft.length * 14) }}
            />
          ) : (
            <span onClick={() => { if (onRenameTitle) { setTitleDraft(title); setEditingTitle(true) } }}
              title={onRenameTitle ? 'Klik om naam te wijzigen' : undefined}
              style={{ cursor: onRenameTitle ? 'text' : 'default' }}>
              {title}
            </span>
          )}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/activity?board=${encodeURIComponent(boardId)}`}
            title={`Activiteit van bord '${title}'`}
            style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconActivity size={13} /> {isMobile ? '' : 'Activiteit'}
          </Link>
          {!isMobile && (
            <>
              <button onClick={() => setReorderMode(r => !r)}
                title={reorderMode ? 'Klaar met sorteren' : 'Volgorde aanpassen'}
                style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: reorderMode ? 'var(--accent-light)' : 'var(--bg-card)',
                  border: `1px solid ${reorderMode ? 'var(--accent)' : 'var(--border)'}`,
                  color: reorderMode ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer' }}>
                ↕ {reorderMode ? 'Klaar' : 'Volgorde'}
              </button>
              <button onClick={exportCSV} title="Exporteer als CSV"
                style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                ↓ CSV
              </button>
            </>
          )}
          <button onClick={addGroup}
            style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            + {isMobile ? 'Groep' : 'Nieuwe groep'}
          </button>
          {isMobile && (
            <button ref={moreBtnRef} onClick={() => setMoreOpen(v => !v)}
              title="Meer acties"
              style={{ padding: '7px 10px', borderRadius: 6, fontSize: 16, fontWeight: 700, lineHeight: 1,
                background: moreOpen ? 'var(--accent-light)' : 'var(--bg-card)',
                border: `1px solid ${moreOpen ? 'var(--accent)' : 'var(--border)'}`,
                color: moreOpen ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer' }}>
              ⋯
            </button>
          )}
          {isMobile && moreOpen && (
            <PortalDropdown anchor={moreBtnRef} onClose={() => setMoreOpen(false)}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 220 }}>
                <button onClick={() => { setReorderMode(r => !r); setMoreOpen(false) }}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                    padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
                    color: reorderMode ? 'var(--accent)' : 'var(--text-primary)', fontSize: 14,
                    fontWeight: reorderMode ? 600 : 500, textAlign: 'left', borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  ↕ {reorderMode ? 'Klaar met sorteren' : 'Volgorde aanpassen'}
                </button>
                <button onClick={() => { exportCSV(); setMoreOpen(false) }}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                    padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, textAlign: 'left', borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  ↓ Exporteer CSV
                </button>
                {yokoOwners.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'var(--border-light)', margin: '6px 4px' }} />
                    <div style={{ padding: '4px 12px 6px', fontSize: 11, fontWeight: 600,
                      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Filter op persoon
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px 8px' }}>
                      {filterOwner && (
                        <button onClick={() => { setFilterOwner(''); setMoreOpen(false) }}
                          style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)',
                            background: 'var(--bg-hover)', cursor: 'pointer', fontSize: 12,
                            color: 'var(--text-muted)' }}>
                          × wis
                        </button>
                      )}
                      {yokoOwners.map(id => {
                        const m = teamData.members.find(t => t.id === id)
                        if (!m) return null
                        const active = filterOwner === id
                        return (
                          <button key={id} onClick={() => { setFilterOwner(active ? '' : id); setMoreOpen(false) }}
                            style={{ padding: '4px 10px', borderRadius: 999,
                              border: `1.5px solid ${active ? m.color : 'var(--border-light)'}`,
                              background: active ? m.color + '22' : 'var(--bg-card)',
                              cursor: 'pointer', fontSize: 12,
                              fontWeight: active ? 700 : 500,
                              color: active ? m.color : 'var(--text-secondary)' }}>
                            {m.name.split(' ')[0]}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </PortalDropdown>
          )}
        </div>
      </div>

      {/* Owner avatar strip — quick filter on people in this board.
          Op mobiel zit deze in het ⋯-menu hierboven, dus alleen op desktop tonen. */}
      {!isMobile && yokoOwners.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {yokoOwners.map(id => {
            const m = teamData.members.find(t => t.id === id)
            if (!m) return null
            const active = filterOwner === id
            return (
              <button key={id} onClick={() => setFilterOwner(active ? '' : id)} title={m.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 9px 3px 3px', borderRadius: 999,
                  border: `1.5px solid ${active ? m.color : 'var(--border-light)'}`,
                  background: active ? m.color + '18' : 'var(--bg-card)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}>
                <MemberAvatar id={id} size={24} />
                <span style={{
                  fontSize: 12.5, fontWeight: active ? 700 : 500,
                  color: active ? m.color : 'var(--text-secondary)',
                }}>
                  {m.name.split(' ')[0]}
                </span>
              </button>
            )
          })}
          {filterOwner && (
            <button onClick={() => setFilterOwner('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '4px 8px' }}>
              × wis filter
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', display: 'inline-flex' }}>
            <IconSearch size={16} />
          </span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Zoeken…"
            style={{ padding: '9px 12px 9px 32px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: 220, boxSizing: 'border-box' }} />
        </div>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: filterStatus ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 14, cursor: 'pointer', outline: 'none' }}>
          <option value="">Alle statussen</option>
          {STATUS_OPTIONS.filter(o => o.label).map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
        </select>

        <select value={filterOwner} onChange={e => setFilterOwner(e.target.value)}
          style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: filterOwner ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 14, cursor: 'pointer', outline: 'none' }}>
          <option value="">Alle personen</option>
          {yokoOwners.map(id => {
            const m = teamData.members.find(t => t.id === id)
            return m ? <option key={id} value={id}>{m.name}</option> : null
          })}
        </select>

        {/* Periode-filter: items waarvan de timeline OVERLAPT met
            [van, tot]. Leeg laten = geen ondergrens / bovengrens. */}
        <PeriodFilterButton from={filterFrom} until={filterUntil} color={color}
          onChange={(f, u) => { setFilterFrom(f ?? ''); setFilterUntil(u ?? '') }} />

        {hasFilter && (
          <>
            <button onClick={() => { setSearch(''); setFilterOwner(''); setFilterStatus(''); setFilterFrom(''); setFilterUntil('') }}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--overlay-medium)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
              × Wissen
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{resultCount} resultaten</span>
            {(filterFrom || filterUntil) && (() => {
              // Som van uren + dagen in de gefilterde set — pro-rateerd
              // wanneer een item z'n timeline maar deels in het filter-
              // window valt. Bijvoorbeeld een project 28 mrt – 24 mei van
              // 20u telt voor de filter 1–31 mei lineair als 24/58 × 20 mee.
              const fromTs  = filterFrom  ? new Date(filterFrom).getTime() : null
              const untilTs = filterUntil ? new Date(filterUntil).getTime() + 86400000 - 1 : null
              const totalHours = filteredGroups.reduce((s, g) => s + g.items.reduce((ss, i) => ss + hoursInRange(i, fromTs, untilTs), 0), 0)
              const totalDays  = totalHours / 8
              const fmt = (n: number) => Math.round(n * 10) / 10
              return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>· {fmt(totalHours)}u in periode ({fmt(totalDays)} dagen)</span>
            })()}
          </>
        )}

        <button onClick={() => setDedupOpen(true)}
          title="Vind items met dezelfde naam en laat je kiezen welke je houdt"
          style={{ marginLeft: 'auto', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-card)' }}>
          🧹 Schoonmaken
        </button>
      </div>

      {dedupOpen && (
        <DedupModal groups={groups} onClose={() => setDedupOpen(false)}
          onDelete={(ids: Set<string>) => {
            onChange(groups.map(g => ({ ...g, items: g.items.filter(i => !ids.has(i.id)) })))
            setDedupOpen(false)
          }} />
      )}

      {/* Groepen — wrapped in een dropzone zodat hele groepen via header-
          handle naar een andere positie gesleept kunnen worden. */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'visible' }}>
        {filteredGroups.map((group, gIdx) => (
          <div key={group.id}
            data-group-id={group.id}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes('application/x-yoko-group')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={e => {
              const raw = e.dataTransfer.getData('application/x-yoko-group')
              if (!raw) return
              e.preventDefault()
              try {
                const { groupId } = JSON.parse(raw) as { groupId: string }
                if (!groupId || groupId === group.id) return
                const fromIdx = groups.findIndex(g => g.id === groupId)
                if (fromIdx < 0) return
                const next = [...groups]
                const [moved] = next.splice(fromIdx, 1)
                next.splice(gIdx, 0, moved)
                onChange(next)
              } catch {}
            }}>
            <BoardGroupSection boardId={boardId} group={group} cols={columns}
              colWidths={colWidths} gridTemplate={gridTemplate}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onSelectGroup={selectGroup}
              sortBy={sortBy} onToggleSort={toggleSort}
              reorderMode={reorderMode}
              onUpdateGroup={handleUpdateGroup} onResizeCol={resizeCol}
              onMoveItemHere={(itemId, fromGroupId) => moveItemBetweenGroups(itemId, fromGroupId, group.id)}
              onNestItem={nestItemUnder}
              onUnnestSubitemHere={unnestSubitemHere}
              onDeleteGroup={() => handleDeleteGroup(group.id)} />
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Geen resultaten gevonden
          </div>
        )}
        {filteredGroups.length > 0 && (() => {
          const allItems = filteredGroups.flatMap(g => g.items)
          const totalItems = allItems.length
          const totalHours = allItems.reduce((s, i) => s + effectiveHours(i), 0)
          const totalDays  = allItems.reduce((s, i) => s + effectiveDays(i), 0)
          const fmt = (n: number) => Math.round(n * 10) / 10
          // Uitgelijnd op het tabel-grid (zelfde gridTemplate als de rijen) zodat
          // de cijfers precies onder hun kolomkoppen vallen. Extra contrast via
          // bg-card + 2px top-border en sterkere tekstkleur.
          return (
            <div style={{
              display: 'grid', gridTemplateColumns: gridTemplate,
              borderTop: '2px solid var(--accent)',
              background: 'var(--bg-card)',
              fontSize: 13, color: 'var(--text-primary)', fontWeight: 700,
              borderRadius: '0 0 10px 10px',
            }}>
              <div />
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11.5, color: 'var(--text-secondary)' }}>Totaal</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {totalItems} items</span>
              </div>
              {columns.map(col => (
                <div key={col.key} style={{
                  padding: '12px 8px', borderLeft: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center',
                }}>
                  {col.key === 'estHours' ? `${fmt(totalHours)}u`
                    : col.key === 'dagen' ? `${fmt(totalDays)} dagen`
                    : ''}
                </div>
              ))}
              <div style={{ borderLeft: '1px solid var(--border)' }} />
            </div>
          )
        })()}
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        Klik op tekst/cijfers om te bewerken · Sleep tussen rijen om te herordenen · Sleep óp een rij maakt 't een subitem · Klik op tijdlijn om datums in te stellen
      </p>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          color={color}
          groups={groups}
          onClear={clearSelection}
          onDelete={bulkDelete}
          onUpdate={bulkUpdate}
          onMoveTo={bulkMoveTo}
        />
      )}
    </div>
  )
}

// ─── Bulk action bar (shown when items selected) ──────────────────────────────
// Toolbar wanneer er meerdere items in een groep aangevinkt zijn. Iedere
// "waarde" die in een rij bewerkt kan worden, kan hier op alle geselecteerde
// items in één keer worden gezet.
function BulkActionBar({ count, color, groups, onClear, onDelete, onUpdate, onMoveTo }: {
  count: number; color: string; groups: BoardGroup[]
  onClear: () => void; onDelete: () => void
  onUpdate: (patch: Partial<BoardItem>) => void
  onMoveTo: (groupId: string) => void
}) {
  type OpenMenu = '' | 'status' | 'owner' | 'move' | 'timeline' | 'deadline' | 'est' | 'echt'
  const [open, setOpen] = useState<OpenMenu>('')
  const toggle = (m: OpenMenu) => setOpen(o => o === m ? '' : m)

  const [tlStart, setTlStart] = useState('')
  const [tlEnd,   setTlEnd]   = useState('')
  const [deadln,  setDeadln]  = useState('')
  const [est,     setEst]     = useState('')
  const [echt,    setEcht]    = useState('')

  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 200,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '8px 10px',
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
      maxWidth: '94vw', flexWrap: 'wrap',
    }}>
      <span style={{ padding: '4px 10px', borderRadius: 8, background: color + '22', color, fontSize: 12.5, fontWeight: 700 }}>
        {count} geselecteerd
      </span>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('status')} style={barBtn}>Status…</button>
        {open === 'status' && (
          <div style={popoverStyle}>
            {STATUS_OPTIONS.filter(o => o.label).map(s => (
              <button key={s.label} onClick={() => { onUpdate({ status: s.label }); setOpen('') }}
                style={{ ...popoverItem, background: s.color + '22', color: s.color }}>
                {s.label}
              </button>
            ))}
            <button onClick={() => { onUpdate({ status: '' }); setOpen('') }}
              style={{ ...popoverItem, color: 'var(--text-muted)' }}>Wis status</button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('owner')} style={barBtn}>Owner…</button>
        {open === 'owner' && (
          <div style={popoverStyle}>
            {teamData.members.map(m => (
              <button key={m.id} onClick={() => { onUpdate({ ownerIds: [m.id] }); setOpen('') }}
                style={{ ...popoverItem, color: m.color }}>
                {m.name}
              </button>
            ))}
            <button onClick={() => { onUpdate({ ownerIds: [] }); setOpen('') }}
              style={{ ...popoverItem, color: 'var(--text-muted)' }}>Wis owner</button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('timeline')} style={barBtn}>Timeline…</button>
        {open === 'timeline' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 220 }}>
            <label style={popoverLabel}>Van
              <input type="date" value={tlStart} onChange={e => setTlStart(e.target.value)} style={popoverInput} />
            </label>
            <label style={popoverLabel}>Tot
              <input type="date" value={tlEnd}   onChange={e => setTlEnd(e.target.value)}   style={popoverInput} />
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => { onUpdate({ startDate: tlStart || null, endDate: tlEnd || null }); setOpen('') }}
                disabled={!tlStart && !tlEnd}
                style={{ ...barBtn, flex: 1, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
                Toepassen
              </button>
              <button onClick={() => { onUpdate({ startDate: null, endDate: null }); setOpen('') }}
                style={{ ...barBtn, color: 'var(--text-muted)', padding: '6px 10px' }}>
                Wis
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('deadline')} style={barBtn}>Deadline…</button>
        {open === 'deadline' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 200 }}>
            <label style={popoverLabel}>Datum
              <input type="date" value={deadln} onChange={e => setDeadln(e.target.value)} style={popoverInput} />
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => { onUpdate({ deadline: deadln || null }); setOpen('') }}
                disabled={!deadln}
                style={{ ...barBtn, flex: 1, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
                Toepassen
              </button>
              <button onClick={() => { onUpdate({ deadline: null }); setOpen('') }}
                style={{ ...barBtn, color: 'var(--text-muted)', padding: '6px 10px' }}>
                Wis
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('est')} style={barBtn}>Est tijd…</button>
        {open === 'est' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 180 }}>
            <label style={popoverLabel}>Uur
              <input type="number" step="0.5" min="0" value={est} onChange={e => setEst(e.target.value)} style={popoverInput} />
            </label>
            <button onClick={() => { const v = parseFloat(est); if (!isNaN(v)) onUpdate({ estHours: v }); setOpen('') }}
              disabled={est === ''}
              style={{ ...barBtn, marginTop: 6, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
              Toepassen
            </button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('echt')} style={barBtn}>Echt gewerkt…</button>
        {open === 'echt' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 180 }}>
            <label style={popoverLabel}>Uur
              <input type="number" step="0.5" min="0" value={echt} onChange={e => setEcht(e.target.value)} style={popoverInput} />
            </label>
            <button onClick={() => { const v = parseFloat(echt); if (!isNaN(v)) onUpdate({ echtGewerkt: v } as Partial<BoardItem>); setOpen('') }}
              disabled={echt === ''}
              style={{ ...barBtn, marginTop: 6, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
              Toepassen
            </button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('move')} style={barBtn}>Verplaats…</button>
        {open === 'move' && (
          <div style={popoverStyle}>
            {groups.map(g => (
              <button key={g.id} onClick={() => { onMoveTo(g.id); setOpen('') }}
                style={popoverItem}>
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={onDelete} style={{ ...barBtn, color: '#C4453A', fontWeight: 700 }}>Verwijder</button>

      <button onClick={onClear} style={{ ...barBtn, color: 'var(--text-muted)' }} title="Selectie wissen">×</button>
    </div>
  )
}

const popoverLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
  marginBottom: 4,
}
const popoverInput: React.CSSProperties = {
  background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

const barBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-light)',
  borderRadius: 7, padding: '6px 11px', fontSize: 12.5, fontWeight: 600,
  color: 'var(--text-secondary)', cursor: 'pointer',
}
const popoverStyle: React.CSSProperties = {
  position: 'absolute', bottom: '100%', left: 0, marginBottom: 6,
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 8, padding: 4, minWidth: 160,
  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
  display: 'flex', flexDirection: 'column', gap: 2,
}
const popoverItem: React.CSSProperties = {
  background: 'transparent', border: 'none',
  padding: '6px 10px', borderRadius: 5, textAlign: 'left',
  fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer',
}

// ─── Gedeelde stijlen ─────────────────────────────────────────────────────────
const editInput: React.CSSProperties = {
  width: '100%', background: 'var(--bg-base)',
  border: '1px solid var(--accent)', borderRadius: 4,
  padding: '2px 7px', color: 'var(--text-primary)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
