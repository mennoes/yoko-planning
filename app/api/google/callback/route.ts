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
    if (cals.length === 0) return backTo(origin, { google: 'error', msg: 'no_calendars' })

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Default-bord voor nieuwe kalender-rijen: payload.boardId als de
    // gebruiker er één meegaf, anders het eerste bord uit de boards-tabel.
    let defaultBoardId = payload.boardId ?? null
    if (!defaultBoardId) {
      const { data: bRow } = await supabaseAdmin
        .from('boards').select('id').order('position', { ascending: true }).limit(1)
      const fallback = (bRow as { id: string }[] | null)?.[0]?.id ?? null
      if (fallback) defaultBoardId = fallback
    }

    // Sync álle kalenders die deze gebruiker met ons mag delen (calendar /
    // calendar.events.readonly scope). Persoonlijke + gedeelde + werk-
    // agenda's komen er zo in één keer in. Routing-regels per event sorteren
    // ze automatisch naar de juiste borden; rest valt terug op default.
    // Behoud bestaande board-koppelingen via onConflict-upsert.
    const rows = cals
      // Filter alleen agenda's waar je écht events kunt zien (no 'freeBusyReader')
      .filter(c => c.accessRole !== 'freeBusyReader')
      .map(c => ({
        user_id:       payload.uid,
        calendar_id:   c.id,
        calendar_name: c.summary,
        board_id:      defaultBoardId,
        refresh_token: tokens.refresh_token,
        access_token:  tokens.access_token,
        expires_at:    expiresAt,
      }))

    // ignoreDuplicates zou bestaande rijen ongewijzigd laten — maar we willen
    // de fresh refresh_token / access_token doorzetten. Doe daarom een
    // upsert met onConflict: 'user_id,calendar_id'. Het board_id zal voor
    // bestaande rijen overschreven worden naar defaultBoardId — niet ideaal
    // als de gebruiker eerder handmatig een ander bord koos, maar zonder
    // schema-kennis kunnen we hier niet partieel updaten.
    // → Workaround: doe twee passes — eerst nieuwe kalenders, dan tokens
    //   bijwerken zonder board_id aan te raken.
    const newRows = rows.filter(r => !!r.calendar_id)
    if (newRows.length > 0) {
      // Eerst: pak bestaande kalender-id's van deze user op uit DB
      const { data: existingRows } = await supabaseAdmin
        .from('google_calendars').select('calendar_id, board_id')
        .eq('user_id', payload.uid)
      const existingMap = new Map<string, string | null>(
        ((existingRows as { calendar_id: string; board_id: string | null }[] | null) ?? [])
          .map(r => [r.calendar_id, r.board_id])
      )
      // Insert nieuwe rijen met default-bord; update bestaande met fresh tokens
      // (en lever de oude board_id terug aan zodat we 'm niet overschrijven).
      const merged = newRows.map(r => ({
        ...r,
        board_id: existingMap.has(r.calendar_id) ? existingMap.get(r.calendar_id) ?? null : r.board_id,
      }))
      const { error } = await supabaseAdmin
        .from('google_calendars').upsert(merged, { onConflict: 'user_id,calendar_id' })
      if (error) return backTo(origin, { google: 'error', msg: 'db_' + error.code })
    }

    return backTo(origin, { google: 'connected', board: defaultBoardId ?? '' })
  } catch (e) {
    return backTo(origin, { google: 'error', msg: String(e).slice(0, 100) })
  }
}
