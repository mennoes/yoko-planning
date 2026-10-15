'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams } from 'next/navigation'
import { BOARD_COLORS } from '@/lib/workload'
import teamData from '@/data/team.json'

// Read-only data shape die de /api/share/[board] endpoint teruggeeft.
// Bewust een subset van BoardItem — gevoelige velden (notes, journal,
// contactpersoon, links, est_hours, deadline) komen er niet door.
type ShareSubItem = {
  id:        string
  name:      string
  startDate: string | null
  endDate:   string | null
  status:    string
  estHours:  number
  ownerIds:  string[]
}
type ShareItem = {
  id:        string
  name:      string
  ownerIds:  string[]
  status:    string
  startDate: string | null
  endDate:   string | null
  estHours:  number
  subitems:  ShareSubItem[]
}
type ShareGroup = {
  id:    string
  name:  string
  color: string
  items: ShareItem[]
}
type MonthlyHours = { key: string; label: string; hours: number; isCurrent: boolean }
type ShareComment = { id: string; author: string; body: string; createdAt: string }

const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${NL_MON[d.getMonth()]}`
}

function relativeMonthLabel(key: string): string | null {
  const now = new Date()
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const previousDate = addMonths(now, -1)
  const nextDate = addMonths(now, 1)
  const previous = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`
  const next = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
  if (key === current) return 'Deze maand'
  if (key === previous) return 'Vorige maand'
  if (key === next) return 'Volgende maand'
  return null
}

type Preset = 'all' | 'prevMonth' | 'month' | 'next' | 'quarter' | 'custom'

function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function monthEnd(d: Date): string {
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return e.toISOString().slice(0, 10)
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function hoursInSelectedRange(start: string | null, end: string | null, hours: number, from: string, until: string): number {
  if (!start || hours <= 0) return 0
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end ?? start}T00:00:00`)
  if (e < s) return 0
  const rangeStart = from ? new Date(`${from}T00:00:00`) : s
  const rangeEnd = until ? new Date(`${until}T23:59:59`) : e
  const overlapStart = s > rangeStart ? s : rangeStart
  const overlapEnd = e < rangeEnd ? e : rangeEnd
  if (overlapEnd < overlapStart) return 0
  const totalDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
  const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1
  return hours * (overlapDays / Math.max(1, totalDays))
}

export default function ShareBoardPage() {
  const params = useParams<{ board: string }>()
  const board = params.board

  const [groups, setGroups]             = useState<ShareGroup[]>([])
  const [, setMonthlyHours] = useState<MonthlyHours[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [comments, setComments]         = useState<ShareComment[]>([])
  const [commentAuthor, setCommentAuthor] = useState('')
  const [commentBody, setCommentBody]   = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  const [preset, setPreset]     = useState<Preset>('month')
  const [monthCursor, setMonthCursor] = useState(0)
  const monthWheelAt = useRef(0)
  const [from, setFrom]         = useState('')
  const [until, setUntil]       = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!board) { setLoading(false); return }
    setLoading(true); setError(null)
    const search = new URLSearchParams(window.location.search)
    const apiUrl = `/api/share/${board}?${search.toString()}`
    fetch(apiUrl, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j?.ok) { setError(j?.error ?? 'Kon bord niet laden'); setGroups([]); return }
        const loadedGroups = (j.groups ?? []) as ShareGroup[]
        setGroups(loadedGroups)
        setComments((j.comments ?? []) as ShareComment[])
        setSelectedGroupIds(new Set(loadedGroups.map(group => group.id)))
        setMonthlyHours((j.monthlyHours ?? []) as MonthlyHours[])
      })
      .catch(() => setError('Netwerkfout'))
      .finally(() => setLoading(false))
  }, [board])

  // Preset → from/until afleiden, behalve voor 'custom' (dan zelf invullen).
  useEffect(() => {
    const today = new Date()
    if (preset === 'all')    { setFrom(''); setUntil(''); return }
    if (preset === 'prevMonth') {
      const p = addMonths(today, -1)
      setFrom(monthStart(p)); setUntil(monthEnd(p)); return
    }
    if (preset === 'month')  { setFrom(monthStart(today));         setUntil(monthEnd(today));               return }
    if (preset === 'next')   {
      const n = addMonths(today, 1)
      setFrom(monthStart(n)); setUntil(monthEnd(n)); return
    }
    if (preset === 'quarter') {
      setFrom(monthStart(today))
      setUntil(monthEnd(addMonths(today, 2)))
      return
    }
    // custom: laat from/until staan zoals user typt
  }, [preset])

  // Items filteren op overlap met from/until.
  const selectedGroups = useMemo(
    () => groups.filter(group => selectedGroupIds.has(group.id)),
    [groups, selectedGroupIds],
  )

  const allGroupsSelected = groups.length > 0 && groups.every(group => selectedGroupIds.has(group.id))
  const selectedGroupLabel = selectedGroups.length === 0
    ? 'Geen groepen'
    : selectedGroups.length === groups.length
      ? 'Alle gedeelde groepen'
      : selectedGroups.map(group => group.name).join(', ')

  function toggleGroup(id: string) {
    setSelectedGroupIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const workRows = useMemo(() => selectedGroups.flatMap(group => group.items.flatMap(item => {
    const datedSubs = item.subitems.filter(sub => sub.startDate || sub.endDate)
    const sources = datedSubs.length > 0
      ? datedSubs.map(sub => ({
          id: sub.id,
          name: sub.name || item.name,
          startDate: sub.startDate ?? sub.endDate,
          endDate: sub.endDate ?? sub.startDate,
          status: sub.status || item.status,
          ownerIds: sub.ownerIds?.length ? sub.ownerIds : item.ownerIds,
          estHours: sub.estHours,
        }))
      : [{ id: item.id, name: item.name, startDate: item.startDate, endDate: item.endDate, status: item.status, ownerIds: item.ownerIds, estHours: item.estHours }]
    return sources.map(source => ({
      ...source,
      groupId: group.id,
      groupName: group.name,
      color: group.color,
      hours: Math.round(hoursInSelectedRange(source.startDate, source.endDate, source.estHours, from, until) * 10) / 10,
    })).filter(row => row.hours > 0)
  })).sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')) || a.name.localeCompare(b.name)), [selectedGroups, from, until])

  const periodHours = Math.round(workRows.reduce((sum, item) => sum + item.hours, 0) * 10) / 10

  const visibleMonthlyHours = useMemo(() => [-1, 0, 1].map(delta => {
    const date = addMonths(new Date(), monthCursor + delta)
    const year = date.getFullYear()
    const monthNumber = date.getMonth() + 1
    const key = `${year}-${String(monthNumber).padStart(2, '0')}`
    const monthFrom = `${key}-01`
    const monthUntil = monthEnd(new Date(year, monthNumber - 1, 1))
    const hours = selectedGroups.flatMap(group => group.items).reduce((total, item) => {
      const datedSubs = item.subitems.filter(sub => sub.startDate || sub.endDate)
      if (datedSubs.length > 0) {
        return total + datedSubs.reduce((sum, sub) => sum + hoursInSelectedRange(sub.startDate ?? sub.endDate, sub.endDate ?? sub.startDate, sub.estHours, monthFrom, monthUntil), 0)
      }
      return total + hoursInSelectedRange(item.startDate, item.endDate, item.estHours, monthFrom, monthUntil)
    }, 0)
    const now = new Date()
    return {
      key,
      label: date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }),
      isCurrent: year === now.getFullYear() && monthNumber === now.getMonth() + 1,
      hours: Math.round(hours * 10) / 10,
    }
  }), [monthCursor, selectedGroups])

  const stats = useMemo(() => {
    const total = workRows.length
    const done  = workRows.filter(i => i.status === 'Done').length
    return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
  }, [workRows])

  async function submitComment() {
    const text = commentBody.trim()
    if (!text || commentSaving) return
    setCommentSaving(true); setCommentError(null)
    try {
      const search = new URLSearchParams(window.location.search)
      const response = await fetch(`/api/share/${board}?${search.toString()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: commentAuthor, body: text }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.comment) throw new Error(result?.error ?? 'Reactie opslaan mislukt.')
      setComments(current => [...current, result.comment as ShareComment])
      setCommentBody('')
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Reactie opslaan mislukt.')
    } finally {
      setCommentSaving(false)
    }
  }

  if (loading) {
    return <main style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>Laden…</main>
  }
  if (error) {
    return (
      <main style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)' }}>Bord niet beschikbaar</h1>
        <p style={{ color: 'var(--text-muted)' }}>{error}</p>
      </main>
    )
  }

  const color = BOARD_COLORS[board] ?? 'var(--accent)'

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, background: color }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Studio Yoko · Read-only weergave
        </span>
      </div>
      <h1 style={{ fontSize: 36, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)', letterSpacing: '-0.02em', textTransform: 'capitalize' }}>
        {board}
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, marginBottom: 20 }}>
        {stats.total} items · {stats.done} afgerond · {stats.pct}% klaar
      </p>

      {/* Uren per maand — het belangrijkste dat een klant in één oogopslag
          moet kunnen zien: hoeveel tijd is er vorige maand aan besteed,
          hoeveel deze maand, en hoeveel staat er volgende maand gepland.
          Klikbaar: filtert de lijst eronder meteen op die maand. */}
      {visibleMonthlyHours.length === 3 && (
        <div onWheel={event => {
          const direction = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
          if (Math.abs(direction) < 8 || Date.now() - monthWheelAt.current < 250) return
          monthWheelAt.current = Date.now()
          setMonthCursor(current => current + (direction > 0 ? 1 : -1))
        }} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 34px', gap: 8, alignItems: 'stretch', marginBottom: 24 }}>
          <button onClick={() => setMonthCursor(current => current - 1)} aria-label="Een maand terug"
            style={{ border: 'none', borderRadius: 10, background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18 }}>‹</button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          {visibleMonthlyHours.map(m => {
            const monthFrom = `${m.key}-01`
            const [year, month] = m.key.split('-').map(Number)
            const monthUntil = monthEnd(new Date(year, month - 1, 1))
            const active = from === monthFrom && until === monthUntil
            return (
              <button key={m.key} onClick={() => { setPreset('custom'); setFrom(monthFrom); setUntil(monthUntil) }}
                style={{
                  textAlign: 'left', cursor: 'pointer',
                  padding: '14px 16px', borderRadius: 12,
                  background: m.isCurrent ? color + '14' : 'var(--bg-card)',
                  border: `1.5px solid ${active ? color : m.isCurrent ? color + '55' : 'var(--border-light)'}`,
                }}>
                <div style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: m.isCurrent ? color : 'var(--text-muted)', marginBottom: 6,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {relativeMonthLabel(m.key) ?? m.label}
                  {m.isCurrent && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
                  )}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  {m.hours > 0 ? `${m.hours}u` : '—'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'capitalize', marginTop: 2 }}>
                  {m.label}
                </div>
              </button>
            )
          })}
          </div>
          <button onClick={() => setMonthCursor(current => current + 1)} aria-label="Een maand verder"
            style={{ border: 'none', borderRadius: 10, background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18 }}>›</button>
        </div>
      )}

      {/* Datum-filter — preset-knoppen + optionele custom range. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
        <details style={{ position: 'relative', marginRight: 6 }}>
          <summary style={{ listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 190,
            padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)',
            color: 'var(--text-primary)', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}>
            <span aria-hidden style={{ fontSize: 12 }}>▽</span>
            <span style={{ flex: 1 }}>
              {selectedGroups.length === 0 ? 'Kies groepen' : selectedGroups.length === groups.length ? 'Alle groepen' : `${selectedGroups.length} groepen`}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>▼</span>
          </summary>
          <div style={{ position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 40, width: 260, maxHeight: 280, overflowY: 'auto',
            padding: 8, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: '0 12px 30px rgba(0,0,0,0.28)' }}>
            <button type="button"
              onClick={() => setSelectedGroupIds(allGroupsSelected ? new Set() : new Set(groups.map(group => group.id)))}
              style={{ width: '100%', textAlign: 'left', padding: '6px 8px', marginBottom: 4, border: 'none', borderRadius: 6,
                background: 'var(--bg-hover)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {allGroupsSelected ? 'Deselecteer alles' : 'Selecteer alles'}
            </button>
            {groups.map(group => {
              const checked = selectedGroupIds.has(group.id)
              return (
                <label key={group.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7,
                  background: checked ? group.color + '18' : 'transparent', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12 }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleGroup(group.id)} style={{ accentColor: group.color }} />
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: group.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: checked ? 650 : 500 }}>{group.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{group.items.length}</span>
                </label>
              )
            })}
          </div>
        </details>
        <span aria-hidden style={{ width: 1, height: 24, background: 'var(--border-light)', marginRight: 2 }} />
        {([
          { id: 'all',       label: 'Alles' },
          { id: 'prevMonth', label: 'Vorige maand' },
          { id: 'month',     label: 'Deze maand' },
          { id: 'next',      label: 'Volgende maand' },
          { id: 'quarter',   label: '3 maanden' },
          { id: 'custom',    label: 'Eigen range' },
        ] as { id: Preset; label: string }[]).map(p => {
          const active = preset === p.id
          return (
            <button key={p.id} onClick={() => setPreset(p.id)}
              style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: active ? color : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${active ? color : 'var(--border-light)'}`,
                cursor: 'pointer', transition: 'all 0.12s',
              }}>{p.label}</button>
          )
        })}
        {preset === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>tot</span>
            <input type="date" value={until} onChange={e => setUntil(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }} />
          </div>
        )}
      </div>

      <section aria-label="Urenverantwoording" style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Werkverantwoording</h2>
            <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--text-muted)' }}>
              {selectedGroupLabel}{from || until ? ` · ${from ? fmtDate(from) : 'begin'} – ${until ? fmtDate(until) : 'nu'}` : ' · alle datums'}
            </div>
          </div>
          <strong style={{ fontSize: 20, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{periodHours}u</strong>
        </div>
        <div style={{ overflowX: 'auto', background: 'var(--bg-card)', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
          <div role="table" style={{ minWidth: 670 }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: '120px minmax(260px,1fr) minmax(160px,.65fr) 72px', gap: 16, padding: '9px 12px', fontSize: 10.5, fontWeight: 750, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              <span role="columnheader">Datum</span><span role="columnheader">Werk</span><span role="columnheader">Door</span><span role="columnheader" style={{ textAlign: 'right' }}>Uren</span>
            </div>
            {workRows.length === 0 ? (
              <div style={{ padding: '22px 12px', color: 'var(--text-muted)', fontSize: 12 }}>Geen geschreven uren binnen deze selectie.</div>
            ) : workRows.map((row, index) => {
              const ownerNames = row.ownerIds.map(id => teamData.members.find(member => member.id === id)?.name).filter(Boolean)
              return (
                <div role="row" key={`${row.groupId}-${row.id}-${row.startDate}-${index}`} style={{ display: 'grid', gridTemplateColumns: '120px minmax(260px,1fr) minmax(160px,.65fr) 72px', gap: 16, alignItems: 'center', padding: '11px 12px', borderTop: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <span role="cell" style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {fmtDate(row.startDate)}{row.endDate && row.endDate !== row.startDate ? ` – ${fmtDate(row.endDate)}` : ''}
                  </span>
                  <span role="cell" style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 10.5, color: 'var(--text-muted)' }}><i style={{ width: 6, height: 6, borderRadius: 2, background: row.color }} />{row.groupName}</span>
                  </span>
                  <span role="cell" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ownerNames.join(', ') || '—'}</span>
                  <strong role="cell" style={{ textAlign: 'right', fontSize: 13 }}>{row.hours}u</strong>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section aria-label="Vragen en opmerkingen" style={{ marginTop: 32 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Vragen over de uren</h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Klopt iets volgens jou niet? Laat hier precies weten om welk werk of welke datum het gaat.
        </p>
        {comments.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border-light)', marginBottom: 18 }}>
            {comments.map(comment => (
              <article key={comment.id} style={{ padding: '12px 2px', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
                  <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>{comment.author}</strong>
                  <time style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(comment.createdAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{comment.body}</p>
              </article>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: 10, alignItems: 'start' }}>
          <input value={commentAuthor} onChange={event => setCommentAuthor(event.target.value)} maxLength={80}
            placeholder="Naam (optioneel)" aria-label="Naam"
            style={{ width: '100%', padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: 12 }} />
          <div>
            <textarea value={commentBody} onChange={event => setCommentBody(event.target.value)} maxLength={2000}
              placeholder="Bijvoorbeeld: kloppen de uren van 14 oktober?" aria-label="Vraag of opmerking"
              style={{ width: '100%', minHeight: 86, resize: 'vertical', padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: 12, lineHeight: 1.45 }} />
            {commentError && <div role="alert" style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>{commentError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={submitComment} disabled={!commentBody.trim() || commentSaving}
                style={{ padding: '8px 14px', border: 0, borderRadius: 6, background: color, color: '#fff', fontSize: 12, fontWeight: 700, cursor: commentBody.trim() && !commentSaving ? 'pointer' : 'default', opacity: commentBody.trim() && !commentSaving ? 1 : 0.5 }}>
                {commentSaving ? 'Opslaan…' : 'Reactie plaatsen'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid var(--border-light)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        Read-only deelweergave · gegenereerd door Yoko Planner · interne notities, contactgegevens en links worden niet getoond
      </footer>
    </main>
  )
}
