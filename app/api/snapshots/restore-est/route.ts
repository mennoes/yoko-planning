// POST /api/snapshots/restore-est  { boardId, since? }
//
// Specifieke recovery voor 'est_hours per item/subitem' — herstelt
// alléén het est_hours-veld op items/subitems vanuit een snapshot,
// laat alle andere velden ongemoeid. Bedoeld om de PR #212 autofill-
// inflatie terug te draaien zonder een hele bord-restore.
//
// Strategie:
//   1. Pak de meest recente snapshot van vóór 'since' (default: 30 min
//      geleden, of de gegeven datum).
//   2. Voor elk huidig item: zoek matching item-id in snapshot.
//        - Item est_hours → kopieer van snapshot.
//        - Subitems → match op id; per match kopieer est_hours.
//   3. Upsert alleen items die daadwerkelijk veranderd zijn.

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SubItem = {
  id?: string
  estHours?: number
  [k: string]: unknown
}
type ItemRow = Record<string, unknown> & {
  id: string
  board_id: string
  est_hours?: number | null
  subitems?: SubItem[] | null
}

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7))
  if (userErr || !userData.user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: { boardId?: string; since?: string }
  try { body = await req.json() } catch { return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 }) }
  const boardId = (body.boardId ?? '').trim()
  if (!boardId) return Response.json({ ok: false, error: 'invalid_board_id' }, { status: 400 })

  // 1. Snapshot zoeken — meest recente voor 'since' (default: 30 min geleden)
  const sinceIso = body.since
    ? new Date(body.since).toISOString()
    : new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data: snaps, error: snapErr } = await supabaseAdmin
    .from('board_snapshots')
    .select('id, snapshot_at, data')
    .eq('board_id', boardId)
    .lte('snapshot_at', sinceIso)
    .order('snapshot_at', { ascending: false })
    .limit(1)
  if (snapErr) return Response.json({ ok: false, error: snapErr.message }, { status: 500 })
  if (!snaps || snaps.length === 0) {
    return Response.json({ ok: false, error: 'no_snapshot_before_cutoff' }, { status: 404 })
  }
  const snap = snaps[0] as { id: string; snapshot_at: string; data: { items?: ItemRow[] } }
  const snapItems: ItemRow[] = Array.isArray(snap.data?.items) ? snap.data.items! : []

  // 2. Huidige items ophalen
  const { data: currentRows, error: curErr } = await supabaseAdmin
    .from('board_items')
    .select('*')
    .eq('board_id', boardId)
    .is('deleted_at', null)
  if (curErr) return Response.json({ ok: false, error: curErr.message }, { status: 500 })
  const currentItems: ItemRow[] = (currentRows ?? []) as ItemRow[]

  // 2b. Pre-restore snapshot — vangnet voor 'ik herstelde de verkeerde
  //     est-uren en wil terug naar wat 't net was'. Dezelfde flow als de
  //     volledige restore-endpoint zodat de actie altijd omkeerbaar is.
  const { data: curGroups } = await supabaseAdmin
    .from('board_groups').select('*').eq('board_id', boardId).is('deleted_at', null)
  await supabaseAdmin.from('board_snapshots').insert({
    board_id:  boardId,
    trigger:   'restore',
    data:      { groups: curGroups ?? [], items: currentItems, capturedAt: new Date().toISOString() },
    size_bytes: JSON.stringify({ groups: curGroups, items: currentItems }).length,
  })

  const snapById = new Map<string, ItemRow>()
  for (const it of snapItems) if (it?.id) snapById.set(it.id, it)

  const toUpsert: ItemRow[] = []
  let touchedItems = 0
  let changedItemEst = 0
  let changedSubEst = 0

  // Helper: lees est_hours uit een snapshot-row. Beide kolom-namen
  // gezien (est_hours snake voor DB, estHours camel voor JSON-veld).
  function readItemEst(row: ItemRow): number | null {
    const a = row['est_hours']
    if (typeof a === 'number') return a
    const b = (row as { estHours?: unknown }).estHours
    if (typeof b === 'number') return b
    return null
  }

  for (const cur of currentItems) {
    const snapMatch = snapById.get(cur.id)
    if (!snapMatch) continue

    let changed = false
    const next: ItemRow = { ...cur }

    // Item-level est_hours rollback
    const snapEst = readItemEst(snapMatch)
    const curEst  = readItemEst(cur)
    if (snapEst !== null && snapEst !== curEst) {
      next.est_hours = snapEst
      changed = true
      changedItemEst += 1
    }

    // Subitem-level est rollback (per id-match)
    const curSubs  = Array.isArray(cur.subitems)       ? cur.subitems!       : []
    const snapSubs = Array.isArray(snapMatch.subitems) ? snapMatch.subitems! : []
    if (curSubs.length > 0 && snapSubs.length > 0) {
      const snapSubById = new Map<string, SubItem>()
      for (const s of snapSubs) if (s?.id) snapSubById.set(s.id, s)
      const mergedSubs = curSubs.map(cs => {
        if (!cs?.id) return cs
        const ss = snapSubById.get(cs.id)
        if (!ss) return cs
        const sVal = typeof ss.estHours === 'number' ? ss.estHours : null
        const cVal = typeof cs.estHours === 'number' ? cs.estHours : null
        if (sVal === null || sVal === cVal) return cs
        changedSubEst += 1
        return { ...cs, estHours: sVal }
      })
      // Alleen op next.subitems schrijven wanneer er daadwerkelijk iets
      // verandert in de array — anders forceren we onnodige upserts.
      const anySubChanged = mergedSubs.some((m, i) => m !== curSubs[i])
      if (anySubChanged) {
        next.subitems = mergedSubs
        changed = true
      }
    }

    if (changed) {
      toUpsert.push(next)
      touchedItems += 1
    }
  }

  if (toUpsert.length === 0) {
    return Response.json({ ok: true, status: 'nothing_to_restore', usedSnapshot: snap.snapshot_at, touchedItems: 0, changedItemEst: 0, changedSubEst: 0 })
  }

  const { error: upErr } = await supabaseAdmin
    .from('board_items')
    .upsert(toUpsert, { onConflict: 'id' })
  if (upErr) return Response.json({ ok: false, error: upErr.message }, { status: 500 })

  return Response.json({
    ok: true,
    usedSnapshot:   snap.snapshot_at,
    touchedItems,
    changedItemEst,
    changedSubEst,
  })
}
