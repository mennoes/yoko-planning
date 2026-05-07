'use client'

import { useEffect, useState } from 'react'
import { getActiveTimer, stopTimer, onTimerUpdate, fmtMinutes, type ActiveTimer } from '@/lib/timerStore'
import { IconStop } from './Icon'

export default function TimerIndicator() {
  const [active, setActive] = useState<ActiveTimer | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    setActive(getActiveTimer())
    const off = onTimerUpdate(() => setActive(getActiveTimer()))
    return off
  }, [])

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  if (!active) return null

  const elapsedMin = Math.max(0, Math.round((now - new Date(active.startTs).getTime()) / 60000))

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 200,
      background: 'var(--bg-card)', border: '1px solid var(--accent)',
      borderRadius: 12, padding: '10px 14px', minWidth: 220,
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
    }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e2445c',
        animation: 'yoko-timer-pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bezig met</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {active.projectName}
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 700, marginTop: 1 }}>
          {fmtMinutes(elapsedMin)}
        </div>
      </div>
      <button onClick={() => stopTimer()} title="Stop" aria-label="Stop"
        style={{ background: '#e2445c', border: 'none', color: '#fff', borderRadius: 8,
          padding: '6px 10px', cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconStop size={14} />
      </button>
      <style jsx global>{`
        @keyframes yoko-timer-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  )
}
