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
import { supabase } from '@/lib/supabase'

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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [detailItem, setDetailItem] = useState<TrashItem | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function refresh() {
      setLoading(true)
      const all = await loadTrash()
      if (cancelled) return
      setItems(all.filter(t => t.boardId === boardId))
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
              <h2 style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Geschiedenis</h2>
            </div>
            <button onClick={onClose} title="Sluiten (Esc)"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>×</button>
          </div>
          {onOpenLog && (
            <div style={{ marginTop: 10 }}>
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
            // Groepeer op dag van verwijdering. Items binnen één dag
            // staan onder een collapse-header met een "Herstel alles van
            // deze dag"-knop. Recentste dag bovenaan.
            const groups = new Map<string, TrashItem[]>()
            for (const t of items) {
              const k = dayKey(t.deletedAt)
              const arr = groups.get(k) ?? []
              arr.push(t); groups.set(k, arr)
            }
            const sorted = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
            return sorted.map(([day, dayItems]) => (
              <DayGroup key={day} day={day} dayItems={dayItems} busyId={busy}
                onPickItem={setDetailItem}
                onRestore={onRestore} onPurge={onPurge} onRestoreAll={() => onRestoreAll(dayItems)} />
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
function DayGroup({ day, dayItems, busyId, onPickItem, onRestore, onPurge, onRestoreAll }: {
  day: string
  dayItems: TrashItem[]
  busyId: string | null
  onPickItem: (t: TrashItem) => void
  onRestore: (t: TrashItem) => void
  onPurge:   (t: TrashItem) => void
  onRestoreAll: () => void
}) {
  // Vandaag/Gisteren open by default; oudere dagen ingeklapt.
  const today = new Date(); today.setHours(0,0,0,0)
  const dayDate = new Date(day); dayDate.setHours(0,0,0,0)
  const diff = Math.round((today.getTime() - dayDate.getTime()) / 86400000)
  const [open, setOpen] = useState(diff <= 1)

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
            · {dayItems.length} {dayItems.length === 1 ? 'item' : 'items'}
          </span>
        </button>
        <button onClick={onRestoreAll}
          disabled={busyId === 'bulk'}
          title="Herstel alle items van deze dag"
          style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid var(--accent)',
            background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 700,
            cursor: busyId === 'bulk' ? 'wait' : 'pointer' }}>
          Herstel alle ({dayItems.length})
        </button>
      </div>
      {open && dayItems.map(t => (
        <div key={t.id} style={{ padding: '10px 18px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => onPickItem(t)}
            title="Klik voor meer info"
            style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {t.groupName ?? '—'} · {fmtDate(t.deletedAt)} · door {t.deletedByName ?? '— (oude entry)'}
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
      ))}
    </div>
  )
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
