// POST /api/snapshots/merge-missing-subitems  { boardId }
//
// Recovery-endpoint voor 'mijn Done-subitems zijn weg'. In tegenstelling tot
// een volledige restore (die de hele bord-state terugzet naar een momentopname)
// kijkt deze endpoint per item welke SUBITEMS in een eerdere snapshot zaten
// die NU missen, en haalt die er weer bij. Recente top-level-wijzigingen
// blijven dus behouden.
//
// Strategie:
//   1. Lees de snapshots tot en met het gekozen herstelmoment. Eén momentopname
//      is onvoldoende voor terugkerende meetings: augustus kan in de nieuwste
//      snapshot staan terwijl september al eerder uit die reeks verdwenen is.
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
  sourceItemId?: string
  name?: string
  status?: string
  startDate?: string | null
  endDate?: string | null
  startTime?: string | null
  externalLink?: string | null
  [k: string]: unknown
}

type ItemRow = Record<string, unknown> & {
  id: string
  board_id: string
  subitems?: SubItem[] | null
  extra?: Record<string, unknown> | null
}

function subIdentity(sub: SubItem): string {
  if (sub.sourceItemId) return `source:${sub.sourceItemId}`
  if (sub.externalLink) return `link:${sub.externalLink}`
  return `date:${sub.startDate ?? sub.endDate ?? ''}:${sub.startTime ?? ''}:${String(sub.name ?? '').trim().toLocaleLowerCase('nl-NL')}`
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

  // 1. Snapshotgeschiedenis zoeken. Nieuwste eerst, zodat bij eenzelfde
  // occurrence de meest recente opgeslagen variant (uren/status) wint.
  const sinceIso = body.since
    ? new Date(body.since).toISOString()
    : new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data: snaps, error: snapErr } = await supabaseAdmin
    .from('board_snapshots')
    .select('id, snapshot_at, data')
    .eq('board_id', boardId)
    .lte('snapshot_at', sinceIso)
    .order('snapshot_at', { ascending: false })
    .limit(100)
  if (snapErr) return Response.json({ ok: false, error: snapErr.message }, { status: 500 })
  if (!snaps || snaps.length === 0) {
    return Response.json({ ok: false, error: 'no_snapshot_before_cutoff' }, { status: 404 })
  }
  const snapshotRows = snaps as Array<{ id: string; snapshot_at: string; data: { items?: ItemRow[] } }>

  // 2. Huidige items ophalen
  const { data: currentRows, error: curErr } = await supabaseAdmin
    .from('board_items')
    .select('*')
    .eq('board_id', boardId)
    .is('deleted_at', null)
  if (curErr) return Response.json({ ok: false, error: curErr.message }, { status: 500 })
  const currentItems: ItemRow[] = (currentRows ?? []) as ItemRow[]

  // 3. Per current item: subitems uit snapshot mergen die nu missen.
  const historyByItemId = new Map<string, SubItem[]>()
  const historyIdentityByItemId = new Map<string, Set<string>>()
  for (const snapshot of snapshotRows) {
    const snapshotItems = Array.isArray(snapshot.data?.items) ? snapshot.data.items : []
    for (const item of snapshotItems) {
      if (!item?.id || !Array.isArray(item.subitems)) continue
      const identities = historyIdentityByItemId.get(item.id) ?? new Set<string>()
      const collected = historyByItemId.get(item.id) ?? []
      for (const sub of item.subitems) {
        if (!sub?.id) continue
        const key = subIdentity(sub)
        if (identities.has(key)) continue
        identities.add(key)
        collected.push(sub)
      }
      historyIdentityByItemId.set(item.id, identities)
      historyByItemId.set(item.id, collected)
    }
  }

  const toUpsert: ItemRow[] = []
  let restoredSubCount = 0
  let touchedItemCount = 0

  for (const cur of currentItems) {
    const snapSubs = historyByItemId.get(cur.id) ?? []
    if (snapSubs.length === 0) continue
    const curSubs = Array.isArray(cur.subitems) ? cur.subitems! : []
    const currentIdentities = new Set(curSubs.map(subIdentity))
    const dismissed = new Set(
      Array.isArray(cur.extra?.dismissedInstanceIds)
        ? cur.extra!.dismissedInstanceIds.filter((id): id is string => typeof id === 'string')
        : [],
    )
    const missing = snapSubs.filter(sub => {
      if (!sub?.id || dismissed.has(sub.id) || (sub.sourceItemId && dismissed.has(sub.sourceItemId))) return false
      return !currentIdentities.has(subIdentity(sub))
    })
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
    return Response.json({ ok: true, status: 'nothing_to_restore', scannedSnapshots: snapshotRows.length, usedSnapshot: snapshotRows[0].snapshot_at, touchedItems: 0, restoredSubs: 0 })
  }

  // Pre-restore snapshot zodat deze actie ook omkeerbaar is via
  // /geschiedenis → de gegenereerde 'restore'-snapshot. Snapshotten
  // alleen wanneer er ook echt wat verandert (toUpsert > 0).
  const { data: curGroupsForSnap } = await supabaseAdmin
    .from('board_groups').select('*').eq('board_id', boardId).is('deleted_at', null)
  await supabaseAdmin.from('board_snapshots').insert({
    board_id:  boardId,
    trigger:   'restore',
    data:      { groups: curGroupsForSnap ?? [], items: currentItems, capturedAt: new Date().toISOString() },
    size_bytes: JSON.stringify({ groups: curGroupsForSnap, items: currentItems }).length,
  })

  const { error: upErr } = await supabaseAdmin
    .from('board_items')
    .upsert(toUpsert, { onConflict: 'id' })
  if (upErr) return Response.json({ ok: false, error: upErr.message }, { status: 500 })

  return Response.json({
    ok: true,
    usedSnapshot:   snapshotRows[0].snapshot_at,
    scannedSnapshots: snapshotRows.length,
    touchedItems:   touchedItemCount,
    restoredSubs:   restoredSubCount,
  })
}
