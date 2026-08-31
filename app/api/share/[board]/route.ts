import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Whitelist van borden die public-shareable zijn. Andere borden (yoko,
// dienjaar) blokkeren we op de API-laag zodat een gebruiker geen
// gevoelige board-namen kan gokken via de URL. Pas deze lijst aan als je
// andere borden ook publiek wilt delen. Zelfde lijst staat in
// components/BoardTable.tsx voor de Deel-knop — houd ze synchroon.
const SHAREABLE_BOARDS = new Set(['nederland', 'vlaanderen', 'pnp'])

// Velden die GEEN externe lezer zou moeten zien:
//   - notes / journal: interne aantekeningen en discussies.
//   - contactpersoon: vaak een e-mailadres van een klant.
//   - links / extra.links: kunnen interne Dropbox/Frame.io-URL's bevatten.
//   - dagen / deadline: planning-intern, geen externe waarde.
//   - extra.ownerHours, extra.notes, etc.: zelfde reden.
// Wat WEL gedeeld wordt: naam, owners, status, datums en geplande uren.
// Die uren zijn nodig voor de expliciet gevraagde projectuitsplitsing; alle
// overige interne iteminformatie blijft buiten de publieke response.
type ShareSubItem = {
  id:        string
  name:      string
  startDate: string | null
  endDate:   string | null
  status:    string
  estHours:  number
}
type ShareItem = {
  id:        string
  name:      string
  ownerIds:  string[]
  status:    string
  startDate: string | null
  endDate:   string | null
  estHours:  number
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
  est_hours: number | null;
  subitems: Array<{ id?: string; name?: string; startDate?: string | null; endDate?: string | null; status?: string; hiddenFromPlanning?: boolean; estHours?: number }> | null;
  position: number | null;
  extra: Record<string, unknown> | null;
}
type GroupRow = { id: string; name: string | null; color: string | null; position: number | null }

type MonthlyHours = { key: string; label: string; hours: number; isCurrent: boolean }

const NL_MONTHS_FULL = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]

// Verdeelt `hours` gelijk over elke kalenderdag tussen start en end
// (inclusief), en telt de dagen die in `from`..`to` vallen op bij de
// teruggegeven som. Zelfde model als lib/workload.ts: 10u over 10 dagen
// = 1u/dag, ongeacht weekend — simpel en voorspelbaar voor een klant.
function hoursInRange(start: string, end: string, hours: number, from: Date, to: Date): number {
  if (hours <= 0) return 0
  const s = new Date(start); s.setHours(0, 0, 0, 0)
  const e = new Date(end);   e.setHours(0, 0, 0, 0)
  if (e < s) return 0
  const totalDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
  const rate = hours / totalDays
  const overlapStart = s > from ? s : from
  const overlapEnd   = e < to   ? e : to
  if (overlapEnd < overlapStart) return 0
  const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1
  return rate * overlapDays
}

function monthBounds(offset: number): { from: Date; to: Date; key: string; label: string; isCurrent: boolean } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const to   = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  to.setHours(23, 59, 59, 999)
  return {
    from, to,
    key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
    label: `${NL_MONTHS_FULL[from.getMonth()]} ${from.getFullYear()}`,
    isCurrent: offset === 0,
  }
}

// Bouwt dezelfde 'subitems-met-datum vervangen de parent-balk'-regel als
// groupsToProjects (lib/workload.ts) zodat de uren-telling hier niet
// dubbel telt: een item met gedateerde subitems levert uren per subitem,
// een item zonder (of met dateloze) subitems levert de eigen uren.
function collectHourSources(itemRows: ItemRow[], isHidden: (extra: Record<string, unknown> | null) => boolean): { start: string; end: string; hours: number }[] {
  const out: { start: string; end: string; hours: number }[] = []
  for (const r of itemRows) {
    if (isHidden(r.extra)) continue
    const subs = (r.subitems ?? []).filter(s => !s?.hiddenFromPlanning)
    const subsWithDates = subs.filter(s => s.startDate || s.endDate)
    if (subsWithDates.length > 0) {
      for (const s of subsWithDates) {
        const start = s.startDate ?? s.endDate!
        const end   = s.endDate   ?? s.startDate!
        out.push({ start, end, hours: Number((s as { estHours?: number }).estHours) || 0 })
      }
      continue
    }
    if (!r.start_date) continue
    out.push({ start: r.start_date, end: r.end_date ?? r.start_date, hours: Number(r.est_hours) || 0 })
  }
  return out
}

function computeMonthlyHours(itemRows: ItemRow[], isHidden: (extra: Record<string, unknown> | null) => boolean): MonthlyHours[] {
  const sources = collectHourSources(itemRows, isHidden)
  return [-1, 0, 1].map(offset => {
    const { from, to, key, label, isCurrent } = monthBounds(offset)
    const hours = sources.reduce((sum, src) => sum + hoursInRange(src.start, src.end, src.hours, from, to), 0)
    return { key, label, isCurrent, hours: Math.round(hours * 10) / 10 }
  })
}

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
    .is('deleted_at', null)
    .order('position', { ascending: true })
  if (gErr) return Response.json({ ok: false, error: 'Kon groepen niet laden' }, { status: 500 })

  const { data: itemRows, error: iErr } = await supabaseAdmin
    .from('board_items')
    .select('id, group_id, name, owner_ids, status, start_date, end_date, est_hours, subitems, position, extra')
    .eq('board_id', board)
    .is('deleted_at', null)
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
        estHours:  Number(s.estHours) || 0,
      }))
    const arr = itemsByGroup.get(r.group_id) ?? []
    arr.push({
      id:        r.id,
      name:      r.name ?? '',
      ownerIds:  r.owner_ids ?? [],
      status:    r.status ?? '',
      startDate: r.start_date,
      endDate:   r.end_date,
      estHours:  Number(r.est_hours) || 0,
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

  const monthlyHours = computeMonthlyHours((itemRows as ItemRow[] | null) ?? [], isHidden)

  return Response.json({ ok: true, board, groups, monthlyHours })
}
