import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTeamAdmin } from '@/lib/teamAdminServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SnapshotSub = { id?: string; estHours?: number; source?: string; [key: string]: unknown }
type ItemRow = Record<string, unknown> & {
  id: string
  board_id: string
  est_hours?: number | null
  subitems?: SnapshotSub[] | null
}

function itemTotal(item: ItemRow): number {
  const own = Number(item.est_hours ?? (item as { estHours?: unknown }).estHours) || 0
  const subs = Array.isArray(item.subitems) ? item.subitems : []
  const manualSubs = subs.filter(sub => sub.source !== 'google')
    .reduce((sum, sub) => sum + (Number(sub.estHours) || 0), 0)
  const googleSubs = subs.filter(sub => sub.source === 'google')
    .reduce((sum, sub) => sum + (Number(sub.estHours) || 0), 0)
  const total = item.source === 'google'
    ? manualSubs + googleSubs
    : (manualSubs > 0 ? manualSubs : own) + googleSubs
  return Math.round(total * 10) / 10
}

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })
  const denied = await requireTeamAdmin(req)
  if (denied) return denied

  let body: { boardId?: string; itemId?: string }
  try { body = await req.json() } catch { return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 }) }
  const boardId = (body.boardId ?? '').trim()
  const itemId = (body.itemId ?? '').trim()
  if (!boardId || !itemId) return Response.json({ ok: false, error: 'invalid_target' }, { status: 400 })

  const { data: current, error: currentError } = await supabaseAdmin
    .from('board_items').select('*').eq('board_id', boardId).eq('id', itemId).is('deleted_at', null).single()
  if (currentError || !current) return Response.json({ ok: false, error: 'item_not_found' }, { status: 404 })
  const currentItem = current as ItemRow
  const currentTotal = itemTotal(currentItem)

  const { data: snapshots, error: snapshotError } = await supabaseAdmin
    .from('board_snapshots').select('id, snapshot_at, data')
    .eq('board_id', boardId).order('snapshot_at', { ascending: false }).limit(100)
  if (snapshotError) return Response.json({ ok: false, error: snapshotError.message }, { status: 500 })

  let source: ItemRow | null = null
  let usedSnapshot: string | null = null
  for (const snapshot of snapshots ?? []) {
    const items = Array.isArray(snapshot.data?.items) ? snapshot.data.items as ItemRow[] : []
    const match = items.find(item => item.id === itemId)
    if (match && itemTotal(match) > currentTotal + 0.01) {
      source = match
      usedSnapshot = snapshot.snapshot_at
      break
    }
  }
  if (!source || !usedSnapshot) {
    return Response.json({ ok: false, error: 'no_earlier_hours_found', currentTotal }, { status: 404 })
  }

  const { data: currentGroups } = await supabaseAdmin
    .from('board_groups').select('*').eq('board_id', boardId).is('deleted_at', null)
  const { data: currentItems } = await supabaseAdmin
    .from('board_items').select('*').eq('board_id', boardId).is('deleted_at', null)
  await supabaseAdmin.from('board_snapshots').insert({
    board_id: boardId,
    trigger: 'restore',
    data: { groups: currentGroups ?? [], items: currentItems ?? [], capturedAt: new Date().toISOString() },
    size_bytes: JSON.stringify({ groups: currentGroups, items: currentItems }).length,
  })

  const sourceSubs = new Map((source.subitems ?? []).filter(sub => sub.id).map(sub => [sub.id!, sub]))
  const restoredSubs = (currentItem.subitems ?? []).map(sub => {
    const earlier = sub.id ? sourceSubs.get(sub.id) : undefined
    return earlier && typeof earlier.estHours === 'number'
      ? { ...sub, estHours: earlier.estHours }
      : sub
  })
  const sourceOwn = Number(source.est_hours ?? (source as { estHours?: unknown }).estHours) || 0
  const restored: ItemRow = {
    ...currentItem,
    est_hours: sourceOwn,
    subitems: restoredSubs,
    updated_at: new Date().toISOString(),
  }
  const { error: restoreError } = await supabaseAdmin.from('board_items').upsert(restored, { onConflict: 'id' })
  if (restoreError) return Response.json({ ok: false, error: restoreError.message }, { status: 500 })

  return Response.json({
    ok: true,
    itemId,
    previousTotal: currentTotal,
    restoredTotal: itemTotal(restored),
    usedSnapshot,
  })
}
