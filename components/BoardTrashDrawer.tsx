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
          ) : items.map(t => (
            <TrashRow key={t.id} t={t} busy={busy === t.id}
              onRestore={() => onRestore(t)} onPurge={() => onPurge(t)} />
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}

function TrashRow({ t, busy, onRestore, onPurge }: {
  t: TrashItem
  busy: boolean
  onRestore: () => void
  onPurge: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [details, setDetails] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next && !details && supabase) {
      setLoading(true)
      try {
        const { data } = await supabase
          .from('board_items')
          .select('start_date, end_date, est_hours, owner_ids, notes, status')
          .eq('id', t.id)
          .single()
        if (data) setDetails(data as Record<string, unknown>)
      } catch {}
      setLoading(false)
    }
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={toggle}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.name}
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
              {expanded ? '▾' : '▸'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {t.groupName ?? '—'} · verwijderd {fmtDate(t.deletedAt)} · door {t.deletedByName ?? '— (oude entry)'}
          </div>
        </button>
        <button onClick={onRestore} disabled={busy}
          style={{ padding: '6px 11px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-light)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', flexShrink: 0 }}>
          Herstel
        </button>
        <button onClick={onPurge} disabled={busy}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red, #C9483D)', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', flexShrink: 0 }}>
          Voorgoed
        </button>
      </div>
      {expanded && (
        <div style={{ padding: '4px 18px 14px 18px', fontSize: 12, color: 'var(--text-secondary)', background: 'var(--overlay-faint)' }}>
          {loading ? (
            <span style={{ color: 'var(--text-muted)' }}>Laden…</span>
          ) : details ? (
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, columnGap: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>Status</span>
              <span>{(details.status as string) || '—'}</span>
              <span style={{ color: 'var(--text-muted)' }}>Datums</span>
              <span>{(details.start_date as string) ?? '—'} → {(details.end_date as string) ?? '—'}</span>
              <span style={{ color: 'var(--text-muted)' }}>Uren</span>
              <span>{(details.est_hours as number) ?? 0}u</span>
              <span style={{ color: 'var(--text-muted)' }}>Owners</span>
              <span>{((details.owner_ids as string[]) ?? []).join(', ') || '—'}</span>
              {!!details.notes && <>
                <span style={{ color: 'var(--text-muted)' }}>Notes</span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{details.notes as string}</span>
              </>}
            </div>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>Geen extra details beschikbaar.</span>
          )}
        </div>
      )}
    </div>
  )
}
