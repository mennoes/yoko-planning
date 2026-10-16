import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { signShare, validShare } from '@/lib/shareToken'
import { randomUUID } from 'node:crypto'
import { groupsToProjects, type Project } from '@/lib/workload'
import type { BoardGroup, BoardItem, SubItem } from '@/lib/boards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Whitelist van borden die public-shareable zijn. Andere borden (yoko,
// dienjaar) blokkeren we op de API-laag zodat een gebruiker geen
// gevoelige board-namen kan gokken via de URL. Pas deze lijst aan als je
// andere borden ook publiek wilt delen. Zelfde lijst staat in
// components/BoardTable.tsx voor de Deel-knop — houd ze synchroon.
const SHAREABLE_BOARDS = new Set(['nederland', 'vlaanderen', 'pnp'])
const commentRate = new Map<string, number[]>()

function normalizedScope(req: NextRequest): string {
  return (req.nextUrl.searchParams.get('groups') ?? '').split(',').map(v => v.trim()).filter(Boolean).sort().join(',')
}
function mayReadShare(board: string, req: NextRequest): boolean {
  const groups = req.nextUrl.searchParams.get('groups') ?? ''
  return SHAREABLE_BOARDS.has(board) || validShare(board, groups, req.nextUrl.searchParams.get('token') ?? '')
}
function shareContext(board: string, req: NextRequest): string {
  return `share:${board}:${normalizedScope(req) || 'all'}`
}

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
  ownerIds:  string[]
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
  source: string | null;
  owner_ids: string[] | null; status: string | null;
  start_date: string | null; end_date: string | null;
  est_hours: number | null;
  subitems: Array<{ id?: string; name?: string; startDate?: string | null; endDate?: string | null; status?: string; source?: string; hiddenFromPlanning?: boolean; estHours?: number; ownerIds?: string[] }> | null;
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

function computeMonthlyHours(projects: Project[]): MonthlyHours[] {
  const sources = projects.flatMap(project => {
    const start = project.startDate ?? project.endDate
    if (!start) return []
    return [{ start, end: project.endDate ?? start, hours: project.estHours }]
  })
  return [-1, 0, 1].map(offset => {
    const { from, to, key, label, isCurrent } = monthBounds(offset)
    const hours = sources.reduce((sum, src) => sum + hoursInRange(src.start, src.end, src.hours, from, to), 0)
    return { key, label, isCurrent, hours: Math.round(hours * 10) / 10 }
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ board: string }> }) {
  const { board } = await params
  if (!mayReadShare(board, req)) {
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
    .select('id, group_id, name, source, owner_ids, status, start_date, end_date, est_hours, subitems, position, extra')
    .eq('board_id', board)
    .is('deleted_at', null)
    .order('position', { ascending: true })
  if (iErr) return Response.json({ ok: false, error: 'Kon items niet laden' }, { status: 500 })

  // Een share-link kan één of meerdere groepen begrenzen met
  // ?groups=id1,id2. Filter dit op de server, zodat niet-geselecteerde
  // groepen ook niet ongemerkt in de publieke API-response meekomen.
  const requestedGroupIds = new Set(
    (req.nextUrl.searchParams.get('groups') ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
      .slice(0, 50),
  )
  const hasGroupScope = requestedGroupIds.size > 0
  const scopedGroupRows = ((groupRows as GroupRow[] | null) ?? [])
    .filter(group => !hasGroupScope || requestedGroupIds.has(group.id))
  const scopedGroupIds = new Set(scopedGroupRows.map(group => group.id))
  const scopedItemRows = ((itemRows as ItemRow[] | null) ?? [])
    .filter(item => scopedGroupIds.has(item.group_id))

  // Verberg items met hiddenFromPlanning=true (gebruiker heeft 'm
  // expliciet uit overzichten gehaald — dan ook niet extern delen).
  const isHidden = (extra: Record<string, unknown> | null): boolean => !!(extra && (extra as { hiddenFromPlanning?: boolean }).hiddenFromPlanning)

  const itemsByGroup = new Map<string, ShareItem[]>()
  for (const r of scopedItemRows) {
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
        ownerIds:  s.ownerIds ?? r.owner_ids ?? [],
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

  const groups: ShareGroup[] = scopedGroupRows.map(g => ({
    id:    g.id,
    name:  g.name ?? '',
    color: g.color ?? '#9aadbd',
    items: itemsByGroup.get(g.id) ?? [],
  }))

  // Gebruik exact dezelfde projectmaterialisatie als Home, Planning en To
  // do's. Daardoor kan Share nooit meer een parent én diens subitems dubbel
  // tellen of een Google-serietotaal als extra uren meenemen.
  const workloadGroups: BoardGroup[] = scopedGroupRows.map(group => ({
    id: group.id,
    name: group.name ?? '',
    color: group.color ?? '#9aadbd',
    items: scopedItemRows
      .filter(row => row.group_id === group.id && !isHidden(row.extra))
      .map((row): BoardItem => ({
        id: row.id,
        name: row.name ?? '',
        ownerIds: row.owner_ids ?? [],
        status: row.status ?? '',
        startDate: row.start_date,
        endDate: row.end_date,
        deadline: null,
        estHours: Number(row.est_hours) || 0,
        dagen: (Number(row.est_hours) || 0) / 8,
        source: row.source === 'google' ? 'google' : 'manual',
        subitems: (row.subitems ?? [])
          .filter(subitem => !subitem.hiddenFromPlanning)
          .map((subitem): SubItem => ({
            id: String(subitem.id ?? ''),
            name: subitem.name ?? '',
            ownerIds: subitem.ownerIds ?? row.owner_ids ?? [],
            status: subitem.status ?? '',
            startDate: subitem.startDate ?? null,
            endDate: subitem.endDate ?? null,
            estHours: Number(subitem.estHours) || 0,
            source: subitem.source === 'google' ? 'google' : 'manual',
          })),
      })),
  }))
  const monthlyHours = computeMonthlyHours(groupsToProjects(board, workloadGroups))

  const { data: commentRows } = await supabaseAdmin.from('comments')
    .select('id, thread, created_at')
    .eq('context_kind', 'page')
    .eq('context_id', shareContext(board, req))
    .eq('resolved', false)
    .order('created_at', { ascending: true })
    .limit(200)
  const comments = ((commentRows ?? []) as Array<{ id: string; thread: Array<{ author?: string; body?: string; createdAt?: string }>; created_at: string }>)
    .flatMap(row => (row.thread ?? []).slice(0, 1).map(reply => ({
      id: row.id,
      author: String(reply.author ?? 'Producer'),
      body: String(reply.body ?? ''),
      createdAt: String(reply.createdAt ?? row.created_at),
    })))

  return Response.json({ ok: true, board, groups, monthlyHours, comments })
}

// Publieke share-reactie. Alleen tekst + een zelfgekozen naam; geen account,
// e-mailadres of interne data is nodig.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ board: string }> }) {
  const { board } = await params
  if (!mayReadShare(board, req)) return Response.json({ ok: false, error: 'Deellink is ongeldig' }, { status: 404 })
  if (!supabaseAdmin) return Response.json({ ok: false, error: 'Niet geconfigureerd' }, { status: 503 })
  const body = await req.json().catch(() => ({})) as { author?: unknown; body?: unknown }
  const author = String(body.author ?? '').trim().slice(0, 80) || 'Producer'
  const text = String(body.body ?? '').trim().slice(0, 2000)
  if (text.length < 2) return Response.json({ ok: false, error: 'Schrijf eerst een vraag of opmerking.' }, { status: 400 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rateKey = `${ip}:${board}`
  const now = Date.now()
  const recent = (commentRate.get(rateKey) ?? []).filter(ts => now - ts < 10 * 60_000)
  if (recent.length >= 8) return Response.json({ ok: false, error: 'Te veel reacties achter elkaar. Probeer het later opnieuw.' }, { status: 429 })
  recent.push(now); commentRate.set(rateKey, recent)

  const id = `share-${randomUUID()}`
  const createdAt = new Date().toISOString()
  const row = {
    id,
    context_kind: 'page',
    context_id: shareContext(board, req),
    quote: 'Vraag over werkverantwoording',
    thread: [{ id: `reply-${randomUUID()}`, author, body: text, createdAt }],
    resolved: false,
    author_id: null,
    created_at: createdAt,
  }
  const { error } = await supabaseAdmin.from('comments').insert(row)
  if (error) return Response.json({ ok: false, error: 'Reactie opslaan mislukt.' }, { status: 500 })
  return Response.json({ ok: true, comment: { id, author, body: text, createdAt } })
}

// New boards are private until an authenticated team member creates a link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ board: string }> }) {
  if (!supabaseAdmin) return Response.json({ error: 'Niet geconfigureerd' }, { status: 503 })
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return Response.json({ error: 'Log opnieuw in' }, { status: 401 })
  const { data, error } = await supabaseAdmin.auth.getUser(auth.slice(7))
  if (error || !data.user) return Response.json({ error: 'Log opnieuw in' }, { status: 401 })
  const { data: profile } = await supabaseAdmin.from('profiles').select('user_id').eq('user_id', data.user.id).maybeSingle()
  if (!profile) return Response.json({ error: 'Geen toegang' }, { status: 403 })
  const { board } = await params
  const { data: found } = await supabaseAdmin.from('boards').select('id').eq('id', board).maybeSingle()
  if (!found && !SHAREABLE_BOARDS.has(board)) return Response.json({ error: 'Agenda niet gevonden' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const groups = typeof body.groups === 'string' ? body.groups : ''
  return Response.json({ token: signShare(board, groups) }, { headers: { 'Cache-Control': 'no-store' } })
}
