// POST /api/snapshots/merge-missing-items  { boardId, since? }
//
// Zet uitsluitend hoofditems en groepen terug die in een gekozen snapshot
// bestaan maar in de huidige actieve bord-state ontbreken. Bestaande items
// worden nooit overschreven, zodat recente status-, owner- en datumwijzigingen
// behouden blijven. Ook actieve items onder een verdwenen groep worden weer
// zichtbaar doordat de bijbehorende snapshot-groep wordt gereactiveerd.

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type GroupRow = Record<string, unknown> & {
  id: string
  board_id: string
}

type ItemRow = Record<string, unknown> & {
  id: string
  board_id: string
  group_id: string
}

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) {
    return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })
  }

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7))
  if (userErr || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: { boardId?: string; since?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  const boardId = (body.boardId ?? '').trim()
  if (!boardId) {
    return Response.json({ ok: false, error: 'invalid_board_id' }, { status: 400 })
  }

  const cutoff = body.since ? new Date(body.since) : new Date(Date.now() - 30 * 60 * 1000)
  if (Number.isNaN(cutoff.getTime())) {
    return Response.json({ ok: false, error: 'invalid_since' }, { status: 400 })
  }

  const { data: snapshots, error: snapshotErr } = await supabaseAdmin
    .from('board_snapshots')
    .select('id, snapshot_at, data')
    .eq('board_id', boardId)
    .lte('snapshot_at', cutoff.toISOString())
    .order('snapshot_at', { ascending: false })
    .limit(1)
  if (snapshotErr) {
    return Response.json({ ok: false, error: snapshotErr.message }, { status: 500 })
  }
  if (!snapshots || snapshots.length === 0) {
    return Response.json({ ok: false, error: 'no_snapshot_before_cutoff' }, { status: 404 })
  }

  const snapshot = snapshots[0] as {
    snapshot_at: string
    data?: { groups?: GroupRow[]; items?: ItemRow[] }
  }
  const snapshotGroups = Array.isArray(snapshot.data?.groups) ? snapshot.data.groups : []
  const snapshotItems = Array.isArray(snapshot.data?.items) ? snapshot.data.items : []

  // Lees ook soft-deleted rijen: een ontbrekend item kan nog in de database
  // staan en wordt dan via upsert gereactiveerd in plaats van gedupliceerd.
  const [{ data: allGroups, error: groupsErr }, { data: allItems, error: itemsErr }] = await Promise.all([
    supabaseAdmin.from('board_groups').select('*').eq('board_id', boardId),
    supabaseAdmin.from('board_items').select('*').eq('board_id', boardId),
  ])
  if (groupsErr || itemsErr) {
    return Response.json({ ok: false, error: groupsErr?.message ?? itemsErr?.message }, { status: 500 })
  }

  const currentGroups = (allGroups ?? []) as Array<GroupRow & { deleted_at?: string | null }>
  const currentItems = (allItems ?? []) as Array<ItemRow & { deleted_at?: string | null }>
  const activeGroupIds = new Set(currentGroups.filter(g => !g.deleted_at).map(g => g.id))
  const activeItemIds = new Set(currentItems.filter(i => !i.deleted_at).map(i => i.id))

  const missingItems = snapshotItems.filter(item => !activeItemIds.has(item.id))
  const neededGroupIds = new Set(missingItems.map(item => item.group_id))

  // Actieve, maar onzichtbare items kunnen onder een soft-deleted groep
  // hangen. Herstel ook hun snapshot-groep zonder het item te overschrijven.
  for (const item of currentItems) {
    if (!item.deleted_at && !activeGroupIds.has(item.group_id)) neededGroupIds.add(item.group_id)
  }

  const missingGroups = snapshotGroups.filter(group =>
    neededGroupIds.has(group.id) && !activeGroupIds.has(group.id),
  )

  if (missingItems.length === 0 && missingGroups.length === 0) {
    return Response.json({
      ok: true,
      status: 'nothing_to_restore',
      usedSnapshot: snapshot.snapshot_at,
      restoredItems: 0,
      restoredGroups: 0,
    })
  }

  // Vangnet vóór herstel: de huidige toestand kan via de bestaande volledige
  // restore-flow altijd worden teruggezet.
  const activeGroups = currentGroups.filter(group => !group.deleted_at)
  const activeItems = currentItems.filter(item => !item.deleted_at)
  const beforePayload = {
    groups: activeGroups,
    items: activeItems,
    capturedAt: new Date().toISOString(),
  }
  const { error: backupErr } = await supabaseAdmin.from('board_snapshots').insert({
    board_id: boardId,
    trigger: 'restore',
    data: beforePayload,
    size_bytes: JSON.stringify(beforePayload).length,
  })
  if (backupErr) {
    return Response.json({ ok: false, error: `backup_failed: ${backupErr.message}` }, { status: 500 })
  }

  if (missingGroups.length > 0) {
    const { error } = await supabaseAdmin
      .from('board_groups')
      .upsert(missingGroups.map(group => ({ ...group, board_id: boardId, deleted_at: null })), { onConflict: 'id' })
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (missingItems.length > 0) {
    const { error } = await supabaseAdmin
      .from('board_items')
      .upsert(missingItems.map(item => ({ ...item, board_id: boardId, deleted_at: null })), { onConflict: 'id' })
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({
    ok: true,
    usedSnapshot: snapshot.snapshot_at,
    restoredItems: missingItems.length,
    restoredGroups: missingGroups.length,
  })
}
