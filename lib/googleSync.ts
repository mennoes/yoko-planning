// Server-only: pulls events from connected Google calendars and upserts them
// as board_items rows. Triggered by /api/google/sync.

import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAccessToken, listEvents, type GoogleEvent } from './googleOAuth'
import teamData from '@/data/team.json'
import { isVrijTitle } from './workloadCategory'

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

// Vooruitblik beperken tot 2 weken: anders explodeert een recurring meeting
// als 30+ subitems en wordt het bord onleesbaar. De sync draait elke 5
// minuten (én bij elke pageload), dus nieuwe instances binnen de horizon
// komen automatisch binnen rollen zonder dat de gebruiker iets hoeft te
// doen. 14 dagen geeft genoeg ruimte voor 'wat staat er deze + volgende
// week'.
const WINDOW_DAYS_FUTURE = 14
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

// Voor recurring meetings (Weekstart, dagelijkse stand-up, etc.) is "Doorlopend"
// een betekenisvollere standaardstatus dan een lege string of 'Working'. De
// gebruiker mag 'm nog steeds handmatig op Done/Stuck zetten — dat respecteren
// we. Als de hele reeks > N dagen geleden afliep (laatste instance voorbij)
// vallen we terug op de normale auto-Done.
function resolveRecurringStatus(existing: string | null | undefined, lastEnd: string | null | undefined): string {
  const prev = (existing ?? '').trim()
  if (prev === 'Stuck') return prev
  if (prev === 'Done')  return prev
  if (isPastByDays(lastEnd, AUTO_DONE_AFTER_DAYS)) return 'Done'
  return 'Doorlopend'
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
type SubItemSnapshot = { id: string; name?: string; ownerIds?: string[]; status?: string; startDate?: string | null; endDate?: string | null; startTime?: string | null; endTime?: string | null; estHours?: number; meetLink?: string | null; externalLink?: string | null }
type ItemRow  = { id: string; group_id: string; board_id: string; external_id: string | null; ical_uid?: string | null; status?: string | null; journal?: unknown; notes?: string | null; owner_ids?: string[] | null; external_user_id?: string | null; subitems?: SubItemSnapshot[] | null; position?: number | null; est_hours?: number | null; extra?: Record<string, unknown> | null }
type Rule     = { pattern: string; board_id: string }

function eventDates(ev: GoogleEvent): { start: string | null; end: string | null } {
  const s = ev.start.date ?? ev.start.dateTime?.slice(0, 10) ?? null
  const e = ev.end.date   ?? ev.end.dateTime?.slice(0, 10)   ?? null
  return { start: s, end: e }
}

// Pakt HH:MM uit ev.start.dateTime / ev.end.dateTime — alleen aanwezig
// bij timed events (geen all-day). Wordt in extra.startTime / extra.endTime
// opgeslagen zodat de Week-view ze op uur-positie kan renderen.
function eventTimes(ev: GoogleEvent): { startTime: string | null; endTime: string | null } {
  const startTime = ev.start.dateTime ? ev.start.dateTime.slice(11, 16) : null
  const endTime   = ev.end.dateTime   ? ev.end.dateTime.slice(11, 16)   : null
  return { startTime, endTime }
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

// Recurring events krijgen géén opgedrongen "Doorlopend"-groep meer. Als de
// gebruiker zo'n groep heeft staan (case-insensitive op naam) gebruiken we
// die voor nieuwe recurring meetings; anders vallen we terug op dezelfde
// target-groep als losse events. Auto-aanmaken of repositioneren doen we
// niet — wat de gebruiker hernoemt of weggooit blijft hernoemd of weg.
async function ensureDoorlopendGroup(
  admin:   SupabaseClient,
  boardId: string,
): Promise<string> {
  const { data: rows } = await admin
    .from('board_groups').select('id, name, position')
    .eq('board_id', boardId)
    .order('position', { ascending: true })
  const groups = (rows as { id: string; name: string; position: number }[] | null) ?? []
  const existing = groups.find(g => g.name.toLowerCase() === 'doorlopend')
  if (existing) return existing.id
  // Geen Doorlopend-groep aanwezig (omdat de gebruiker 'm verwijderd of
  // hernoemd heeft) → fallback naar de standaard Google-groep.
  return await ensureGoogleGroup(admin, boardId)
}

// Done-groep — gebruikers willen items die op Done staan terugzien in een
// vaste Done-bucket, ook voor gcal-rijen. We hergebruiken een bestaande
// groep met die naam (case-insensitive); anders maken we 'm onderaan aan.
// Niet renummeren — Done hoort onderaan en de client behandelt 'm hetzelfde.
async function ensureDoneGroup(
  admin:   SupabaseClient,
  boardId: string,
): Promise<string> {
  const { data: rows } = await admin
    .from('board_groups').select('id, name')
    .eq('board_id', boardId)
    .ilike('name', 'done')
    .limit(1)
  const existing = (rows as { id: string; name: string }[] | null)?.[0]
  if (existing) return existing.id

  const { data: posRows } = await admin
    .from('board_groups').select('position')
    .eq('board_id', boardId)
    .order('position', { ascending: false })
    .limit(1)
  const maxPos = (posRows as { position: number }[] | null)?.[0]?.position ?? -1

  const newId = `g_done_${boardId}_${Date.now()}`
  await admin.from('board_groups').insert({
    id:        newId,
    board_id:  boardId,
    name:      'Done',
    color:     '#9aa39a',
    collapsed: true,
    position:  maxPos + 1,
  })
  return newId
}

// Vrij/Vakantie-groep — events met titels als 'Vrij', 'Vakantie', 'Verlof',
// 'Ziek' of een feestdag horen niet tussen losse projecten te staan. We
// bundelen ze in een aparte 'Vrij'-groep zodat de planning meteen duidelijk
// maakt wie wanneer afwezig is. Bestaande groep met die naam wordt
// hergebruikt; anders aanmaken onderaan het bord.
async function ensureVrijGroup(
  admin:   SupabaseClient,
  boardId: string,
): Promise<string> {
  const { data: rows } = await admin
    .from('board_groups').select('id, name')
    .eq('board_id', boardId)
    .ilike('name', 'vrij')
    .limit(1)
  const existing = (rows as { id: string; name: string }[] | null)?.[0]
  if (existing) return existing.id

  const { data: posRows } = await admin
    .from('board_groups').select('position')
    .eq('board_id', boardId)
    .order('position', { ascending: false })
    .limit(1)
  const maxPos = (posRows as { position: number }[] | null)?.[0]?.position ?? -1

  const newId = `g_vrij_${boardId}_${Date.now()}`
  await admin.from('board_groups').insert({
    id:        newId,
    board_id:  boardId,
    name:      'Vrij',
    color:     '#3db883',
    collapsed: false,
    position:  maxPos + 1,
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
  // Fallback-bord: vroeger was cal.board_id verplicht en sloegen we kalenders
  // zonder selectie over. Dat dwong de user om per kalender een bord te
  // kiezen. Nu: routing-regels per event bepalen het juiste bord; events
  // zonder match landen op het eerste bord in de registry (of cal.board_id
  // als die nog gezet is voor backwards compat).
  let defaultBoard = cal.board_id
  if (!defaultBoard) {
    const { data: bRow } = await admin
      .from('boards').select('id').order('position', { ascending: true }).limit(1)
    defaultBoard = (bRow as { id: string }[] | null)?.[0]?.id ?? null
  }
  if (!defaultBoard) return { added: 0, updated: 0, removed: 0 }
  const fallbackBoard: string = defaultBoard
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

  // Aparte cache voor de Doorlopend-groep — recurring events landen hier
  // i.p.v. tussen losse projecten.
  const doorlopendCache = new Map<string, string>()
  async function getDoorlopendGroupFor(boardId: string): Promise<string> {
    const cached = doorlopendCache.get(boardId)
    if (cached) return cached
    const gid = await ensureDoorlopendGroup(admin, boardId)
    doorlopendCache.set(boardId, gid)
    return gid
  }

  // Done-groep cache: zodra een event status='Done' krijgt routen we 'm
  // hierheen i.p.v. naar Doorlopend/Losse projecten. De client doet hetzelfde
  // via autoMoveDoneItems, maar dat draait pas bij user-acties — door hier
  // ook te routen sluit het visueel direct na de sync aan.
  const doneCache = new Map<string, string>()
  async function getDoneGroupFor(boardId: string): Promise<string> {
    const cached = doneCache.get(boardId)
    if (cached) return cached
    const gid = await ensureDoneGroup(admin, boardId)
    doneCache.set(boardId, gid)
    return gid
  }

  // Vrij-groep cache: events met 'Vrij'/'Vakantie'/'Verlof'-achtige titels
  // landen hier i.p.v. tussen losse projecten.
  const vrijCache = new Map<string, string>()
  async function getVrijGroupFor(boardId: string): Promise<string> {
    const cached = vrijCache.get(boardId)
    if (cached) return cached
    const gid = await ensureVrijGroup(admin, boardId)
    vrijCache.set(boardId, gid)
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
    .select('id, group_id, board_id, external_id, ical_uid, status, journal, owner_ids, subitems, external_user_id, position, est_hours, extra')
    .eq('source',           'google')
    .eq('external_user_id', cal.user_id)
    .eq('calendar_id',      cal.calendar_id)

  const existing = (existingRows as ItemRow[] | null) ?? []
  const byExt    = new Map(existing.map(r => [r.external_id, r.id]))
  const byExtFull = new Map(existing.map(r => [r.external_id, r]))

  // Verzamel alle item-id's die ergens al als subitem zijn ingenest. Wanneer
  // een gebruiker een Google-item handmatig onder een ander item heeft
  // gesleept, wordt de top-level row verwijderd en blijft alleen de
  // subitem-entry in het parent-item bestaan. Zonder deze check zou de
  // eerstvolgende sync 'm opnieuw top-level aanmaken en zou de nesting bij
  // elke refresh "verdwijnen". Door deze id's te skippen blijft de nesting
  // permanent staan over syncs heen.
  const { data: subParents } = await admin
    .from('board_items')
    .select('subitems')
    .not('subitems', 'is', null)
  const nestedIds = new Set<string>()
  for (const r of (subParents as { subitems: SubItemSnapshot[] | null }[] | null) ?? []) {
    for (const s of (r.subitems ?? [])) if (s?.id) nestedIds.add(s.id)
  }

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
    if (!start) return false
    // FILTER: alleen meetings (2+ attendees) en Vrij/vakantie-events
    // komen in het systeem. Solo blok-events ('Tijd voor mezelf',
    // 'Focus tijd', etc.) zijn niet zinvol voor team-planning en
    // maken het overzicht alleen vol. Vrij-events blijven omdat ze
    // afwezigheid signaleren.
    const attendeeCount = (ev.attendees ?? []).length
    if (attendeeCount >= 2) return true
    if (isVrijTitle(ev.summary ?? '')) return true
    return false
  })
  const groupedByRec = new Map<string, GoogleEvent[]>()
  for (const ev of validEvents) {
    const key = ev.recurringEventId ?? ev.id
    const arr = groupedByRec.get(key) ?? []
    arr.push(ev)
    groupedByRec.set(key, arr)
  }

  // iCalUID is stabiel over kalender-eigenaren heen: dezelfde meeting in
  // Menno's én Vincent's agenda heeft dezelfde iCalUID. Daarmee herkennen
  // we gedeelde events en voorkomen we dat elke teamleden-sync een eigen
  // duplicate rij maakt. Eén iCalUID per groupKey — voor recurring nemen
  // we de iCalUID van de eerste instance.
  function iCalKeyForGroup(instances: GoogleEvent[]): string | null {
    for (const ev of instances) {
      if (ev.iCalUID) return ev.iCalUID
    }
    return null
  }
  const wantedICals: string[] = []
  for (const instances of groupedByRec.values()) {
    const u = iCalKeyForGroup(instances)
    if (u) wantedICals.push(u)
  }
  // Lookup gedeelde rijen die ANDERE users al hebben aangemaakt voor deze
  // events. Bij een match hergebruiken we hun id (i.p.v. eigen kopie maken)
  // zodat comments/journal/workload-overrides behouden blijven.
  const sharedByICal = new Map<string, ItemRow>()
  if (wantedICals.length > 0) {
    const { data: sharedRows } = await admin
      .from('board_items')
      .select('id, group_id, board_id, external_id, ical_uid, status, journal, owner_ids, subitems, external_user_id, position, est_hours, extra')
      .eq('source', 'google')
      .in('ical_uid', Array.from(new Set(wantedICals)))
    for (const r of (sharedRows as ItemRow[] | null) ?? []) {
      if (!r.ical_uid) continue
      const prev = sharedByICal.get(r.ical_uid)
      // Kies deterministisch dezelfde "canonical" rij over concurrent syncs heen:
      // de rij met de laagste id wint (alfabetisch).
      if (!prev || r.id < prev.id) sharedByICal.set(r.ical_uid, r)
    }
  }

  // Helper: vind de bestaande rij voor dit event, bij voorkeur via iCalUID.
  // Fallback: mijn eigen historische rij via external_id (oude id-vorm met
  // user-prefix). Dat zorgt dat we naadloos migreren zonder data te verliezen.
  function findExistingFor(icalUid: string | null, extId: string): { row: ItemRow | undefined; id: string } {
    if (icalUid) {
      const shared = sharedByICal.get(icalUid)
      if (shared) return { row: shared, id: shared.id }
    }
    const mineId = byExt.get(extId)
    const mineRow = byExtFull.get(extId)
    if (mineRow) return { row: mineRow, id: mineRow.id }
    if (mineId) return { row: undefined, id: mineId }
    // Nieuwe rij — canonical id-vorm op basis van iCalUID zodat een
    // volgende sync door een ander teamlid op dezelfde rij landt.
    const newId = icalUid ? `it_g_${icalUid}` : `it_g_${extId}_${cal.user_id.slice(0, 8)}`
    return { row: undefined, id: newId }
  }

  const seenExt: Set<string> = new Set()
  // Track ook welke shared-rij-ids we deze sync hebben aangeraakt; cleanup
  // verwijdert alleen rijen die nog steeds van MIJ zijn én die ik nu niet zag.
  const seenIds: Set<string> = new Set()
  let added = 0, updated = 0
  const upserts: Record<string, unknown>[] = []

  for (const [groupKey, instances] of groupedByRec) {
    if (instances.length === 1) {
      // Single, non-recurring event
      const ev = instances[0]
      const { start, end } = eventDates(ev)
      if (!start) continue
      const name        = ev.summary ?? '(geen titel)'
      const targetBoard = routeEvent(name, fallbackBoard, rules)
      const targetGroup = await getGroupFor(targetBoard)
      seenExt.add(ev.id)
      const icalUid     = ev.iCalUID ?? null
      const lookup      = findExistingFor(icalUid, ev.id)
      const existingRow = lookup.row
      const id          = lookup.id
      seenIds.add(id)
      // Item is door gebruiker als subitem ergens ingenest — niet opnieuw
      // top-level aanmaken. seenIds is al gemarkeerd zodat de cleanup-pass
      // het ook niet aanraakt.
      if (nestedIds.has(id)) continue
      if (existingRow) updated++; else added++
      // Bewaar handmatige verplaatsingen — als de gebruiker het item naar
      // een Done-groep of ander bord heeft gesleept, mag Google die niet
      // weer terugsturen naar de target-groep volgens de route-regels.
      const keepBoard = existingRow?.board_id ?? targetBoard
      const newStatus = resolveStatus(existingRow?.status, end ?? start)
      // Vrij/Vakantie-events bundelen we in een eigen Vrij-groep zodat
      // afwezigheid meteen herkenbaar is in het bord. Done heeft daarna
      // voorrang (events kunnen oud-en-afgehandeld zijn). Anders volgen we
      // bestaande logica: gebruiker-keuze respecteren, anders targetGroup.
      const isVrij = isVrijTitle(name)
      // existingRow.group_id ALTIJD respecteren — ook wanneer status nu
      // Done is. Zonder die respect schoof een sync de gebruiker z'n
      // handmatige verplaatsing terug naar de Done-groep (klassiek probleem:
      // 'ik heb het zojuist uit Done gehaald en nu staat het er weer').
      // Voor NIEUWE rijen (zonder existingRow) defaulten we op de juiste
      // status/Vrij/target-startpositie.
      const keepGroup = existingRow?.group_id
        ?? (newStatus === 'Done'
              ? await getDoneGroupFor(keepBoard)
              : (isVrij ? await getVrijGroupFor(keepBoard) : targetGroup))
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
        status:             newStatus,
        start_date:         start,
        end_date:           end ?? start,
        deadline:           null,
        // Bestaande est_hours behouden — gebruiker mag uren bijstellen
        // via de planning-detail-popup (radial chart / Est Time veld).
        // Sync zou anders elke 5 min terugzetten naar de Google-default.
        est_hours:          existingRow?.est_hours ?? (eventOwners.perPerson * finalOwners.length),
        dagen:              0,
        notes:              ev.description ?? null,
        contactpersoon:     null, uitzenddag: null, framelink: null, nummers: null,
        subitems:           [],
        journal:            existingRow?.journal ?? [],
        extra:              (() => {
          // ownerHours uit existingRow.extra prevaleren (user-edits in
          // de radial); fallback op de net-uit-Google-attendees berekende
          // verdeling. Time/Meet-velden blijven door de sync gemanaged.
          const exExtra = (existingRow?.extra ?? {}) as Record<string, unknown>
          const exOwnerHours = exExtra.ownerHours as Record<string, number> | undefined
          return {
            ownerHours: exOwnerHours && Object.keys(exOwnerHours).length > 0 ? exOwnerHours : ownerHoursMap,
            ...(() => { const t = eventTimes(ev); return t.startTime || t.endTime ? { startTime: t.startTime, endTime: t.endTime } : {} })(),
            ...(ev.hangoutLink ? { meetLink: ev.hangoutLink } : {}),
          }
        })(),
        // Position bewaren als er al een rij was — anders sprong een
        // handmatig gesleept item bij elke sync terug naar bovenaan.
        position:            existingRow?.position ?? 0,
        source:              'google',
        external_id:         ev.id,
        ical_uid:            icalUid,
        external_link:       ev.htmlLink ?? null,
        external_synced_at:  new Date().toISOString(),
        // Niet overschrijven als een ander teamlid deze rij eerst heeft
        // aangemaakt — anders verliezen we hun ownership-spoor en kapt de
        // cleanup straks van een andere user de rij weg.
        external_user_id:    existingRow?.external_user_id ?? cal.user_id,
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
    const targetBoard = routeEvent(baseName, fallbackBoard, rules)
    const targetGroup = await getDoorlopendGroupFor(targetBoard)
    const minStart = eventDates(sorted[0]).start
    const maxEnd   = eventDates(sorted[sorted.length - 1]).end ?? eventDates(sorted[sorted.length - 1]).start
    // Voor recurring nemen we de owners van de meeste recente instantie —
    // attendee-lijsten zijn meestal hetzelfde over alle herhalingen.
    const groupOwners = ownersForEvent(sorted[sorted.length - 1])
    const icalUid     = iCalKeyForGroup(sorted)
    const lookup      = findExistingFor(icalUid, groupKey)
    const existingRow = lookup.row
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
      const { startTime, endTime } = eventTimes(ev)
      const dateLabel = start ? new Date(start).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
      const sid  = `si_g_${ev.id}`
      const prev = priorById.get(sid)
      // Naam-bepaling voor recurring instances, prioriteit:
      //   1. Heeft de gebruiker dit specifieke event in Google een eigen
      //      titel gegeven (anders dan de master)? → die Google-titel
      //      gebruiken. Vangt cases af zoals 'NL College S04 E40' waar
      //      elke aflevering een eigen titel krijgt op een recurring slot.
      //   2. Heeft de gebruiker 'm in de tool handmatig hernoemd (prev
      //      ≠ dateLabel-formaat)? → die handmatige naam bewaren.
      //   3. Fallback: het dag-datum-label ('ma 26 mei').
      const evTitle = (ev.summary ?? '').trim()
      const instanceRenamedInGoogle = evTitle.length > 0 && evTitle !== baseName.trim()
      const subitemName = instanceRenamedInGoogle
        ? evTitle
        : (prev?.name && prev.name !== '—' && !/^[a-z]{2,3}\s+\d/i.test(prev.name)
            ? prev.name
            : dateLabel)
      return {
        id:        sid,
        name:      subitemName,
        ownerIds:  prev?.ownerIds && prev.ownerIds.length > 0 ? prev.ownerIds : finalOwners,
        status:    resolveStatus(prev?.status, end ?? start),
        startDate: start,
        endDate:   end ?? start,
        startTime,
        endTime,
        estHours:  eventHours(ev) * finalOwners.length,
        // Per-instance Meet-link — sommige reeksen verschillen per moment.
        meetLink:  ev.hangoutLink ?? prev?.meetLink ?? null,
        // Per-instance Google-Calendar-link — zo kan de UI naar de juiste
        // datum springen ipv het master-event.
        externalLink: ev.htmlLink ?? prev?.externalLink ?? null,
        source:    'google' as const,
      }
    })
    const id          = lookup.id
    seenIds.add(id)
    // Door gebruiker genest onder een ander item → niet opnieuw top-level
    // aanmaken bij volgende syncs.
    if (nestedIds.has(id)) continue
    if (existingRow) updated++; else added++
    const keepBoard = existingRow?.board_id ?? targetBoard
    const newStatus = resolveRecurringStatus(existingRow?.status, maxEnd ?? minStart)
    // Groep-keuze prioriteit: Done > Vrij > Doorlopend.
    //  - Done items horen in de Done-groep (ook wanneer de gebruiker zelf
    //    op Done klikt of de hele reeks > 3 dagen geleden afliep).
    //  - Recurring 'Vrij'/'Vakantie' etc. landen in de Vrij-groep zodat
    //    afwezigheid herkenbaar blijft.
    //  - Anders gaan recurring items naar de Doorlopend-groep van hun
    //    huidige bord, óók als ze ooit in 'Losse projecten' belandden.
    // Manuele bord-verplaatsingen (keepBoard) blijven gerespecteerd.
    const isVrij = isVrijTitle(baseName)
    // Eerst kijken of de gebruiker dit item al naar een eigen groep heeft
    // verplaatst — die keuze respecteren we. Alleen Done schuift er overheen
    // (Done-bucket is altijd waar Done's horen). Vrij komt op de tweede plek;
    // pas als 'ie nog niet bestaat (nieuw item) maken we 'm zelf aan.
    // Zelfde regel als bij single-events: bestaande verplaatsing ALTIJD
    // respecteren, ook bij Done. Default-keuzes (Done-bucket, Vrij-groep,
    // Doorlopend) gelden alleen voor nieuwe rijen.
    const keepGroup = existingRow?.group_id
      ?? (newStatus === 'Done'
            ? await getDoneGroupFor(keepBoard)
            : (isVrij
                  ? await getVrijGroupFor(keepBoard)
                  : (keepBoard === targetBoard
                      ? targetGroup
                      : await getDoorlopendGroupFor(keepBoard))))
    upserts.push({
      id,
      group_id:           keepGroup,
      board_id:           keepBoard,
      // Geen '(N×)'-suffix meer op de recurring parent — de subitem-
      // teller staat al in de tooltip van de expand-knop, een dubbel-
      // signaal in de naam maakt het visueel rommelig. Bij volgende
      // sync overschrijven we automatisch ook bestaande rijen met
      // suffix.
      name:               baseName,
      owner_ids:          finalOwners,
      status:             newStatus,
      start_date:         minStart,
      end_date:           maxEnd ?? minStart,
      deadline:           null,
      // est_hours bewaren als user 'm heeft bijgesteld in de planning-
      // detail-popup. Sync zou anders elke 5 min terugzetten op de uit
      // Google-duur berekende totaal.
      est_hours:          existingRow?.est_hours ?? totalHours,
      dagen:              0,
      notes:              sorted[0].description ?? null,
      contactpersoon:     null, uitzenddag: null, framelink: null, nummers: null,
      subitems,
      journal:            existingRow?.journal ?? [],
      extra:              (() => {
        const exExtra = (existingRow?.extra ?? {}) as Record<string, unknown>
        const exOwnerHours = exExtra.ownerHours as Record<string, number> | undefined
        return {
          ownerHours: exOwnerHours && Object.keys(exOwnerHours).length > 0 ? exOwnerHours : ownerHoursMap,
          ...(() => { const m = sorted.find(ev => ev.hangoutLink)?.hangoutLink; return m ? { meetLink: m } : {} })(),
        }
      })(),
      // Position bewaren — anders sprong een handmatig gesleept item
      // bij elke sync terug naar bovenaan.
      position:            existingRow?.position ?? 0,
      source:              'google',
      external_id:         groupKey,
      ical_uid:            icalUid,
      external_link:       sorted[0].htmlLink ?? null,
      external_synced_at:  new Date().toISOString(),
      external_user_id:    existingRow?.external_user_id ?? cal.user_id,
      calendar_id:         cal.calendar_id,
      updated_at:          new Date().toISOString(),
    })
  }

  if (upserts.length > 0) {
    await admin.from('board_items').upsert(upserts, { onConflict: 'id' })
  }

  // Auto-categoriseer items met 'Vrij'/'Vakantie'/'Verlof'/etc. in de titel
  // als category='vrij' in workload_categories. De classifier doet dit op de
  // fly ook, maar door 't expliciet op te slaan zien alle devices/tools het
  // direct (zonder regex-evaluatie) en respecteren ze de vrij-tag. Bestaande
  // handmatige overrides van de gebruiker laten we ongemoeid.
  const vrijIds = upserts
    .filter(u => isVrijTitle(u.name as string))
    .map(u => String(u.id))
  if (vrijIds.length > 0) {
    const { data: existingCats } = await admin
      .from('workload_categories')
      .select('item_id')
      .in('item_id', vrijIds)
    const alreadySet = new Set((existingCats as { item_id: string }[] | null)?.map(r => r.item_id) ?? [])
    const newRows = vrijIds
      .filter(id => !alreadySet.has(id))
      .map(id => ({ item_id: id, category: 'vrij', updated_at: new Date().toISOString() }))
    if (newRows.length > 0) {
      await admin.from('workload_categories').upsert(newRows, { onConflict: 'item_id' })
    }
  }

  // Remove events that no longer exist (or were cancelled) remotely.
  // Belangrijk: een gedeeld event waarvan ik nu de canonical rij raakte
  // (maar die rij heeft een ander external_user_id) mag ik NIET verwijderen
  // namens de echte eigenaar. Daarom filteren we op rijen die nog steeds
  // mijn external_user_id dragen én die ik dit run niet meer gezien heb.
  //
  // Twee opruimscenario's tegelijk:
  //  1. Event is uit Google verwijderd → ik schreef nergens naartoe voor dat
  //     id → r.id niet in seenIds → opruimen.
  //  2. Ik had een oude per-user rij (`it_g_{ev.id}_{userprefix}`) die door
  //     deze sync naar een gedeelde canonical rij (`it_g_{iCalUID}`) is
  //     verhuisd → ik schreef wel naar de canonical id, niet naar mijn oude
  //     → r.id niet in seenIds → opruimen.
  //
  // De extra `external_id`-check die hier eerst stond blokkeerde scenario 2:
  // we hadden het Google event-id wél gezien (seenExt), alleen routed naar
  // een ander board_items.id, waardoor mijn stale rij bleef hangen.
  const toRemove = existing
    .filter(r => r.external_user_id === cal.user_id)
    .filter(r => !seenIds.has(r.id))
    .map(r => r.id)
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
  const boardsTouched = new Set<string>([fallbackBoard])
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

  // Globale dedup: oude per-user rijen (van vóór deze migratie) hadden geen
  // ical_uid; nu we die net hebben geschreven kunnen we matches uit andere
  // users hun kalenders herkennen en ineen schuiven. Per iCalUID houden we
  // de canonical rij (lage id wint — zelfde regel als sharedByICal), mergen
  // owner_ids erin en verwijderen de duplicaten.
  const upsertedICals = Array.from(new Set(
    upserts.map(u => u.ical_uid).filter((x): x is string => !!x)
  ))
  if (upsertedICals.length > 0) {
    const { data: dupRows } = await admin
      .from('board_items')
      .select('id, ical_uid, owner_ids, journal, subitems')
      .eq('source', 'google')
      .in('ical_uid', upsertedICals)
    type Dup = { id: string; ical_uid: string | null; owner_ids: string[] | null; journal: unknown; subitems: SubItemSnapshot[] | null }
    const byUid = new Map<string, Dup[]>()
    for (const r of (dupRows as Dup[] | null) ?? []) {
      if (!r.ical_uid) continue
      const arr = byUid.get(r.ical_uid) ?? []
      arr.push(r)
      byUid.set(r.ical_uid, arr)
    }
    for (const [, group] of byUid) {
      if (group.length <= 1) continue
      group.sort((a, b) => a.id.localeCompare(b.id))
      const canonical = group[0]
      const dupes     = group.slice(1)
      // Merge owner_ids zodat we geen teamleden verliezen.
      const merged = new Set<string>(canonical.owner_ids ?? [])
      for (const d of dupes) for (const o of (d.owner_ids ?? [])) merged.add(o)
      if (merged.size !== (canonical.owner_ids ?? []).length) {
        await admin.from('board_items')
          .update({ owner_ids: Array.from(merged) })
          .eq('id', canonical.id)
      }
      await admin.from('board_items').delete().in('id', dupes.map(d => d.id))
      removed += dupes.length
    }
  }

  // Migratie-cleanup voor pre-iCalUID duplicaten: rijen van teamleden die
  // sinds de fix nog niet hebben gesynct hebben ical_uid IS NULL. We
  // matchen ze met de canonical rij via name + start_date (combinatie is
  // praktisch uniek per event) en mergen ze in. Idempotent: na een paar
  // syncs heeft elke rij ical_uid en doet de query niets meer.
  for (const u of upserts) {
    const icalUid   = u.ical_uid as string | null
    if (!icalUid) continue
    const name      = String(u.name ?? '')
    const startDate = u.start_date as string | null
    const canonical = String(u.id)
    if (!name || !startDate) continue
    const { data: legacyRows } = await admin
      .from('board_items')
      .select('id, owner_ids, journal')
      .eq('source', 'google')
      .is('ical_uid', null)
      .eq('name', name)
      .eq('start_date', startDate)
      .neq('id', canonical)
    const legacies = (legacyRows as { id: string; owner_ids: string[] | null; journal: unknown }[] | null) ?? []
    if (legacies.length === 0) continue
    const merged = new Set<string>((u.owner_ids as string[]) ?? [])
    for (const r of legacies) for (const o of (r.owner_ids ?? [])) merged.add(o)
    if (merged.size !== ((u.owner_ids as string[]) ?? []).length) {
      await admin.from('board_items')
        .update({ owner_ids: Array.from(merged) })
        .eq('id', canonical)
    }
    await admin.from('board_items').delete().in('id', legacies.map(r => r.id))
    removed += legacies.length
  }

  await admin.from('google_calendars').update({ last_sync_at: new Date().toISOString() }).eq('id', cal.id)
  return { added, updated, removed }
}

export async function syncCalendarsForUser(admin: SupabaseClient, userId: string) {
  // Eenmalige opruim: oude auto-geleerde routing-regels met een te-kort
  // pattern (< 8 chars) verwijderen. Die ontstonden vóór de bijgewerkte
  // drempel en sleepten via substring-match onbedoeld events mee naar
  // andere borden. We filteren in JS-land (pattern lengte) zodat we
  // geen Postgres-specifieke functies hoeven aan te roepen. Idempotent:
  // na de eerste run is er niks meer om op te ruimen.
  try {
    const { data: short } = await admin
      .from('calendar_routing_rules')
      .select('id, pattern, position')
      .gte('position', 100)   // alleen user-leerde regels; seed-regels (positie < 100) blijven
    const tooShort = ((short as { id: string; pattern: string }[] | null) ?? [])
      .filter(r => (r.pattern ?? '').length < 8)
      .map(r => r.id)
    if (tooShort.length > 0) {
      await admin.from('calendar_routing_rules').delete().in('id', tooShort)
    }
  } catch {}

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
