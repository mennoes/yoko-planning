import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { BOARD_NAMES } from '@/lib/boardStore'
import yokoRaw       from '@/data/boards/yoko.json'
import pnpRaw        from '@/data/boards/pnp.json'
import nederlandRaw  from '@/data/boards/nederland.json'
import vlaanderenRaw from '@/data/boards/vlaanderen.json'
import dienjaarRaw   from '@/data/boards/dienjaar.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RAW: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw,
  vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
}

type ImportItem = {
  id?: string; name: string; ownerIds?: string[]; status?: string
  startDate?: string | null; endDate?: string | null; deadline?: string | null
  estHours?: number; dagen?: number; notes?: string; contactpersoon?: string
  uitzenddag?: string | null; framelink?: string; nummers?: number
  subitems?: unknown[]; journal?: unknown[]
}
type ImportGroup = { id?: string; name: string; color?: string; collapsed?: boolean; items: ImportItem[] }

// One-shot push of the imported boards (data/boards/*.json) into Supabase.
// REPLACES existing google-source-free rows for the listed boards. Google-
// synced rows (source='google') are preserved.
export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return new Response('not configured', { status: 500 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const { data: u, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !u.user) return new Response('unauthorized', { status: 401 })

  const stats: Record<string, { groups: number; items: number; subitems: number }> = {}

  for (const board of BOARD_NAMES) {
    const raw = RAW[board]
    if (!raw) continue
    const groups = (raw.groups as ImportGroup[]) ?? []

    // Wipe non-google rows for this board so the imported data wins
    await supabaseAdmin.from('board_items').delete().eq('board_id', board).neq('source', 'google')
    await supabaseAdmin.from('board_groups').delete().eq('board_id', board)

    let totalItems = 0, totalSubs = 0
    const groupRows = groups.map((g, i) => ({
      id:        g.id ?? `g_${board}_${i}`,
      board_id:  board,
      name:      g.name,
      color:     g.color ?? '#9aadbd',
      collapsed: g.collapsed ?? false,
      position:  i,
    }))
    if (groupRows.length > 0) {
      const { error: ge } = await supabaseAdmin.from('board_groups').insert(groupRows)
      if (ge) return Response.json({ ok: false, board, error: 'groups: ' + ge.message }, { status: 500 })
    }

    const itemRows: Record<string, unknown>[] = []
    for (const g of groups) {
      const gid = g.id ?? `g_${board}_${groupRows.findIndex(r => r.name === g.name)}`
      g.items.forEach((i, idx) => {
        totalItems++
        const subs = (i.subitems as { estHours?: number }[] | undefined) ?? []
        totalSubs += subs.length
        itemRows.push({
          id:         i.id ?? `it_${board}_${gid}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          group_id:   gid,
          board_id:   board,
          name:       i.name,
          owner_ids:  i.ownerIds ?? [],
          status:     i.status ?? '',
          start_date: i.startDate ?? null,
          end_date:   i.endDate ?? null,
          deadline:   i.deadline ?? null,
          est_hours:  i.estHours ?? 0,
          dagen:      i.dagen ?? 0,
          notes:      i.notes ?? null,
          contactpersoon: i.contactpersoon ?? null,
          uitzenddag:     i.uitzenddag ?? null,
          framelink:      i.framelink ?? null,
          nummers:        i.nummers ?? null,
          subitems:       i.subitems ?? [],
          journal:        i.journal ?? [],
          extra:          {},
          position:       idx,
          source:         'manual',
          updated_at:     new Date().toISOString(),
        })
      })
    }
    if (itemRows.length > 0) {
      // Insert in chunks to avoid request size limits
      const CHUNK = 200
      for (let s = 0; s < itemRows.length; s += CHUNK) {
        const slice = itemRows.slice(s, s + CHUNK)
        const { error: ie } = await supabaseAdmin.from('board_items').insert(slice)
        if (ie) return Response.json({ ok: false, board, error: 'items: ' + ie.message }, { status: 500 })
      }
    }
    stats[board] = { groups: groupRows.length, items: totalItems, subitems: totalSubs }
  }

  return Response.json({ ok: true, stats })
}
