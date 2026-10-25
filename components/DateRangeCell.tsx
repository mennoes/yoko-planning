'use client'

// Het datumveld van de agenda: een pil met de periode erin, en daarachter
// een echte kalender waarin je een bereik aanklikt.
//
// Dit zat vast in BoardTable, dus het venster op /planning had zijn eigen,
// veel soberdere variant: twee losse invoervelden met een pijltje ertussen.
// Nu staat het hier, zodat beide plekken hetzelfde doen.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DatumVeld } from './DatumVeld'
import { isoWeekNumber } from '@/lib/weekPlanning'

const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

const NL_MONTHS_LONG = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']

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

function RecentPeriodsRow({ color, onPick }: { color: string; onPick: (from: string, until: string) => void }) {
  const [recents, setRecents] = useState<RecentPeriod[]>([])
  useEffect(() => {
    const refresh = () => setRecents(loadRecentPeriods())
    refresh()
    window.addEventListener('yoko-recent-periods-update', refresh)
    return () => window.removeEventListener('yoko-recent-periods-update', refresh)
  }, [])
  if (recents.length === 0) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
        Recent
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {recents.map(r => (
          <button key={`${r.from}_${r.until}`} onClick={() => onPick(r.from, r.until)}
            style={{ padding: '4px 9px', borderRadius: 999,
              border: '1px solid var(--border-light)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
            {fmtRange(r.from, r.until)}
          </button>
        ))}
      </div>
    </div>
  )
}

const NL_DAYS_SHORT  = ['ma','di','wo','do','vr','za','zo']

const RECENT_PERIODS_KEY = 'yoko:recentPeriods'

type RecentPeriod = { from: string; until: string; at: number }

const navBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', fontSize: 11, padding: '3px 8px',
  borderRadius: 4,
}

function loadRecentPeriods(): RecentPeriod[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_PERIODS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as RecentPeriod[]
  } catch { return [] }
}

export function pushRecentPeriod(from: string, until: string) {
  if (typeof window === 'undefined') return
  if (!from || !until) return
  const list = loadRecentPeriods().filter(r => !(r.from === from && r.until === until))
  list.unshift({ from, until, at: Date.now() })
  window.localStorage.setItem(RECENT_PERIODS_KEY, JSON.stringify(list.slice(0, 6)))
  window.dispatchEvent(new CustomEvent('yoko-recent-periods-update'))
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getDate()} ${NL_MON[dt.getMonth()]}.`
}

export function fmtRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return ''
  if (!start) return `→ ${fmtDate(end)}`
  if (!end)   return fmtDate(start)
  const d1 = new Date(start), d2 = new Date(end)
  if (d1.getMonth() === d2.getMonth())
    return `${NL_MON[d1.getMonth()]}. ${d1.getDate()} – ${d2.getDate()}`
  return `${d1.getDate()} ${NL_MON[d1.getMonth()]}. – ${d2.getDate()} ${NL_MON[d2.getMonth()]}.`
}

export const editInput: React.CSSProperties = {
  width: '100%', background: 'var(--bg-base)',
  border: '1px solid var(--accent)', borderRadius: 4,
  padding: '2px 7px', color: 'var(--text-primary)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

export function PortalDropdown({ anchor, onClose, children }: {
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
    <div ref={dropRef} onMouseDown={event => event.stopPropagation()} style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
      visibility: ready ? 'visible' : 'hidden',
      maxHeight: `calc(100vh - 16px)`, overflowY: 'auto',
    }}>
      {children}
    </div>,
    document.body
  )
}

export function RangeCalendar({
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
  const calendarWeeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7))
  const selectedWeekLabel = selA
    ? (() => {
        const first = isoWeekNumber(selA)
        const last = isoWeekNumber(selB ?? selA)
        return first === last ? `week ${first}` : `week ${first}–${last}`
      })()
    : null

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 16, minWidth: 290,
      boxShadow: '0 10px 36px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Datums instellen</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {selectedWeekLabel && <span style={{ fontSize: 11, color, background: color + '18', padding: '2px 7px', borderRadius: 10, fontWeight: 700 }}>{selectedWeekLabel}</span>}
          {days !== null && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--overlay-medium)', padding: '2px 7px', borderRadius: 10 }}>
              {days} dag{days !== 1 ? 'en' : ''}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
        <DatumVeld value={selA} ariaLabel="Van"
          onChange={v => { setSelA(v); if (selB) onChange(v, selB) }}
          style={{ ...editInput, flex: 1 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>→</span>
        <DatumVeld value={selB} ariaLabel="Tot"
          onChange={v => { setSelB(v); if (selA) onChange(selA, v) }}
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

      {/* Recent gebruikte periodes — bewaard in localStorage onder
          yoko:recentPeriods. Tot 4 chips zodat 'n veelgebruikte range
          met 1 klik herstelbaar is zonder opnieuw te kiezen. */}
      <RecentPeriodsRow color={color} onPick={(s, e) => {
        setSelA(s); setSelB(e); setPhase('A')
        const d = new Date(s); setVy(d.getFullYear()); setVm(d.getMonth())
        onChange(s, e)
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={prevMonth} style={navBtnStyle}>◀</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {NL_MONTHS_LONG[vm]} {vy}
        </span>
        <button onClick={nextMonth} style={navBtnStyle}>▶</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)', marginBottom: 3 }}>
        <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>wk</div>
        {NL_DAYS_SHORT.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)' }}>
        {calendarWeeks.map((weekCells, row) => {
          const weekDate = weekCells.find((cell): cell is string => !!cell)
          return <div key={`week-${row}`} style={{ display: 'contents' }}>
            <div title="Weeknummer" style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700, borderRight: '1px solid var(--border-light)' }}>
              {weekDate ? isoWeekNumber(weekDate) : ''}
            </div>
            {weekCells.map((cell, dayIndex) => {
              if (!cell) return <div key={`e-${row}-${dayIndex}`} style={{ height: 30 }} />
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

export function DateRangeCell({
  startDate, endDate, onChange, color = '#579bfc', fontScale = 1,
}: {
  startDate: string | null; endDate: string | null
  onChange: (s: string | null, e: string | null) => void
  /** De kleur van de groep waar de rij in staat; kleurt de pil. */
  color?: string
  /** 1 in een rij, ruimer in een venster. */
  fontScale?: number
}) {
  const [open, setOpen]   = useState(false)
  const [hover, setHover] = useState(false)
  const celFont = (basis: number) => Math.round(basis * fontScale * 10) / 10
  const btnRef = useRef<HTMLButtonElement>(null)

  const today   = new Date().toISOString().split('T')[0]
  const isLate  = !!endDate && endDate < today
  const hasAny  = startDate || endDate
  const pillClr = isLate ? '#e2445c' : color

  // Inclusieve dagen tussen start en eind. Monday-stijl toont 'Xd' bij
  // hover. Voor week+ groeperen we naar 'Yw Zd' zodat lange ranges
  // niet als '83d' verschijnen.
  function durationLabel(): string | null {
    if (!startDate) return null
    const s = new Date(startDate).getTime()
    const e = new Date(endDate ?? startDate).getTime()
    const days = Math.round((e - s) / 86400000) + 1
    if (days <= 0) return null
    if (days < 7)   return `${days}d`
    const w = Math.floor(days / 7)
    const d = days - w * 7
    return d === 0 ? `${w}w` : `${w}w ${d}d`
  }

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

  const dur = durationLabel()
  const showDuration = hover && hasAny && !!dur

  return (
    <div style={{ width: '100%' }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative', overflow: 'hidden',
          width: '100%', textAlign: 'left', cursor: 'pointer',
          border: hasAny ? `1px solid ${pillClr}55` : 'none',
          borderRadius: 999, padding: '5px 14px',
          background: hasAny ? pillClr + '22' : 'transparent',
          display: 'flex', alignItems: 'center', gap: 5, minHeight: 30,
        }}>
        {hasAny && (
          <span style={{
            position: 'absolute', inset: 0, width: `${progressPct}%`,
            background: pillClr + 'cc', borderRadius: 999,
            transition: 'width 0.4s ease', pointerEvents: 'none', zIndex: 0,
          }} />
        )}
        {hasAny ? (
          <>
            {isLate && !showDuration && (
              <span style={{
                position: 'relative', zIndex: 1,
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                background: 'rgba(0,0,0,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 900, color: '#fff',
              }}>!</span>
            )}
            <span title={`${progressPct}% verstreken · ${dur ?? ''}`}
              style={{ position: 'relative', zIndex: 1, fontSize: celFont(13), fontWeight: 600,
                color: progressPct > 35 ? '#fff' : 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1, textAlign: 'center',
                textShadow: progressPct > 35 ? '0 1px 1px rgba(0,0,0,0.2)' : 'none' }}>
              {showDuration ? dur : fmtRange(startDate, endDate)}
            </span>
            {showDuration && (
              <button type="button" onClick={ev => { ev.stopPropagation(); onChange(null, null); setOpen(false) }}
                title="Alleen datums wissen — uren blijven behouden"
                style={{ position: 'relative', zIndex: 2,
                  width: 18, height: 18, borderRadius: '50%',
                  border: 0, padding: 0,
                  background: 'rgba(0,0,0,0.35)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                  marginLeft: 2 }}>
                ×
              </button>
            )}
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
        )}
      </button>

      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <RangeCalendar
            startDate={startDate} endDate={endDate} color={color}
            onChange={(s, e) => { onChange(s, e); if (!s && !e) setOpen(false) }}
          />
        </PortalDropdown>
      )}
    </div>
  )
}

