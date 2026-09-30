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
  const { data: profile } = await supabaseAdmin.from('profiles').select('user_id').eq('user_id', authData.user.id).maybeSingle()
  if (!profile) return Response.json({ ok: false, error: 'profile_not_found' }, { status: 403 })

  let body: { boardId?: string; name?: string }
  try { body = await req.json() } catch { return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 }) }
  const boardId = (body.boardId ?? '').trim()
  const name = (body.name ?? '').trim()
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(boardId) || !name || name.length > 80) {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin.from('boards')
    .update({ name, updated_at: new Date().toISOString() }).eq('id', boardId)
    .select('id, name').maybeSingle()
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return Response.json({ ok: false, error: 'board_not_found' }, { status: 404 })
  return Response.json({ ok: true, board: data })
}
