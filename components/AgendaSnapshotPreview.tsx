'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BoardGroup, BoardItem, ColumnDef, SubItem } from '@/lib/boards'
import { getBoardConfig } from '@/lib/boardsRegistry'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtRange } from './DateRangeCell'
import { UserAvatar } from './UserAvatar'

export type AgendaSnapshotSummary = {
  id: string
  board_id: string
  snapshot_at: string
  trigger: string
}

type SnapshotPayload = {
  groups?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
}

function itemFromRow(row: Record<string, unknown>): BoardItem {
  const extra = (row.extra && typeof row.extra === 'object' ? row.extra : {}) as Record<string, unknown>
  return {
    ...extra,
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    ownerIds: Array.isArray(row.owner_ids) ? row.owner_ids.map(String) : [],
    status: String(row.status ?? ''),
    startDate: typeof row.start_date === 'string' ? row.start_date : null,
    endDate: typeof row.end_date === 'string' ? row.end_date : null,
    deadline: typeof row.deadline === 'string' ? row.deadline : null,
    estHours: Number(row.est_hours ?? 0),
    dagen: Number(row.dagen ?? 0),
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    contactpersoon: typeof row.contactpersoon === 'string' ? row.contactpersoon : undefined,
    uitzenddag: typeof row.uitzenddag === 'string' ? row.uitzenddag : null,
    framelink: typeof row.framelink === 'string' ? row.framelink : undefined,
    nummers: typeof row.nummers === 'number' ? row.nummers : undefined,
    subitems: Array.isArray(row.subitems) ? row.subitems as SubItem[] : [],
    journal: Array.isArray(row.journal) ? row.journal as BoardItem['journal'] : [],
    source: row.source === 'google' ? 'google' : 'manual',
    externalLink: typeof row.external_link === 'string' ? row.external_link : undefined,
  }
}

export function groupsFromSnapshot(payload: SnapshotPayload): BoardGroup[] {
  const rows = payload.items ?? []
  const byGroup = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const groupId = String(row.group_id ?? '')
    const list = byGroup.get(groupId) ?? []
    list.push(row)
    byGroup.set(groupId, list)
  }
  return (payload.groups ?? [])
    .slice()
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map(group => ({
      id: String(group.id ?? ''),
      name: String(group.name ?? 'Zonder naam'),
      color: String(group.color ?? '#9aadbd'),
      collapsed: false,
      items: (byGroup.get(String(group.id ?? '')) ?? [])
        .slice()
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
        .map(itemFromRow),
    }))
}

function triggerLabel(trigger: string): string {
  if (trigger === 'manual') return 'Handmatig herstelpunt'
  if (trigger === 'restore') return 'Vóór een herstelactie'
  return 'Automatisch herstelpunt'
}

function valueFor(item: BoardItem | SubItem, column: ColumnDef, color: string) {
  const key = column.key
  if (key === 'ownerIds') {
    const ids = item.ownerIds ?? []
    return ids.length ? <div style={{ display: 'flex', alignItems: 'center' }}>{ids.slice(0, 4).map((id, index) => (
      <UserAvatar key={id} memberId={id} size={28} style={{ marginLeft: index ? -7 : 0, boxShadow: '0 0 0 2px var(--bg-card)' }} />
    ))}{ids.length > 4 && <span style={{ marginLeft: 5, fontSize: 11, color: 'var(--text-muted)' }}>+{ids.length - 4}</span>}</div> : '—'
  }
  if (key === 'timeline') {
    const label = fmtRange(item.startDate, item.endDate)
    return label ? <span style={{ display: 'inline-flex', minWidth: 96, justifyContent: 'center', padding: '5px 11px', borderRadius: 999, border: `1px solid ${color}66`, background: `${color}20`, color: 'var(--text-primary)', fontWeight: 650 }}>{label}</span> : '—'
  }
  if (key === 'deadline') return item.deadline ? fmtDate(item.deadline) : '—'
  if (key === 'status') return item.status ? <span style={{ display: 'inline-flex', padding: '5px 9px', borderRadius: 6, background: item.status.toLowerCase().includes('done') ? '#00c87522' : 'var(--overlay-medium)', fontWeight: 650 }}>{item.status}</span> : '—'
  const value = (item as unknown as Record<string, unknown>)[key]
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function SnapshotItemDetails({ item, color, onClose }: { item: BoardItem; color: string; onClose: () => void }) {
  return <div style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', justifyContent: 'flex-end', background: 'rgba(14,18,24,.28)' }} onClick={onClose}>
    <section onClick={event => event.stopPropagation()} aria-label={`Details van ${item.name}`} style={{ width: 'min(560px, 94vw)', height: '100%', overflowY: 'auto', background: 'var(--bg-card)', borderLeft: '1px solid var(--border)', boxShadow: '-18px 0 45px rgba(0,0,0,.18)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '22px 24px 18px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12 }}>
        <span style={{ width: 8, borderRadius: 9, background: color }} />
        <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Alleen-lezen voorbeeld</div><h3 style={{ margin: '5px 0 0', fontSize: 23, color: 'var(--text-primary)' }}>{item.name}</h3></div>
        <button onClick={onClose} aria-label="Details sluiten" style={closeButtonStyle}>×</button>
      </div>
      <div style={{ padding: 24, display: 'grid', gap: 20 }}>
        <Detail label="Periode" value={fmtRange(item.startDate, item.endDate) || '—'} />
        <Detail label="Deadline" value={fmtDate(item.deadline) || '—'} />
        <Detail label="Status" value={item.status || '—'} />
        <Detail label="Uren" value={`${item.estHours || 0}u`} />
        <Detail label="Beschrijving" value={item.notes || '—'} />
        <div><div style={detailLabelStyle}>Owners</div><div style={{ display: 'flex', gap: 6, marginTop: 7 }}>{item.ownerIds?.length ? item.ownerIds.map(id => <UserAvatar key={id} memberId={id} size={34} />) : '—'}</div></div>
        <div><div style={detailLabelStyle}>Subitems ({item.subitems?.length ?? 0})</div><div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>{item.subitems?.length ? item.subitems.map((sub, index) => <div key={sub.id} style={{ padding: '11px 12px', borderBottom: index < item.subitems!.length - 1 ? '1px solid var(--border-light)' : 'none', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}><strong style={{ fontSize: 13 }}>{sub.name}</strong><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtRange(sub.startDate, sub.endDate) || 'Geen periode'} · {sub.estHours || 0}u</span></div>) : <div style={{ padding: 12, color: 'var(--text-muted)' }}>Geen subitems in deze versie.</div>}</div></div>
      </div>
    </section>
  </div>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div style={detailLabelStyle}>{label}</div><div style={{ marginTop: 5, color: 'var(--text-primary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{value}</div></div>
}

export function AgendaSnapshotPreview({ snapshot, onClose, onRestore }: {
  snapshot: AgendaSnapshotSummary
  onClose: () => void
  onRestore: (snapshot: AgendaSnapshotSummary) => Promise<boolean>
}) {
  const config = getBoardConfig(snapshot.board_id)
  const [groups, setGroups] = useState<BoardGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<BoardItem | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    function keydown(event: KeyboardEvent) { if (event.key === 'Escape') selected ? setSelected(null) : onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, selected])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) { setError('Recovery is niet beschikbaar.'); setLoading(false); return }
      setLoading(true); setError('')
      const { data, error: loadError } = await supabase.from('board_snapshots').select('data').eq('id', snapshot.id).single()
      if (cancelled) return
      if (loadError || !data) setError('Deze versie kon niet worden geladen.')
      else setGroups(groupsFromSnapshot((data as { data: SnapshotPayload }).data ?? {}))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [snapshot.id])

  const columns = (config?.columns ?? []).filter(column => !column.hidden)
  const shownGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('nl-NL')
    if (!needle) return groups
    return groups.map(group => ({ ...group, items: group.items.filter(item => item.name.toLocaleLowerCase('nl-NL').includes(needle) || item.subitems?.some(sub => sub.name.toLocaleLowerCase('nl-NL').includes(needle))) })).filter(group => group.items.length)
  }, [groups, query])
  const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0)
  const subCount = groups.reduce((sum, group) => sum + group.items.reduce((count, item) => count + (item.subitems?.length ?? 0), 0), 0)
  const grid = `minmax(270px, 2fr) ${columns.map(column => `${Math.max(78, Math.min(column.width, 180))}px`).join(' ')}`

  if (typeof document === 'undefined') return null
  return createPortal(<>
    <div style={{ position: 'fixed', inset: 0, zIndex: 10040, background: 'rgba(0,0,0,.56)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
    <div role="dialog" aria-modal="true" aria-label={`Voorbeeld van ${config?.name ?? snapshot.board_id}`} style={{ position: 'fixed', inset: '20px', zIndex: 10041, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 30px 90px rgba(0,0,0,.38)' }}>
      <header style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ width: 12, height: 42, borderRadius: 8, background: config?.color ?? '#579bfc' }} />
        <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em' }}>Recoveryvoorbeeld · niets kan hier worden gewijzigd</div><h2 style={{ margin: '3px 0 0', color: 'var(--text-primary)', fontSize: 22 }}>{config?.name ?? snapshot.board_id} <span style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 500 }}>· {new Date(snapshot.snapshot_at).toLocaleString('nl-NL')}</span></h2></div>
        <button disabled={restoring} onClick={async () => { setRestoring(true); const restored = await onRestore(snapshot); setRestoring(false); if (restored) onClose() }} style={{ ...actionButtonStyle, background: config?.color ?? 'var(--accent)', color: '#fff', borderColor: config?.color ?? 'var(--accent)' }}>{restoring ? 'Herstellen…' : 'Deze versie herstellen'}</button>
        <button onClick={onClose} aria-label="Voorbeeld sluiten" style={closeButtonStyle}>×</button>
      </header>
      <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Zoek in deze oude agenda…" style={{ width: 'min(420px, 45vw)', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none' }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{groups.length} groepen · {itemCount} items · {subCount} subitems · {triggerLabel(snapshot.trigger)}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 18 }}>
        {loading && <div style={emptyStyle}>Oude agenda laden…</div>}
        {error && <div style={{ ...emptyStyle, color: 'var(--red, #e2445c)' }}>{error}</div>}
        {!loading && !error && shownGroups.length === 0 && <div style={emptyStyle}>Geen onderdelen gevonden.</div>}
        {!loading && !error && shownGroups.map(group => <section key={group.id} style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', background: 'var(--bg-card)' }}>
          <button onClick={() => setCollapsed(current => { const next = new Set(current); next.has(group.id) ? next.delete(group.id) : next.add(group.id); return next })} style={{ width: '100%', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 9, border: 0, borderBottom: collapsed.has(group.id) ? 0 : '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left' }}><span>{collapsed.has(group.id) ? '▶' : '▼'}</span><span style={{ width: 10, height: 10, borderRadius: 3, background: group.color }} /><strong>{group.name}</strong><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{group.items.length} items</span></button>
          {!collapsed.has(group.id) && <div style={{ minWidth: 760, overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}><div style={headerCellStyle}>Item</div>{columns.map(column => <div key={column.key} style={headerCellStyle}>{column.label}</div>)}</div>
            {group.items.map(item => <div key={item.id}>
              <div onDoubleClick={() => setSelected(item)} style={{ display: 'grid', gridTemplateColumns: grid, borderBottom: '1px solid var(--border-light)', alignItems: 'stretch' }}>
                <div style={{ ...cellStyle, gap: 8, minWidth: 0 }}><button aria-label={`${item.name} subitems ${expanded.has(item.id) ? 'sluiten' : 'openen'}`} onClick={() => setExpanded(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next })} disabled={!item.subitems?.length} style={{ width: 24, border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: item.subitems?.length ? 'pointer' : 'default' }}>{item.subitems?.length ? (expanded.has(item.id) ? '▼' : '▶') : ''}</button><button onClick={() => setSelected(item)} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 0, background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontSize: 13.5, fontWeight: 650 }}>{item.name}</button></div>
                {columns.map(column => <div key={column.key} style={cellStyle}>{valueFor(item, column, group.color)}</div>)}
              </div>
              {expanded.has(item.id) && item.subitems?.map(sub => <div key={sub.id} style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--bg-base)', borderBottom: '1px solid var(--border-light)', alignItems: 'stretch' }}><div style={{ ...cellStyle, paddingLeft: 52, fontSize: 12.5 }}><span style={{ color: group.color }}>↳</span>{sub.name}</div>{columns.map(column => <div key={column.key} style={{ ...cellStyle, fontSize: 12 }}>{valueFor(sub, column, group.color)}</div>)}</div>)}
            </div>)}
          </div>}
        </section>)}
      </div>
      {selected && <SnapshotItemDetails item={selected} color={config?.color ?? '#579bfc'} onClose={() => setSelected(null)} />}
    </div>
  </>, document.body)
}

const headerCellStyle: React.CSSProperties = { padding: '9px 11px', borderRight: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }
const cellStyle: React.CSSProperties = { minHeight: 46, padding: '7px 11px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)', fontSize: 12.5, overflow: 'hidden' }
const detailLabelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em' }
const actionButtonStyle: React.CSSProperties = { padding: '9px 13px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12.5, fontWeight: 750, cursor: 'pointer' }
const closeButtonStyle: React.CSSProperties = { width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer' }
const emptyStyle: React.CSSProperties = { padding: 36, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }
