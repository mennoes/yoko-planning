// POST /api/snapshots/merge-missing-subitems  { boardId }
//
// Recovery-endpoint voor 'mijn Done-subitems zijn weg'. In tegenstelling tot
// een volledige restore (die de hele bord-state terugzet naar een momentopname)
// kijkt deze endpoint per item welke SUBITEMS in een eerdere snapshot zaten
// die NU missen, en haalt die er weer bij. Recente top-level-wijzigingen
// blijven dus behouden.
//
// Strategie:
//   1. Pak de meest recente snapshot van vóór 'now - 30 min' — dat is laat
//      genoeg om wijzigingen-van-deze-minuut intact te houden maar oud genoeg
//      om de Done-subs voor de Google-sync-wipe te bevatten. Bij twijfel kun
//      je ?since=YYYY-MM-DDTHH:mm meegeven om een specifieke snapshot te pakken.
//   2. Voor elk huidig item: zoek matching item in snapshot. Bouw de unie
//      van subitems (huidige + snapshot, gededupt op id). Wanneer een subitem
//      in beide voorkomt prefereren we de huidige versie (kan recent gewijzigd
//      zijn — bv. naar Done teruggezet).
//   3. Upsert alleen items waar daadwerkelijk subitems bijkwamen.

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SubItem = {
  id?: string
  name?: string
  status?: string
  startDate?: string | null
  endDate?: string | null
  [k: string]: unknown
}

type ItemRow = Record<string, unknown> & {
  id: string
  board_id: string
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

  // 1. Snapshot zoeken — meest recente voor `since` (default: 30 min geleden,
  //    voldoende voor de Google-sync window van 5 min).
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

  // 3. Per current item: subitems uit snapshot mergen die nu missen.
  const snapById = new Map<string, ItemRow>()
  for (const it of snapItems) if (it?.id) snapById.set(it.id, it)

  const toUpsert: ItemRow[] = []
  let restoredSubCount = 0
  let touchedItemCount = 0

  for (const cur of currentItems) {
    const snapMatch = snapById.get(cur.id)
    if (!snapMatch) continue
    const snapSubs = Array.isArray(snapMatch.subitems) ? snapMatch.subitems! : []
    if (snapSubs.length === 0) continue
    const curSubs = Array.isArray(cur.subitems) ? cur.subitems! : []
    const curSubIds = new Set(curSubs.map(s => s?.id).filter(Boolean) as string[])
    const missing = snapSubs.filter(s => s?.id && !curSubIds.has(s.id))
    if (missing.length === 0) continue

    // Sorteer chronologisch zodat de Done-sectie weer netjes onderaan in
    // de UI komt te staan en de actieve subs in de juiste volgorde.
    const merged = [...curSubs, ...missing].sort(
      (a, b) => String(a?.startDate ?? '').localeCompare(String(b?.startDate ?? '')),
    )
    toUpsert.push({ ...cur, subitems: merged })
    restoredSubCount += missing.length
    touchedItemCount += 1
  }

  if (toUpsert.length === 0) {
    return Response.json({ ok: true, status: 'nothing_to_restore', usedSnapshot: snap.snapshot_at, touchedItems: 0, restoredSubs: 0 })
  }

  const { error: upErr } = await supabaseAdmin
    .from('board_items')
    .upsert(toUpsert, { onConflict: 'id' })
  if (upErr) return Response.json({ ok: false, error: upErr.message }, { status: 500 })

  return Response.json({
    ok: true,
    usedSnapshot:   snap.snapshot_at,
    touchedItems:   touchedItemCount,
    restoredSubs:   restoredSubCount,
  })
}
