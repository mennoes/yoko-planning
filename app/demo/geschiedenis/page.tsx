'use client'

// DEMO-VARIANT van app/geschiedenis/page.tsx — de echte pagina praat met de
// Supabase `board_snapshots`-tabel en de /api/snapshots/*-routes (échte
// productie-bord-data, inclusief een auth-token). Die mogen we vanuit de
// publieke demo nooit raken.
//
// In plaats daarvan simuleren we hetzelfde 'versies + papierbak'-verhaal
// met verzonnen, in-memory data over de twee demo-borden (DEMO_BOARD_IDS,
// zie lib/demoFixtures.ts). 'Herstel' op een versie zet het gekozen
// demo-bord écht terug naar z'n seed-state, via dezelfde saveGroups()-call
// die elke andere demo-bord-edit ook gebruikt — demo-veilig, want
// pushBoardToRemote is een no-op zonder ingelogde gebruiker (zie
// lib/boardStore.ts). De 'papierbak'-tab werkt hetzelfde: een paar
// verzonnen, al-verwijderde items die je terug kunt zetten op het
// bijbehorende demo-bord.
//
// Geen enkele localStorage-key of API-call hier raakt een echt bord-id
// (yoko/pnp/nederland/vlaanderen/dienjaar) of de echte snapshot-tabel.
import { useEffect, useState } from 'react'
import type { BoardItem } from '@/lib/boards'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { buildDemoBoards, DEMO_BOARD_IDS } from '@/lib/demoFixtures'

type DemoTrigger = 'auto' | 'manual' | 'restore'

type Snapshot = {
  id:         string
  boardId:    string
  snapshotAt: string
  trigger:    DemoTrigger
  sizeBytes:  number
  groupCount: number
  itemCount:  number
}

type DemoTrashItem = {
  id:            string
  name:          string
  boardId:       string
  groupName:     string
  deletedAt:     string
  deletedByName: string
}

type HistoryTab = 'versies' | 'papierbak'

function countGroupsItems(boardId: string): { groups: number; items: number } {
  const groups = buildDemoBoards()[boardId]?.groups ?? []
  const items = groups.reduce((sum, g) => sum + g.items.length, 0)
  return { groups: groups.length, items }
}

function fakeSize(groupCount: number, itemCount: number): number {
  return 900 + itemCount * 420 + groupCount * 90
}

// Verzint een handvol plausibele versies terug in de tijd, per demo-bord —
// item-aantal loopt licht op naar 'nu' toe, zodat de lijst oogt als een
// bord dat geleidelijk gegroeid is (net als de echte dagelijkse archivering).
function buildFakeSnapshots(): Snapshot[] {
  const now = Date.now()
  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  const plan: { offset: number; trigger: DemoTrigger }[] = [
    { offset: 2 * HOUR, trigger: 'auto' },
    { offset: DAY + 3 * HOUR, trigger: 'auto' },
    { offset: 3 * DAY + 6 * HOUR, trigger: 'manual' },
    { offset: 7 * DAY + 4 * HOUR, trigger: 'auto' },
    { offset: 14 * DAY, trigger: 'auto' },
  ]
  const out: Snapshot[] = []
  for (const boardId of DEMO_BOARD_IDS) {
    const base = countGroupsItems(boardId)
    plan.forEach((p, i) => {
      const itemCount = Math.max(0, base.items - i)
      out.push({
        id:         `demo-snap-${boardId}-${i}`,
        boardId,
        snapshotAt: new Date(now - p.offset).toISOString(),
        trigger:    p.trigger,
        sizeBytes:  fakeSize(base.groups, itemCount),
        groupCount: base.groups,
        itemCount,
      })
    })
  }
  return out.sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt))
}

function buildFakeTrash(): DemoTrashItem[] {
  const now = Date.now()
  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  return [
    {
      id:            'demo-trash-1',
      name:          'Oude planning — concept v1',
      boardId:       'De Gouw & Bree',
      groupName:     'Nieuwe aanvragen',
      deletedAt:     new Date(now - 5 * HOUR).toISOString(),
      deletedByName: 'Pikachu',
    },
    {
      id:            'demo-trash-2',
      name:          'Losse aantekening (te verwijderen)',
      boardId:       'Rivendel & Rohan',
      groupName:     'In aanbouw',
      deletedAt:     new Date(now - 2 * DAY).toISOString(),
      deletedByName: 'Pippi',
    },
  ]
}

export default function DemoSnapshotsPage() {
  const [tab, setTab] = useState<HistoryTab>('versies')
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [filterBoard, setFilterBoard] = useState<string>('')

  useEffect(() => {
    setSnapshots(buildFakeSnapshots())
  }, [])

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

  function manualSnapshot(boardId: string) {
    setBusy(`new:${boardId}`)
    window.setTimeout(() => {
      const { groups, items } = countGroupsItems(boardId)
      const snap: Snapshot = {
        id:         `demo-snap-manual-${Date.now()}`,
        boardId,
        snapshotAt: new Date().toISOString(),
        trigger:    'manual',
        sizeBytes:  fakeSize(groups, items),
        groupCount: groups,
        itemCount:  items,
      }
      setSnapshots(current => [snap, ...current])
      setBusy(null)
    }, 250)
  }

  function restore(snap: Snapshot) {
    if (!window.confirm(
      `Bord '${snap.boardId}' terugzetten naar de versie van ${formatDate(snap.snapshotAt)}?\n\n` +
      `De huidige (demo-)state wordt eerst zelf als versie bewaard, dus deze actie is ook weer terug te draaien.`,
    )) return
    setBusy(snap.id)
    window.setTimeout(() => {
      const seed = buildDemoBoards()[snap.boardId]?.groups ?? []
      saveGroups(snap.boardId, seed)
      const { groups, items } = countGroupsItems(snap.boardId)
      const restoreSnap: Snapshot = {
        id:         `demo-snap-restore-${Date.now()}`,
        boardId:    snap.boardId,
        snapshotAt: new Date().toISOString(),
        trigger:    'restore',
        sizeBytes:  fakeSize(groups, items),
        groupCount: groups,
        itemCount:  items,
      }
      setSnapshots(current => [restoreSnap, ...current])
      setBusy(null)
      window.alert(`Hersteld: ${groups} groepen en ${items} items op bord '${snap.boardId}'.`)
    }, 250)
  }

  const visible = filterBoard ? snapshots.filter(s => s.boardId === filterBoard) : snapshots

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
            {DEMO_BOARD_IDS.map(b => (
              <button key={b} onClick={() => setFilterBoard(b)} style={pillStyle(filterBoard === b)}>{b}</button>
            ))}
            <div style={{ flex: 1 }} />
            {DEMO_BOARD_IDS.map(b => (
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

          {visible.length === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>Nog geen versies gevonden. Klik &apos;📸 Versie van &lt;bord&gt;&apos; om er handmatig één te maken.</p>
          )}

          {visible.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1.6fr 1fr 1fr 1fr 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                <span>Bord</span>
                <span>Datum</span>
                <span>Trigger</span>
                <span>Groepen / Items</span>
                <span>Grootte</span>
                <span></span>
              </div>
              {visible.map(s => (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '140px 1.6fr 1fr 1fr 1fr 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{s.boardId}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{formatDate(s.snapshotAt)}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.trigger}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.groupCount} / {s.itemCount}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{formatBytes(s.sizeBytes)}</span>
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
  const [items, setItems] = useState<DemoTrashItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setItems(buildFakeTrash())
  }, [])

  function onRestore(trashItem: DemoTrashItem) {
    setBusy(trashItem.id)
    window.setTimeout(() => {
      const seed = buildDemoBoards()[trashItem.boardId]?.groups ?? []
      const groups = loadGroups(trashItem.boardId, seed)
      const targetGroup = groups.find(g => g.name === trashItem.groupName) ?? groups[0]
      if (targetGroup) {
        const restored: BoardItem = {
          id: `demo-restored-${Date.now()}`,
          name: trashItem.name,
          ownerIds: [],
          status: 'Not started',
          startDate: null,
          endDate: null,
          deadline: null,
          estHours: 0,
          dagen: 0,
        }
        const next = groups.map(g => g.id === targetGroup.id ? { ...g, items: [...g.items, restored] } : g)
        saveGroups(trashItem.boardId, next)
      }
      setItems(current => current.filter(candidate => candidate.id !== trashItem.id))
      setBusy(null)
    }, 250)
  }

  function onPurge(trashItem: DemoTrashItem) {
    if (!window.confirm(`'${trashItem.name}' definitief verwijderen uit de (demo-)papierbak?\n\nDit kan niet ongedaan gemaakt worden.`)) return
    setBusy(trashItem.id)
    window.setTimeout(() => {
      setItems(current => current.filter(candidate => candidate.id !== trashItem.id))
      setBusy(null)
    }, 250)
  }

  function restoreRecent() {
    if (items.length === 0) return
    if (!window.confirm('Herstel ALLES dat in de (demo-)papierbak zit?')) return
    setBusy('recent')
    window.setTimeout(() => {
      for (const trashItem of items) {
        const seed = buildDemoBoards()[trashItem.boardId]?.groups ?? []
        const groups = loadGroups(trashItem.boardId, seed)
        const targetGroup = groups.find(g => g.name === trashItem.groupName) ?? groups[0]
        if (!targetGroup) continue
        const restored: BoardItem = {
          id: `demo-restored-${Date.now()}-${trashItem.id}`,
          name: trashItem.name,
          ownerIds: [],
          status: 'Not started',
          startDate: null,
          endDate: null,
          deadline: null,
          estHours: 0,
          dagen: 0,
        }
        const next = groups.map(g => g.id === targetGroup.id ? { ...g, items: [...g.items, restored] } : g)
        saveGroups(trashItem.boardId, next)
      }
      window.alert(`${items.length} item(s) hersteld. Open het bord om ze weer te zien.`)
      setItems([])
      setBusy(null)
    }, 250)
  }

  return (
    <>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px', lineHeight: 1.5, maxWidth: 700 }}>
        Hier staan items die uit de borden verwijderd zijn. Verwijderingen via de UI of een sync zijn
        soft-delete: herstel zet een item terug op het oorspronkelijke bord en in de oorspronkelijke groep.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button
          onClick={restoreRecent}
          disabled={busy === 'recent' || items.length === 0}
          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent-light)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: (busy === 'recent' || items.length === 0) ? 'wait' : 'pointer' }}
        >
          ⚡ Herstel alles
        </button>
      </div>

      {items.length === 0 && (
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
            {items.map(trashItem => (
              <div key={trashItem.id} style={{ display: 'grid', gridTemplateColumns: '2fr 100px 1fr 1fr 1fr 90px 90px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{trashItem.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{trashItem.boardId}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{trashItem.groupName ?? '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(trashItem.deletedAt, false)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{trashItem.deletedByName ?? '—'}</span>
                <button onClick={() => onRestore(trashItem)} disabled={busy === trashItem.id}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: busy === trashItem.id ? 'wait' : 'pointer' }}>
                  Herstel
                </button>
                <button onClick={() => onPurge(trashItem)} disabled={busy === trashItem.id}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red, #C9483D)', fontSize: 12, fontWeight: 600, cursor: busy === trashItem.id ? 'wait' : 'pointer' }}>
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
