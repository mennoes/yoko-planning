import type { SupabaseClient } from '@supabase/supabase-js'
import type { GoogleEvent } from './googleOAuth'
import type { SubItem } from './boards'

export type MeetingRoute = { boardId: string; reason: 'participants' | 'title' | 'fallback' | 'conflict' }
type RoutingRule = { pattern: string; board_id: string }
const ORGANIZATIONS: Record<string, string> = {
  'universiteitvannederland.nl': 'nederland',
  'universiteitvanvlaanderen.be': 'vlaanderen',
  'pnpmedia.nl': 'pnp',
}
const TITLE_RULES: RoutingRule[] = [
  { pattern: 'universiteit van nederland', board_id: 'nederland' },
  { pattern: 'uvnl', board_id: 'nederland' },
  { pattern: 'universiteit van vlaanderen', board_id: 'vlaanderen' },
  { pattern: 'uvvl', board_id: 'vlaanderen' },
  { pattern: 'pnp', board_id: 'pnp' },
  { pattern: 'pnpmedia', board_id: 'pnp' },
]
function words(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

/** Organization participants beat incidental title keywords. PnP produces
 * UvNL/UvVL work too: the more specific university wins over PnP. Conflicting
 * universities need a matching title, otherwise use Yoko without guessing. */
export function routeGoogleMeeting(events: GoogleEvent[], rules: RoutingRule[], available: Set<string>): MeetingRoute {
  if (!available.has('yoko')) throw new Error('Yoko-agenda ontbreekt; automatische meetingrouting gestopt')
  const participantBoards = new Set<string>()
  for (const event of events) {
    const people = [...(event.attendees ?? []).filter(a => a.responseStatus !== 'declined' && !a.resource)]
    if (event.organizer?.email) people.push(event.organizer)
    for (const person of people) {
      const domain = person.email?.trim().toLowerCase().split('@')[1] ?? ''
      for (const [known, board] of Object.entries(ORGANIZATIONS)) {
        if ((domain === known || domain.endsWith(`.${known}`)) && available.has(board)) participantBoards.add(board)
      }
    }
  }
  const title = ` ${words(events[events.length - 1]?.summary ?? '')} `
  const titleBoards = [...rules, ...TITLE_RULES]
    .filter(r => available.has(r.board_id) && words(r.pattern).length >= 3 && title.includes(` ${words(r.pattern)} `))
    .map(r => r.board_id)
  const universities = [...participantBoards].filter(b => b !== 'pnp')
  if (universities.length === 1) return { boardId: universities[0], reason: 'participants' }
  if (universities.length > 1) {
    const matching = [...new Set(titleBoards.filter(b => participantBoards.has(b)))]
    return matching.length === 1
      ? { boardId: matching[0], reason: 'title' }
      : { boardId: 'yoko', reason: 'conflict' }
  }
  // A specific UvNL/UvVL title can disambiguate a PnP-only invitation.
  const universityTitle = titleBoards.find(b => b === 'nederland' || b === 'vlaanderen')
  if (participantBoards.has('pnp') && universityTitle) return { boardId: universityTitle, reason: 'title' }
  if (participantBoards.has('pnp')) return { boardId: 'pnp', reason: 'participants' }
  return titleBoards.length > 0
    ? { boardId: titleBoards[0], reason: 'title' }
    : { boardId: 'yoko', reason: 'fallback' }
}

export type MeetingParent = {
  id: string; name: string; board_id: string; group_id: string
  status: string | null; source: string | null; external_link?: string | null
  deleted_at: string | null; updated_at: string | null
  subitems: SubItem[] | null; extra: Record<string, unknown> | null
}
const GENERIC = new Set(('de het een en van voor met in op over aan bij the and of for with ' +
  'meeting meetings call overleg sync check in checkin update start kickoff kick off bespreking ' +
  'project productie planning afstemming presentatie feedback review concept ontwerp huisstijl ' +
  'yoko studio pnp uvnl uvvl nederland vlaanderen universiteit part deel aflevering afl episode').split(' '))
function projectTokens(title: string): string[] {
  return [...new Set(words(title).split(' ').filter(w => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w)))]
}

/** Whole words only; no fuzzy typo/substring guessing. Ambiguous candidates
 * stay in Meetings. Long, distinctive one-word project names are supported. */
export function findMeetingProject(title: string, candidates: MeetingParent[], route: MeetingRoute): MeetingParent | null {
  if (route.reason === 'conflict') return null
  const eventTokens = new Set(projectTokens(title))
  const matches = candidates.filter(p => !p.deleted_at && p.status !== 'Done' && p.source !== 'google'
    && !p.external_link && (route.reason === 'fallback' || p.board_id === route.boardId))
    .map(parent => {
      const tokens = projectTokens(parent.name)
      const shared = tokens.filter(t => eventTokens.has(t))
      const distinctive = shared.length >= 2 || (tokens.length === 1 && shared[0]?.length >= 6)
      const coverage = tokens.length > 0 ? shared.length / tokens.length : 0
      return { parent, score: distinctive && coverage >= 0.8 ? coverage + Math.min(shared.length, 4) * 0.05 : 0 }
    }).filter(m => m.score > 0).sort((a, b) => b.score - a.score)
  if (!matches.length || (matches[1] && matches[0].score - matches[1].score < 0.15)) return null
  return matches[0].parent
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}
export function nestedMeetingId(seriesId: string, event: GoogleEvent): string {
  if (!event.recurringEventId) return seriesId
  const original = event.originalStartTime ?? event.start
  const date = original.dateTime ? new Date(original.dateTime).toISOString() : original.date
  return `si_g_${seriesId}_${encodeURIComponent(date ?? event.id)}`
}

export function mergeNestedMeetings(parent: MeetingParent, incoming: SubItem[], seriesId: string): { subitems: SubItem[]; extra: Record<string, unknown> } {
  const extra = parent.extra ?? {}
  const dismissed = new Set(strings(extra.dismissedInstanceIds))
  const merged = [...(parent.subitems ?? [])]
  for (const fresh of incoming) {
    if (dismissed.has(fresh.id)) continue
    const idx = merged.findIndex(s => s.id === fresh.id)
    const previous = idx < 0 ? undefined : merged[idx]
    const sub: SubItem = {
      ...fresh,
      ...previous,
      // Calendar fields stay live; user-entered hours/owners/status and
      // other subitem fields survive. Never change the parent project.
      startDate: fresh.startDate, endDate: fresh.endDate,
      startTime: fresh.startTime, endTime: fresh.endTime,
      externalLink: fresh.externalLink, meetLink: fresh.meetLink,
      source: 'google', googleSeriesId: seriesId,
      status: previous?.statusOverride === 'active' ? (previous.status === 'Done' ? '' : previous.status)
        : previous?.statusOverride === 'done' || previous?.status === 'Done' ? 'Done'
          : previous?.status === 'Stuck' ? 'Stuck' : fresh.status === 'Done' ? 'Done' : previous?.status ?? fresh.status,
    }
    if (idx < 0) merged.push(sub)
    else merged[idx] = sub
  }
  return {
    subitems: merged,
    extra: { ...extra, googleMeetingSeriesIds: [...new Set([...strings(extra.googleMeetingSeriesIds), seriesId])] },
  }
}

const PARENT_FIELDS = 'id,name,board_id,group_id,status,source,external_link,deleted_at,updated_at,subitems,extra'

/** Optimistic compare-and-swap: a simultaneous human edit or another
 * calendar sync causes a fresh read + merge, never a stale JSON overwrite. */
export async function saveNestedMeetings(admin: SupabaseClient, parentId: string, incoming: SubItem[], seriesId: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await admin.from('board_items').select(PARENT_FIELDS).eq('id', parentId).single()
    if (error || !data) throw new Error('Project voor Google-meeting kon niet worden geladen')
    const parent = data as MeetingParent
    if (parent.deleted_at) return // A user deleted the project while this sync ran.
    const patch = mergeNestedMeetings(parent, incoming, seriesId)
    const stamp = new Date(Math.max(Date.now(), Date.parse(parent.updated_at ?? '') + 1 || 0)).toISOString()
    let update = admin.from('board_items').update({ ...patch, updated_at: stamp })
      .eq('id', parentId).is('deleted_at', null)
    update = parent.updated_at ? update.eq('updated_at', parent.updated_at) : update.is('updated_at', null)
    const result = await update.select('id')
    if (result.error) throw new Error(`Google-meeting opslaan mislukt: ${result.error.message}`)
    if (result.data?.length) return
  }
  throw new Error('Project werd tegelijk gewijzigd; Google-meeting wordt bij de volgende sync opnieuw geprobeerd')
}

export async function loadMeetingPlacement(admin: SupabaseClient) {
  const parents: MeetingParent[] = []
  // Supabase caps a response at 1000 rows. Page explicitly so older or
  // larger boards do not silently fall outside project matching/dedup.
  for (let start = 0; ; start += 500) {
    const { data, error } = await admin.from('board_items').select(PARENT_FIELDS).order('id').range(start, start + 499)
    if (error) throw new Error(`Projecten laden voor meetingrouting mislukt: ${error.message}`)
    const rows = (data ?? []) as MeetingParent[]
    parents.push(...rows)
    if (rows.length < 500) break
  }
  const { data: groups, error } = await admin.from('board_groups').select('id,name').is('deleted_at', null)
  if (error) throw new Error(`Agendagroepen laden mislukt: ${error.message}`)
  const activeGroups = new Set((groups ?? []).map(g => String(g.id)))
  const projectGroups = new Set((groups ?? []).filter(g => !/^(meetings?|doorlopend|done|vrij|google agenda|opkomend|toekomstig)\b/i.test(String(g.name).trim())).map(g => String(g.id)))
  const nestedIds = new Set(parents.flatMap(p => (p.subitems ?? []).map(s => s.id)))
  const seriesParents = new Map<string, MeetingParent>()
  for (const parent of parents) {
    for (const id of strings(parent.extra?.googleMeetingSeriesIds)) seriesParents.set(id, parent)
  }
  return {
    nestedIds,
    hasSeries: (id: string) => seriesParents.has(id),
    async place(seriesId: string, title: string, route: MeetingRoute, isNew: boolean, incoming: SubItem[]): Promise<boolean> {
      const existingParent = seriesParents.get(seriesId)
      // Keep all pre-existing/manual placements. A weak/no match stays as
      // a regular Google item in Meetings; it is not moved on a later sync.
      const parent = existingParent ?? (isNew && !nestedIds.has(seriesId)
        ? findMeetingProject(title, parents.filter(p => projectGroups.has(p.group_id)), route)
        : null)
      if (!parent) return false
      // A renamed recurring series can contain several unrelated projects.
      // Only auto-place the whole new series if every occurrence fits.
      if (!existingParent && incoming.some(s => !findMeetingProject(s.name, [parent], route))) return false
      if (parent.deleted_at || !activeGroups.has(parent.group_id)) return true
      // Respect instances that a user moved to a different parent.
      const own = new Set((parent.subitems ?? []).map(s => s.id))
      const eligible = incoming.filter(s => !nestedIds.has(s.id) || own.has(s.id))
      await saveNestedMeetings(admin, parent.id, eligible, seriesId)
      const patched = mergeNestedMeetings(parent, eligible, seriesId)
      Object.assign(parent, patched)
      seriesParents.set(seriesId, parent)
      for (const s of eligible) nestedIds.add(s.id)
      return true
    },
  }
}
