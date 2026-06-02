// POST /api/snapshots/restore  { snapshotId }
// Herstelt de bord-state naar de inhoud van de gegeven snapshot.
// Werkwijze:
//  1. Lees de snapshot uit board_snapshots.
//  2. Soft-delete álle huidige groepen + items van dat bord (geen hard
//     DELETE — de gebruiker kan via /trash terug naar de oude state).
//  3. Maak eerst een 'pre-restore' snapshot zodat deze actie ook
//     ongedaan te maken is.
//  4. Upsert groepen + items uit de snapshot terug.

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type GroupRow = {
  id: string; board_id: string; name: string; color: string | null
  collapsed: boolean | null; position: number | null
  deleted_at?: string | null
}
type ItemRow = Record<string, unknown> & { id: string; board_id: string; group_id: string }

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7))
  if (userErr || !userData.user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: { snapshotId?: string }
  try { body = await req.json() } catch { return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 }) }
  const snapshotId = (body.snapshotId ?? '').trim()
  if (!snapshotId) return Response.json({ ok: false, error: 'invalid_id' }, { status: 400 })

  // 1. Snapshot lezen
  const { data: snap, error: snapErr } = await supabaseAdmin
    .from('board_snapshots')
    .select('id, board_id, data, snapshot_at')
    .eq('id', snapshotId)
    .single()
  if (snapErr || !snap) return Response.json({ ok: false, error: 'snapshot_not_found' }, { status: 404 })

  const boardId = (snap as { board_id: string }).board_id
  const payload = (snap as { data: { groups: GroupRow[]; items: ItemRow[] } }).data
  const snapGroups = payload?.groups ?? []
  const snapItems  = payload?.items  ?? []

  // 2. Pre-restore snapshot — vangnet voor "ik herstelde een verkeerde
  //    snapshot en wil terug naar wat er net was".
  const { data: curGroups } = await supabaseAdmin
    .from('board_groups').select('*').eq('board_id', boardId).is('deleted_at', null)
  const { data: curItems }  = await supabaseAdmin
    .from('board_items').select('*').eq('board_id', boardId).is('deleted_at', null)
  await supabaseAdmin.from('board_snapshots').insert({
    board_id:  boardId,
    trigger:   'restore',
    data:      { groups: curGroups ?? [], items: curItems ?? [], capturedAt: new Date().toISOString() },
    size_bytes: JSON.stringify({ groups: curGroups, items: curItems }).length,
  })

  // 3. Soft-delete huidige bord-state.
  const stamp = new Date().toISOString()
  await supabaseAdmin.from('board_items')
    .update({ deleted_at: stamp })
    .eq('board_id', boardId)
    .is('deleted_at', null)
  await supabaseAdmin.from('board_groups')
    .update({ deleted_at: stamp })
    .eq('board_id', boardId)
    .is('deleted_at', null)

  // 4. Upsert snapshot-rijen terug. Snapshot kan rijen bevatten die nu
  //    soft-deleted zijn — die activeren we via deleted_at = null.
  if (snapGroups.length > 0) {
    const groupRows = snapGroups.map(g => ({
      id: g.id, board_id: g.board_id, name: g.name,
      color: g.color ?? '#9aadbd', collapsed: g.collapsed ?? false,
      position: g.position ?? 0, deleted_at: null,
    }))
    await supabaseAdmin.from('board_groups').upsert(groupRows, { onConflict: 'id' })
  }
  if (snapItems.length > 0) {
    const itemRows = snapItems.map(it => ({ ...it, deleted_at: null }))
    await supabaseAdmin.from('board_items').upsert(itemRows, { onConflict: 'id' })
  }

  return Response.json({
    ok: true,
    boardId,
    groupsRestored: snapGroups.length,
    itemsRestored:  snapItems.length,
  })
}
