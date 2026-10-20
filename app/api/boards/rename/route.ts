import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(auth.slice(7))
  if (authError || !authData.user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  // Een geldige Yoko-login is voldoende om een agenda te hernoemen. De
  // eerdere extra profiles-check maakte dit onnodig kwetsbaar: oudere of
  // opnieuw gekoppelde accounts kunnen wel correct ingelogd zijn, maar nog
  // geen profiles-rij hebben. Dan leek de naam lokaal gewijzigd, terwijl de
  // server hem weigerde en hij na refresh terugviel.

  let body: { boardId?: string; name?: string }
  try { body = await req.json() } catch { return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 }) }
  const boardId = (body.boardId ?? '').trim()
  const name = (body.name ?? '').trim()
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(boardId) || !name || name.length > 80) {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  // Niet elke installatie heeft de kolom `updated_at` op `boards`.
  // PostgREST weigert de hele update dan met PGRST204; in dat geval
  // proberen we 't gewoon zonder tijdstempel.
  let { data, error } = await supabaseAdmin.from('boards')
    .update({ name, updated_at: new Date().toISOString() }).eq('id', boardId)
    .select('id, name').maybeSingle()
  if (error && (error.code === 'PGRST204' || /updated_at/.test(error.message ?? ''))) {
    ;({ data, error } = await supabaseAdmin.from('boards')
      .update({ name }).eq('id', boardId)
      .select('id, name').maybeSingle())
  }
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return Response.json({ ok: false, error: 'board_not_found' }, { status: 404 })
  return Response.json({ ok: true, board: data })
}
