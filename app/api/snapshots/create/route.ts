// POST /api/snapshots/create  { boardId }
// Schrijft een snapshot van de huidige bord-state weg naar board_snapshots.
// Idempotent voor 'auto'-trigger: als er vandaag al een auto-snapshot voor
// dit bord bestaat doet 't niks. Voor 'manual' altijd door.

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7))
  if (userErr || !userData.user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: { boardId?: string; trigger?: 'auto' | 'manual' }
  try { body = await req.json() } catch { return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 }) }
  const boardId = (body.boardId ?? '').trim()
  if (!boardId) return Response.json({ ok: false, error: 'invalid_board_id' }, { status: 400 })
  const trigger = body.trigger === 'manual' ? 'manual' : 'auto'

  // Idempotent voor auto: skip als er deze week al een snapshot bestaat.
  // Was daily — wekelijks is 7× minder storage en blijft een ruim
  // recovery-net voor 'oeps, ik heb iets per ongeluk weggegooid'.
  if (trigger === 'auto') {
    const startOfWeek = new Date()
    startOfWeek.setHours(0, 0, 0, 0)
    const dow = (startOfWeek.getDay() + 6) % 7  // ma=0
    startOfWeek.setDate(startOfWeek.getDate() - dow)
    const { data: existing } = await supabaseAdmin
      .from('board_snapshots')
      .select('id')
      .eq('board_id', boardId)
      .gte('snapshot_at', startOfWeek.toISOString())
      .limit(1)
    if (existing && existing.length > 0) {
      return Response.json({ ok: true, status: 'already_exists' })
    }
  }

  // Live bord-state ophalen — alleen niet-deleted rijen, identiek aan
  // pullBoardFromRemote zodat de snapshot precies dezelfde wereld vangt
  // als wat de user op het bord ziet.
  const { data: groupRows } = await supabaseAdmin
    .from('board_groups').select('*').eq('board_id', boardId).is('deleted_at', null).order('position')
  const { data: itemRows }  = await supabaseAdmin
    .from('board_items').select('*').eq('board_id', boardId).is('deleted_at', null).order('position')

  if (!groupRows || !itemRows) {
    return Response.json({ ok: false, error: 'pull_failed' }, { status: 500 })
  }

  // Sla rijen op zoals ze zijn — bij restore reconstrueren we de borden
  // via dezelfde shape die rowToItem/itemToRow gebruiken.
  const payload = {
    groups: groupRows,
    items:  itemRows,
    capturedAt: new Date().toISOString(),
  }
  const dataStr = JSON.stringify(payload)
  const { data, error } = await supabaseAdmin
    .from('board_snapshots')
    .insert({
      board_id:   boardId,
      trigger,
      data:       payload,
      size_bytes: dataStr.length,
    })
    .select('id, snapshot_at')
    .single()
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  return Response.json({ ok: true, status: 'created', id: data?.id, snapshot_at: data?.snapshot_at })
}
