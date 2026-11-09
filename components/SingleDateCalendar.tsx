'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { isoWeekNumber } from '@/lib/weekPlanning'

const MONTHS = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']
const DAYS = ['ma','di','wo','do','vr','za','zo']

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function calendarWeeks(year: number, month: number): Array<Array<string | null>> {
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7
  const count = new Date(year, month + 1, 0).getDate()
  const cells: Array<string | null> = Array(firstDay).fill(null)
  for (let day = 1; day <= count; day++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7))
}

export default function SingleDateCalendar({ anchor, value, min, onChange, onClose }: {
  anchor: RefObject<HTMLElement | null>
  value: string | null
  min?: string
  onChange: (value: string | null) => void
  onClose: () => void
}) {
  const initial = value ? new Date(`${value}T12:00:00`) : new Date()
  const [year, setYear] = useState(initial.getFullYear())
  const [month, setMonth] = useState(initial.getMonth())
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [ready, setReady] = useState(false)
  const popup = useRef<HTMLDivElement>(null)
  const today = localIso(new Date())
  const weeks = calendarWeeks(year, month)

  useEffect(() => {
    function place() {
      if (!anchor.current || !popup.current) return
      const source = anchor.current.getBoundingClientRect()
      const panel = popup.current.getBoundingClientRect()
      const margin = 8
      let top = source.bottom + 4
      if (top + panel.height + margin > window.innerHeight) {
        top = Math.max(margin, source.top - panel.height - 4)
      }
      let left = source.left
      if (left + panel.width + margin > window.innerWidth) left = window.innerWidth - panel.width - margin
      setPosition({ top, left: Math.max(margin, left) })
      setReady(true)
    }
    function outside(event: MouseEvent) {
      if (!popup.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose()
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', keyboard)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [anchor, onClose])

  function previousMonth() {
    if (month === 0) { setMonth(11); setYear(value => value - 1) }
    else setMonth(value => value - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(value => value + 1) }
    else setMonth(value => value + 1)
  }
  function choose(date: string) {
    if (min && date < min) return
    onChange(date)
    onClose()
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={popup} role="dialog" aria-label="Datum kiezen"
      // Houd het oorspronkelijke tekstveld gefocust. In agendacellen sluit
      // onBlur de editor; zonder preventDefault verdween de kalender nog
      // vóór een dag kon worden aangeklikt.
      onMouseDown={event => { event.preventDefault(); event.stopPropagation() }}
      style={{
        position: 'fixed', top: position.top, left: position.left, zIndex: 10000,
        visibility: ready ? 'visible' : 'hidden', width: 326, maxWidth: 'calc(100vw - 16px)',
        padding: 16, borderRadius: 12, border: '1px solid var(--border)',
        background: 'var(--bg-card)', boxShadow: '0 12px 38px rgba(0,0,0,.32)',
      }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 14 }}>Datum kiezen</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button type="button" onClick={previousMonth} aria-label="Vorige maand" style={navButton}>‹</button>
        <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{MONTHS[month]} {year}</strong>
        <button type="button" onClick={nextMonth} aria-label="Volgende maand" style={navButton}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(7, 1fr)', marginBottom: 4 }}>
        <span style={weekday}>wk</span>
        {DAYS.map(day => <span key={day} style={weekday}>{day}</span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(7, 1fr)' }}>
        {weeks.map((week, row) => {
          const first = week.find((date): date is string => !!date)
          return <div key={row} style={{ display: 'contents' }}>
            <span style={{ ...dayCell, color: 'var(--text-muted)', fontSize: 10, borderRight: '1px solid var(--border-light)' }}>
              {first ? isoWeekNumber(first) : ''}
            </span>
            {week.map((date, column) => {
              if (!date) return <span key={`${row}-${column}`} style={dayCell} />
              const disabled = !!min && date < min
              const selected = date === value
              const isToday = date === today
              return <button type="button" key={date} disabled={disabled} onClick={() => choose(date)}
                aria-label={new Date(`${date}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}
                style={{
                  ...dayCell, border: selected ? '1px solid var(--accent)' : isToday ? '1px solid var(--border-strong)' : '1px solid transparent',
                  borderRadius: 6, background: selected ? 'var(--accent)' : 'transparent',
                  color: selected ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .35 : 1,
                  fontWeight: selected || isToday ? 800 : 500,
                }}>{Number(date.slice(-2))}</button>
            })}
          </div>
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
        <button type="button" onClick={() => { onChange(null); onClose() }} style={footerButton}>Wissen</button>
        <button type="button" onClick={() => choose(today)} disabled={!!min && today < min}
          style={{ ...footerButton, color: 'var(--accent)', fontWeight: 750 }}>Vandaag</button>
      </div>
    </div>,
    document.body,
  )
}

const navButton: React.CSSProperties = {
  width: 30, height: 30, border: '1px solid var(--border-light)', borderRadius: 7,
  background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20, lineHeight: 1,
}
const weekday: React.CSSProperties = {
  height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-muted)', fontSize: 10, fontWeight: 750,
}
const dayCell: React.CSSProperties = {
  height: 34, minWidth: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, boxSizing: 'border-box',
}
const footerButton: React.CSSProperties = {
  border: 0, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', padding: '5px 7px', fontSize: 12,
}
