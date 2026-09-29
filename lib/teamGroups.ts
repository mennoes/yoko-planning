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

export function loadTeamGroups() { return read() }

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
  const next = before.map(group => ({
    ...group,
    memberIds: targetGroupId === group.id
      ? [...group.memberIds.filter(id => id !== memberId), memberId]
      : group.memberIds.filter(id => id !== memberId),
  }))
  write(next)
  const changed = next.filter((group, index) => JSON.stringify(group.memberIds) !== JSON.stringify(before[index]?.memberIds ?? []))
  await push(changed)
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
