'use client'

import {
  createContext, useContext, useState, useEffect, useRef,
  type ReactNode, type MouseEvent,
} from 'react'
import Link from 'next/link'
import teamData from '@/data/team.json'
import { useTeam } from './TeamContext'
import { UserAvatar } from './UserAvatar'
import { loadCapacities, onCapacitiesChange, pullCapacities } from '@/lib/capacitiesStore'
import { useTeamGroups } from './useTeamGroups'

type PopupPos = { top: number; left: number }
type MemberPopupCtx = {
  showMember: (id: string, e: MouseEvent) => void
}

const Ctx = createContext<MemberPopupCtx>({ showMember: () => {} })

// ─── Provider + popup renderer ────────────────────────────────────────────────
export function MemberPopupProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pos,      setPos]      = useState<PopupPos>({ top: 0, left: 0 })
  const popupRef  = useRef<HTMLDivElement>(null)
  const { members: liveTeam } = useTeam()
  const { groups: teamGroups } = useTeamGroups()
  const [capacities, setCapacities] = useState<Record<string, number>>(() => loadCapacities())

  useEffect(() => {
    const refresh = () => setCapacities(loadCapacities())
    refresh()
    void pullCapacities().then(refresh)
    return onCapacitiesChange(refresh)
  }, [])

  function showMember(id: string, e: MouseEvent) {
    e.stopPropagation()
    if (activeId === id) { setActiveId(null); return }
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const vw    = window.innerWidth
    const vh    = window.innerHeight
    const popW  = 280
    const popH  = 210
    let top  = rect.bottom + 10
    let left = rect.left
    if (top + popH > vh)  top  = rect.top - popH - 10
    if (left + popW > vw) left = vw - popW - 12
    if (left < 8)         left = 8
    setPos({ top, left })
    setActiveId(id)
  }

  // Close on outside click / Escape
  useEffect(() => {
    if (!activeId) return
    function onDown(e: PointerEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setActiveId(null)
      }
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setActiveId(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [activeId])

  const member = (() => {
    if (!activeId) return null
    const live = liveTeam.find(m => m.id === activeId)
    if (live) return { id: live.id, name: live.name, color: live.color, email: live.email, weeklyCapacity: live.weeklyCapacity }
    return teamData.members.find(m => m.id === activeId) ?? null
  })()
  const capacity = member ? (capacities[member.id] ?? member.weeklyCapacity) : 0
  const teamName = member
    ? (teamGroups.find(group => group.memberIds.includes(member.id))?.name ?? 'Studio Yoko')
    : 'Studio Yoko'

  return (
    <Ctx.Provider value={{ showMember }}>
      {children}
      {member && (
        <div
          ref={popupRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1200,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '20px 22px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.2)',
            minWidth: 260,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <UserAvatar memberId={member.id} size={52} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                {member.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {(member as { email?: string }).email ?? ''}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border)', margin: '0 0 14px' }} />

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat label="Capaciteit" value={`${capacity} u/w`} color={member.color} />
            <Stat label="Team" value={teamName} color="var(--text-muted)" />
          </div>

          {/* Color swatch */}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: member.color, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{member.color}</span>
          </div>

          {/* View profile */}
          <Link href={`/profile/${member.id}`} onClick={() => setActiveId(null)}
            style={{ display: 'block', marginTop: 14, padding: '8px 10px',
              background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, textAlign: 'center',
              textDecoration: 'none' }}>
            Bekijk profiel →
          </Link>

          {/* Close button */}
          <button
            onClick={() => setActiveId(null)}
            style={{
              position: 'absolute', top: 10, right: 12,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, color: 'var(--text-muted)', lineHeight: 1, padding: '2px 4px',
              borderRadius: 4,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >×</button>
        </div>
      )}
    </Ctx.Provider>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'var(--bg-hover)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
    </div>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useMemberPopup = () => useContext(Ctx)

// ─── Clickable avatar wrapper ─────────────────────────────────────────────────
export function ClickableMember({
  memberId, children, style,
}: {
  memberId: string
  children: ReactNode
  style?: React.CSSProperties
}) {
  const { showMember } = useMemberPopup()
  return (
    <span
      onClick={e => showMember(memberId, e)}
      title="Klik voor profiel"
      style={{ cursor: 'pointer', display: 'inline-flex', ...style }}
    >
      {children}
    </span>
  )
}
