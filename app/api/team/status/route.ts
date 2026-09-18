// Beveiligde statuswijziging voor teamleden. De team-admin UI gebruikt deze
// route zodat de expliciete actief/inactief-status niet afhankelijk is van
// client-RLS en daardoor stil kan terugvallen.

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isTeamAdmin } from '@/lib/teamAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const { data: actor, error: actorError } = await supabaseAdmin.from('profiles')
    .select('member_id').eq('user_id', userData.user.id).maybeSingle()
  if (actorError || !isTeamAdmin(actor?.member_id)) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let body: { id?: string; inactive?: boolean }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  const id = (body.id ?? '').trim()
  if (!id || typeof body.inactive !== 'boolean') {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (id === 'unassigned') {
    return Response.json({ ok: false, error: 'cannot_change_unassigned' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('team_members')
    .update({ inactive: body.inactive })
    .eq('id', id)
    .select('id, inactive')
    .maybeSingle()

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return Response.json({ ok: false, error: 'member_not_found' }, { status: 404 })
  }

  return Response.json({ ok: true, member: data })
}
