import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { pastBillableOccurrences } from '@/lib/googleMeetingHistory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CleanupRow = {
  id: string
  name: string
  source: string | null
  start_date: string | null
  end_date: string | null
  est_hours: number | null
  subitems: { startDate?: string | null; endDate?: string | null; estHours?: number }[] | null
}

/** Draagt deze rij uren van werk dat al geweest is? Zulke uren zijn nodig
 *  voor uren- en factuurverantwoording en mogen door een opschoonactie nooit
 *  worden weggegooid — ook niet als de naam toevallig matcht met een
 *  Google-event. */
function carriesPastHours(row: CleanupRow, todayIso: string): boolean {
  const subitems = Array.isArray(row.subitems) ? row.subitems : []
  const occurrences = subitems.length > 0
    ? subitems.map(sub => ({ id: '', startDate: sub.startDate ?? null, endDate: sub.endDate ?? null, estHours: Number(sub.estHours) || 0 }))
    : [{ id: '', startDate: row.start_date, endDate: row.end_date, estHours: Number(row.est_hours) || 0 }]
  return pastBillableOccurrences(occurrences, todayIso).length > 0
}

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
  let totalKeptForHours = 0
  const todayIso = new Date().toISOString().slice(0, 10)
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
      .select('id, name, source, start_date, end_date, est_hours, subitems')
      .eq('board_id', boardId)
      .in('name', Array.from(names))
      .is('deleted_at', null)
    const candidates = ((dupRows as CleanupRow[] | null) ?? []).filter(r => r.source !== 'google')
    // Rijen met al gemaakte uren blijven staan. Oude Google-historie mist
    // vaak juist `source = 'google'` (zie isGoogleHistoryRow in googleSync),
    // dus precies de rijen die het herstelpad probeert terug te halen zouden
    // hier anders sneuvelen — en wel onherstelbaar.
    const toDelete = candidates.filter(r => !carriesPastHours(r, todayIso)).map(r => r.id)
    const keptForHours = candidates.length - toDelete.length

    if (toDelete.length > 0) {
      // Soft-delete i.p.v. `.delete()`: een opschoonactie mag nooit
      // onomkeerbaar zijn. Zo blijft alles terug te halen via de papierbak.
      const hiddenAt = new Date().toISOString()
      await supabaseAdmin.from('board_items')
        .update({ deleted_at: hiddenAt, updated_at: hiddenAt })
        .in('id', toDelete)
      perBoard[boardId] = toDelete.length
      totalDeleted += toDelete.length
    }
    if (keptForHours > 0) totalKeptForHours += keptForHours
  }

  return Response.json({ ok: true, deleted: totalDeleted, keptForHours: totalKeptForHours, perBoard })
}
