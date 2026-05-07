import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Removes manual duplicates of Google-synced items: any board_item whose name
// matches a currently-synced Google item on the same board (e.g. an XLSX
// import that pre-dated the Google sync, or a stale per-instance row from
// before the recurringEventId rewrite).
export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return new Response('not configured', { status: 500 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const { data, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !data.user) return new Response('unauthorized', { status: 401 })
  const userId = data.user.id

  const { data: cals } = await supabaseAdmin.from('google_calendars')
    .select('board_id').eq('user_id', userId)
  const boards = [...new Set(((cals as { board_id: string | null }[] | null) ?? [])
    .map(c => c.board_id).filter(Boolean) as string[])]
  if (boards.length === 0) return Response.json({ ok: true, deleted: 0 })

  let totalDeleted = 0
  const perBoard: Record<string, number> = {}

  for (const boardId of boards) {
    // Names of items currently coming from Google sync for this user/board
    const { data: googleRows } = await supabaseAdmin.from('board_items')
      .select('name')
      .eq('board_id', boardId)
      .eq('source', 'google')
      .eq('external_user_id', userId)
    const namesRaw = ((googleRows as { name: string }[] | null) ?? []).map(r => r.name)
    // Strip the "(N×)" recurring suffix so we also match the bare title
    const names = new Set<string>()
    for (const n of namesRaw) {
      names.add(n)
      const stripped = n.replace(/\s*\(\d+×\)\s*$/, '').trim()
      if (stripped) names.add(stripped)
    }
    if (names.size === 0) continue

    // Find non-google rows on the same board with matching names. Note: we
    // include rows where source IS NULL or any value that isn't 'google'.
    const { data: dupRows } = await supabaseAdmin.from('board_items')
      .select('id, name, source')
      .eq('board_id', boardId)
      .in('name', Array.from(names))
    const toDelete = ((dupRows as { id: string; name: string; source: string | null }[] | null) ?? [])
      .filter(r => r.source !== 'google')
      .map(r => r.id)

    if (toDelete.length > 0) {
      await supabaseAdmin.from('board_items').delete().in('id', toDelete)
      perBoard[boardId] = toDelete.length
      totalDeleted += toDelete.length
    }
  }

  return Response.json({ ok: true, deleted: totalDeleted, perBoard })
}
