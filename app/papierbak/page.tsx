'use client'

import { useEffect, useState } from 'react'
import { useProfile } from '@/components/ProfileContext'
import {
  loadTrash, restoreTrashItem, purgeTrashItem, pullBoardFromRemote, restoreRecentTrash, type TrashItem,
} from '@/lib/boardStore'

export default function TrashPage() {
  const { isAuthenticated, authChecked } = useProfile()
  const [items, setItems]     = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setItems(await loadTrash())
    setLoading(false)
  }
  useEffect(() => {
    if (authChecked && isAuthenticated) refresh()
  }, [authChecked, isAuthenticated])

  async function onRestore(t: TrashItem) {
    setBusy(t.id)
    const ok = await restoreTrashItem(t.id)
    if (ok) {
      // Direct ook het bord opnieuw pullen zodat het item terug op het
      // bord verschijnt zonder dat de gebruiker hoeft te refreshen.
      await pullBoardFromRemote(t.boardId).catch(() => {})
      setItems(prev => prev.filter(x => x.id !== t.id))
    }
    setBusy(null)
  }

  async function onPurge(t: TrashItem) {
    if (!window.confirm(
      `'${t.name}' definitief verwijderen?\n\n` +
      `Dit kan niet ongedaan gemaakt worden — ook Cmd+Z helpt dan niet meer. ` +
      `De Supabase point-in-time recovery (PITR) op de Pro-plan kan 't nog wel ` +
      `binnen 7 dagen herstellen via het Supabase dashboard.`,
    )) return
    setBusy(t.id)
    const ok = await purgeTrashItem(t.id)
    if (ok) setItems(prev => prev.filter(x => x.id !== t.id))
    setBusy(null)
  }

  if (!authChecked) return <Shell><p style={{ color: 'var(--text-muted)' }}>Laden…</p></Shell>
  if (!isAuthenticated) return <Shell><p style={{ color: 'var(--text-secondary)' }}>Log eerst in om de papierbak te bekijken.</p></Shell>

  return (
    <Shell>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px', lineHeight: 1.5, maxWidth: 640 }}>
        Hier staan items die uit de borden verwijderd zijn. Verwijderingen via de
        UI of via een sync zijn <strong>soft-delete</strong>: de rij blijft in de
        database staan met een tijdstempel. Herstel zet 'm terug op het oorspronkelijke
        bord/groep.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button onClick={async () => {
          if (!confirm('Herstel ALLES dat in het laatste uur in de prullenbak is beland?')) return
          const n = await restoreRecentTrash(60)
          alert(`${n} item(s) hersteld. Open je bord om ze weer te zien.`)
          refresh()
        }}
          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent-light)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          ⚡ Herstel alles van het laatste uur
        </button>
        <button onClick={async () => {
          const n = await restoreRecentTrash(24 * 60)
          alert(`${n} item(s) hersteld.`)
          refresh()
        }}
          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Laatste 24u
        </button>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Laden…</p>}
      {!loading && items.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>Niets in de papierbak — alles staat netjes op de borden.</p>
      )}

      {items.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 1fr 1fr 1fr 90px 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            <span>Naam</span>
            <span>Bord</span>
            <span>Oorspr. groep</span>
            <span>Verwijderd op</span>
            <span>Door</span>
            <span></span>
            <span></span>
          </div>
          {items.map(t => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '2fr 100px 1fr 1fr 1fr 90px 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{t.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.boardId}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.groupName ?? '—'}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(t.deletedAt)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.deletedByName ?? '—'}</span>
              <button onClick={() => onRestore(t)} disabled={busy === t.id}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: busy === t.id ? 'wait' : 'pointer' }}>
                Herstel
              </button>
              <button onClick={() => onPurge(t)} disabled={busy === t.id}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red, #C9483D)', fontSize: 12, fontWeight: 600, cursor: busy === t.id ? 'wait' : 'pointer' }}>
                Voorgoed
              </button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1100, padding: '40px 32px' }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
        🗑 Papierbak
      </h1>
      {children}
    </div>
  )
}
