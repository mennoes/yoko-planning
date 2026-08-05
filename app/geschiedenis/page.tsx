'use client'

import { useEffect, useState } from 'react'
import { useProfile } from '@/components/ProfileContext'
import { supabase } from '@/lib/supabase'
import {
  loadTrash,
  purgeTrashItem,
  pullBoardFromRemote,
  restoreRecentTrash,
  restoreTrashItem,
  type TrashItem,
} from '@/lib/boardStore'

type Snapshot = {
  id:          string
  board_id:    string
  snapshot_at: string
  trigger:    'auto' | 'manual' | 'restore'
  size_bytes:  number | null
  item_count?: number
  group_count?: number
}

type HistoryTab = 'versies' | 'papierbak'

export default function SnapshotsPage() {
  const { isAuthenticated, authChecked } = useProfile()
  const [tab, setTab] = useState<HistoryTab>('versies')
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState<string | null>(null)
  const [filterBoard, setFilterBoard] = useState<string>('')

  useEffect(() => {
    function syncTabFromUrl() {
      setTab(new URLSearchParams(window.location.search).get('tab') === 'papierbak' ? 'papierbak' : 'versies')
    }
    syncTabFromUrl()
    window.addEventListener('popstate', syncTabFromUrl)
    return () => window.removeEventListener('popstate', syncTabFromUrl)
  }, [])

  function switchTab(next: HistoryTab) {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === 'papierbak') url.searchParams.set('tab', 'papierbak')
    else url.searchParams.delete('tab')
    window.history.replaceState(null, '', url.toString())
  }

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
      <HistoryTabs active={tab} onChange={switchTab} />

      {tab === 'papierbak' ? <TrashPanel /> : (
        <>
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
        </>
      )}
    </Shell>
  )
}

function HistoryTabs({ active, onChange }: { active: HistoryTab; onChange: (tab: HistoryTab) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, margin: '14px 0 22px', padding: 4, width: 'fit-content', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)' }}>
      {([
        ['versies', '📜 Versies'],
        ['papierbak', '🗑 Papierbak'],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-pressed={active === id}
          style={{
            padding: '8px 16px',
            border: 0,
            borderRadius: 7,
            background: active === id ? 'var(--accent)' : 'transparent',
            color: active === id ? '#fff' : 'var(--text-secondary)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function TrashPanel() {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function refreshTrash() {
    setLoading(true)
    setItems(await loadTrash())
    setLoading(false)
  }

  useEffect(() => {
    refreshTrash()
  }, [])

  async function onRestore(item: TrashItem) {
    setBusy(item.id)
    const restored = await restoreTrashItem(item.id)
    if (restored) {
      await pullBoardFromRemote(item.boardId).catch(() => {})
      setItems(current => current.filter(candidate => candidate.id !== item.id))
    }
    setBusy(null)
  }

  async function onPurge(item: TrashItem) {
    if (!window.confirm(
      `'${item.name}' definitief verwijderen?\n\n` +
      `Dit kan niet ongedaan gemaakt worden — ook Cmd+Z helpt dan niet meer. ` +
      `De Supabase point-in-time recovery (PITR) op de Pro-plan kan 't nog wel ` +
      `binnen 7 dagen herstellen via het Supabase dashboard.`,
    )) return
    setBusy(item.id)
    const purged = await purgeTrashItem(item.id)
    if (purged) setItems(current => current.filter(candidate => candidate.id !== item.id))
    setBusy(null)
  }

  async function restoreRecent(minutes: number, requireConfirmation = false) {
    if (requireConfirmation && !window.confirm('Herstel ALLES dat in het laatste uur in de papierbak is beland?')) return
    setBusy(`recent:${minutes}`)
    const count = await restoreRecentTrash(minutes)
    window.alert(`${count} item(s) hersteld.${minutes === 60 ? ' Open je bord om ze weer te zien.' : ''}`)
    await refreshTrash()
    setBusy(null)
  }

  return (
    <>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px', lineHeight: 1.5, maxWidth: 700 }}>
        Hier staan items die uit de borden verwijderd zijn. Verwijderingen via de UI of een sync zijn
        soft-delete: herstel zet een item terug op het oorspronkelijke bord en in de oorspronkelijke groep.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button
          onClick={() => restoreRecent(60, true)}
          disabled={busy === 'recent:60'}
          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent-light)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: busy === 'recent:60' ? 'wait' : 'pointer' }}
        >
          ⚡ Herstel alles van het laatste uur
        </button>
        <button
          onClick={() => restoreRecent(24 * 60)}
          disabled={busy === `recent:${24 * 60}`}
          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: busy === `recent:${24 * 60}` ? 'wait' : 'pointer' }}
        >
          Laatste 24u
        </button>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Laden…</p>}
      {!loading && items.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>Niets in de papierbak — alles staat netjes op de borden.</p>
      )}

      {items.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 1fr 1fr 1fr 90px 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
              <span>Naam</span>
              <span>Bord</span>
              <span>Oorspr. groep</span>
              <span>Verwijderd op</span>
              <span>Door</span>
              <span />
              <span />
            </div>
            {items.map(item => (
              <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 100px 1fr 1fr 1fr 90px 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{item.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.boardId}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.groupName ?? '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(item.deletedAt, false)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.deletedByName ?? '—'}</span>
                <button onClick={() => onRestore(item)} disabled={busy === item.id}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: busy === item.id ? 'wait' : 'pointer' }}>
                  Herstel
                </button>
                <button onClick={() => onPurge(item)} disabled={busy === item.id}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red, #C9483D)', fontSize: 12, fontWeight: 600, cursor: busy === item.id ? 'wait' : 'pointer' }}>
                  Voorgoed
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
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
function formatDate(iso: string, includeYear = true): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'short',
      ...(includeYear ? { year: 'numeric' as const } : {}),
      hour: '2-digit',
      minute: '2-digit',
    })
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
        📜 Geschiedenis & herstel
      </h1>
      {children}
    </div>
  )
}
