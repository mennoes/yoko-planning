'use client'

// Per-bord snapshot-picker. Toont alle beschikbare snapshots voor dít
// bord met meta (datum, # groepen, # items, trigger) en een Herstel-
// knop per regel. De Herstel-actie roept /api/snapshots/merge-missing-
// subitems aan met de timestamp van de gekozen snapshot — die wordt dan
// de baseline waaruit verdwenen subitems terug op de huidige items
// gemerged worden. Top-level fields (status/owner/datums/notes) blijven
// staan zoals ze nu zijn; alleen ontbrekende subs komen erbij.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { pullBoardFromRemote } from '@/lib/boardStore'
import type { BoardGroup, BoardItem } from '@/lib/boards'
import { AgendaSnapshotPreview, type AgendaSnapshotSummary } from './AgendaSnapshotPreview'

type Snapshot = {
  id:          string
  snapshot_at: string
  trigger:     'auto' | 'manual' | 'restore'
  size_bytes:  number | null
  groupCount?: number
  itemCount?:  number
  subCount?:   number
}
type PreviewMode = 'missing' | 'items' | 'subs' | 'hours' | 'full'
type RecoveryPreview = { snapshot: AgendaSnapshotSummary; mode: PreviewMode }

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1)    return 'net gemaakt'
  if (min < 60)   return `${min}m geleden`
  if (min < 1440) return `${Math.floor(min / 60)}u geleden`
  return `${Math.floor(min / 1440)}d geleden`
}

export function BoardRecoveryDrawer({ boardId, boardTitle, groups, open, onClose }: {
  boardId:    string
  boardTitle: string
  groups:     BoardGroup[]
  open:       boolean
  onClose:    () => void
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState<string | null>(null)
  const [msg, setMsg]             = useState<string | null>(null)
  const [preview, setPreview]     = useState<RecoveryPreview | null>(null)
  const zeroHourItems = groups.flatMap(group => group.items).filter(item => {
    if (!item.subitems?.length) return false
    const manualSubTotal = item.subitems
      .filter(sub => sub.source !== 'google')
      .reduce((sum, sub) => sum + (Number(sub.estHours) || 0), 0)
    const googleSubTotal = item.subitems
      .filter(sub => sub.source === 'google')
      .reduce((sum, sub) => sum + (Number(sub.estHours) || 0), 0)
    const total = item.source === 'google'
      ? manualSubTotal + googleSubTotal
      : (manualSubTotal > 0 ? manualSubTotal : (Number(item.estHours) || 0)) + googleSubTotal
    return total === 0
  })

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !preview) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, preview])

  useEffect(() => {
    if (!open || !supabase) return
    let cancelled = false
    async function refresh() {
      setLoading(true)
      const { data } = await supabase!
        .from('board_snapshots')
        .select('id, snapshot_at, trigger, size_bytes, data')
        .eq('board_id', boardId)
        .order('snapshot_at', { ascending: false })
        .limit(100)
      if (cancelled) return
      type Row = Snapshot & { data: { groups?: unknown[]; items?: Array<{ subitems?: unknown[] }> } }
      const rows = (data ?? []) as Row[]
      setSnapshots(rows.map(r => {
        const items = r.data?.items ?? []
        const subTotal = items.reduce((s, it) => s + (Array.isArray(it?.subitems) ? it.subitems!.length : 0), 0)
        return {
          id: r.id, snapshot_at: r.snapshot_at, trigger: r.trigger, size_bytes: r.size_bytes,
          groupCount: r.data?.groups?.length ?? 0,
          itemCount:  items.length,
          subCount:   subTotal,
        }
      }))
      setLoading(false)
    }
    refresh()
    return () => { cancelled = true }
  }, [open, boardId])

  async function herstel(snap: Snapshot): Promise<boolean> {
    if (!supabase) return false
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return false }
    setBusy(snap.id); setMsg(null)
    try {
      const res = await fetch('/api/snapshots/merge-missing-subitems', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, since: snap.snapshot_at }),
      })
      const json = await res.json() as { ok: boolean; error?: string; touchedItems?: number; restoredSubs?: number; status?: string }
      if (!json.ok) { setMsg(`Recovery mislukt: ${json.error ?? 'onbekend'}`); return false }
      await pullBoardFromRemote(boardId).catch(() => {})
      if (json.status === 'nothing_to_restore') {
        setMsg(`Niets terug te halen uit deze versie — alle subs staan al op de huidige items.`)
      } else {
        setMsg(`✓ Hersteld: ${json.restoredSubs ?? 0} subitem(s) op ${json.touchedItems ?? 0} item(s).`)
      }
      return true
    } finally {
      setBusy(null)
    }
  }

  async function herstelOntbrekendeAfspraken(confirmed = false): Promise<boolean> {
    if (!supabase) return false
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return false }
    setBusy('history-scan'); setMsg(null)
    try {
      if (!confirmed) {
        const previewRes = await fetch('/api/snapshots/merge-missing-subitems', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ boardId, dryRun: true }),
        })
        const result = await previewRes.json() as { ok: boolean; error?: string; touchedItems?: number; restoredSubs?: number; status?: string; usedSnapshotId?: string; usedSnapshot?: string }
        if (!result.ok) { setMsg(`Controle mislukt: ${result.error ?? 'onbekend'}`); return false }
        if (result.status === 'nothing_to_restore' || !result.restoredSubs) {
          setMsg('Geen ontbrekende afspraken gevonden. Er is niets gewijzigd.')
          return false
        }
        if (!result.usedSnapshotId || !result.usedSnapshot) {
          setMsg('Voorbeeld kon niet worden opgebouwd; er is niets gewijzigd.')
          return false
        }
        setMsg(`${result.restoredSubs} ontbrekende afspraak/afspraken gevonden op ${result.touchedItems ?? 0} item(s). Bekijk eerst de gebruikte versie.`)
        setPreview({
          mode: 'missing',
          snapshot: { id: result.usedSnapshotId, board_id: boardId, snapshot_at: result.usedSnapshot, trigger: 'auto' },
        })
        return false
      }
      const res = await fetch('/api/snapshots/merge-missing-subitems', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId }),
      })
      const json = await res.json() as {
        ok: boolean
        error?: string
        touchedItems?: number
        restoredSubs?: number
        scannedSnapshots?: number
        status?: string
      }
      if (!json.ok) { setMsg(`Afspraken herstellen mislukt: ${json.error ?? 'onbekend'}`); return false }
      await pullBoardFromRemote(boardId).catch(() => {})
      if (json.status === 'nothing_to_restore') {
        setMsg(`Geen ontbrekende afspraken gevonden in ${json.scannedSnapshots ?? 0} eerdere versies.`)
      } else {
        setMsg(`✓ ${json.restoredSubs ?? 0} afspraak/afspraken hersteld op ${json.touchedItems ?? 0} item(s).`)
      }
      return true
    } finally {
      setBusy(null)
    }
  }

  async function herstelEst(snap: Snapshot): Promise<boolean> {
    if (!supabase) return false
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return false }
    setBusy(snap.id); setMsg(null)
    try {
      const res = await fetch('/api/snapshots/restore-est', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, since: snap.snapshot_at }),
      })
      const json = await res.json() as { ok: boolean; error?: string; touchedItems?: number; changedItemEst?: number; changedSubEst?: number; status?: string }
      if (!json.ok) { setMsg(`Est-rollback mislukt: ${json.error ?? 'onbekend'}`); return false }
      await pullBoardFromRemote(boardId).catch(() => {})
      if (json.status === 'nothing_to_restore') {
        setMsg(`Niets te wijzigen — est-uren staan al gelijk aan deze snapshot.`)
      } else {
        setMsg(`✓ Est-uren teruggezet: ${json.changedItemEst ?? 0} items + ${json.changedSubEst ?? 0} subs op ${json.touchedItems ?? 0} rijen.`)
      }
      return true
    } finally {
      setBusy(null)
    }
  }

  async function volledigTerugzetten(snap: Snapshot): Promise<boolean> {
    if (!supabase) return false
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return false }
    setBusy(`full:${snap.id}`); setMsg(null)
    try {
      const res = await fetch('/api/snapshots/restore', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: snap.id }),
      })
      const json = await res.json() as { ok: boolean; error?: string; groupsRestored?: number; itemsRestored?: number }
      if (!json.ok) { setMsg(`Volledige restore mislukt: ${json.error ?? 'onbekend'}`); return false }
      await pullBoardFromRemote(boardId).catch(() => {})
      setMsg(`✓ Bord teruggezet: ${json.groupsRestored ?? 0} groepen en ${json.itemsRestored ?? 0} items.`)
      return true
    } finally {
      setBusy(null)
    }
  }

  async function laatsteRecoveryTerugdraaien() {
    const snap = snapshots.find(snapshot => snapshot.trigger === 'restore')
    if (!snap) { setMsg('Geen eerdere herstelactie gevonden om terug te draaien.'); return }
    setPreview({ mode: 'full', snapshot: summaryFor(snap) })
  }

  async function herstelItemUren(item: BoardItem) {
    if (!supabase) return
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return }
    setBusy(`item:${item.id}`); setMsg(null)
    try {
      const res = await fetch('/api/snapshots/restore-item-est', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, itemId: item.id }),
      })
      const json = await res.json() as {
        ok: boolean; error?: string; restoredTotal?: number; previousTotal?: number; usedSnapshot?: string
      }
      if (!json.ok) {
        setMsg(json.error === 'no_earlier_hours_found'
          ? `Geen eerdere versie met uren gevonden voor '${item.name}'.`
          : `Uren herstellen mislukt: ${json.error ?? 'onbekend'}`)
        return
      }
      await pullBoardFromRemote(boardId).catch(() => {})
      setMsg(`✓ '${item.name}' hersteld: ${json.previousTotal ?? 0}u → ${json.restoredTotal ?? 0}u uit ${fmtDate(json.usedSnapshot ?? '')}.`)
    } finally {
      setBusy(null)
    }
  }

  async function herstelItems(snap: Snapshot): Promise<boolean> {
    if (!supabase) return false
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return false }
    setBusy(snap.id); setMsg(null)
    try {
      const res = await fetch('/api/snapshots/merge-missing-items', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, since: snap.snapshot_at }),
      })
      const json = await res.json() as { ok: boolean; error?: string; restoredItems?: number; restoredGroups?: number; status?: string }
      if (!json.ok) { setMsg(`Item-recovery mislukt: ${json.error ?? 'onbekend'}`); return false }
      await pullBoardFromRemote(boardId).catch(() => {})
      if (json.status === 'nothing_to_restore') {
        setMsg('Geen ontbrekende hoofditems of groepen gevonden in deze versie.')
      } else {
        setMsg(`✓ Hersteld: ${json.restoredItems ?? 0} hoofditem(s) en ${json.restoredGroups ?? 0} groep(en).`)
      }
      return true
    } finally {
      setBusy(null)
    }
  }

  function summaryFor(snap: Snapshot): AgendaSnapshotSummary {
    return { id: snap.id, board_id: boardId, snapshot_at: snap.snapshot_at, trigger: snap.trigger }
  }

  async function applyPreviewAction(snapshot: AgendaSnapshotSummary): Promise<boolean> {
    if (!preview) return false
    if (preview.mode === 'missing') return herstelOntbrekendeAfspraken(true)
    const source = snapshots.find(item => item.id === snapshot.id)
    if (!source) { setMsg('Deze versie is niet meer beschikbaar.'); return false }
    if (preview.mode === 'items') return herstelItems(source)
    if (preview.mode === 'subs') return herstel(source)
    if (preview.mode === 'hours') return herstelEst(source)
    return volledigTerugzetten(source)
  }

  function previewLabel(mode: PreviewMode): string {
    if (mode === 'missing') return 'Voeg ontbrekende afspraken toe'
    if (mode === 'items') return 'Herstel ontbrekende items'
    if (mode === 'subs') return 'Herstel ontbrekende subitems'
    if (mode === 'hours') return 'Zet uren terug naar deze versie'
    return 'Zet volledige agenda terug'
  }

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 'min(560px, 100vw)', zIndex: 9001,
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
            <h2 style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>↩︎ Recovery</h2>
          </div>
          <button onClick={onClose} title="Sluiten (Esc)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Kies een versie om verdwenen hoofditems, groepen of subitems terug te halen. Bestaande items en
          recente wijzigingen blijven staan; Recovery voegt uitsluitend ontbrekende gegevens toe.
        </p>
        <button
          onClick={() => void herstelOntbrekendeAfspraken()}
          disabled={busy !== null || loading}
          style={{
            marginTop: 10, width: '100%', padding: '9px 12px', borderRadius: 7,
            border: 'none', background: 'var(--accent)', color: '#172033',
            fontSize: 12.5, fontWeight: 800, cursor: busy || loading ? 'wait' : 'pointer',
          }}
        >
          {busy === 'history-scan' ? 'Eerdere versies controleren…' : 'Zoek en herstel ontbrekende afspraken'}
        </button>
        <button onClick={() => void laatsteRecoveryTerugdraaien()} disabled={busy !== null}
          style={{ marginTop: 6, width: '100%', padding: '7px 12px', borderRadius: 7,
            border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)',
            fontSize: 11.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
          {busy === 'revert-latest' ? 'Terugdraaien…' : 'Laatste herstelactie terugdraaien'}
        </button>
      </div>

      {msg && (
        <div style={{ padding: '10px 18px', background: msg.startsWith('✓') ? 'rgba(0,200,117,0.12)' : 'rgba(226,68,92,0.12)', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-primary)' }}>
          {msg}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {zeroHourItems.length > 0 && (
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'rgba(226,68,92,0.07)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
              Mogelijk onbedoeld gewiste uren
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 10 }}>
              Alleen dit item wordt hersteld uit de nieuwste eerdere versie waarin het wél uren had. Andere items en velden blijven exact staan.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {zeroHourItems.map(item => (
                <button key={item.id} onClick={() => void herstelItemUren(item)} disabled={busy !== null}
                  style={{ padding: '7px 11px', borderRadius: 7, border: '1px solid var(--red)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 750, cursor: busy ? 'wait' : 'pointer' }}>
                  {busy === `item:${item.id}` ? 'Herstellen…' : `↩ Herstel uren · ${item.name}`}
                </button>
              ))}
            </div>
          </div>
        )}
        {loading ? (
          <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Laden…</p>
        ) : snapshots.length === 0 ? (
          <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
            Nog geen snapshots voor dit bord. Auto-snapshots worden dagelijks aangemaakt zodra iemand de app opent.
          </p>
        ) : snapshots.map(s => (
          <div key={s.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 700 }}>
                {fmtDate(s.snapshot_at)}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>· {relativeAge(s.snapshot_at)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                {s.trigger === 'manual' ? '📸 handmatig' : s.trigger === 'restore' ? '⤺ pre-restore' : 'auto'}
                {' · '}{s.groupCount ?? 0} groepen · {s.itemCount ?? 0} items · {s.subCount ?? 0} subs
              </div>
            </div>
            <button onClick={() => setPreview({ mode: 'items', snapshot: summaryFor(s) })} disabled={busy === s.id}
              title="Zet alleen ontbrekende hoofditems en groepen terug; bestaande items veranderen niet."
              style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--accent)',
                background: 'var(--accent-light, rgba(88,150,255,0.18))', color: 'var(--text-primary)',
                fontSize: 12, fontWeight: 700, cursor: busy === s.id ? 'wait' : 'pointer', flexShrink: 0 }}>
              {busy === s.id ? 'Bezig…' : 'Bekijk · items'}
            </button>
            <button onClick={() => setPreview({ mode: 'subs', snapshot: summaryFor(s) })} disabled={busy === s.id}
              style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--accent)',
                background: 'var(--accent-light, rgba(88,150,255,0.18))', color: 'var(--text-primary)',
                fontSize: 12, fontWeight: 700, cursor: busy === s.id ? 'wait' : 'pointer', flexShrink: 0 }}>
              {busy === s.id ? 'Bezig…' : 'Bekijk · subs'}
            </button>
            <button onClick={() => setPreview({ mode: 'hours', snapshot: summaryFor(s) })} disabled={busy === s.id}
              title="Zet alleen est-uren terug naar de waarden uit deze snapshot. Verandert verder niets."
              style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-secondary)',
                fontSize: 12, fontWeight: 700, cursor: busy === s.id ? 'wait' : 'pointer', flexShrink: 0 }}>
              Bekijk · uren
            </button>
            {s.trigger === 'restore' && (
              <button onClick={() => setPreview({ mode: 'full', snapshot: summaryFor(s) })} disabled={busy !== null}
                title="Zet het volledige bord terug naar deze automatisch gemaakte pre-restoreversie."
                style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--red)',
                  background: 'transparent', color: 'var(--red)', fontSize: 12, fontWeight: 700,
                  cursor: busy ? 'wait' : 'pointer', flexShrink: 0 }}>
                {busy === `full:${s.id}` ? 'Terugzetten…' : 'Bekijk · terugdraaien'}
              </button>
            )}
          </div>
        ))}
      </div>
      {preview && <AgendaSnapshotPreview
        snapshot={preview.snapshot}
        onClose={() => setPreview(null)}
        onRestore={applyPreviewAction}
        actionLabel={previewLabel(preview.mode)}
        eyebrow="Controleer eerst deze alleen-lezen versie"
      />}
    </div>,
    document.body,
  )
}
