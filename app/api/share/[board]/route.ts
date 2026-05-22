import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Whitelist van borden die public-shareable zijn. Andere borden (yoko, pnp,
// dienjaar, etc.) blokkeren we op de API-laag zodat een gebruiker geen
// gevoelige board-namen kan gokken via de URL. Pas deze lijst aan als je
// andere borden ook publiek wilt delen.
const SHAREABLE_BOARDS = new Set(['nederland', 'vlaanderen'])

// Velden die GEEN externe lezer zou moeten zien:
//   - notes / journal: interne aantekeningen en discussies.
//   - contactpersoon: vaak een e-mailadres van een klant.
//   - links / extra.links: kunnen interne Dropbox/Frame.io-URL's bevatten.
//   - est_hours / dagen / deadline: planning-intern, geen externe waarde.
//   - extra.ownerHours, extra.notes, etc.: zelfde reden.
// Wat WEL gedeeld wordt: name, owner_ids, status, start/end-datums.
type ShareSubItem = {
  id:        string
  name:      string
  startDate: string | null
  endDate:   string | null
  status:    string
}
type ShareItem = {
  id:        string
  name:      string
  ownerIds:  string[]
  status:    string
  startDate: string | null
  endDate:   string | null
  subitems:  ShareSubItem[]
}
type ShareGroup = {
  id:    string
  name:  string
  color: string
  items: ShareItem[]
}

type ItemRow = {
  id: string; group_id: string; name: string | null;
  owner_ids: string[] | null; status: string | null;
  start_date: string | null; end_date: string | null;
  subitems: Array<{ id?: string; name?: string; startDate?: string | null; endDate?: string | null; status?: string; hiddenFromPlanning?: boolean }> | null;
  position: number | null;
  extra: Record<string, unknown> | null;
}
type GroupRow = { id: string; name: string | null; color: string | null; position: number | null }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ board: string }> }) {
  const { board } = await params
  if (!SHAREABLE_BOARDS.has(board)) {
    return Response.json({ ok: false, error: 'Bord niet gedeeld' }, { status: 404 })
  }
  if (!supabaseAdmin) {
    return Response.json({ ok: false, error: 'Supabase niet geconfigureerd' }, { status: 500 })
  }

  const { data: groupRows, error: gErr } = await supabaseAdmin
    .from('board_groups')
    .select('id, name, color, position')
    .eq('board_id', board)
    .order('position', { ascending: true })
  if (gErr) return Response.json({ ok: false, error: 'Kon groepen niet laden' }, { status: 500 })

  const { data: itemRows, error: iErr } = await supabaseAdmin
    .from('board_items')
    .select('id, group_id, name, owner_ids, status, start_date, end_date, subitems, position, extra')
    .eq('board_id', board)
    .order('position', { ascending: true })
  if (iErr) return Response.json({ ok: false, error: 'Kon items niet laden' }, { status: 500 })

  // Verberg items met hiddenFromPlanning=true (gebruiker heeft 'm
  // expliciet uit overzichten gehaald — dan ook niet extern delen).
  const isHidden = (extra: Record<string, unknown> | null): boolean => !!(extra && (extra as { hiddenFromPlanning?: boolean }).hiddenFromPlanning)

  const itemsByGroup = new Map<string, ShareItem[]>()
  for (const r of (itemRows as ItemRow[] | null) ?? []) {
    if (isHidden(r.extra)) continue
    const subs: ShareSubItem[] = (r.subitems ?? [])
      .filter(s => !s?.hiddenFromPlanning)
      .map(s => ({
        id:        String(s.id ?? ''),
        name:      s.name ?? '',
        startDate: s.startDate ?? null,
        endDate:   s.endDate   ?? null,
        status:    s.status ?? '',
      }))
    const arr = itemsByGroup.get(r.group_id) ?? []
    arr.push({
      id:        r.id,
      name:      r.name ?? '',
      ownerIds:  r.owner_ids ?? [],
      status:    r.status ?? '',
      startDate: r.start_date,
      endDate:   r.end_date,
      subitems:  subs,
    })
    itemsByGroup.set(r.group_id, arr)
  }

  const groups: ShareGroup[] = ((groupRows as GroupRow[] | null) ?? []).map(g => ({
    id:    g.id,
    name:  g.name ?? '',
    color: g.color ?? '#9aadbd',
    items: itemsByGroup.get(g.id) ?? [],
  }))

  return Response.json({ ok: true, board, groups })
}
