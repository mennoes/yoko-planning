'use client'

// Per-board papierbak — toont alleen items uit dít specifieke bord die
// soft-deleted zijn. Rechter-drawer met Herstel / Voorgoed per regel.
//
// Hergebruikt loadTrash() en restoreTrashItem() uit lib/boardStore.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  loadTrash, restoreTrashItem, purgeTrashItem, pullBoardFromRemote, type TrashItem,
} from '@/lib/boardStore'
import { loadBoardActivity, itemIdFromTarget, type ItemActivity, type ActivityField } from '@/lib/itemActivity'
import { supabase } from '@/lib/supabase'
import teamData from '@/data/team.json'
import { useTeamPhotos } from './TeamPhotosContext'

type Profile = { user_id: string; name: string | null; member_id: string | null }

// Iconen per actie-type (Monday-stijl). SVG inline zodat we geen extra
// icon-library hoeven te laden. Geeft één teken per actie zodat 'n
// logregel direct visueel scant.
function ActionIcon({ type }: { type: 'delete' | 'status' | 'date' | 'owner' | 'hours' | 'move' | 'note' | 'name' | 'add' | 'default' }) {
  const base = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  switch (type) {
    case 'delete': return <svg {...base}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    case 'status': return <svg {...base}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    case 'date':   return <svg {...base}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'owner':  return <svg {...base}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>
    case 'hours':  return <svg {...base}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
    case 'move':   return <svg {...base}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
    case 'note':   return <svg {...base}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    case 'name':   return <svg {...base}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
    case 'add':    return <svg {...base}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    default:       return <svg {...base}><circle cx="12" cy="12" r="3"/></svg>
  }
}

function iconTypeFor(e: ItemActivity): 'status' | 'date' | 'owner' | 'hours' | 'move' | 'note' | 'name' | 'add' | 'default' {
  const f = e.meta?.field as ActivityField | undefined
  if (f === 'status') return 'status'
  if (f === 'startDate' || f === 'endDate' || f === 'deadline') return 'date'
  if (f === 'ownerIds' || f === 'ownerHours') return 'owner'
  if (f === 'estHours') return 'hours'
  if (f === 'notes') return 'note'
  if (f === 'name') return 'name'
  const a = (e.action ?? '').toLowerCase()
  if (a.includes('verplaats') || a.includes('move')) return 'move'
  if (a.includes('toegevoegd') || a.includes('aangemaakt')) return 'add'
  return 'default'
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function fmtDayLabel(iso: string): string {
  try {
    const d = new Date(iso); d.setHours(0,0,0,0)
    const today = new Date(); today.setHours(0,0,0,0)
    const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'Vandaag'
    if (diffDays === 1) return 'Gisteren'
    return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
  } catch { return iso }
}

function dayKey(iso: string): string {
  return iso.slice(0, 10) // YYYY-MM-DD
}

export function BoardTrashDrawer({ boardId, boardTitle, open, onClose, onOpenLog }: {
  boardId:    string
  boardTitle: string
  open:       boolean
  onClose:    () => void
  onOpenLog?: () => void
}) {
  const [items, setItems]     = useState<TrashItem[]>([])
  const [activity, setActivity] = useState<ItemActivity[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [filter, setFilter]   = useState<'all' | 'changes' | 'deleted'>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [detailItem, setDetailItem] = useState<TrashItem | null>(null)
  const { getPhoto } = useTeamPhotos()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function refresh() {
      setLoading(true)
      const [trashAll, actAll] = await Promise.all([
        loadTrash(),
        loadBoardActivity(boardId, 200),
      ])
      if (cancelled) return
      setItems(trashAll.filter(t => t.boardId === boardId))
      setActivity(actAll)
      // Profiles ophalen voor avatar + naam achter de actie.
      if (supabase) {
        const uids = Array.from(new Set(actAll.map(a => a.user_id).filter((x): x is string => !!x)))
        if (uids.length > 0) {
          const { data } = await supabase
            .from('profiles')
            .select('user_id, name, member_id')
            .in('user_id', uids)
          if (!cancelled && data) {
            const map: Record<string, Profile> = {}
            for (const p of data as Profile[]) map[p.user_id] = p
            setProfiles(map)
          }
        }
      }
      setLoading(false)
    }
    refresh()
    return () => { cancelled = true }
  }, [open, boardId])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function onRestore(t: TrashItem) {
    setBusy(t.id)
    const ok = await restoreTrashItem(t.id)
    if (ok) {
      await pullBoardFromRemote(boardId).catch(() => {})
      setItems(prev => prev.filter(x => x.id !== t.id))
    }
    setBusy(null)
  }

  async function onPurge(t: TrashItem) {
    if (!window.confirm(`'${t.name}' definitief verwijderen?\n\nDit kan niet meer ongedaan gemaakt worden.`)) return
    setBusy(t.id)
    const ok = await purgeTrashItem(t.id)
    if (ok) setItems(prev => prev.filter(x => x.id !== t.id))
    setBusy(null)
  }

  async function onRestoreAll(dayItems: TrashItem[]) {
    if (!window.confirm(`Alle ${dayItems.length} items van deze dag herstellen?`)) return
    setBusy('bulk')
    const restoredIds: string[] = []
    for (const t of dayItems) {
      const ok = await restoreTrashItem(t.id)
      if (ok) restoredIds.push(t.id)
    }
    if (restoredIds.length > 0) await pullBoardFromRemote(boardId).catch(() => {})
    setItems(prev => prev.filter(x => !restoredIds.includes(x.id)))
    setBusy(null)
  }

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 9000 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(640px, 100vw)', zIndex: 9001,
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
              <h2 style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Geschiedenis</h2>
            </div>
            <button onClick={onClose} title="Sluiten (Esc)"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>×</button>
          </div>
          {/* Filter-tabs: alles / alleen wijzigingen / alleen verwijderd */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {([
              { id: 'all',     label: 'Alles' },
              { id: 'changes', label: 'Wijzigingen' },
              { id: 'deleted', label: 'Verwijderd' },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setFilter(t.id)}
                style={{
                  padding: '5px 11px', borderRadius: 999, border: '1px solid var(--border)',
                  background: filter === t.id ? 'var(--accent)' : 'var(--bg-card)',
                  color: filter === t.id ? '#000' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                {t.label}
              </button>
            ))}
          </div>
          {/* Legacy onOpenLog: wijzigingen zitten nu in deze drawer zelf. */}
          {false && onOpenLog && (
            <div style={{ marginTop: 10, display: 'none' }}>
              <button onClick={onOpenLog}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  textDecoration: 'underline' }}>
                Bekijk volledig wijzigingen-logboek →
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Laden…</p>
          ) : items.length === 0 ? (
            <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
              Geen verwijderde items op dit bord.
            </p>
          ) : (() => {
            type Ev = { kind: 'delete'; ts: string; t: TrashItem } | { kind: 'change'; ts: string; e: ItemActivity }
            const events: Ev[] = []
            if (filter !== 'changes') for (const t of items) events.push({ kind: 'delete', ts: t.deletedAt, t })
            if (filter !== 'deleted') for (const a of activity) events.push({ kind: 'change', ts: a.ts, e: a })
            if (events.length === 0) {
              return <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>Geen geschiedenis te tonen.</p>
            }
            // Sorteer chronologisch desc + groepeer op dag.
            events.sort((a, b) => b.ts.localeCompare(a.ts))
            const groups = new Map<string, Ev[]>()
            for (const ev of events) {
              const k = dayKey(ev.ts)
              const arr = groups.get(k) ?? []
              arr.push(ev); groups.set(k, arr)
            }
            const sorted = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
            return sorted.map(([day, dayEvents], idx) => (
              <DayGroup key={day} day={day} dayEvents={dayEvents} busyId={busy}
                defaultOpen={idx === 0}
                profiles={profiles}
                getPhoto={getPhoto}
                onPickItem={setDetailItem}
                onRestore={onRestore} onPurge={onPurge}
                onRestoreAll={() => onRestoreAll(dayEvents.filter(ev => ev.kind === 'delete').map(ev => (ev as { t: TrashItem }).t))} />
            ))
          })()}
        </div>
      </div>
      {detailItem && (
        <TrashItemModal t={detailItem}
          onClose={() => setDetailItem(null)}
          onRestore={() => { void onRestore(detailItem); setDetailItem(null) }}
          onPurge={() => { void onPurge(detailItem); setDetailItem(null) }} />
      )}
    </>,
    document.body,
  )
}

// Eén dag-groep in de Geschiedenis. Inklapbare header met telling +
// 'Herstel alle' bulk-knop; daaronder de individuele items.
function DayGroup({ day, dayEvents, busyId, defaultOpen, profiles, getPhoto, onPickItem, onRestore, onPurge, onRestoreAll }: {
  day: string
  dayEvents: ({ kind: 'delete'; ts: string; t: TrashItem } | { kind: 'change'; ts: string; e: ItemActivity })[]
  busyId: string | null
  defaultOpen?: boolean
  profiles: Record<string, Profile>
  getPhoto: (memberId: string) => string | null
  onPickItem: (t: TrashItem) => void
  onRestore: (t: TrashItem) => void
  onPurge:   (t: TrashItem) => void
  onRestoreAll: () => void
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const deletedCount = dayEvents.filter(ev => ev.kind === 'delete').length

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
        background: 'var(--overlay-faint)' }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {fmtDayLabel(day)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            · {dayEvents.length} {dayEvents.length === 1 ? 'gebeurtenis' : 'gebeurtenissen'}
          </span>
        </button>
        {deletedCount > 0 && (
          <button onClick={onRestoreAll}
            disabled={busyId === 'bulk'}
            title="Herstel alle verwijderde items van deze dag"
            style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid var(--accent)',
              background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 700,
              cursor: busyId === 'bulk' ? 'wait' : 'pointer' }}>
            Herstel alle ({deletedCount})
          </button>
        )}
      </div>
      {open && dayEvents.map((ev, i) => {
        if (ev.kind === 'delete') {
          const t = ev.t
          return (
            <div key={`d_${t.id}_${i}`} style={{ padding: '10px 18px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fce7e6', color: '#C9483D',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ActionIcon type="delete" />
              </span>
              <button onClick={() => onPickItem(t)}
                title="Klik voor meer info"
                style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Verwijderd · {t.groupName ?? '—'} · {fmtDate(t.deletedAt)} · door {t.deletedByName ?? '— (oude entry)'}
                </div>
              </button>
              <button onClick={() => onRestore(t)} disabled={busyId === t.id}
                style={{ padding: '6px 11px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-light)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: busyId === t.id ? 'wait' : 'pointer', flexShrink: 0 }}>
                Herstel
              </button>
              <button onClick={() => onPurge(t)} disabled={busyId === t.id}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red, #C9483D)', fontSize: 12, fontWeight: 600, cursor: busyId === t.id ? 'wait' : 'pointer', flexShrink: 0 }}>
                Voorgoed
              </button>
            </div>
          )
        }
        // Change-event
        const e = ev.e
        const p = e.user_id ? profiles[e.user_id] : null
        const name = p?.name ?? 'Iemand'
        const memberId = p?.member_id ?? null
        const photo = memberId ? getPhoto(memberId) : null
        const memberColor = teamData.members.find(m => m.id === memberId)?.color ?? '#9aa3ad'
        const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
        const iconKind = iconTypeFor(e)
        const itemId = itemIdFromTarget(e.target)
        const itemName = e.meta?.itemName ?? null
        const boardForLink = (e.meta?.boardId as string | undefined) ?? null
        function openItem() {
          if (!itemId || !boardForLink) return
          const url = `/projects/${boardForLink}?focus=${encodeURIComponent(itemId)}&drawer=${encodeURIComponent(itemId)}`
          window.location.href = url
        }
        return (
          <div key={`a_${e.id}`}
            onClick={openItem}
            style={{ padding: '12px 18px', borderTop: '1px solid var(--border-light)',
              display: 'flex', gap: 12, alignItems: 'flex-start',
              cursor: itemId ? 'pointer' : 'default',
              background: 'var(--bg-base)',
              transition: 'background 0.1s' }}
            onMouseEnter={ev2 => { if (itemId) (ev2.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
            onMouseLeave={ev2 => { (ev2.currentTarget as HTMLElement).style.background = 'var(--bg-base)' }}>
            {/* Avatar van actor met klein action-icon-badge in de hoek
                (zoals Monday's activity-log). */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              {photo ? (
                <img src={photo} alt={name} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <span style={{ width: 34, height: 34, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: memberColor + '22', color: memberColor, fontSize: 12, fontWeight: 700 }}>
                  {initials}
                </span>
              )}
              <span style={{ position: 'absolute', right: -3, bottom: -3,
                width: 18, height: 18, borderRadius: '50%',
                background: 'var(--bg-card)', border: '2px solid var(--bg-base)',
                color: 'var(--text-primary)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <ActionIcon type={iconKind} />
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Lijn 1: ITEM-naam dik bovenaan (waar de wijziging op is). */}
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginBottom: 2 }}>
                {itemName ?? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 500 }}>(item zonder naam)</span>}
              </div>
              {/* Lijn 2: WIE + WAT. */}
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{name.split(' ')[0]}</strong>{' '}{e.action}
              </div>
              {/* Lijn 3: before -> after via duidelijke pills. */}
              {(e.meta?.before !== undefined || e.meta?.after !== undefined) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={pillStyle(false)}>{fmtSimple(e.meta?.before)}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>→</span>
                  <span style={pillStyle(true)}>{fmtSimple(e.meta?.after)}</span>
                </div>
              ) : e.detail ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{e.detail}</div>
              ) : null}
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 5 }}>
                {fmtDate(e.ts)}
                {itemId && boardForLink && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>· klik om item te openen ↗</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function pillStyle(positive: boolean): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: 999,
    background: positive ? 'rgba(46, 175, 90, 0.14)' : 'rgba(196, 69, 58, 0.10)',
    color: positive ? '#2eaf5a' : 'var(--text-secondary)',
    border: `1px solid ${positive ? 'rgba(46, 175, 90, 0.35)' : 'var(--border)'}`,
    fontSize: 11.5, fontWeight: 600,
    maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }
}

function fmtSimple(v: unknown): string {
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

// Centered modal die de volledige info van een verwijderd item toont.
function TrashItemModal({ t, onClose, onRestore, onPurge }: {
  t: TrashItem
  onClose: () => void
  onRestore: () => void
  onPurge: () => void
}) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!supabase) { setLoading(false); return }
      try {
        const { data } = await supabase
          .from('board_items')
          .select('start_date, end_date, est_hours, owner_ids, notes, status, deadline')
          .eq('id', t.id)
          .single()
        if (!cancelled && data) setDetails(data as Record<string, unknown>)
      } catch {}
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [t.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9100, backdropFilter: 'blur(3px)' }} />
      <div onClick={e => e.stopPropagation()}
        style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(520px, 92vw)', maxHeight: '85vh', overflowY: 'auto',
          zIndex: 9101, background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Verwijderd item
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
              {t.name}
            </h3>
          </div>
          <button onClick={onClose} title="Sluiten (Esc)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 16 }}>
          <span style={{ color: 'var(--text-muted)' }}>Bord</span>
          <span style={{ textTransform: 'capitalize' }}>{t.boardId}</span>
          <span style={{ color: 'var(--text-muted)' }}>Oorspr. groep</span>
          <span>{t.groupName ?? '—'}</span>
          <span style={{ color: 'var(--text-muted)' }}>Verwijderd op</span>
          <span>{fmtDate(t.deletedAt)}</span>
          <span style={{ color: 'var(--text-muted)' }}>Door</span>
          <span>{t.deletedByName ?? '— (oude entry)'}</span>
          {loading ? (
            <>
              <span style={{ color: 'var(--text-muted)' }}>Details</span>
              <span style={{ color: 'var(--text-muted)' }}>Laden…</span>
            </>
          ) : details && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>Status</span>
              <span>{(details.status as string) || '—'}</span>
              <span style={{ color: 'var(--text-muted)' }}>Datums</span>
              <span>{(details.start_date as string) ?? '—'} → {(details.end_date as string) ?? '—'}</span>
              <span style={{ color: 'var(--text-muted)' }}>Deadline</span>
              <span>{(details.deadline as string) ?? '—'}</span>
              <span style={{ color: 'var(--text-muted)' }}>Uren</span>
              <span>{(details.est_hours as number) ?? 0}u</span>
              <span style={{ color: 'var(--text-muted)' }}>Owners</span>
              <span>{((details.owner_ids as string[]) ?? []).join(', ') || '—'}</span>
              {!!details.notes && <>
                <span style={{ color: 'var(--text-muted)' }}>Notes</span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{details.notes as string}</span>
              </>}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onPurge}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red, #C9483D)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Voorgoed verwijderen
          </button>
          <button onClick={onRestore}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Herstellen
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
