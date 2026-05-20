import { NextRequest } from 'next/server'
import { verifyState, exchangeCode, listCalendars } from '@/lib/googleOAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StatePayload = { uid: string; boardId: string | null; nonce: string; exp: number }

function backTo(origin: string, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString()
  return Response.redirect(`${origin}/?${q}`, 302)
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const code   = req.nextUrl.searchParams.get('code')
  const state  = req.nextUrl.searchParams.get('state')
  const oerr   = req.nextUrl.searchParams.get('error')

  if (oerr)            return backTo(origin, { google: 'error', msg: oerr })
  if (!code || !state) return backTo(origin, { google: 'error', msg: 'missing_params' })

  const payload = verifyState<StatePayload>(state)
  if (!payload)                      return backTo(origin, { google: 'error', msg: 'bad_state' })
  if (payload.exp < Date.now())      return backTo(origin, { google: 'error', msg: 'state_expired' })
  if (!supabaseAdmin)                return backTo(origin, { google: 'error', msg: 'admin_missing' })

  try {
    const tokens = await exchangeCode(code, `${origin}/api/google/callback`)
    const cals   = await listCalendars(tokens.access_token)
    const cal    = cals.find(c => c.primary) ?? cals[0]
    if (!cal) return backTo(origin, { google: 'error', msg: 'no_calendars' })

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Geen boardId in de OAuth-state? Pak dan automatisch het eerste bord uit
    // de boards-tabel zodat events vanaf de eerste sync ergens binnenkomen,
    // i.p.v. zwijgend nergens te landen.
    let boardId = payload.boardId ?? null
    if (!boardId) {
      const { data: bRow } = await supabaseAdmin
        .from('boards').select('id').order('position', { ascending: true }).limit(1)
      const fallback = (bRow as { id: string }[] | null)?.[0]?.id ?? null
      if (fallback) boardId = fallback
    }

    const { error } = await supabaseAdmin.from('google_calendars').upsert({
      user_id:       payload.uid,
      calendar_id:   cal.id,
      calendar_name: cal.summary,
      board_id:      boardId,
      refresh_token: tokens.refresh_token,
      access_token:  tokens.access_token,
      expires_at:    expiresAt,
    }, { onConflict: 'user_id,calendar_id' })

    if (error) return backTo(origin, { google: 'error', msg: 'db_' + error.code })
    return backTo(origin, { google: 'connected', board: payload.boardId ?? '' })
  } catch (e) {
    return backTo(origin, { google: 'error', msg: String(e).slice(0, 100) })
  }
}
