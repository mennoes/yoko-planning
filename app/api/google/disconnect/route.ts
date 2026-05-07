import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return new Response('not configured', { status: 500 })

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const { data, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !data.user) return new Response('unauthorized', { status: 401 })

  const body       = await req.json().catch(() => ({}))
  const calendarId = typeof body?.calendarId === 'string' ? body.calendarId : null

  let q = supabaseAdmin.from('google_calendars').delete().eq('user_id', data.user.id)
  if (calendarId) q = q.eq('calendar_id', calendarId)
  const { error: dErr } = await q
  if (dErr) return new Response('db error', { status: 500 })
  return Response.json({ ok: true })
}
