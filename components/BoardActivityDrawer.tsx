'use client'

// Monday-stijl activiteitenlijst die rechts in beeld schuift wanneer je op
// 'Activiteit' klikt op een board. Elke rij toont WIE iets wijzigde, WAT er
// gebeurde (met from→to pill), en een 'Ongedaan maken'-knop wanneer er
// gestructureerde before-data in meta zit. Entries zonder meta worden alleen
// gelezen — undo niet beschikbaar.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { loadBoardActivity, itemIdFromTarget, onAnyItemActivityChange, type ItemActivity, type ActivityField } from '@/lib/itemActivity'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { useTeamPhotos } from './TeamPhotosContext'
import teamData from '@/data/team.json'
import type { BoardItem, BoardGroup } from '@/lib/boards'

type ProfileRow = { user_id: string; member_id: string | null; name: string | null }

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1)    return 'zojuist'
  if (min < 60)   return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}u`
  return `${Math.floor(min / 1440)}d`
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('startDate' in o || 'endDate' in o) {
      const s = (o.startDate as string | null) ?? '—'
      const e = (o.endDate as string | null) ?? s
      return s === e ? s : `${s} – ${e}`
    }
    return JSON.stringify(v)
  }
  return String(v)
}

function applyUndo(boardId: string, itemId: string, field: ActivityField, before: unknown): boolean {
  const groups = loadGroups(boardId, [])
  if (groups.length === 0) return false
  const next: BoardGroup[] = groups.map(g => ({
    ...g,
    items: g.items.map(i => {
      if (i.id !== itemId) return i
      const patch: Partial<BoardItem> = {}
      if (field === 'startDate' && before && typeof before === 'object') {
        const b = before as { startDate?: string | null; endDate?: string | null }
        patch.startDate = b.startDate ?? null
        patch.endDate   = b.endDate   ?? null
      } else if (field === 'endDate' && before && typeof before === 'object') {
        const b = before as { startDate?: string | null; endDate?: string | null }
        patch.startDate = b.startDate ?? null
        patch.endDate   = b.endDate   ?? null
      } else if (field === 'estHours') {
        patch.estHours = Number(before) || 0
      } else if (field === 'status') {
        patch.status = String(before ?? '')
      } else if (field === 'ownerIds') {
        patch.ownerIds = Array.isArray(before) ? (before as string[]) : []
      } else if (field === 'ownerHours') {
        patch.ownerHours = (before ?? {}) as Record<string, number>
      } else if (field === 'name') {
        patch.name = String(before ?? '')
      } else if (field === 'notes') {
        patch.notes = String(before ?? '')
      } else if (field === 'deadline') {
        patch.deadline = (before as string | null) ?? null
      } else {
        return i
      }
      return { ...i, ...patch }
    }),
  }))
  saveGroups(boardId, next)
  return true
}

export function BoardActivityDrawer({ boardId, boardTitle, open, onClose }: {
  boardId:    string
  boardTitle: string
  open:       boolean
  onClose:    () => void
}) {
  const { getPhoto } = useTeamPhotos()
  const [entries, setEntries] = useState<ItemActivity[]>([])
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'all' | 'mine'>('all')
  const [meId, setMeId]       = useState<string | null>(null)

  // Profielen voor user_id → naam/foto mapping
  useEffect(() => {
    if (!open || !supabase) return
    let cancelled = false
    supabase.from('profiles').select('user_id, member_id, name').then(({ data }) => {
      if (cancelled || !data) return
      const map: Record<string, ProfileRow> = {}
      for (const r of data as ProfileRow[]) if (r.user_id) map[r.user_id] = r
      setProfiles(map)
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setMeId(session?.user?.id ?? null)
    })
    return () => { cancelled = true }
  }, [open])

  // Activity-load + live refresh op item-activity events
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function refresh() {
      setLoading(true)
      const list = await loadBoardActivity(boardId, 300)
      if (cancelled) return
      // Extra client-side filter: entries zonder meta.boardId (van vóór
      // migratie 0020) zijn niet boardspecifiek bekend op de server. We
      // halen de actuele item-id-set van dit bord uit boardStore en
      // matchen daar tegenaan zodat alleen relevante events tonen.
      const groups = loadGroups(boardId, [])
      const boardItemIds = new Set<string>()
      for (const g of groups) for (const i of g.items) boardItemIds.add(i.id)
      const filtered = list.filter(e => {
        const itemId = itemIdFromTarget(e.target)
        const metaBoard = (e.meta as { boardId?: string } | null)?.boardId
        if (metaBoard === boardId) return true
        return !!itemId && boardItemIds.has(itemId)
      })
      setEntries(filtered)
      setLoading(false)
    }
    refresh()
    return onAnyItemActivityChange(refresh)
  }, [open, boardId])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const shown = filter === 'mine' && meId
    ? entries.filter(e => e.user_id === meId)
    : entries

  async function undoEntry(e: ItemActivity) {
    if (!e.meta?.field || e.meta.before === undefined) return
    const itemId = itemIdFromTarget(e.target)
    const bid    = e.meta.boardId ?? boardId
    if (!itemId || !bid) return
    const ok = applyUndo(bid, itemId, e.meta.field, e.meta.before)
    if (!ok) {
      alert('Kon niet ongedaan maken — item niet meer aanwezig op dit bord.')
    }
  }

  return createPortal(
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, backdropFilter: 'blur(3px)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(520px, 100vw)', zIndex: 9001,
        background: 'var(--bg-base)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {boardTitle}
              </div>
              <h2 style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Logboek</h2>
            </div>
            <button onClick={onClose} title="Sluiten (Esc)"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {(['all', 'mine'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  padding: '5px 11px', borderRadius: 999, border: '1px solid var(--border)',
                  background: filter === f ? 'var(--accent)' : 'var(--bg-card)',
                  color: filter === f ? '#000' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                {f === 'all' ? 'Iedereen' : 'Alleen ikzelf'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Laden…</p>
          ) : shown.length === 0 ? (
            <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
              Geen activiteit op dit bord.
            </p>
          ) : shown.map(e => {
            const p = e.user_id ? profiles[e.user_id] : null
            const name = p?.name ?? 'Iemand'
            const memberId = p?.member_id ?? null
            const photo = memberId ? getPhoto(memberId) : null
            const memberColor = teamData.members.find(m => m.id === memberId)?.color ?? '#888'
            const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
            const itemName = e.meta?.itemName ?? null
            const canUndo  = !!(e.meta?.field && e.meta.before !== undefined && (e.meta.boardId ?? boardId))
            return (
              <div key={e.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 36, flexShrink: 0, paddingTop: 2, fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                  {relTime(e.ts)}
                </div>
                {photo ? (
                  <img src={photo} alt={name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                    background: memberColor + '22', color: memberColor,
                  }}>{initials || '?'}</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {itemName && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {itemName}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{name.split(' ')[0]}</strong>{' '}{e.action}
                  </div>
                  {(e.meta?.before !== undefined || e.meta?.after !== undefined) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      <span style={pillStyle(false)}>{fmtVal(e.meta?.before)}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>→</span>
                      <span style={pillStyle(true)}>{fmtVal(e.meta?.after)}</span>
                    </div>
                  ) : e.detail ? (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{e.detail}</div>
                  ) : null}
                </div>
                <button onClick={() => undoEntry(e)}
                  disabled={!canUndo}
                  title={canUndo ? 'Zet terug naar de vorige waarde' : 'Geen undo beschikbaar voor deze regel'}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: canUndo ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: 11, fontWeight: 600, cursor: canUndo ? 'pointer' : 'not-allowed',
                    flexShrink: 0, opacity: canUndo ? 1 : 0.6,
                  }}>
                  Ongedaan
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </>,
    document.body,
  )
}

function pillStyle(isAfter: boolean): React.CSSProperties {
  return {
    fontSize: 11.5, fontWeight: 600,
    padding: '2px 8px', borderRadius: 6,
    border: '1px solid var(--border)',
    background: isAfter ? 'var(--accent-light)' : 'var(--bg-card)',
    color: 'var(--text-primary)',
    maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }
}
