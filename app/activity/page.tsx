'use client'

import { useEffect, useState } from 'react'
import { loadActivity, clearActivity, type ActivityEntry } from '@/lib/activityLog'
import { useIsMobile } from '@/lib/useIsMobile'

const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1)    return 'zojuist'
  if (min < 60)   return `${min}m geleden`
  if (min < 1440) return `${Math.floor(min / 60)}u geleden`
  const d = new Date(iso)
  return `${d.getDate()} ${NL_MON[d.getMonth()]}`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

export default function ActivityPage() {
  const isMobile = useIsMobile()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => { setEntries(loadActivity()); setHydrated(true) }, [])

  if (!hydrated) return null

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '20px 16px 60px' : '44px 36px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isMobile ? 18 : 28 }}>
        <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 900, color: 'var(--text-primary)', margin: 0, flex: 1, letterSpacing: '-0.04em' }}>
          📜 Activiteit
        </h1>
        {entries.length > 0 && (
          <button onClick={() => { if (confirm('Activiteit log leegmaken?')) { clearActivity(); setEntries([]) } }}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Wis
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Nog geen activiteit.</p>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {entries.map((e, i) => (
            <div key={e.id} style={{
              padding: '12px 16px',
              borderBottom: i < entries.length - 1 ? '1px solid var(--border-light)' : 'none',
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{ minWidth: 80, flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{relTime(e.ts)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTime(e.ts)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  <strong style={{ fontWeight: 600 }}>{e.action}</strong>
                  {e.target && <span style={{ color: 'var(--text-secondary)' }}>: {e.target}</span>}
                </div>
                {e.detail && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{e.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
