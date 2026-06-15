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

type Snapshot = {
  id:          string
  snapshot_at: string
  trigger:     'auto' | 'manual' | 'restore'
  size_bytes:  number | null
  groupCount?: number
  itemCount?:  number
  subCount?:   number
}

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

export function BoardRecoveryDrawer({ boardId, boardTitle, open, onClose }: {
  boardId:    string
  boardTitle: string
  open:       boolean
  onClose:    () => void
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState<string | null>(null)
  const [msg, setMsg]             = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

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

  async function herstel(snap: Snapshot) {
    if (!supabase) return
    if (!window.confirm(
      `Verdwenen subitems herstellen uit de versie van ${fmtDate(snap.snapshot_at)}?\n\n` +
      `Top-level fields op huidige items blijven zoals ze nu zijn. Alleen subs die in ` +
      `deze versie zaten maar nu missen worden teruggeplaatst.`,
    )) return
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return }
    setBusy(snap.id); setMsg(null)
    try {
      const res = await fetch('/api/snapshots/merge-missing-subitems', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, since: snap.snapshot_at }),
      })
      const json = await res.json() as { ok: boolean; error?: string; touchedItems?: number; restoredSubs?: number; status?: string }
      if (!json.ok) { setMsg(`Recovery mislukt: ${json.error ?? 'onbekend'}`); return }
      await pullBoardFromRemote(boardId).catch(() => {})
      if (json.status === 'nothing_to_restore') {
        setMsg(`Niets terug te halen uit deze versie — alle subs staan al op de huidige items.`)
      } else {
        setMsg(`✓ Hersteld: ${json.restoredSubs ?? 0} subitem(s) op ${json.touchedItems ?? 0} item(s).`)
      }
    } finally {
      setBusy(null)
    }
  }

  async function herstelEst(snap: Snapshot) {
    if (!supabase) return
    if (!window.confirm(
      `Est-uren terugzetten op alle items/subitems vanuit ${fmtDate(snap.snapshot_at)}?\n\n` +
      `Alleen est_hours wordt overschreven — naam, status, owners, datums blijven ongemoeid. ` +
      `Bedoeld voor het terugdraaien van de oude 'autofill werkdagen × 8'-inflatie.`,
    )) return
    const sess = await supabase.auth.getSession()
    const token = sess.data.session?.access_token
    if (!token) { window.alert('Niet ingelogd.'); return }
    setBusy(snap.id); setMsg(null)
    try {
      const res = await fetch('/api/snapshots/restore-est', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, since: snap.snapshot_at }),
      })
      const json = await res.json() as { ok: boolean; error?: string; touchedItems?: number; changedItemEst?: number; changedSubEst?: number; status?: string }
      if (!json.ok) { setMsg(`Est-rollback mislukt: ${json.error ?? 'onbekend'}`); return }
      await pullBoardFromRemote(boardId).catch(() => {})
      if (json.status === 'nothing_to_restore') {
        setMsg(`Niets te wijzigen — est-uren staan al gelijk aan deze snapshot.`)
      } else {
        setMsg(`✓ Est-uren teruggezet: ${json.changedItemEst ?? 0} items + ${json.changedSubEst ?? 0} subs op ${json.touchedItems ?? 0} rijen.`)
      }
    } finally {
      setBusy(null)
    }
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
          Kies een versie om verdwenen subitems uit terug te halen. De huidige top-level fields op je items
          (status, owners, datums, notes) blijven zoals ze zijn — alleen ontbrekende subs worden bijgeplakt.
        </p>
      </div>

      {msg && (
        <div style={{ padding: '10px 18px', background: msg.startsWith('✓') ? 'rgba(0,200,117,0.12)' : 'rgba(226,68,92,0.12)', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-primary)' }}>
          {msg}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Laden…</p>
        ) : snapshots.length === 0 ? (
          <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
            Nog geen snapshots voor dit bord. Auto-snapshots worden dagelijks aangemaakt zodra iemand de app opent.
          </p>
        ) : snapshots.map(s => (
          <div key={s.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 12 }}>
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
            <button onClick={() => herstel(s)} disabled={busy === s.id}
              style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--accent)',
                background: 'var(--accent-light, rgba(88,150,255,0.18))', color: 'var(--text-primary)',
                fontSize: 12, fontWeight: 700, cursor: busy === s.id ? 'wait' : 'pointer', flexShrink: 0 }}>
              {busy === s.id ? 'Bezig…' : 'Herstel subs'}
            </button>
            <button onClick={() => herstelEst(s)} disabled={busy === s.id}
              title="Zet alleen est-uren terug naar de waarden uit deze snapshot. Verandert verder niets."
              style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-secondary)',
                fontSize: 12, fontWeight: 700, cursor: busy === s.id ? 'wait' : 'pointer', flexShrink: 0 }}>
              Herstel uren
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
