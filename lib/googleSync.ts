// Server-only: pulls events from connected Google calendars and upserts them
// as board_items rows. Triggered by /api/google/sync.

import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAccessToken, listEvents, type GoogleEvent } from './googleOAuth'
import teamData from '@/data/team.json'
import { isVrijTitle } from './workloadCategory'

// Map @studioyoko.nl emails → member-id, opgebouwd uit een unie van
// team.json (statische seed) ÉN public.team_members (live tabel) zodat
// admin-toegevoegde leden als Manuel ook als Yoko-attendee herkend
// worden. De seed-set kan op import al gebouwd worden; de DB-set
// wordt per sync-pass opgehaald via buildMemberKeys().
//
// Lookup is fuzzy: we normaliseren de local-part van een email (lowercase,
// strippen streepjes/punten) en vergelijken met member.id én een naam-
// hash. Daardoor matchen 'anne-fleur', 'annefleur', 'anne.fleur' alledrie
// op member-id 'anne-fleur', ook al staat er in team.json maar één variant.
function normEmailLocal(s: string): string {
  return s.toLowerCase().replace(/[.\-_]/g, '')
}
type MemberKey = { id: string; keys: Set<string> }
function memberToKey(m: { id: string; name: string; email?: string | null }): MemberKey {
  const keys = new Set<string>()
  keys.add(normEmailLocal(m.id))
  if (m.email) keys.add(normEmailLocal(m.email.split('@')[0] ?? ''))
  if (m.name) keys.add(normEmailLocal(m.name.split(' ')[0] ?? ''))
  return { id: m.id, keys }
}
const SEED_MEMBER_KEYS: MemberKey[] = (teamData.members as Array<{ id: string; name: string; email?: string }>)
  .map(memberToKey)

async function buildMemberKeys(admin: SupabaseClient): Promise<MemberKey[]> {
  const merged = new Map<string, MemberKey>()
  for (const k of SEED_MEMBER_KEYS) merged.set(k.id, k)
  try {
    const { data } = await admin
      .from('team_members')
      .select('id, name, email')
    type Row = { id: string; name: string; email: string | null }
    for (const r of (data as Row[] | null) ?? []) {
      // Live-row vervangt of vult de seed aan (DB-data is autoritatief).
      merged.set(r.id, memberToKey(r))
    }
  } catch { /* ignore — fallback op seed */ }
  return Array.from(merged.values())
}

function resolveAttendeeEmailWith(memberKeys: MemberKey[], email: string): string | null {
  const e = email.toLowerCase().trim()
  if (!e.endsWith('@studioyoko.nl')) return null
  const local = normEmailLocal(e.split('@')[0] ?? '')
  if (!local) return null
  for (const { id, keys } of memberKeys) {
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
const WINDOW_DAYS_FUTURE = 14   // 2 weken vooruit. Verder doortrekken
// laat recurring meetings (zoals een wekelijkse Redactievergadering)
// exploderen tot tientallen subitems — onleesbaar. Save-the-dates met
// een datum verder dan 2 weken weg verschijnen vanzelf zodra ze
// dichterbij komen; de sync draait elke 5 minuten.
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
  // Inclusief soft-deleted (zie comment bij ensureMeetingsGroup) zodat
  // we 'n bestaande maar weggekruiste groep niet dupliceren én items
  // niet aan 'n onzichtbare group_id koppelen.
  const { data: rows } = await admin
    .from('board_groups').select('id, name, deleted_at')
    .eq('board_id', boardId)
    .ilike('name', 'done')
    .limit(1)
  const existing = (rows as { id: string; name: string; deleted_at: string | null }[] | null)?.[0]
  if (existing) {
    if (existing.deleted_at) {
      await admin.from('board_groups').update({ deleted_at: null }).eq('id', existing.id)
    }
    return existing.id
  }

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
  // Inclusief soft-deleted (zie ensureMeetingsGroup).
  const { data: rows } = await admin
    .from('board_groups').select('id, name, deleted_at')
    .eq('board_id', boardId)
    .ilike('name', 'vrij')
    .limit(1)
  const existing = (rows as { id: string; name: string; deleted_at: string | null }[] | null)?.[0]
  if (existing) {
    if (existing.deleted_at) {
      await admin.from('board_groups').update({ deleted_at: null }).eq('id', existing.id)
    }
    return existing.id
  }

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

// Meetings & doorlopend — alle Google meetings (zowel losse als
// recurring) landen hier per bord, zodat ze niet versnipperd tussen
// echte projecten staan. Hergebruikt bestaande 'doorlopend' of
// 'meetings'-achtige groep zodat we geen duplicaten maken; anders
// aanmaken onderaan het bord met een herkenbare gele tint.
async function ensureMeetingsGroup(
  admin:   SupabaseClient,
  boardId: string,
): Promise<string> {
  // Inclusief soft-deleted groepen ophalen — anders maken we per ongeluk
  // 'n nieuwe groep terwijl er al eentje in de prullenbak staat met
  // dezelfde naam, of (erger) krijgen de items een soft-deleted group_id
  // toegewezen waardoor ze in de UI onzichtbaar worden (pull filtert
  // soft-deleted groepen weg).
  const { data: rows } = await admin
    .from('board_groups').select('id, name, deleted_at')
    .eq('board_id', boardId)
    .order('position', { ascending: true })
  const groups = (rows as { id: string; name: string; deleted_at: string | null }[] | null) ?? []
  const norm = (s: string) => s.toLowerCase().trim()
  const target = groups.find(g => {
    const n = norm(g.name)
    return n === 'meetings & doorlopend'
        || n === 'meetings en doorlopend'
        || n === 'meetings'
        || n === 'doorlopend'
  })
  if (target) {
    // Bestaande groep — als 'ie soft-deleted is, herleven we 'm. Anders
    // belanden items op een group_id die de UI filtert.
    if (target.deleted_at) {
      await admin.from('board_groups').update({ deleted_at: null }).eq('id', target.id)
    }
    return target.id
  }

  const { data: posRows } = await admin
    .from('board_groups').select('position')
    .eq('board_id', boardId)
    .order('position', { ascending: false })
    .limit(1)
  const maxPos = (posRows as { position: number }[] | null)?.[0]?.position ?? -1

  const newId = `g_meetings_${boardId}_${Date.now()}`
  await admin.from('board_groups').insert({
    id:        newId,
    board_id:  boardId,
    name:      'Meetings & doorlopend',
    color:     '#D8B62E',
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
  // Member-keys voor attendee-resolutie: combineert team.json (seed) +
  // live team_members tabel. Daardoor herkent de sync ook 'manuel@
  // studioyoko.nl' als Yoko-attendee zodra Manuel via /team-admin is
  // toegevoegd, zonder dat we de hardcoded JSON hoeven te updaten.
  const memberKeys = await buildMemberKeys(admin)
  const resolveAttendeeEmail = (email: string) => resolveAttendeeEmailWith(memberKeys, email)

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

  // Meetings-groep cache: alle Google meetings (single én recurring)
  // landen hier per bord, zodat ze in één bucket te overzien zijn.
  const meetingsCache = new Map<string, string>()
  async function getMeetingsGroupFor(boardId: string): Promise<string> {
    const cached = meetingsCache.get(boardId)
    if (cached) return cached
    const gid = await ensureMeetingsGroup(admin, boardId)
    meetingsCache.set(boardId, gid)
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
    // Geen eager-add van de calendar-owner meer. Eerder werd memberId
    // ALTIJD toegevoegd, ook wanneer die niet als attendee in 't event
    // stond — daardoor kreeg bv. Anne-Fleur owner-status op events die
    // toevallig op haar agenda stonden zonder dat ze uitgenodigd was.
    // Voor solo-events (geen attendees) vangen we 't af via de
    // fallback hieronder.
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
  let skipCancelled = 0, skipDeclined = 0, skipNoStart = 0, skipSoloNonVrij = 0
  const validEvents = events.filter(ev => {
    if (ev.status === 'cancelled') { skipCancelled++; return false }
    const self = ev.attendees?.find(a => a.self)
    if (self?.responseStatus === 'declined') { skipDeclined++; return false }
    const { start } = eventDates(ev)
    if (!start) { skipNoStart++; return false }
    const attendeeCount = (ev.attendees ?? []).length
    if (attendeeCount === 0) {
      if (!isVrijTitle(ev.summary ?? '')) { skipSoloNonVrij++; return false }
      return true
    }
    return true
  })
  // eslint-disable-next-line no-console
  console.log(`[googleSync] cal=${cal.calendar_id} fetched=${events.length} valid=${validEvents.length} skip{cancelled:${skipCancelled},declined:${skipDeclined},noStart:${skipNoStart},soloNonVrij:${skipSoloNonVrij}}`)
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
  // CANONICAL ROW per iCalUID. Eén rij per Google-event in de DB,
  // gedeeld door alle teamleden. Onder eerdere implementatie kon
  // Vincent's sync Menno's external_id/calendar_id overschrijven →
  // Menno's volgende sync vond zijn row niet terug → nieuwe row →
  // duplicaat. Fix: in de upsert preserven we external_id /
  // calendar_id / external_user_id van existingRow zodat alleen de
  // EERSTE sync die velden zet en daarna niemand ze overschrijft.
  const sharedByICal = new Map<string, ItemRow>()
  if (wantedICals.length > 0) {
    // BELANGRIJK: WEL soft-deleted rijen meenemen. Een eerdere bug-cyclus
    // of de push-safety-guard kan de canonical Weekstart-row hebben
    // soft-deleted; we willen die kunnen 'revive' ipv een tweede rij
    // ernaast aanmaken. De upsert hieronder zet deleted_at expliciet op
    // null om de row weer zichtbaar te maken.
    const { data: sharedRows } = await admin
      .from('board_items')
      .select('id, group_id, board_id, external_id, ical_uid, status, journal, owner_ids, subitems, external_user_id, position, est_hours, extra, name, start_date, deleted_at')
      .eq('source', 'google')
      .in('ical_uid', Array.from(new Set(wantedICals)))
    for (const r of (sharedRows as ItemRow[] | null) ?? []) {
      if (!r.ical_uid) continue
      const prev = sharedByICal.get(r.ical_uid)
      if (!prev || r.id < prev.id) sharedByICal.set(r.ical_uid, r)
    }
  }

  // Legacy dedup BINNEN mijn eigen rijen: oude rijen zonder iCalUID
  // krijgen via findExistingFor een match op naam+datum zodat ze niet
  // dubbel ontstaan bij de eerstvolgende sync. Filtert nu strikt op
  // external_user_id = cal.user_id, zodat we andermans data nooit
  // aanraken.
  const legacyByKey = new Map<string, ItemRow>()
  {
    const { data: legacyRows } = await admin
      .from('board_items')
      .select('id, group_id, board_id, external_id, ical_uid, status, journal, owner_ids, subitems, external_user_id, position, est_hours, extra, name, start_date')
      .eq('source', 'google')
      .eq('external_user_id', cal.user_id)
      .is('ical_uid', null)
      .is('deleted_at', null)
    for (const r of (legacyRows as ItemRow[] | null) ?? []) {
      const name = String((r as { name?: string }).name ?? '').toLowerCase().trim()
        .replace(/\s*\(\d+×\)\s*$/, '').trim()
      const sd   = String((r as { start_date?: string | null }).start_date ?? '')
      if (!name || !sd || !r.board_id) continue
      const key = `${r.board_id}::${name}::${sd}`
      const prev = legacyByKey.get(key)
      if (!prev || r.id < prev.id) legacyByKey.set(key, r)
    }
  }
  function legacyLookup(name: string, startDate: string | null): ItemRow | undefined {
    if (!startDate) return undefined
    const norm = name.toLowerCase().trim().replace(/\s*\(\d+×\)\s*$/, '').trim()
    const boards = new Set<string>([fallbackBoard])
    for (const r of rules) boards.add(r.board_id)
    for (const b of boards) {
      const hit = legacyByKey.get(`${b}::${norm}::${startDate}`)
      if (hit) return hit
    }
    return undefined
  }

  // Helper: vind de bestaande rij voor dit event, bij voorkeur via iCalUID.
  // Fallback-chain:
  //  1. sharedByICal (cross-user dedup via iCalUID — beste match)
  //  2. byExt (mijn eigen oude id-vorm met user-prefix)
  //  3. legacyLookup (oude rijen ZONDER iCalUID die door eerdere sync-
  //     versies gemaakt zijn; match op board+name+startDate)
  //  4. Nieuw — canonical id op basis van iCalUID
  function findExistingFor(
    icalUid: string | null,
    extId: string,
    name: string,
    startDate: string | null,
  ): { row: ItemRow | undefined; id: string } {
    if (icalUid) {
      const shared = sharedByICal.get(icalUid)
      if (shared) return { row: shared, id: shared.id }
    }
    const mineId = byExt.get(extId)
    const mineRow = byExtFull.get(extId)
    if (mineRow) return { row: mineRow, id: mineRow.id }
    if (mineId) return { row: undefined, id: mineId }
    // Legacy: zelfde event-naam+datum op hetzelfde bord (alleen mijn
    // eigen rows). Backfill van iCalUID gebeurt via de upsert.
    const legacy = legacyLookup(name, startDate)
    if (legacy) return { row: legacy, id: legacy.id }
    // Nieuwe rij — CANONICAL id-vorm op basis van iCalUID. Eén rij
    // per event, gedeeld door alle teamleden.
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
      // getGroupFor / getDoorlopendGroupFor zijn nu niet meer nodig als
      // default — alle nieuwe meetings landen in de Meetings-groep en
      // bestaande rij-groepen worden gerespecteerd via existingRow.group_id.
      seenExt.add(ev.id)
      const icalUid     = ev.iCalUID ?? null
      const lookup      = findExistingFor(icalUid, ev.id, name, start)
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
      // status/Vrij/Meetings-startpositie. Meetings (alle non-Vrij Google
      // events) gaan naar de 'Meetings & doorlopend'-groep zodat ze niet
      // versnipperd tussen echte projecten staan.
      const keepGroup = existingRow?.group_id
        ?? (newStatus === 'Done'
              ? await getDoneGroupFor(keepBoard)
              : (isVrij
                  ? await getVrijGroupFor(keepBoard)
                  : await getMeetingsGroupFor(keepBoard)))
      const eventOwners = ownersForEvent(ev)
      // Vervang owner_ids met de VERSE set Yoko-attendees uit Google.
      // De eerdere 'union met bestaande'-strategie zorgde ervoor dat ooit
      // toegevoegde owners (bv. iemand die ooit per ongeluk toegevoegd
      // was, of die zelf 'declined' heeft sinds de vorige sync) eeuwig
      // bleven hangen. Manuele toevoegingen vanuit de planning-UI worden
      // hierdoor wel overschreven; user kan ze opnieuw toevoegen — beter
      // dat dan dat random mensen onverklaard owner blijven.
      const finalOwners = [...eventOwners.owners]
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
        position:            existingRow?.position ?? 9999,
        source:              'google',
        // external_id/calendar_id NIET overschrijven als er al een rij
        // bestaat. Die behoren bij de gebruiker die als EERSTE deze rij
        // aanmaakte — overschrijven zou hun lookup-via-ev.id breken en
        // race-condities veroorzaken. Bij een nieuwe rij vullen we ze in.
        external_id:         existingRow?.external_id ?? ev.id,
        ical_uid:            icalUid,
        external_link:       (existingRow as { external_link?: string | null } | undefined)?.external_link ?? ev.htmlLink ?? null,
        external_synced_at:  new Date().toISOString(),
        external_user_id:    existingRow?.external_user_id ?? cal.user_id,
        calendar_id:         (existingRow as { calendar_id?: string } | undefined)?.calendar_id ?? cal.calendar_id,
        // Revive soft-deleted rijen — als een eerdere bug 'm verstopt heeft,
        // moet 'ie weer terugkomen zodra Google z'n update binnenpakt.
        deleted_at:          null,
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
    // Recurring rename-detect: pak de naam van de MEEST RECENTE instance
    // (de laatste in tijds-volgorde). Bij 'rename this and following
    // events' in Google houden alle toekomst-instances de nieuwe naam;
    // dat is wat de gebruiker bedoelt. Eerdere modus-aanpak verloor 't
    // bij 180 dagen historie + 14 dagen toekomst — de oude naam was
    // numeriek vaker dan de nieuwe en wonnen daardoor. Niet meer.
    // Edge-case 'rename one instance' (één outlier) accepteren we als
    // misser; dat is zeldzaam en de user kan handmatig de naam zetten.
    const baseName = (() => {
      // sorted is op start-datum; pak de laatste met een niet-lege summary.
      for (let i = sorted.length - 1; i >= 0; i--) {
        const s = (sorted[i].summary ?? '').trim()
        if (s) return s
      }
      return '(geen titel)'
    })()
    const targetBoard = routeEvent(baseName, fallbackBoard, rules)
    // Doorlopend-group is vervangen door 'Meetings & doorlopend' voor
    // nieuwe rijen (zie keepGroup hieronder).
    const minStart = eventDates(sorted[0]).start
    const maxEnd   = eventDates(sorted[sorted.length - 1]).end ?? eventDates(sorted[sorted.length - 1]).start
    // Voor recurring nemen we de owners van de meeste recente instantie —
    // attendee-lijsten zijn meestal hetzelfde over alle herhalingen.
    const groupOwners = ownersForEvent(sorted[sorted.length - 1])
    const icalUid     = iCalKeyForGroup(sorted)
    const lookup      = findExistingFor(icalUid, groupKey, baseName, minStart)
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
      // Naam-fallback: was 'wo 3 jun' / 'ma 26 mei' (date-label) — gebruiker
      // ervaart 't als "verkeerde naam". Recurring instances erven nu de
      // master-naam (parent.name). De datum-kolom toont 't moment al, dus
      // dubbele info in de naam is niet nodig.
      const subitemName = instanceRenamedInGoogle
        ? evTitle
        : (prev?.name && prev.name !== '—' && !/^[a-z]{2,3}\s+\d/i.test(prev.name)
            ? prev.name
            : (baseName || dateLabel))
      return {
        id:        sid,
        name:      subitemName,
        ownerIds:  prev?.ownerIds && prev.ownerIds.length > 0 ? prev.ownerIds : finalOwners,
        status:    resolveStatus(prev?.status, end ?? start),
        startDate: start,
        endDate:   end ?? start,
        startTime,
        endTime,
        // estHours: door-gebruiker-ingevulde waarde bewaren. Anders
        // overschrijft elke sync de handmatig gezette uren (bv. 24u op
        // 'n boekomslag-subitem) met de event-duur * owners. Alleen
        // berekenen als er nog niks stond.
        estHours:  (typeof prev?.estHours === 'number' && prev.estHours > 0)
                     ? prev.estHours
                     : eventHours(ev) * finalOwners.length,
        // Per-instance Meet-link — sommige reeksen verschillen per moment.
        meetLink:  ev.hangoutLink ?? prev?.meetLink ?? null,
        // Per-instance Google-Calendar-link — zo kan de UI naar de juiste
        // datum springen ipv het master-event.
        externalLink: ev.htmlLink ?? prev?.externalLink ?? null,
        source:    'google' as const,
      }
    })
    // Behoud subitems die NIET uit de Google-sync komen of waarvan
    // het Google-event buiten ons window valt. Voorheen verving deze
    // sync de subitems-lijst volledig met wat in `sorted` zat, dus
    // handmatig toegevoegde subs (zonder si_g_-prefix) ÉN Done-instances
    // waarvan Google de instance op een gegeven moment dropt verdwenen
    // stilletjes. Nu mergen we: nieuwe sync-output + alle prior subs die
    // niet door deze sync overschreven werden.
    const syncedIds = new Set(subitems.map(s => s.id))
    const preserved = priorSubs.filter(s => !syncedIds.has(s.id))
    const mergedSubitems = [...subitems, ...preserved]
    // Sorteer chronologisch: zo blijft de Done-sectie onderaan in de UI
    // en houden gebruikers visueel hetzelfde beeld als voorheen.
    mergedSubitems.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
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
    // respecteren, ook bij Done. Default voor nieuwe recurring rijen is
    // de gedeelde 'Meetings & doorlopend' bucket — daar landen óók
    // recurring meetings zodat losse en doorlopende meetings naast elkaar
    // staan i.p.v. in twee aparte groepen.
    const keepGroup = existingRow?.group_id
      ?? (newStatus === 'Done'
            ? await getDoneGroupFor(keepBoard)
            : (isVrij
                  ? await getVrijGroupFor(keepBoard)
                  : await getMeetingsGroupFor(keepBoard)))
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
      subitems:           mergedSubitems,
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
      position:            existingRow?.position ?? 9999,
      source:              'google',
      // Per-user velden NIET overschrijven (zie single-event-branch).
      external_id:         existingRow?.external_id ?? groupKey,
      ical_uid:            icalUid,
      external_link:       (existingRow as { external_link?: string | null } | undefined)?.external_link ?? sorted[0].htmlLink ?? null,
      external_synced_at:  new Date().toISOString(),
      external_user_id:    existingRow?.external_user_id ?? cal.user_id,
      calendar_id:         (existingRow as { calendar_id?: string } | undefined)?.calendar_id ?? cal.calendar_id,
      deleted_at:          null,
      updated_at:          new Date().toISOString(),
    })
  }

  if (upserts.length > 0) {
    const { error: upErr } = await admin.from('board_items').upsert(upserts, { onConflict: 'id' })
    if (upErr) {
      // eslint-disable-next-line no-console
      console.error(`[googleSync] upsert FAILED voor ${cal.calendar_id}:`, upErr.message, upErr.details, upErr.hint, 'rows:', upserts.length)
      // Niet stilzwijgend doorgaan — laat de caller weten dat sync gefaald is
      // zodat /api/google/sync de error doorgeeft aan de sidebar-knop.
      throw new Error(`upsert failed: ${upErr.message}`)
    }
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
  // CLEANUP UITGESCHAKELD. Eerder soft-deleten we items waarvan we het
  // id niet meer hadden gezien in deze sync-run. Klonk veilig maar
  // veegde in praktijk EN MASSE oude Done-meetings weg zodra ze buiten
  // het 180-dagen-window vielen (recurring instances van een jaar
  // geleden, items waarvan het Google-event was gewijzigd of waarvan
  // de status op Done was gezet en de gebruiker 'm verder met rust
  // wilde laten). Geen automatische opruim meer; verwijderen gaat
  // uitsluitend via expliciete UI-acties en is dan via de Geschiedenis
  // (Papierbak) drawer herstelbaar.
  void existing
  void seenIds
  const removed = 0

  // VERWIJDERD: de oude 'auto-cleanup non-google rows met dezelfde naam
  // als een synced Google item' veegde handmatige projecten weg zodra
  // Vincent een meeting met dezelfde titel synced (bv. een sponsor-
  // meeting 'Gerolsteiner' wiste het handmatige Gerolsteiner-project
  // op het yoko-bord). Te agressief; we vertrouwen voortaan op de
  // expliciete dedup-SQL en /trash voor opruimen.

  // VERWIJDERD: cross-user dedup-loops. Eerder mergden we rijen van
  // verschillende teamleden met dezelfde iCalUID/naam-datum in één,
  // maar dat veroorzaakte race-condities (Vincent's sync overschreef
  // Menno's row z'n external_id → Menno's sync vond 'm niet meer →
  // miste meetings + duplicaten). Per-user rows zijn nu het model:
  // visueel kan een gedeeld event 2x verschijnen, maar geen data-
  // verlies meer.

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
