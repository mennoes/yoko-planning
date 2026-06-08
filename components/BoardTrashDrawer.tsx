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
            <div key={t.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {t.groupName ?? '—'} · verwijderd {fmtDate(t.deletedAt)}
                  {t.deletedByName && ` · door ${t.deletedByName}`}
                </div>
              </div>
              <button onClick={() => onRestore(t)} disabled={busy === t.id}
                style={{ padding: '6px 11px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-light)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: busy === t.id ? 'wait' : 'pointer', flexShrink: 0 }}>
                Herstel
              </button>
              <button onClick={() => onPurge(t)} disabled={busy === t.id}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red, #C9483D)', fontSize: 12, fontWeight: 600, cursor: busy === t.id ? 'wait' : 'pointer', flexShrink: 0 }}>
                Voorgoed
              </button>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}
