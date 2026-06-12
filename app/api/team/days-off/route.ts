// POST /api/team/days-off  { memberId, daysOff }
//
// Server-route die profiles.days_off van een willekeurig teamlid bijwerkt
// via supabaseAdmin. Nodig omdat de standaard RLS-policy
// 'Eigen profiel bijwerken' (auth.uid() = user_id) een client-side update
// blokkeert zodra je iemand anders dan jezelf wilt aanpassen.
//
// Vereist een Bearer-token van een ingelogde gebruiker — geen anon access.
// Geen extra role-check: in de Yoko-tool kunnen alle ingelogde leden
// elkaars werkdagen bijstellen (same trust model als /api/team/delete).

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])

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

  let body: { memberId?: string; daysOff?: unknown }
  try { body = await req.json() } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const memberId = (body.memberId ?? '').trim()
  if (!memberId) return Response.json({ ok: false, error: 'missing_member_id' }, { status: 400 })
  if (!Array.isArray(body.daysOff)) {
    return Response.json({ ok: false, error: 'invalid_days_off' }, { status: 400 })
  }
  const daysOff = (body.daysOff as unknown[])
    .filter((d): d is string => typeof d === 'string' && VALID_DAYS.has(d))

  // Primaire opslag: team_capacities.days_off (int[]). Deze tabel heeft
  // geen FK naar auth.users, dus werkt voor ÉLK teamlid — ook degenen
  // zonder login (Manuel, freelancers). De kolom bestaat al sinds
  // migratie 0021, geen extra SQL nodig.
  const DAY_TO_ISO: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }
  const daysOffIso = daysOff.map(d => DAY_TO_ISO[d]).filter((n): n is number => !!n)
  const { error: tcErr } = await supabaseAdmin
    .from('team_capacities')
    .upsert({
      member_id:  memberId,
      days_off:   daysOffIso,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'member_id' })
  if (tcErr) {
    return Response.json({ ok: false, error: tcErr.message }, { status: 500 })
  }

  // Legacy mirror naar profiles — schrijf alleen als er al een
  // rij bestaat. Best-effort; faalt silent als de rij ontbreekt.
  await supabaseAdmin
    .from('profiles')
    .update({ days_off: daysOff })
    .eq('member_id', memberId)
    .then(() => {})

  return Response.json({ ok: true, memberId, daysOff })
}
