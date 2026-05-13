// Server-only: pulls events from connected Google calendars and upserts them
// as board_items rows. Triggered by /api/google/sync.

import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAccessToken, listEvents, type GoogleEvent } from './googleOAuth'
import teamData from '@/data/team.json'

// Map @studioyoko.nl emails → member-id, opgebouwd uit team.json. Bij
// shared meetings (Teamdag, weekstart, etc.) trekken we hieruit alle
// Yoko-deelnemers als mede-eigenaar van het item.
//
// Lookup is fuzzy: we normaliseren de local-part van een email (lowercase,
// strippen streepjes/punten) en vergelijken met member.id én een naam-
// hash. Daardoor matchen 'anne-fleur', 'annefleur', 'anne.fleur' alledrie
// op member-id 'anne-fleur', ook al staat er in team.json maar één variant.
function normEmailLocal(s: string): string {
  return s.toLowerCase().replace(/[.\-_]/g, '')
}
const MEMBER_KEYS: Array<{ id: string; keys: Set<string> }> = (teamData.members as Array<{ id: string; name: string; email?: string }>)
  .map(m => {
    const keys = new Set<string>()
    keys.add(normEmailLocal(m.id))
    if (m.email) keys.add(normEmailLocal(m.email.split('@')[0] ?? ''))
    if (m.name) keys.add(normEmailLocal(m.name.split(' ')[0] ?? ''))
    return { id: m.id, keys }
  })
function resolveAttendeeEmail(email: string): string | null {
  const e = email.toLowerCase().trim()
  if (!e.endsWith('@studioyoko.nl')) return null
  const local = normEmailLocal(e.split('@')[0] ?? '')
  if (!local) return null
  for (const { id, keys } of MEMBER_KEYS) {
    if (keys.has(local)) return id
  }
  return null
}

const WINDOW_DAYS_FUTURE = 56   // ~8 weeks ahead
const WINDOW_DAYS_PAST   = 180  // 6 months back — zodat recurring meetings
                                 //   ook hun historische instances meenemen
const AUTO_DONE_AFTER_DAYS = 3  // events waarvan de end-date > N dagen
                                 //   geleden is, worden auto op 'Done' gezet
                                 //   tenzij de gebruiker 'Stuck' heeft gezet

function isPastByDays(end: string | null | undefined, days: number): boolean {
  if (!end) return false
  const endTs = Date.parse(end)
  if (Number.isNaN(endTs)) return false
  return Date.now() - endTs > days * 86400000
}

function resolveStatus(existing: string | null | undefined, end: string | null | undefined): string {
  const prev = (existing ?? '').trim()
  // Stuck nooit overschrijven — daar wil de gebruiker bewust naar kijken.
  if (prev === 'Stuck') return prev
  // Door gebruiker handmatig op Done gezet? Laat staan.
  if (prev === 'Done') return prev
  if (isPastByDays(end, AUTO_DONE_AFTER_DAYS)) return 'Done'
  return prev
}

type GoogleCalRow = {
  id:             string
  user_id:        string
  calendar_id:    string
  calendar_name:  string | null
  board_id:       string | null
  refresh_token:  string
  access_token:   string | null
  expires_at:     string | null
}

type GroupRow = { id: string; board_id: string; name: string; color: string; collapsed: boolean; position: number }
type SubItemSnapshot = { id: string; name?: string; ownerIds?: string[]; status?: string; startDate?: string | null; endDate?: string | null; estHours?: number }
type ItemRow  = { id: string; group_id: string; board_id: string; external_id: string | null; status?: string | null; journal?: unknown; notes?: string | null; owner_ids?: string[] | null; subitems?: SubItemSnapshot[] | null }
type Rule     = { pattern: string; board_id: string }

function eventDates(ev: GoogleEvent): { start: string | null; end: string | null } {
  const s = ev.start.date ?? ev.start.dateTime?.slice(0, 10) ?? null
  const e = ev.end.date   ?? ev.end.dateTime?.slice(0, 10)   ?? null
  return { start: s, end: e }
}

// Estimate planning-hours from a Google event. Timed events use the actual
// duration; all-day events fall back to 8h × #days.
function eventHours(ev: GoogleEvent): number {
  if (ev.start.dateTime && ev.end.dateTime) {
    const ms = new Date(ev.end.dateTime).getTime() - new Date(ev.start.dateTime).getTime()
    return Math.max(0, Math.round((ms / 3600000) * 10) / 10)
  }
  if (ev.start.date && ev.end.date) {
    const days = Math.max(1, Math.round((new Date(ev.end.date).getTime() - new Date(ev.start.date).getTime()) / 86400000))
    return days * 8
  }
  return 0
}

// ─── Routing helpers ─────────────────────────────────────────────────────────
async function getRoutingRules(admin: SupabaseClient): Promise<Rule[]> {
  const { data } = await admin
    .from('calendar_routing_rules')
    .select('pattern, board_id')
    .eq('enabled', true)
    .order('position', { ascending: true })
  return ((data as Rule[] | null) ?? []).filter(r => r.pattern && r.board_id)
}

function routeEvent(name: string, defaultBoard: string, rules: Rule[]): string {
  const lc = (name || '').toLowerCase()
  for (const r of rules) {
    if (lc.includes(r.pattern.toLowerCase())) return r.board_id
  }
  return defaultBoard
}

async function ensureGoogleGroup(
  admin:   SupabaseClient,
  boardId: string,
): Promise<string> {
  // Voorkeur: de eerste/bovenste groep van het bord — daar zien gebruikers
  // hun nieuwe items meteen staan, ipv in een aparte 'Google Agenda' groep
  // die je makkelijk over het hoofd ziet. Als het bord nog leeg is maken we
  // alsnog een 'Google Agenda' groep aan zodat de sync ergens kan upserten.
  const { data: topRows } = await admin
    .from('board_groups').select('*')
    .eq('board_id', boardId)
    .order('position', { ascending: true })
    .limit(1)
  const top = (topRows as GroupRow[] | null)?.[0]
  if (top) return top.id

  const newId = `g_google_${boardId}_${Date.now()}`
  await admin.from('board_groups').insert({
    id:        newId,
    board_id:  boardId,
    name:      'Google Agenda',
    color:     '#B0C6EB',
    collapsed: false,
    position:  0,
  })
  return newId
}

async function ensureFreshAccessToken(
  admin: SupabaseClient,
  cal:   GoogleCalRow,
): Promise<string> {
  const expiresMs = cal.expires_at ? new Date(cal.expires_at).getTime() : 0
  if (cal.access_token && expiresMs > Date.now() + 60_000) return cal.access_token

  const fresh    = await refreshAccessToken(cal.refresh_token)
  const newExp   = new Date(Date.now() + fresh.expires_in * 1000).toISOString()
  await admin.from('google_calendars').update({
    access_token: fresh.access_token,
    expires_at:   newExp,
  }).eq('id', cal.id)
  return fresh.access_token
}

async function syncOneCalendar(admin: SupabaseClient, cal: GoogleCalRow): Promise<{ added: number; updated: number; removed: number }> {
  if (!cal.board_id) return { added: 0, updated: 0, removed: 0 }
  const accessToken = await ensureFreshAccessToken(admin, cal)

  // Routing-regels (substring → board). Wordt per event toegepast; valt
  // terug op cal.board_id wanneer geen enkele regel matcht.
  const rules = await getRoutingRules(admin)

  // Cache van Google Agenda groepen per bord — een event kan op elk bord
  // landen, dus we creëren de groep lazy voor elk uniek bord dat we raken.
  const groupCache = new Map<string, string>()
  async function getGroupFor(boardId: string): Promise<string> {
    const cached = groupCache.get(boardId)
    if (cached) return cached
    const gid = await ensureGoogleGroup(admin, boardId)
    groupCache.set(boardId, gid)
    return gid
  }

  // Look up the connecting user's member_id so synced events show up in their
  // planning timeline. Fallback: als member_id (nog) leeg is — bv. omdat de
  // gebruiker net is aangemaakt en zijn ProfileSetup tegelijk met de eerste
  // sync werd ingevuld — proberen we te raden via de voornaam in profiles.name.
  const { data: profileRow } = await admin
    .from('profiles').select('member_id, name').eq('user_id', cal.user_id).single()
  const pRow = profileRow as { member_id: string | null; name: string | null } | null
  let memberId = pRow?.member_id ?? null
  if (!memberId && pRow?.name) {
    const first = pRow.name.split(' ')[0]?.toLowerCase() ?? ''
    // Match tegen een vaste set teamleden — voorkomt dat een andere
    // gebruiker per ongeluk wordt geclaimd.
    const known = ['menno','vincent','odette','anne-fleur','kars']
    const hit = known.find(k => k === first || k.startsWith(first) || first.startsWith(k))
    if (hit) memberId = hit
  }
  const ownerIds = memberId ? [memberId] : []

  // Voor een event: alle Yoko-deelnemers die niet hebben afgezegd worden
  // mede-eigenaar. Valt terug op de calendar-owner als er geen attendees
  // zijn (bv. private events). Per-persoon-uren = de eventduur (iedereen
  // is de hele meeting aanwezig); totaal-est-hours = duur × N personen
  // zodat de planning-werkbelasting de werkelijke groepsuren toont.
  function ownersForEvent(ev: GoogleEvent): { owners: string[]; perPerson: number; total: number } {
    const dur = eventHours(ev)
    const ats = ev.attendees ?? []
    const yokos = new Set<string>()
    for (const a of ats) {
      const email = a.email
      if (!email) continue
      if (a.responseStatus === 'declined') continue
      const id = resolveAttendeeEmail(email)
      if (id) yokos.add(id)
    }
    // De calendar-owner zélf staat soms niet in de attendees-lijst (single-
    // person events) — toch meenemen.
    if (memberId) yokos.add(memberId)
    const owners = [...yokos]
    if (owners.length === 0) return { owners: ownerIds, perPerson: dur, total: dur }
    return { owners, perPerson: dur, total: dur * owners.length }
  }

  const now     = new Date()
  const timeMin = new Date(now.getTime() - WINDOW_DAYS_PAST   * 86400000).toISOString()
  const timeMax = new Date(now.getTime() + WINDOW_DAYS_FUTURE * 86400000).toISOString()
  const events  = await listEvents(accessToken, cal.calendar_id, timeMin, timeMax)

  // Bestaande items uit DEZE calendar — over alle boards heen (een event kan
  // van bord verhuizen wanneer een routing-regel toegevoegd of gewijzigd is).
  // Trek óók status/journal/owner_ids mee zodat we user-edits niet
  // overschrijven bij de volgende Google-sync.
  const { data: existingRows } = await admin
    .from('board_items')
    .select('id, group_id, board_id, external_id, status, journal, owner_ids, subitems')
    .eq('source',           'google')
    .eq('external_user_id', cal.user_id)
    .eq('calendar_id',      cal.calendar_id)

  const existing = (existingRows as ItemRow[] | null) ?? []
  const byExt    = new Map(existing.map(r => [r.external_id, r.id]))
  const byExtFull = new Map(existing.map(r => [r.external_id, r]))

  // Group recurring events by their master ID so each recurring meeting
  // becomes ONE board_item with subitems for each instance. Single events
  // (no recurringEventId) stay as their own item.
  //
  // We negeren ook events waarvan:
  //  - de status 'cancelled' is (afgezegd)
  //  - de transparency 'transparent' is (in Google als "Free" gemarkeerd)
  //  - de gebruiker zelf 'declined' heeft (afgewezen) of nog op 'needsAction' staat
  //    en waar minstens één andere attendee al iets heeft beslist — dat is
  //    typisch een uitnodiging die de gebruiker stil heeft genegeerd. We laten
  //    'needsAction' wel staan als die persoon zelf de organizer is.
  const validEvents = events.filter(ev => {
    if (ev.status === 'cancelled') return false
    if (ev.transparency === 'transparent') return false
    const self = ev.attendees?.find(a => a.self)
    if (self?.responseStatus === 'declined') return false
    const { start } = eventDates(ev)
    return !!start
  })
  const groupedByRec = new Map<string, GoogleEvent[]>()
  for (const ev of validEvents) {
    const key = ev.recurringEventId ?? ev.id
    const arr = groupedByRec.get(key) ?? []
    arr.push(ev)
    groupedByRec.set(key, arr)
  }

  const seenExt: Set<string> = new Set()
  let added = 0, updated = 0
  const upserts: Record<string, unknown>[] = []

  for (const [groupKey, instances] of groupedByRec) {
    if (instances.length === 1) {
      // Single, non-recurring event
      const ev = instances[0]
      const { start, end } = eventDates(ev)
      if (!start) continue
      const name        = ev.summary ?? '(geen titel)'
      const targetBoard = routeEvent(name, cal.board_id, rules)
      const targetGroup = await getGroupFor(targetBoard)
      seenExt.add(ev.id)
      const existingId  = byExt.get(ev.id)
      const existingRow = byExtFull.get(ev.id)
      const id          = existingId ?? `it_g_${ev.id}_${cal.user_id.slice(0, 8)}`
      if (existingId) updated++; else added++
      // Bewaar handmatige verplaatsingen — als de gebruiker het item naar
      // een Done-groep of ander bord heeft gesleept, mag Google die niet
      // weer terugsturen naar de target-groep volgens de route-regels.
      const keepBoard = existingRow?.board_id ?? targetBoard
      const keepGroup = existingRow?.group_id ?? targetGroup
      const eventOwners = ownersForEvent(ev)
      // Union van bestaande + Google-attendees: bestaande user-toevoegingen
      // blijven staan, en nieuwe Yoko-deelnemers uit Google worden vanzelf
      // toegevoegd. (Vorige variant 'als er al iets staat → niet aanraken'
      // betekende dat Vincent/Anne-Fleur op een Teamdag nooit binnenkwamen.)
      const ownerSet = new Set<string>(existingRow?.owner_ids ?? [])
      for (const o of eventOwners.owners) ownerSet.add(o)
      const finalOwners = [...ownerSet]
      // per-persoon uren in ownerHours, totaal in est_hours zodat
      // workload-berekeningen per persoon kloppen.
      const ownerHoursMap: Record<string, number> = {}
      for (const oid of finalOwners) ownerHoursMap[oid] = eventOwners.perPerson
      upserts.push({
        id,
        group_id:           keepGroup,
        board_id:           keepBoard,
        name,
        owner_ids:          finalOwners,
        status:             resolveStatus(existingRow?.status, end ?? start),
        start_date:         start,
        end_date:           end ?? start,
        deadline:           null,
        est_hours:          eventOwners.perPerson * finalOwners.length,
        dagen:              0,
        notes:              ev.description ?? null,
        contactpersoon:     null, uitzenddag: null, framelink: null, nummers: null,
        subitems:           [],
        journal:            existingRow?.journal ?? [],
        extra:              { ownerHours: ownerHoursMap },
        position:            0,
        source:              'google',
        external_id:         ev.id,
        external_link:       ev.htmlLink ?? null,
        external_synced_at:  new Date().toISOString(),
        external_user_id:    cal.user_id,
        calendar_id:         cal.calendar_id,
        updated_at:          new Date().toISOString(),
      })
      continue
    }

    // Recurring meeting: build one parent + subitem per instance
    const sorted = [...instances].sort((a, b) => {
      const sa = eventDates(a).start ?? ''; const sb = eventDates(b).start ?? ''
      return sa.localeCompare(sb)
    })
    // Only mark the groupKey as seen — individual instance IDs are NOT
    // separate rows. If older syncs created per-instance rows, they'll
    // be missing from seenExt and get cleaned up below.
    seenExt.add(groupKey)
    const baseName    = sorted[0].summary ?? '(geen titel)'
    const targetBoard = routeEvent(baseName, cal.board_id, rules)
    const targetGroup = await getGroupFor(targetBoard)
    const minStart = eventDates(sorted[0]).start
    const maxEnd   = eventDates(sorted[sorted.length - 1]).end ?? eventDates(sorted[sorted.length - 1]).start
    // Voor recurring nemen we de owners van de meeste recente instantie —
    // attendee-lijsten zijn meestal hetzelfde over alle herhalingen.
    const groupOwners = ownersForEvent(sorted[sorted.length - 1])
    const existingId  = byExt.get(groupKey)
    const existingRow = byExtFull.get(groupKey)
    const ownerSet = new Set<string>(existingRow?.owner_ids ?? [])
    for (const o of groupOwners.owners) ownerSet.add(o)
    const finalOwners = [...ownerSet]
    const totalHours = sorted.reduce((s, ev) => s + eventHours(ev), 0) * finalOwners.length
    const ownerHoursMap: Record<string, number> = {}
    const perPersonTotal = sorted.reduce((s, ev) => s + eventHours(ev), 0)
    for (const oid of finalOwners) ownerHoursMap[oid] = perPersonTotal
    // Bouw een lookup van bestaande subitems zodat user-edits (status Done,
    // hernoemen, owner-aanpassingen) bij elke sync behouden blijven.
    const priorSubs = Array.isArray(existingRow?.subitems) ? existingRow!.subitems! : []
    const priorById = new Map<string, SubItemSnapshot>(priorSubs.map(s => [s.id, s]))
    const subitems = sorted.map(ev => {
      const { start, end } = eventDates(ev)
      const dateLabel = start ? new Date(start).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
      const sid  = `si_g_${ev.id}`
      const prev = priorById.get(sid)
      return {
        id:        sid,
        // Bewaar handmatig hernoemde subitems; anders standaard de datum-label.
        name:      prev?.name && prev.name !== '—' && !/^[a-z]{2,3}\s+\d/i.test(prev.name) ? prev.name : dateLabel,
        ownerIds:  prev?.ownerIds && prev.ownerIds.length > 0 ? prev.ownerIds : finalOwners,
        status:    resolveStatus(prev?.status, end ?? start),
        startDate: start,
        endDate:   end ?? start,
        estHours:  eventHours(ev) * finalOwners.length,
      }
    })
    const id          = existingId ?? `it_g_${groupKey}_${cal.user_id.slice(0, 8)}`
    if (existingId) updated++; else added++
    const keepBoard = existingRow?.board_id ?? targetBoard
    const keepGroup = existingRow?.group_id ?? targetGroup
    upserts.push({
      id,
      group_id:           keepGroup,
      board_id:           keepBoard,
      name:               baseName + ` (${instances.length}×)`,
      owner_ids:          finalOwners,
      status:             resolveStatus(existingRow?.status, maxEnd ?? minStart),
      start_date:         minStart,
      end_date:           maxEnd ?? minStart,
      deadline:           null,
      est_hours:          totalHours,
      dagen:              0,
      notes:              sorted[0].description ?? null,
      contactpersoon:     null, uitzenddag: null, framelink: null, nummers: null,
      subitems,
      journal:            existingRow?.journal ?? [],
      extra:              { ownerHours: ownerHoursMap },
      position:            0,
      source:              'google',
      external_id:         groupKey,
      external_link:       sorted[0].htmlLink ?? null,
      external_synced_at:  new Date().toISOString(),
      external_user_id:    cal.user_id,
      calendar_id:         cal.calendar_id,
      updated_at:          new Date().toISOString(),
    })
  }

  if (upserts.length > 0) {
    await admin.from('board_items').upsert(upserts, { onConflict: 'id' })
  }

  // Remove events that no longer exist (or were cancelled) remotely
  const toRemove = existing.filter(r => r.external_id && !seenExt.has(r.external_id)).map(r => r.id)
  let removed = 0
  if (toRemove.length > 0) {
    await admin.from('board_items').delete().in('id', toRemove)
    removed = toRemove.length
  }

  // Auto-cleanup: delete any non-google rows on this board whose name matches
  // a synced Google item (catches XLSX import duplicates and stale per-instance
  // rows from older sync versions). Strip the "(N×)" recurring suffix so the
  // base title also matches.
  const upsertedNames = new Set<string>()
  for (const u of upserts) {
    const name = String(u.name ?? '').trim()
    if (!name) continue
    upsertedNames.add(name)
    upsertedNames.add(name.replace(/\s*\(\d+×\)\s*$/, '').trim())
  }
  // Dedup zoekt op ALLE boards die we via routing geraakt hebben, niet
  // alleen het default-bord. Een UvVL-event landt nu op Vlaanderen, dus
  // de XLSX-duplicaat staat ook dáár.
  const boardsTouched = new Set<string>([cal.board_id])
  for (const u of upserts) boardsTouched.add(String(u.board_id))
  if (upsertedNames.size > 0) {
    const { data: dupRows } = await admin
      .from('board_items')
      .select('id, source')
      .in('board_id', Array.from(boardsTouched))
      .in('name', Array.from(upsertedNames))
    const dupIds = ((dupRows as { id: string; source: string | null }[] | null) ?? [])
      .filter(r => r.source !== 'google')
      .map(r => r.id)
    if (dupIds.length > 0) {
      await admin.from('board_items').delete().in('id', dupIds)
      removed += dupIds.length
    }
  }

  await admin.from('google_calendars').update({ last_sync_at: new Date().toISOString() }).eq('id', cal.id)
  return { added, updated, removed }
}

export async function syncCalendarsForUser(admin: SupabaseClient, userId: string) {
  const { data: cals } = await admin
    .from('google_calendars').select('*').eq('user_id', userId)
  const list = (cals as GoogleCalRow[] | null) ?? []

  const results: Array<{ calendarId: string; added: number; updated: number; removed: number; error?: string }> = []
  for (const c of list) {
    try {
      const r = await syncOneCalendar(admin, c)
      results.push({ calendarId: c.calendar_id, ...r })
    } catch (e) {
      results.push({ calendarId: c.calendar_id, added: 0, updated: 0, removed: 0, error: String(e).slice(0, 200) })
    }
  }
  return results
}
