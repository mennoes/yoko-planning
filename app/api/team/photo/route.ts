import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isTeamAdmin } from '@/lib/teamAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEAM_PHOTO_PREFIX = '__team_photo__:'

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return Response.json({ error: 'not_configured' }, { status: 500 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userError } = await supabase.auth.getUser(auth.slice(7))
  if (userError || !userData.user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: actor, error: actorError } = await supabaseAdmin.from('profiles')
    .select('member_id').eq('user_id', userData.user.id).maybeSingle()
  if (actorError || !actor?.member_id) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body: { memberId?: unknown; photo?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_body' }, { status: 400 }) }
  const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
  const photo = typeof body.photo === 'string' ? body.photo : null
  if (!memberId || memberId === 'unassigned' || photo === null || photo.length > 750_000 || (photo && !/^data:image\/(jpeg|png|webp);base64,/.test(photo))) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (actor.member_id !== memberId && !isTeamAdmin(actor.member_id)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const metadataId = `${TEAM_PHOTO_PREFIX}${memberId}`
  if (photo) {
    const { error } = await supabaseAdmin.from('team_members_extra').upsert({
      id: metadataId,
      name: 'Profielfoto',
      email: photo,
      weekly_capacity: 0,
      color: '#9aadbd',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    if (error) return Response.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabaseAdmin.from('team_members_extra').delete().eq('id', metadataId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // Houd een bestaand ingelogd profiel gelijk. Voor leden zonder login is
  // de metadata-rij hierboven de gedeelde bron van waarheid.
  const { error: profileError } = await supabaseAdmin.from('profiles').update({ photo: photo || null }).eq('member_id', memberId)
  if (profileError) return Response.json({ error: profileError.message }, { status: 500 })
  return Response.json({ ok: true })
}

