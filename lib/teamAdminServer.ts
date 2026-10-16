import 'server-only'

import type { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isTeamAdmin } from '@/lib/teamAdmin'

/**
 * Server-side authorization guard for routes that use the Supabase service
 * role or can mutate data belonging to the whole team.
 *
 * Returning a Response keeps every route from subtly implementing a
 * different (and potentially weaker) version of the same check.
 */
export async function requireTeamAdmin(req: NextRequest): Promise<Response | null> {
  if (!supabase || !supabaseAdmin) {
    return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })
  }

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(auth.slice(7))
  if (userError || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: actor, error: actorError } = await supabaseAdmin
    .from('profiles')
    .select('member_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (actorError || !isTeamAdmin(actor?.member_id)) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  return null
}
