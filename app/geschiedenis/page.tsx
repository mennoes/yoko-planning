'use client'

import { useEffect, useState } from 'react'
import { useProfile } from '@/components/ProfileContext'
import { supabase } from '@/lib/supabase'
import { pullBoardFromRemote } from '@/lib/boardStore'

type Snapshot = {
  id:          string
  board_id:    string
  snapshot_at: string
  trigger:    'auto' | 'manual' | 'restore'
  size_bytes:  number | null
  item_count?: number
  group_count?: number
}

export default function SnapshotsPage() {
  const { isAuthenticated, authChecked } = useProfile()
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState<string | null>(null)
  const [filterBoard, setFilterBoard] = useState<string>('')

  async function refresh() {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('board_snapshots')
      .select('id, board_id, snapshot_at, trigger, size_bytes, data')
      .order('snapshot_at', { ascending: false })
      .limit(200)
    if (!data) { setSnapshots([]); setLoading(false); return }
    type Row = Snapshot & { data: { groups?: unknown[]; items?: unknown[] } }
    setSnapshots((data as Row[]).map(r => ({
      id: r.id, board_id: r.board_id, snapshot_at: r.snapshot_at,
      trigger: r.trigger, size_bytes: r.size_bytes,
      group_count: r.data?.groups?.length ?? 0,
      item_count:  r.data?.items?.length  ?? 0,
    })))
    setLoading(false)
  }

  useEffect(() => {
    if (authChecked && isAuthenticated) refresh()
  }, [authChecked, isAuthenticated])

  async function manualSnapshot(boardId: string) {
    if (!supabase) return
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) return
    setBusy(`new:${boardId}`)
    await fetch('/api/snapshots/create', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, trigger: 'manual' }),
    })
    setBusy(null)
    refresh()
  }

  // Recovery voor "Done-subitems zijn weg" — merget ontbrekende subs uit de
  // meest recente snapshot (van vóór 30 min geleden) terug in de HUIDIGE
  // items. Recente top-level-wijzigingen blijven dus behouden.
  async function mergeMissingSubs(boardId: string) {
    if (!supabase) return
    if (!window.confirm(
      `Ontbrekende subitems voor '${boardId}' terughalen?\n\n` +
      `Pakt de meest recente snapshot van vóór 30 min geleden, kijkt per item welke ` +
      `subitems daar wél in zitten maar nu missen, en plaatst die terug op de ` +
      `huidige items. Top-level wijzigingen van net blijven staan.`,
    )) return
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) return
    setBusy(`recover:${boardId}`)
    const res = await fetch('/api/snapshots/merge-missing-subitems', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId }),
    })
    const json = await res.json() as { ok: boolean; error?: string; touchedItems?: number; restoredSubs?: number; usedSnapshot?: string; status?: string }
    setBusy(null)
    if (!json.ok) {
      window.alert(`Recovery mislukt: ${json.error ?? 'onbekend'}`)
      return
    }
    await pullBoardFromRemote(boardId).catch(() => {})
    if (json.status === 'nothing_to_restore') {
      window.alert(`Niets terug te zetten — de huidige state heeft al alle subitems uit de snapshot van ${formatDate(json.usedSnapshot ?? '')}.`)
    } else {
      window.alert(`Hersteld: ${json.restoredSubs} subitem(s) op ${json.touchedItems} item(s) (uit snapshot ${formatDate(json.usedSnapshot ?? '')}).`)
    }
  }

  async function restore(snap: Snapshot) {
    if (!supabase) return
    if (!window.confirm(
      `Bord '${snap.board_id}' terugzetten naar de snapshot van ${formatDate(snap.snapshot_at)}?\n\n` +
      `De huidige state wordt eerst zelf als snapshot bewaard (trigger=restore), dus deze actie is ook weer terug te draaien.`,
    )) return
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) return
    setBusy(snap.id)
    const res = await fetch('/api/snapshots/restore', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId: snap.id }),
    })
    const json = await res.json() as { ok: boolean; error?: string; groupsRestored?: number; itemsRestored?: number }
    setBusy(null)
    if (!json.ok) {
      window.alert(`Restore mislukt: ${json.error ?? 'onbekend'}`)
      return
    }
    await pullBoardFromRemote(snap.board_id).catch(() => {})
    window.alert(`Hersteld: ${json.groupsRestored} groepen en ${json.itemsRestored} items op bord '${snap.board_id}'.`)
    refresh()
  }

  const boards = Array.from(new Set(snapshots.map(s => s.board_id))).sort()
  const visible = filterBoard ? snapshots.filter(s => s.board_id === filterBoard) : snapshots

  if (!authChecked) return <Shell><p style={{ color: 'var(--text-muted)' }}>Laden…</p></Shell>
  if (!isAuthenticated) return <Shell><p style={{ color: 'var(--text-secondary)' }}>Log eerst in.</p></Shell>

  return (
    <Shell>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 18px', lineHeight: 1.5, maxWidth: 700 }}>
        Dagelijkse archief-versies per bord. Elke versie bevat de complete state (groepen + items + subitems)
        van dat bord op dat moment. Automatisch aangemaakt zodra een gebruiker de app opent op een dag waarop
        er nog geen versie bestaat. <strong>Herstel</strong> zet &apos;t bord terug naar de gekozen versie —
        de huidige state wordt eerst zelf als versie bewaard, dus altijd terug te draaien.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setFilterBoard('')}
          style={pillStyle(filterBoard === '')}>Alle borden</button>
        {boards.map(b => (
          <button key={b} onClick={() => setFilterBoard(b)} style={pillStyle(filterBoard === b)}>{b}</button>
        ))}
        <div style={{ flex: 1 }} />
        {boards.map(b => (
          <button key={`recover-${b}`} onClick={() => mergeMissingSubs(b)} disabled={busy === `recover:${b}`}
            title="Haal ontbrekende subitems uit de laatste snapshot terug op de huidige items"
            style={{
              padding: '5px 10px', borderRadius: 999, border: '1px solid var(--accent)',
              background: 'var(--accent-light, rgba(88,150,255,0.18))', color: 'var(--text-primary)',
              fontSize: 11, fontWeight: 700, cursor: busy === `recover:${b}` ? 'wait' : 'pointer',
            }}>
            ↩︎ Herstel subs van {b}
          </button>
        ))}
        {boards.map(b => (
          <button key={`new-${b}`} onClick={() => manualSnapshot(b)} disabled={busy === `new:${b}`}
            style={{
              padding: '5px 10px', borderRadius: 999, border: '1px solid var(--border)',
              background: 'var(--bg-card)', color: 'var(--text-secondary)',
              fontSize: 11, fontWeight: 600, cursor: busy === `new:${b}` ? 'wait' : 'pointer',
            }}>
            📸 Versie van {b}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Laden…</p>}
      {!loading && visible.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>Nog geen versies gevonden. Klik &apos;📸 Versie van &lt;bord&gt;&apos; om er handmatig één te maken.</p>
      )}

      {visible.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1.6fr 1fr 1fr 1fr 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            <span>Bord</span>
            <span>Datum</span>
            <span>Trigger</span>
            <span>Groepen / Items</span>
            <span>Grootte</span>
            <span></span>
          </div>
          {visible.map(s => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '120px 1.6fr 1fr 1fr 1fr 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{s.board_id}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{formatDate(s.snapshot_at)}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.trigger}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.group_count} / {s.item_count}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{formatBytes(s.size_bytes)}</span>
              <button onClick={() => restore(s)} disabled={busy === s.id}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: busy === s.id ? 'wait' : 'pointer' }}>
                Herstel
              </button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 999,
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
    background: active ? 'var(--accent)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
function formatBytes(n: number | null | undefined): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1200, padding: '40px 32px' }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
        📜 Geschiedenis
      </h1>
      {children}
    </div>
  )
}
