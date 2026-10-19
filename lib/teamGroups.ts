import { supabase } from './supabase'
import { getCurrentUserId } from './sync'
import { TEAM_GROUP_META_PREFIX } from './teamMemberIdentity'

export type TeamGroup = {
  id: string
  name: string
  color: string
  position: number
  memberIds: string[]
}

/** De vaste secties doen mee in dezelfde volgorde als je eigen teams.
 *  Ze staan als gewone rijen in dezelfde opslag, met een gereserveerde id,
 *  zodat één lijst de hele volgorde bepaalt — inclusief waar Freelancers
 *  en Inactief team staan. Hun leden komen niet uit memberIds maar uit de
 *  indeling zelf (eigen team / freelancer / geen recent werk), dus die
 *  lijst blijft leeg. */
export const BASE_SECTIONS: ReadonlyArray<{ id: string; name: string; color: string }> = [
  { id: '__yoko__',      name: 'Studio Yoko',   color: '#579bfc' },
  { id: '__freelance__', name: 'Freelancers',   color: '#9aadbd' },
  { id: '__inactive__',  name: 'Inactief team', color: '#8a919c' },
]

export function isBaseSectionId(id: string): boolean {
  return BASE_SECTIONS.some(section => section.id === id)
}

const KEY = 'yoko-team-groups'
const EVENT = 'yoko-team-groups-update'

function read(): TeamGroup[] {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as TeamGroup[]
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function write(groups: TeamGroup[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(groups))
  window.dispatchEvent(new CustomEvent(EVENT))
}

function slugify(value: string) {
  return value.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Altijd op `position`, nooit op de volgorde waarin ze toevallig in
 *  localStorage staan. createTeamGroup en assignMemberToTeamGroup
 *  schrijven de lijst terug zoals ze 'm kregen, dus zonder deze sortering
 *  kon de getoonde volgorde na een willekeurige actie omslaan. */
export function loadTeamGroups() {
  return read().sort((a, b) => a.position - b.position)
}

/** Alleen de teams die jij zelf hebt gemaakt. */
export function loadCustomTeamGroups() {
  return loadTeamGroups().filter(group => !isBaseSectionId(group.id))
}

/**
 * Alle secties in volgorde: je eigen teams én de vaste blokken.
 *
 * Nog niet eerder verplaatst? Dan staan de vaste blokken op hun
 * vertrouwde plek: Studio Yoko bovenaan, daarna je eigen teams, en
 * Freelancers + Inactief team onderaan.
 */
export function loadTeamSections(): TeamGroup[] {
  const opgeslagen = loadTeamGroups()
  const bekend = new Map(opgeslagen.map(group => [group.id, group]))
  const eigen = opgeslagen.filter(group => !isBaseSectionId(group.id))

  const sectie = (id: string): TeamGroup => {
    const bestaand = bekend.get(id)
    if (bestaand) return bestaand
    const basis = BASE_SECTIONS.find(section => section.id === id)!
    return { ...basis, position: 0, memberIds: [] }
  }

  // Zijn de vaste blokken al eens verplaatst, dan hebben ze een opgeslagen
  // positie en doet de gewone sortering het werk.
  if (BASE_SECTIONS.every(section => bekend.has(section.id))) return opgeslagen

  const yoko = sectie('__yoko__')
  const freelance = sectie('__freelance__')
  const inactief = sectie('__inactive__')
  return [yoko, ...eigen, freelance, inactief]
}

/** Kan deze groep nog omhoog/omlaag? De pijlen stonden er altijd, ook bij
 *  één groep — dan gebeurde er niets en leek het stuk. */
export function canMoveTeamGroup(groupId: string, direction: -1 | 1): boolean {
  const groups = loadTeamSections()
  const index = groups.findIndex(group => group.id === groupId)
  if (index < 0) return false
  const target = index + direction
  return target >= 0 && target < groups.length
}

export function onTeamGroupsChange(handler: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

async function push(groups: TeamGroup[]) {
  if (!supabase || !await getCurrentUserId()) return false
  if (groups.length === 0) return true
  const { error } = await supabase.from('team_members_extra').upsert(groups.map(group => ({
    id: `${TEAM_GROUP_META_PREFIX}${group.id}`,
    name: group.name,
    // Bestaande kolommen hergebruiken: email bevat alleen de JSON-array
    // met interne member-id's; er worden geen mailadressen opgeslagen.
    email: JSON.stringify(group.memberIds),
    weekly_capacity: group.position,
    color: group.color,
    updated_at: new Date().toISOString(),
  })), { onConflict: 'id' })
  return !error
}

export async function createTeamGroup(name: string, color = '#579bfc'): Promise<TeamGroup | null> {
  const clean = name.trim()
  if (!clean) return null
  const groups = read()
  const base = slugify(clean) || `groep-${Date.now()}`
  let id = base
  let suffix = 2
  while (groups.some(group => group.id === id)) id = `${base}-${suffix++}`
  const group: TeamGroup = { id, name: clean, color, position: groups.length, memberIds: [] }
  const next = [...groups, group]
  write(next)
  await push([group])
  return group
}

export async function assignMemberToTeamGroup(memberId: string, targetGroupId: string | null): Promise<void> {
  const before = read()
  if (targetGroupId && !before.some(group => group.id === targetGroupId)) {
    throw new Error('team_group_not_found')
  }
  const next = before.map(group => ({
    ...group,
    memberIds: targetGroupId === group.id
      ? [...group.memberIds.filter(id => id !== memberId), memberId]
      : group.memberIds.filter(id => id !== memberId),
  }))
  write(next)
  const changed = next.filter((group, index) => JSON.stringify(group.memberIds) !== JSON.stringify(before[index]?.memberIds ?? []))
  if (changed.length === 0) return
  const remoteExpected = !!supabase && !!await getCurrentUserId()
  const persisted = await push(changed)
  if (remoteExpected && !persisted) {
    // Laat de interface nooit een verplaatsing bevestigen die na refresh
    // weer verdwijnt. Herstel de vorige indeling en laat de aanroeper melden
    // dat opslaan niet is gelukt.
    write(before)
    throw new Error('team_group_save_failed')
  }
}

/**
 * Verschuif een sectie één plek. Geeft null terug als het gelukt is, en
 * anders de reden.
 *
 * Die reden is er omdat dit eerder stil mislukte: de volgorde veranderde
 * lokaal, de opslag naar Supabase ging fout, en de eerstvolgende pull zette
 * alles terug. Je zag dan een lijst die niet bewoog, zonder uitleg.
 */
export async function moveTeamGroup(groupId: string, direction: -1 | 1): Promise<string | null> {
  // Over de volledige lijst, dus ook langs Studio Yoko, Freelancers en
  // Inactief team. Eerder ging dit alleen over je eigen teams, waardoor er
  // met één team niets te verschuiven viel en de pijlen niets deden.
  const before = read()
  const sections = loadTeamSections()
  const index = sections.findIndex(group => group.id === groupId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sections.length) {
    return index < 0 ? 'Deze sectie staat niet in de lijst.' : null
  }
  ;[sections[index], sections[target]] = [sections[target], sections[index]]
  const next = sections.map((group, position) => ({ ...group, position }))
  write(next)

  const remoteExpected = !!supabase && !!await getCurrentUserId()
  if (!remoteExpected) return null   // lokaal-only installatie: klaar
  const persisted = await push(next)
  if (persisted) return null
  // Niet opgeslagen: zet terug, zodat je niet naar een volgorde kijkt die
  // na een refresh weer anders is.
  write(before)
  return 'De nieuwe volgorde is niet opgeslagen. Probeer het opnieuw.'
}

export async function pullTeamGroups(): Promise<boolean> {
  if (!supabase || !await getCurrentUserId()) return false
  const { data, error } = await supabase.from('team_members_extra')
    .select('id, name, email, weekly_capacity, color')
    .like('id', `${TEAM_GROUP_META_PREFIX}%`)
    .order('weekly_capacity', { ascending: true })
  if (error || !data) return false
  if (data.length === 0) {
    const local = read()
    if (local.length > 0) await push(local)
    return true
  }
  const groups: TeamGroup[] = (data as Array<{ id: string; name: string; email: string | null; weekly_capacity: number; color: string }>).map(row => {
    let memberIds: string[] = []
    try {
      const parsed = JSON.parse(row.email ?? '[]') as unknown
      if (Array.isArray(parsed)) memberIds = parsed.filter((id): id is string => typeof id === 'string')
    } catch {}
    return {
      id: row.id.slice(TEAM_GROUP_META_PREFIX.length),
      name: row.name,
      color: row.color || '#579bfc',
      position: Number(row.weekly_capacity) || 0,
      memberIds,
    }
  })
  if (JSON.stringify(groups) !== JSON.stringify(read())) write(groups)
  return true
}

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
export function subscribeRemoteTeamGroups(): () => void {
  if (!supabase || channel) return () => {}
  const ch = supabase.channel('team-groups')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members_extra' }, payload => {
      const id = String((payload.new as { id?: string } | null)?.id ?? (payload.old as { id?: string } | null)?.id ?? '')
      if (id.startsWith(TEAM_GROUP_META_PREFIX)) void pullTeamGroups()
    })
    .subscribe()
  channel = ch
  return () => {
    if (supabase && channel) void supabase.removeChannel(channel)
    channel = null
  }
}
