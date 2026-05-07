'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { loadGroups } from '@/lib/boardStore'
import { BOARD_COLORS } from '@/lib/workload'
import yokoRaw       from '@/data/boards/yoko.json'
import pnpRaw        from '@/data/boards/pnp.json'
import nederlandRaw  from '@/data/boards/nederland.json'
import vlaanderenRaw from '@/data/boards/vlaanderen.json'
import dienjaarRaw   from '@/data/boards/dienjaar.json'
import teamData      from '@/data/team.json'
import type { BoardGroup } from '@/lib/boards'

const RAW: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw, vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
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
}
const STATUS_FG: Record<string, string> = {
  'Done': '#037f4c',
  'Working on...': '#ff7b24',
  'Stuck': '#C4453A',
  'Not started': '#9A9590',
}

export default function ShareBoardPage() {
  const params = useParams<{ board: string }>()
  const board = params.board
  const [groups, setGroups]   = useState<BoardGroup[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!board || !RAW[board]) { setHydrated(true); return }
    setGroups(loadGroups(board, RAW[board].groups as BoardGroup[]))
    setHydrated(true)
  }, [board])

  const stats = useMemo(() => {
    const items = groups.flatMap(g => g.items)
    const total = items.length
    const done  = items.filter(i => i.status === 'Done').length
    return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
  }, [groups])

  if (!hydrated) return null
  if (!board || !RAW[board]) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)' }}>Onbekend bord</h1>
        <p style={{ color: 'var(--text-muted)' }}>Het gevraagde bord bestaat niet.</p>
      </div>
    )
  }

  const color = BOARD_COLORS[board] ?? 'var(--accent)'

  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, background: color }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Studio Yoko · Read-only
        </span>
      </div>
      <h1 style={{ fontSize: 36, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)', letterSpacing: '-0.02em', textTransform: 'capitalize' }}>
        {board}
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, marginBottom: 28 }}>
        {stats.total} items · {stats.done} afgerond · {stats.pct}% klaar
      </p>

      {groups.map(g => (
        <section key={g.id} style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 4, height: 16, borderRadius: 2, background: g.color || color }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{g.name}</h2>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.items.length}</span>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden' }}>
            {g.items.length === 0 ? (
              <p style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Geen items.</p>
            ) : g.items.map((item, i) => {
              const owners = (item.ownerIds ?? []).map(id => teamData.members.find(m => m.id === id)).filter(Boolean) as typeof teamData.members
              const status = item.status as string
              return (
                <div key={item.id} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto auto auto',
                  alignItems: 'center', gap: 12,
                  padding: '12px 18px',
                  borderBottom: i < g.items.length - 1 ? '1px solid var(--border-light)' : 'none',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                    {item.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.notes as string}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: -6, marginRight: 4 }}>
                    {owners.slice(0, 3).map((m, idx) => (
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
                  {status && (
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      padding: '2px 8px', borderRadius: 12,
                      background: STATUS_BG[status] ?? 'var(--bg-hover)',
                      color: STATUS_FG[status] ?? 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}>{status}</span>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 90, textAlign: 'right' }}>
                    {item.startDate ? fmtDate(item.startDate as string) : ''}
                    {item.startDate && item.endDate && ' → '}
                    {item.endDate ? fmtDate(item.endDate as string) : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <footer style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid var(--border-light)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        Powered by Yoko Planner
      </footer>
    </main>
  )
}
