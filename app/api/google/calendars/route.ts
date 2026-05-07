import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { listCalendars, refreshAccessToken, type CalendarSummary } from '@/lib/googleOAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = {
  id:            string
  calendar_id:   string
  calendar_name: string | null
  board_id:      string | null
  refresh_token: string
  access_token:  string | null
  expires_at:    string | null
  last_sync_at:  string | null
}

// GET — list current user's connections + available calendars (best-effort)
export async function GET(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return new Response('not configured', { status: 500 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const { data, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !data.user) return new Response('unauthorized', { status: 401 })

  const { data: rows } = await supabaseAdmin
    .from('google_calendars').select('*').eq('user_id', data.user.id)
  const list = (rows as Row[] | null) ?? []

  const connections = list.map(r => ({
    calendarId:   r.calendar_id,
    calendarName: r.calendar_name,
    boardId:      r.board_id,
    lastSyncAt:   r.last_sync_at,
  }))

  let available: CalendarSummary[] = []
  if (list.length > 0) {
    try {
      const cal       = list[0]
      const expiresMs = cal.expires_at ? new Date(cal.expires_at).getTime() : 0
      let token       = cal.access_token
      if (!token || expiresMs < Date.now() + 60_000) {
        const fresh = await refreshAccessToken(cal.refresh_token)
        token = fresh.access_token
        await supabaseAdmin.from('google_calendars').update({
          access_token: token,
          expires_at:   new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        }).eq('id', cal.id)
      }
      available = await listCalendars(token!)
    } catch { /* ignore — UI shows known connections only */ }
  }

  return Response.json({ connections, available })
}

// POST — change which Google calendar is mapped to which board for an existing
// connection.  Body: { calendarId, newCalendarId?, boardId? }
export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return new Response('not configured', { status: 500 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const { data, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !data.user) return new Response('unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({}))
  const calendarId    = typeof body?.calendarId    === 'string' ? body.calendarId    : null
  const newCalendarId = typeof body?.newCalendarId === 'string' ? body.newCalendarId : null
  const boardId       = typeof body?.boardId       === 'string' ? body.boardId       : null
  if (!calendarId) return new Response('missing calendarId', { status: 400 })

  const update: Record<string, unknown> = {}
  if (newCalendarId) update.calendar_id = newCalendarId
  if (boardId !== null) update.board_id = boardId
  if (Object.keys(update).length === 0) return Response.json({ ok: true })

  const { error: uErr } = await supabaseAdmin
    .from('google_calendars').update(update)
    .eq('user_id', data.user.id).eq('calendar_id', calendarId)
  if (uErr) return new Response('db error', { status: 500 })
  return Response.json({ ok: true })
}
