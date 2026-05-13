'use client'

import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import teamData from '@/data/team.json'
import type { BoardItem, BoardGroup, ColumnDef, SubItem } from '@/lib/boards'
import { useProfile }     from './ProfileContext'
import { useTeamPhotos }  from './TeamPhotosContext'
import { useUndo }        from './UndoContext'
import { GoogleBadge }    from './GoogleBadge'
import { createNotification } from '@/lib/notificationsStore'
import { logItemActivity }    from '@/lib/itemActivity'
import {
  loadCommentsFor, saveComment, newCommentId, onCommentsUpdate,
  toggleReaction, type CommentThread,
} from '@/lib/commentsStore'
import { MentionTextarea } from './MentionTextarea'
import { ReactionRow }     from './ReactionRow'

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
    if (anchor.current) {
      const r = anchor.current.getBoundingClientRect()
      setPos({ top: r.bottom + 3, left: Math.min(r.left, window.innerWidth - 210) })
      setReady(true)
    }
    function onDown(e: MouseEvent) {
      if (!dropRef.current?.contains(e.target as Node) &&
          !anchor.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (typeof window === 'undefined') return null
  return createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
      visibility: ready ? 'visible' : 'hidden',
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
  const trigRef = useRef<HTMLDivElement>(null)
  const { profile } = useProfile()
  const team = teamData.members
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])

  return (
    <div>
      <div ref={trigRef} onClick={() => setOpen(o => !o)}
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
            borderRadius: 8, padding: 6, minWidth: 190,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}>
            {team.map(m => {
              const active  = value.includes(m.id)
              const isMe    = profile?.memberId === m.id
              const photo   = isMe ? profile?.photo : null
              const initials = m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
              return (
                <button key={m.id} onClick={() => toggle(m.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '6px 8px', borderRadius: 4,
                  background: active ? m.color + '18' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
                }}>
                  {photo ? (
                    <img src={photo} alt="" style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${m.color}`, objectFit: 'cover',
                    }} />
                  ) : (
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: m.color + '30', border: `2px solid ${m.color}`,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: m.color,
                    }}>{initials}</span>
                  )}
                  <span style={{ fontWeight: active ? 600 : 400 }}>
                    {m.name}{isMe ? ' (jij)' : ''}
                  </span>
                  {active && <span style={{ marginLeft: 'auto', color: m.color, fontSize: 12 }}>✓</span>}
                </button>
              )
            })}
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
function SubItemRow({ subitem, cols, gridTemplate, rail, onUpdate, onDelete }: {
  subitem: SubItem; cols: ColumnDef[]; gridTemplate: string
  rail?: string
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

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: gridTemplate,
      alignItems: 'center', minHeight: 36,
      borderBottom: '1px solid var(--border-light)',
      background: hover ? 'var(--overlay-subtle)' : 'var(--overlay-sub)',
      transition: 'background 0.1s',
    }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* Per-rij rail aan de absolute linkerkant — kort segment per
          subitem zoals Monday doet, ipv één doorlopende balk. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch', height: '100%' }}>
        <div style={{ width: 4, background: rail ?? 'var(--accent)', borderRadius: 2, margin: '4px 0 4px 0' }} />
      </div>
      <div style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', minWidth: 0 }}>
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
            style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 400, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
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
function SubItemsSection({ subitems, cols, gridTemplate, accentColor, onUpdate }: {
  subitems: SubItem[]; cols: ColumnDef[]; gridTemplate: string
  accentColor?: string
  onUpdate: (u: SubItem[]) => void
}) {
  function updateOne(id: string, u: Partial<SubItem>) { onUpdate(subitems.map(s => s.id === id ? { ...s, ...u } : s)) }
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
    <div style={{ borderBottom: '1px solid var(--border)', padding: '4px 18px 8px 30px', background: 'var(--overlay-sub-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: 'var(--overlay-sub-header)', borderBottom: '1px solid var(--border-light)' }}>
        <div />
        <div style={{ padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subitem</div>
        {cols.map(c => (
          <div key={c.key} style={hdrCell}>{headerLabelFor(c.key, c.label)}</div>
        ))}
        <div style={{ borderLeft: '1px solid var(--border-light)' }} />
      </div>
      {subitems.map(sub => (
        <SubItemRow key={sub.id} subitem={sub} cols={cols} gridTemplate={gridTemplate}
          rail={rail}
          onUpdate={u => updateOne(sub.id, u)} onDelete={() => deleteOne(sub.id)} />
      ))}
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

// ─── Item rij ─────────────────────────────────────────────────────────────────
function BoardRow({ item, cols, gridTemplate, selected, accentColor, onToggleSelect, reorderMode, isFirst, isLast, onMoveUp, onMoveDown, onUpdate, onDelete }: {
  item: BoardItem; cols: ColumnDef[]; gridTemplate: string
  selected: boolean
  accentColor?: string
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
  const [showComments, setShowComments] = useState(false)
  useEffect(() => {
    const refresh = () => {
      const threads = loadCommentsFor('board-item:' + item.id)
      setCommentCount(threads.reduce((s, t) => s + t.thread.length, 0))
    }
    refresh()
    return onCommentsUpdate(refresh)
  }, [item.id])

  // Auto-rollup: als parent een veld leeg laat én er zijn subitems, dan
  // afleiden uit subitems. Hours doen we al verderop in de Cell-dispatcher
  // (read-only sum). Hier: timeline + owners. Schrijf-actie van de gebruiker
  // overschrijft de derived waarde — om weer auto te krijgen moet je 't
  // veld op de parent leegmaken.
  let effectiveItem: BoardItem = item
  if (hasSubitems) {
    const updates: Partial<BoardItem> = {}
    const subStarts = subitems.map(s => s.startDate).filter(Boolean) as string[]
    const subEnds   = subitems.map(s => s.endDate).filter(Boolean) as string[]
    if (!item.startDate && subStarts.length > 0) updates.startDate = [...subStarts].sort()[0]
    if (!item.endDate   && subEnds.length   > 0) updates.endDate   = [...subEnds].sort().slice(-1)[0]
    const parentOwnersEmpty = !item.ownerIds || item.ownerIds.length === 0
      || (item.ownerIds.length === 1 && item.ownerIds[0] === 'unassigned')
    if (parentOwnersEmpty) {
      const subOwners = new Set<string>()
      for (const s of subitems) for (const oid of (s.ownerIds ?? [])) if (oid && oid !== 'unassigned') subOwners.add(oid)
      if (subOwners.size > 0) updates.ownerIds = [...subOwners]
    }
    if (!item.status) {
      // Status rolt op naar 'Done' alleen wanneer ALLE subitems Done zijn.
      const allDone = subitems.length > 0 && subitems.every(s => s.status === 'Done')
      if (allDone) updates.status = 'Done'
    }
    if (Object.keys(updates).length > 0) effectiveItem = { ...item, ...updates }
  }

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: gridTemplate,
        alignItems: 'center', minHeight: 40,
        borderBottom: expanded ? 'none' : '1px solid var(--border)',
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

          {hasSubitems && !expanded && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--overlay-medium)', borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>
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
            <span
              onClick={() => {
                if (item.source === 'google') return
                setNameDraft(item.name); setEditName(true)
              }}
              title={item.source === 'google' ? 'Bewerk dit item in Google Calendar' : undefined}
              style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500,
                cursor: item.source === 'google' ? 'default' : 'pointer',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              {item.name}
            </span>
          )}

          {/* Comments-knop — opent een modal met thread + @ mentions + delete.
              Toont een felle pill als er al opmerkingen zijn zodat ie opvalt. */}
          <button onClick={(e) => { e.stopPropagation(); setShowComments(true) }}
            title={commentCount > 0 ? `${commentCount} opmerking${commentCount === 1 ? '' : 'en'}` : 'Plaats opmerking'}
            style={commentCount > 0 ? {
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 999,
              background: 'var(--accent-light)',
              border: '1px solid var(--accent)',
              color: 'var(--text-primary)',
              fontSize: 11, fontWeight: 700,
              cursor: 'pointer', flexShrink: 0, lineHeight: 1,
            } : {
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 13, padding: '2px 5px', borderRadius: 6, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 3,
              opacity: hover ? 0.7 : 0.35, transition: 'opacity 0.15s',
            }}>
            💬{commentCount > 0 ? <span style={{ minWidth: 8, textAlign: 'center' }}>{commentCount}</span> : ''}
          </button>
        </div>

        {cols.map(col => (
          <div key={col.key} style={{ padding: '4px 8px', borderLeft: '1px solid var(--border)', height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
            <Cell item={effectiveItem} col={col} onUpdate={onUpdate} />
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
          onUpdate={updated => onUpdate({ subitems: updated })} />
      )}
      {showComments && (
        <BoardItemCommentModal itemId={item.id} itemText={item.name}
          onClose={() => setShowComments(false)} />
      )}
    </>
  )
}

// ─── Comment modal voor één board-item ────────────────────────────────────────
function BoardItemCommentModal({ itemId, itemText, onClose }: {
  itemId: string; itemText: string; onClose: () => void
}) {
  const { profile } = useProfile()
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [newReply, setNewReply] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])

  useEffect(() => {
    const refresh = () => setThreads(loadCommentsFor('board-item:' + itemId))
    refresh()
    return onCommentsUpdate(refresh)
  }, [itemId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, backdropFilter: 'blur(4px)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(460px, 92vw)', maxHeight: '80vh', zIndex: 9001,
        background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Opmerkingen</div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemText}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px' }}>
          {replies.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', margin: '8px 0' }}>Nog geen opmerkingen.</p>
          ) : replies.map(r => {
            const mine = !!profile?.memberId && r.authorId === profile.memberId
            return (
              <div key={r.id} style={{ marginBottom: 12, position: 'relative' }}
                onMouseEnter={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.cmt-del'); if (btn) btn.style.opacity = '1' }}
                onMouseLeave={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.cmt-del'); if (btn) btn.style.opacity = '0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                  <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{r.author}</strong>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    {new Date(r.createdAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45 }}>
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
                    style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, opacity: 0, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #e2445c)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <MentionTextarea
            value={newReply}
            onChange={setNewReply}
            onMentionsChange={setMentionIds}
            onSubmit={addReply}
            placeholder="Schrijf een opmerking… (typ @ om iemand te taggen, ⌘+Enter om te plaatsen)"
            rows={2}
          />
          <button onClick={addReply} disabled={!newReply.trim()}
            style={{ padding: '8px 14px', borderRadius: 6, border: 'none',
              background: newReply.trim() ? 'var(--accent)' : 'var(--bg-hover)',
              color: newReply.trim() ? '#000' : 'var(--text-muted)',
              fontSize: 12.5, fontWeight: 700, cursor: newReply.trim() ? 'pointer' : 'not-allowed',
              alignSelf: 'flex-end' }}>
            Plaats
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── Groep ────────────────────────────────────────────────────────────────────
function BoardGroupSection({ boardId, group, cols, colWidths, gridTemplate, selectedIds, onToggleSelect, onSelectGroup, sortBy, onToggleSort, reorderMode, onUpdateGroup, onMoveItemHere, onNestItem, onDeleteGroup, onResizeCol }: {
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
  onDeleteGroup: () => void
  onResizeCol: (key: string, width: number) => void
}) {
  const [dropHover, setDropHover] = useState(false)
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
    onUpdateGroup({
      ...group,
      items: group.items.map(i => {
        if (bulk ? selectedIds.has(i.id) : i.id === itemId) return { ...i, ...updates }
        return i
      }),
    })
    // Toast met bulk-bewustzijn — Cell-handlers zelf zijn silent.
    const item = group.items.find(i => i.id === itemId)
    const target = bulk
      ? `${group.items.filter(g => selectedIds.has(g.id)).length} items`
      : (item ? `'${item.name}'` : 'Item')
    if ('status' in updates) {
      showToast(`${target} → ${updates.status || '(geen status)'}`)
    } else if ('ownerIds' in updates) {
      const next = (updates.ownerIds ?? []).filter(id => id !== 'unassigned')
      const names = next.map(id => teamData.members.find(m => m.id === id)?.name?.split(' ')[0] ?? id)
      showToast(names.length === 0 ? `${target} niet meer toegewezen` : `${target} → ${names.join(', ')}`)
    } else if ('startDate' in updates || 'endDate' in updates) {
      showToast(`Datums bijgewerkt op ${target}`)
    }
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
        const subs = (item.subitems ?? []) as Array<{ startDate?: string | null; endDate?: string | null }>
        const dates = subs.map(s => dKey === 'startDate' ? s.startDate : s.endDate).filter(Boolean) as string[]
        if (dates.length > 0) {
          dates.sort()
          v = dKey === 'startDate' ? dates[0] : dates[dates.length - 1]
        }
      }
      return v ? new Date(v).getTime() : Number.MAX_SAFE_INTEGER
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
    if (!e.dataTransfer.types.includes('application/x-yoko-item')) return
    e.preventDefault()
    if (!dropHover) setDropHover(true)
  }
  function onContainerDragLeave(e: React.DragEvent) {
    // alleen weghalen als we de container echt verlaten, niet bij child-overgangen
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false)
  }
  function onContainerDrop(e: React.DragEvent) {
    setDropHover(false)
    const raw = e.dataTransfer.getData('application/x-yoko-item')
    if (!raw) return
    try {
      const { itemId, fromGroupId } = JSON.parse(raw) as { itemId: string; fromGroupId: string }
      if (!itemId || !fromGroupId || fromGroupId === group.id) return
      e.preventDefault()
      onMoveItemHere(itemId, fromGroupId)
    } catch {}
  }

  return (
    <GroupCtx.Provider value={{ color: group.color }}>
      <div style={{
        marginBottom: 20, borderRadius: 8,
        outline: dropHover ? `2px dashed ${group.color}` : '2px dashed transparent',
        outlineOffset: -2,
        transition: 'outline-color 0.12s',
      }}
        onDragOver={onContainerDragOver}
        onDragLeave={onContainerDragLeave}
        onDrop={onContainerDrop}>

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

          {headerHover && !editName && (
            <button onClick={onDeleteGroup} title="Groep verwijderen"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px', borderRadius: 3 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
              ×
            </button>
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
                  // Shift houden = nest-modus (item wordt subitem van deze).
                  // Visualiseren via dashed outline; reorder overslaan.
                  if (e.shiftKey && dragRowRef.current !== null && dragRowRef.current !== realIdx) {
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
                  if (dragRowRef.current === null || dragRowRef.current === realIdx) return
                  const next = [...group.items]
                  const [moved] = next.splice(dragRowRef.current, 1)
                  next.splice(realIdx, 0, moved)
                  dragRowRef.current = realIdx
                  onUpdateGroup({ ...group, items: next })
                }}
                onDragLeave={e => { e.currentTarget.style.outline = '' }}
                onDrop={e => {
                  e.currentTarget.style.outline = ''
                  if (!e.shiftKey) return
                  const raw = e.dataTransfer.getData('application/x-yoko-item')
                  if (!raw) return
                  try {
                    const data = JSON.parse(raw) as { itemId: string; fromGroupId: string; fromBoard?: string }
                    if (!data.itemId || data.itemId === item.id) return
                    if (data.fromBoard && data.fromBoard !== boardId) return  // alleen binnen hetzelfde bord
                    e.preventDefault()
                    onNestItem(data.itemId, data.fromGroupId, item.id)
                  } catch {}
                }}
                onDragEnd={() => { dragRowRef.current = null }}>
                <BoardRow item={item} cols={cols} gridTemplate={gridTemplate}
                  selected={selectedIds.has(item.id)}
                  accentColor={group.color}
                  onToggleSelect={() => onToggleSelect(item.id)}
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
function autoMoveDoneItems(next: BoardGroup[]): BoardGroup[] {
  const doneIdx   = next.findIndex(g => g.name.toLowerCase() === 'done')
  const doneGroup = doneIdx >= 0 ? next[doneIdx] : null

  const additions: BoardItem[] = []

  const updated = next.map(g => {
    if (doneGroup && g.id === doneGroup.id) return g  // never disturb the Done group
    const stay = g.items.filter(i => {
      if (i.status === 'Done') { additions.push(i); return false }
      return true
    })
    return stay.length === g.items.length ? g : { ...g, items: stay }
  })

  if (additions.length === 0) return next

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
  const searchParams = useSearchParams()
  const focusId = searchParams?.get('focus') ?? null
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
  const [editingTitle,  setEditingTitle] = useState(false)
  const [selectedIds,   setSelectedIds]  = useState<Set<string>>(new Set())
  // Default sort: timeline-asc — items met vroegste startdatum komen
  // boven, zodat je in één oogopslag ziet wat eerst aan de beurt is.
  // Klik op een kolom-header overschrijft dit.
  const [sortBy,        setSortBy]       = useState<{ key: string; dir: 'asc' | 'desc' } | null>({ key: 'timeline', dir: 'asc' })
  const [reorderMode,   setReorderMode]  = useState(false)
  const [titleDraft,    setTitleDraft]   = useState(title)

  function resizeCol(key: string, newWidth: number) {
    const updated = { ...colWidths, [key]: Math.max(60, newWidth) }
    setColWidths(updated)
    try { localStorage.setItem(storageKey, JSON.stringify(updated)) } catch { /* ignore */ }
  }

  function addGroup() {
    onChange([...groups, { id: Date.now().toString(), name: 'Nieuwe groep', color, collapsed: false, items: [] }])
  }

  const hasFilter = !!(search || filterOwner || filterStatus)

  const filteredGroups = useMemo(() => {
    if (!hasFilter) return groups
    return groups.map(g => ({
      ...g,
      items: g.items.filter(item => {
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
        if (filterOwner && !item.ownerIds.includes(filterOwner)) return false
        if (filterStatus && item.status !== filterStatus) return false
        return true
      }),
    })).filter(g => g.items.length > 0)
  }, [groups, search, filterOwner, filterStatus, hasFilter])

  const allOwners = useMemo(() => {
    const ids = new Set<string>()
    groups.forEach(g => g.items.forEach(i => i.ownerIds.forEach(id => ids.add(id))))
    return Array.from(ids)
  }, [groups])

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
      estHours:  Number(source.estHours) || 0,
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
    // Notificeer bij bulk-status-wijziging
    if (patch.status !== undefined) {
      for (const g of groups) for (const i of g.items) {
        if (selectedIds.has(i.id) && i.status !== patch.status) {
          notifyOwnersOfStatusChange(i, i.status, patch.status)
        }
      }
    }
    onChange(groups.map(g => ({
      ...g,
      items: g.items.map(i => selectedIds.has(i.id) ? { ...i, ...patch } : i),
    })))
  }
  function bulkDelete() {
    if (selectedIds.size === 0) return
    // Geen confirm-dialog meer — undo-toast vangt vergissingen op.
    const snapshot = groups.map(g => ({ ...g, items: [...g.items] }))
    const count = selectedIds.size
    onChange(groups.map(g => ({ ...g, items: g.items.filter(i => !selectedIds.has(i.id)) })))
    pushUndo(() => onChange(snapshot), `${count} item${count === 1 ? '' : 's'} verwijderd`)
    clearSelection()
  }
  function toggleSort(key: string) {
    setSortBy(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
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
          <button onClick={() => setReorderMode(r => !r)}
            title={reorderMode ? 'Klaar met sorteren' : 'Volgorde aanpassen'}
            style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: reorderMode ? 'var(--accent-light)' : 'var(--bg-card)',
              border: `1px solid ${reorderMode ? 'var(--accent)' : 'var(--border)'}`,
              color: reorderMode ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer' }}>
            ↕ {reorderMode ? 'Klaar' : 'Volgorde'}
          </button>
          {sortBy && (
            <button onClick={() => setSortBy(null)} title="Sortering wissen"
              style={{ padding: '7px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-muted)', cursor: 'pointer' }}>
              × sortering
            </button>
          )}
          <button onClick={exportCSV} title="Exporteer als CSV"
            style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            ↓ CSV
          </button>
          <button onClick={addGroup}
            style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            + Nieuwe groep
          </button>
        </div>
      </div>

      {/* Owner avatar strip — quick filter on people in this board */}
      {allOwners.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {allOwners.map(id => {
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
                <span style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: m.color + '30', border: `1.5px solid ${m.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: m.color, flexShrink: 0,
                }}>
                  {m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12, pointerEvents: 'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Zoeken…"
            style={{ padding: '6px 8px 6px 26px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 180, boxSizing: 'border-box' }} />
        </div>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: filterStatus ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 13, cursor: 'pointer', outline: 'none' }}>
          <option value="">Alle statussen</option>
          {STATUS_OPTIONS.filter(o => o.label).map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
        </select>

        <select value={filterOwner} onChange={e => setFilterOwner(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: filterOwner ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 13, cursor: 'pointer', outline: 'none' }}>
          <option value="">Alle personen</option>
          {allOwners.map(id => {
            const m = teamData.members.find(t => t.id === id)
            return m ? <option key={id} value={id}>{m.name}</option> : null
          })}
        </select>

        {hasFilter && (
          <>
            <button onClick={() => { setSearch(''); setFilterOwner(''); setFilterStatus('') }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--overlay-medium)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
              × Wissen
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{resultCount} resultaten</span>
          </>
        )}
      </div>

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
              onDeleteGroup={() => handleDeleteGroup(group.id)} />
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Geen resultaten gevonden
          </div>
        )}
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        Klik op tekst/cijfers om te bewerken · Sleep rijen om te herordenen · Shift+sleep op een ander item maakt 't subitem · Klik op tijdlijn om datums in te stellen
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
