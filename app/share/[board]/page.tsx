'use client'

import { useEffect, useState, useMemo } from 'react'
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
}
type ShareItem = {
  id:        string
  name:      string
  ownerIds:  string[]
  status:    string
  startDate: string | null
  endDate:   string | null
  subitems:  ShareSubItem[]
}
type ShareGroup = {
  id:    string
  name:  string
  color: string
  items: ShareItem[]
}

const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${NL_MON[d.getMonth()]}`
}

const STATUS_BG: Record<string, string> = {
  'Done': 'rgba(0,200,117,0.15)',
  'Working on...': 'rgba(255,123,36,0.15)',
  'Stuck': 'rgba(196,69,58,0.15)',
  'Not started': 'rgba(154,149,144,0.15)',
  'Doorlopend': 'rgba(87,155,252,0.15)',
}
const STATUS_FG: Record<string, string> = {
  'Done': '#037f4c',
  'Working on...': '#ff7b24',
  'Stuck': '#C4453A',
  'Not started': '#9A9590',
  'Doorlopend': '#579bfc',
}

type Preset = 'all' | 'month' | 'next' | 'quarter' | 'custom'

function localIsoToday(): string {
  return new Date().toISOString().slice(0, 10)
}
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

export default function ShareBoardPage() {
  const params = useParams<{ board: string }>()
  const board = params.board

  const [groups, setGroups]     = useState<ShareGroup[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const [preset, setPreset]     = useState<Preset>('all')
  const [from, setFrom]         = useState('')
  const [until, setUntil]       = useState('')

  useEffect(() => {
    if (!board) { setLoading(false); return }
    setLoading(true); setError(null)
    fetch(`/api/share/${board}`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j?.ok) { setError(j?.error ?? 'Kon bord niet laden'); setGroups([]); return }
        setGroups((j.groups ?? []) as ShareGroup[])
      })
      .catch(() => setError('Netwerkfout'))
      .finally(() => setLoading(false))
  }, [board])

  // Preset → from/until afleiden, behalve voor 'custom' (dan zelf invullen).
  useEffect(() => {
    const today = new Date()
    if (preset === 'all')    { setFrom(''); setUntil(''); return }
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
  const filteredGroups: ShareGroup[] = useMemo(() => {
    if (!from && !until) return groups
    const fromTs  = from  ? new Date(from).getTime()           : null
    const untilTs = until ? new Date(until).getTime() + 86400000 - 1 : null
    const overlaps = (s: string | null, e: string | null) => {
      if (!s) return false
      const ms = new Date(s).getTime()
      const me = e ? new Date(e).getTime() + 86400000 - 1 : ms + 86400000 - 1
      if (fromTs  != null && me < fromTs)  return false
      if (untilTs != null && ms > untilTs) return false
      return true
    }
    return groups
      .map(g => ({
        ...g,
        items: g.items
          .filter(i => overlaps(i.startDate, i.endDate) || i.subitems.some(s => overlaps(s.startDate, s.endDate))),
      }))
      .filter(g => g.items.length > 0)
  }, [groups, from, until])

  const stats = useMemo(() => {
    const items = filteredGroups.flatMap(g => g.items)
    const total = items.length
    const done  = items.filter(i => i.status === 'Done').length
    return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
  }, [filteredGroups])

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

      {/* Datum-filter — preset-knoppen + optionele custom range. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
        {([
          { id: 'all',     label: 'Alles' },
          { id: 'month',   label: 'Deze maand' },
          { id: 'next',    label: 'Volgende maand' },
          { id: 'quarter', label: '3 maanden' },
          { id: 'custom',  label: 'Eigen range' },
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

      {filteredGroups.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '20px 0' }}>
          Geen items in deze periode.
        </p>
      )}

      {filteredGroups.map(g => (
        <section key={g.id} style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 4, height: 16, borderRadius: 2, background: g.color || color }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{g.name}</h2>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.items.length}</span>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden' }}>
            {g.items.map((item, i) => {
              const owners = (item.ownerIds ?? [])
                .map(id => teamData.members.find(m => m.id === id))
                .filter(Boolean) as typeof teamData.members
              const status = item.status
              return (
                <div key={item.id} style={{
                  padding: '12px 18px',
                  borderBottom: i < g.items.length - 1 ? '1px solid var(--border-light)' : 'none',
                }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) auto auto auto',
                    alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ minWidth: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                    <div style={{ display: 'flex', marginRight: 4 }}>
                      {owners.slice(0, 4).map((m, idx) => (
                        <span key={m.id} style={{
                          width: 24, height: 24, borderRadius: '50%',
                          background: m.color + '30', border: `1.5px solid ${m.color}`,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700, color: m.color,
                          marginLeft: idx === 0 ? 0 : -8,
                        }} title={m.name}>
                          {m.name.charAt(0)}
                        </span>
                      ))}
                    </div>
                    {status ? (
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        padding: '2px 10px', borderRadius: 999,
                        background: STATUS_BG[status] ?? 'var(--bg-hover)',
                        color: STATUS_FG[status] ?? 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}>{status}</span>
                    ) : <span />}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 110, textAlign: 'right' }}>
                      {item.startDate ? fmtDate(item.startDate) : ''}
                      {item.startDate && item.endDate && item.startDate !== item.endDate && ' → '}
                      {item.endDate && item.endDate !== item.startDate ? fmtDate(item.endDate) : ''}
                    </div>
                  </div>
                  {/* Subitem-instances (bv. recurring events): alleen
                      naam + datum, geen status of owners om de weergave
                      compact te houden. */}
                  {item.subitems.length > 0 && (
                    <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: '0 0 0 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {item.subitems.slice(0, 8).map(sub => (
                        <li key={sub.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.name}</span>
                          <span style={{ flexShrink: 0, marginLeft: 8 }}>
                            {sub.startDate ? fmtDate(sub.startDate) : ''}
                            {sub.startDate && sub.endDate && sub.startDate !== sub.endDate && ' → '}
                            {sub.endDate && sub.endDate !== sub.startDate ? fmtDate(sub.endDate) : ''}
                          </span>
                        </li>
                      ))}
                      {item.subitems.length > 8 && (
                        <li style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          + {item.subitems.length - 8} meer
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <footer style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid var(--border-light)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        Read-only deelweergave · gegenereerd door Yoko Planner · interne notities, contactgegevens en uren-inschattingen worden bewust niet getoond
      </footer>
    </main>
  )
}
