// Server-route die een team-lid verwijdert uit team_members EN optioneel
// het Supabase auth-account opruimt zodat een schone re-invite mogelijk
// is. Vereist Bearer-token van een ingelogde gebruiker — geen anon
// access.
//
// POST { id, email?, deleteAuth? } → { ok, removedAuth }

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

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

  let body: { id?: string; email?: string; deleteAuth?: boolean }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const id = (body.id ?? '').trim()
  if (!id) return Response.json({ ok: false, error: 'invalid_id' }, { status: 400 })
  if (id === 'unassigned') {
    return Response.json({ ok: false, error: 'cannot_delete_unassigned' }, { status: 400 })
  }

  // 1) team_members rij verwijderen.
  const { error: dErr } = await supabaseAdmin.from('team_members').delete().eq('id', id)
  if (dErr) {
    return Response.json({ ok: false, error: dErr.message }, { status: 500 })
  }

  // 2) Optioneel ook het auth-account opruimen. Doen we alleen wanneer
  //    deleteAuth=true ÉN er een email gegeven is — zo verwijderen we
  //    nooit een auth-user die niet expliciet aangewezen is.
  let removedAuth = false
  const emailIn = (body.email ?? '').trim().toLowerCase()
  if (body.deleteAuth && emailIn) {
    // Vind de user-id via listUsers (gefilterd op email).
    let authUserId: string | null = null
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 })
      if (error) break
      const users = data?.users ?? []
      const hit = users.find(u => (u.email ?? '').toLowerCase() === emailIn)
      if (hit) { authUserId = hit.id; break }
      if (users.length < 100) break
    }
    if (authUserId) {
      const { error: aErr } = await supabaseAdmin.auth.admin.deleteUser(authUserId)
      if (!aErr) removedAuth = true
      // Ook de profile-row weg zodat een re-invite vers begint.
      await supabaseAdmin.from('profiles').delete().eq('user_id', authUserId)
    }
  }

  return Response.json({ ok: true, removedAuth })
}
