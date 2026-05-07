'use client'

import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import teamData from '@/data/team.json'
import type { BoardItem, BoardGroup, ColumnDef, SubItem } from '@/lib/boards'
import { useProfile }     from './ProfileContext'
import { useTeamPhotos }  from './TeamPhotosContext'

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
            background: 'var(--bg-hover)', border: '1px solid var(--border)',
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
          : value.map(id => <MemberAvatar key={id} id={id} size={24} />)
        }
      </div>

      {open && (
        <PortalDropdown anchor={trigRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-hover)', border: '1px solid var(--border)',
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

  return (
    <div style={{ width: '100%' }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        border: 'none', borderRadius: 4, padding: '3px 8px',
        background: hasAny ? pillClr + 'cc' : 'transparent',
        display: 'flex', alignItems: 'center', gap: 5, minHeight: 26,
      }}>
        {hasAny ? (
          <>
            {isLate && (
              <span style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                background: 'rgba(0,0,0,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 900, color: '#fff',
              }}>!</span>
            )}
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

// ─── Cel dispatcher ───────────────────────────────────────────────────────────
function Cell({ item, col, onUpdate }: {
  item: BoardItem; col: ColumnDef; onUpdate: (u: Partial<BoardItem>) => void
}) {
  if (col.type === 'owners')    return <OwnersCell    value={item.ownerIds} onChange={v => onUpdate({ ownerIds: v })} />
  if (col.type === 'status')    return <StatusCell    value={item.status}   onChange={v => onUpdate({ status: v })} />
  if (col.type === 'daterange') return <DateRangeCell startDate={item.startDate} endDate={item.endDate} onChange={(s,e) => onUpdate({ startDate: s, endDate: e })} />
  if (col.type === 'url')       return <UrlCell       value={(item[col.key] as string) ?? ''} onChange={v => onUpdate({ [col.key]: v })} />
  return (
    <EditableCell
      value={item[col.key] as string | number | null}
      inputType={col.type === 'currency' ? 'number' : col.type as 'text' | 'number' | 'date'}
      onChange={v => onUpdate({ [col.key]: col.type === 'currency' ? (v as number) : v })}
    />
  )
}

// ─── Subitem grid template ────────────────────────────────────────────────────
const SUBITEM_GRID = '22px 1fr 90px 145px 175px 80px 80px 36px'

// ─── Subitem rij ──────────────────────────────────────────────────────────────
function SubItemRow({ subitem, onUpdate, onDelete }: {
  subitem: SubItem; onUpdate: (u: Partial<SubItem>) => void; onDelete: () => void
}) {
  const [hover,     setHover]     = useState(false)
  const [editName,  setEditName]  = useState(false)
  const [nameDraft, setNameDraft] = useState(subitem.name)

  const cellBorder: React.CSSProperties = {
    borderLeft: '1px solid var(--border-light)', height: '100%',
    display: 'flex', alignItems: 'center', padding: '3px 8px', overflow: 'hidden',
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: SUBITEM_GRID,
      alignItems: 'center', minHeight: 36,
      borderBottom: '1px solid var(--border-light)',
      background: hover ? 'var(--overlay-subtle)' : 'var(--overlay-sub)',
      transition: 'background 0.1s',
    }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ height: '100%', borderRight: '2px solid var(--overlay-medium)' }} />
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
      <div style={cellBorder}><OwnersCell value={subitem.ownerIds} onChange={v => onUpdate({ ownerIds: v })} /></div>
      <div style={cellBorder}><StatusCell value={subitem.status} onChange={v => onUpdate({ status: v })} /></div>
      <div style={cellBorder}>
        <DateRangeCell startDate={subitem.startDate} endDate={subitem.endDate} onChange={(s,e) => onUpdate({ startDate: s, endDate: e })} />
      </div>
      <div style={cellBorder}><EditableCell value={subitem.estHours || null} inputType="number" onChange={v => onUpdate({ estHours: (v as number) ?? 0 })} /></div>
      <div style={cellBorder}><EditableCell value={subitem.echtGewerkt ?? null} inputType="number" onChange={v => onUpdate({ echtGewerkt: v != null ? (v as number) : undefined })} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-light)', height: '100%' }}>
        {hover && (
          <button onClick={onDelete} title="Verwijderen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px', borderRadius: 3 }}>×</button>
        )}
      </div>
    </div>
  )
}

// ─── Subitems sectie ──────────────────────────────────────────────────────────
function SubItemsSection({ subitems, onUpdate }: { subitems: SubItem[]; onUpdate: (u: SubItem[]) => void }) {
  function updateOne(id: string, u: Partial<SubItem>) { onUpdate(subitems.map(s => s.id === id ? { ...s, ...u } : s)) }
  function deleteOne(id: string) { onUpdate(subitems.filter(s => s.id !== id)) }
  function addOne() {
    onUpdate([...subitems, { id: Date.now().toString(), name: 'Nieuw subitem', ownerIds: [], status: '', startDate: null, endDate: null, estHours: 0 }])
  }
  const hdrCell: React.CSSProperties = { padding: '4px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--border-light)' }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--overlay-sub-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: SUBITEM_GRID, background: 'var(--overlay-sub-header)', borderBottom: '1px solid var(--border-light)' }}>
        <div />
        <div style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subitem</div>
        {['Owner', 'Status', 'Timeline', 'Est.', 'Echt gewerkt'].map(lbl => <div key={lbl} style={hdrCell}>{lbl}</div>)}
        <div style={{ borderLeft: '1px solid var(--border-light)' }} />
      </div>
      {subitems.map(sub => (
        <SubItemRow key={sub.id} subitem={sub} onUpdate={u => updateOne(sub.id, u)} onDelete={() => deleteOne(sub.id)} />
      ))}
      <div style={{ padding: '6px 10px 6px 34px' }}>
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
function BoardRow({ item, cols, gridTemplate, selected, onToggleSelect, onUpdate, onDelete }: {
  item: BoardItem; cols: ColumnDef[]; gridTemplate: string
  selected: boolean
  onToggleSelect: () => void
  onUpdate: (u: Partial<BoardItem>) => void; onDelete: () => void
}) {
  const [hover,     setHover]     = useState(false)
  const [editName,  setEditName]  = useState(false)
  const [nameDraft, setNameDraft] = useState(item.name)
  const [expanded,  setExpanded]  = useState(false)
  const subitems    = item.subitems ?? []
  const hasSubitems = subitems.length > 0

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
            <span onClick={() => { setNameDraft(item.name); setEditName(true) }}
              style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              {item.name}
            </span>
          )}
        </div>

        {cols.map(col => (
          <div key={col.key} style={{ padding: '4px 8px', borderLeft: '1px solid var(--border)', height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
            <Cell item={item} col={col} onUpdate={onUpdate} />
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border)', height: '100%' }}>
          {hover && (
            <button onClick={onDelete} title="Verwijderen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '2px 6px', borderRadius: 3 }}>×</button>
          )}
        </div>
      </div>

      {expanded && (
        <SubItemsSection subitems={subitems} onUpdate={updated => onUpdate({ subitems: updated })} />
      )}
    </>
  )
}

// ─── Groep ────────────────────────────────────────────────────────────────────
function BoardGroupSection({ group, cols, colWidths, gridTemplate, selectedIds, onToggleSelect, onSelectGroup, onUpdateGroup, onDeleteGroup, onResizeCol }: {
  group: BoardGroup; cols: ColumnDef[]; colWidths: Record<string, number>; gridTemplate: string
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectGroup: (groupId: string, allSelected: boolean) => void
  onUpdateGroup: (g: BoardGroup) => void
  onDeleteGroup: () => void
  onResizeCol: (key: string, width: number) => void
}) {
  const [collapsed,    setCollapsed]    = useState(group.collapsed ?? false)
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
    onUpdateGroup({ ...group, items: group.items.map(i => i.id === itemId ? { ...i, ...updates } : i) })
  }
  function deleteItem(itemId: string) {
    onUpdateGroup({ ...group, items: group.items.filter(i => i.id !== itemId) })
  }
  function addItem() {
    onUpdateGroup({ ...group, items: [...group.items, {
      id: Date.now().toString(), name: 'Nieuw item', ownerIds: [], status: '',
      startDate: null, endDate: null, deadline: null, estHours: 0, dagen: 0,
    }] })
  }

  const totHours = group.items.reduce((s, i) => s + (i.estHours ?? 0), 0)
  const totDagen = group.items.reduce((s, i) => s + (i.dagen ?? 0), 0)

  return (
    <GroupCtx.Provider value={{ color: group.color }}>
      <div style={{ marginBottom: 20 }}>

        {/* Groep header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderLeft: `4px solid ${group.color}`, background: 'var(--overlay-subtle)' }}
          onMouseEnter={() => setHeaderHover(true)} onMouseLeave={() => setHeaderHover(false)}>

          <button onClick={() => setCollapsed(c => !c)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            {collapsed ? '▶' : '▼'}
          </button>

          <button ref={colorBtnRef} onClick={e => { e.stopPropagation(); setColorPicker(o => !o) }}
            title="Kleur wijzigen"
            style={{ width: 14, height: 14, borderRadius: 3, background: group.color, border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0 }} />

          {colorPicker && (
            <PortalDropdown anchor={colorBtnRef} onClose={() => setColorPicker(false)}>
              <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}>
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
              <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Item</div>
              {cols.map(col => (
                <div key={col.key} style={{ position: 'relative', padding: '6px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--border)', userSelect: 'none' }}>
                  {col.label}
                  <div
                    title="Kolom breder/smaller slepen"
                    style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }}
                    onMouseDown={e => {
                      e.preventDefault()
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

            {group.items.map((item, idx) => (
              <div key={item.id} draggable
                onDragStart={e => { dragRowRef.current = idx; e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={e => {
                  e.preventDefault()
                  if (dragRowRef.current === null || dragRowRef.current === idx) return
                  const next = [...group.items]
                  const [moved] = next.splice(dragRowRef.current, 1)
                  next.splice(idx, 0, moved)
                  dragRowRef.current = idx
                  onUpdateGroup({ ...group, items: next })
                }}
                onDragEnd={() => { dragRowRef.current = null }}>
                <BoardRow item={item} cols={cols} gridTemplate={gridTemplate}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={() => onToggleSelect(item.id)}
                  onUpdate={u => updateItem(item.id, u)} onDelete={() => deleteItem(item.id)} />
              </div>
            ))}

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

// ─── BoardTable (hoofd component) ─────────────────────────────────────────────
type BoardTableProps = {
  title: string; emoji: string; color: string
  columns: ColumnDef[]; groups: BoardGroup[]
  onChange: (groups: BoardGroup[]) => void
  onRenameTitle?: (label: string) => void
}

export default function BoardTable({ title, emoji, color, columns, groups, onChange, onRenameTitle }: BoardTableProps) {
  const storageKey = `board-col-widths-${title}`

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

  const gridTemplate = `36px 1fr ${columns.map(c => `${colWidths[c.key] ?? c.width}px`).join(' ')} 36px`

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
    onChange(groups.map(g => ({
      ...g,
      items: g.items.map(i => selectedIds.has(i.id) ? { ...i, ...patch } : i),
    })))
  }
  function bulkDelete() {
    if (selectedIds.size === 0) return
    if (!confirm(`${selectedIds.size} item(s) verwijderen?`)) return
    onChange(groups.map(g => ({ ...g, items: g.items.filter(i => !selectedIds.has(i.id)) })))
    clearSelection()
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
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>AGENDA</span>
          <span style={{ color: 'var(--border)', margin: '0 10px' }}>/</span>
          {editingTitle ? (
            <input autoFocus value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => { const v = titleDraft.trim() || title; onRenameTitle?.(v); setEditingTitle(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = titleDraft.trim() || title; onRenameTitle?.(v); setEditingTitle(false) } if (e.key === 'Escape') setEditingTitle(false) }}
              style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', background: 'transparent', border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none', padding: '0 2px', width: Math.max(120, titleDraft.length * 17) }}
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

      {/* Groepen */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'visible' }}>
        {filteredGroups.map(group => (
          <BoardGroupSection key={group.id} group={group} cols={columns}
            colWidths={colWidths} gridTemplate={gridTemplate}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectGroup={selectGroup}
            onUpdateGroup={handleUpdateGroup} onResizeCol={resizeCol}
            onDeleteGroup={() => handleDeleteGroup(group.id)} />
        ))}
        {filteredGroups.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Geen resultaten gevonden
          </div>
        )}
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        Klik op tekst/cijfers om te bewerken · Sleep rijen om te herordenen · Klik op tijdlijn om datums in te stellen
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
function BulkActionBar({ count, color, groups, onClear, onDelete, onUpdate, onMoveTo }: {
  count: number; color: string; groups: BoardGroup[]
  onClear: () => void; onDelete: () => void
  onUpdate: (patch: Partial<BoardItem>) => void
  onMoveTo: (groupId: string) => void
}) {
  const [statusOpen, setStatusOpen] = useState(false)
  const [ownerOpen,  setOwnerOpen]  = useState(false)
  const [moveOpen,   setMoveOpen]   = useState(false)
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
        <button onClick={() => { setStatusOpen(o => !o); setOwnerOpen(false); setMoveOpen(false) }} style={barBtn}>Status…</button>
        {statusOpen && (
          <div style={popoverStyle}>
            {STATUS_OPTIONS.filter(o => o.label).map(s => (
              <button key={s.label} onClick={() => { onUpdate({ status: s.label }); setStatusOpen(false) }}
                style={{ ...popoverItem, background: s.color + '22', color: s.color }}>
                {s.label}
              </button>
            ))}
            <button onClick={() => { onUpdate({ status: '' }); setStatusOpen(false) }}
              style={{ ...popoverItem, color: 'var(--text-muted)' }}>Wis status</button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => { setOwnerOpen(o => !o); setStatusOpen(false); setMoveOpen(false) }} style={barBtn}>Owner…</button>
        {ownerOpen && (
          <div style={popoverStyle}>
            {teamData.members.map(m => (
              <button key={m.id} onClick={() => { onUpdate({ ownerIds: [m.id] }); setOwnerOpen(false) }}
                style={{ ...popoverItem, color: m.color }}>
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => { setMoveOpen(o => !o); setStatusOpen(false); setOwnerOpen(false) }} style={barBtn}>Verplaats…</button>
        {moveOpen && (
          <div style={popoverStyle}>
            {groups.map(g => (
              <button key={g.id} onClick={() => { onMoveTo(g.id); setMoveOpen(false) }}
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
