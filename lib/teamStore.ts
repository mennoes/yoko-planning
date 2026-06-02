// Team-leden komen voortaan uit Supabase (tabel team_members). Bij eerste
// bezoek seeden we de huidige data/team.json daar naartoe zodat bestaande
// installaties geen lege team-lijst krijgen. data/team.json blijft fallback
// voor offline / niet-geauthenticeerde sessies.

import { supabase } from './supabase'
import teamData from '@/data/team.json'
import { getCurrentUserId } from './sync'

export type TeamMember = {
  id:              string
  name:            string
  email:           string
  color:           string
  weeklyCapacity:  number
  position:        number
  hidden:          boolean
}

type Row = {
  id:              string
  name:            string
  email:           string | null
  color:           string | null
  weekly_capacity: number | null
  position:        number | null
  hidden:          boolean | null
}

function rowToMember(r: Row): TeamMember {
  return {
    id:             r.id,
    name:           r.name,
    email:          r.email ?? '',
    color:          r.color ?? '#9aadbd',
    weeklyCapacity: Number(r.weekly_capacity ?? 0),
    position:       Number(r.position ?? 0),
    hidden:         !!r.hidden,
  }
}

export async function pullTeam(): Promise<TeamMember[] | null> {
  if (!supabase) return null
  if (!await getCurrentUserId()) return null
  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, email, color, weekly_capacity, position, hidden')
    .order('position', { ascending: true })
  if (error || !data) return null
  return (data as Row[]).map(rowToMember)
}

export async function upsertTeamMember(m: TeamMember): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('team_members').upsert({
    id:              m.id,
    name:            m.name,
    email:           m.email,
    color:           m.color,
    weekly_capacity: m.weeklyCapacity,
    position:        m.position,
    hidden:          m.hidden,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'id' })
  return !error
}

export async function deleteTeamMember(id: string): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('team_members').delete().eq('id', id)
  return !error
}

// Eerste-run-seed: kopieer data/team.json naar Supabase als de tabel leeg
// is. Idempotent — bij bestaande rijen doet 'ie niets.
export async function ensureTeamSeed(): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  const { data } = await supabase.from('team_members').select('id').limit(1)
  if (data && data.length > 0) return
  const seedRows = (teamData.members as Array<{ id: string; name: string; email?: string; color?: string; weeklyCapacity?: number }>).map((m, i) => ({
    id:              m.id,
    name:            m.name,
    email:           m.email ?? '',
    color:           m.color ?? '#9aadbd',
    weekly_capacity: m.weeklyCapacity ?? 0,
    position:        i,
    hidden:          false,
    updated_at:      new Date().toISOString(),
  }))
  if (seedRows.length === 0) return
  await supabase.from('team_members').upsert(seedRows, { onConflict: 'id' })
}

export function subscribeRemoteTeam(onChange: () => void): () => void {
  if (!supabase) return () => {}
  const ch = supabase.channel('team_members')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => onChange())
    .subscribe()
  return () => { supabase!.removeChannel(ch) }
}

// Fallback wanneer Supabase niet bereikbaar is — leest hetzelfde schema
// uit data/team.json zodat de app niet leeg start.
export function fallbackTeam(): TeamMember[] {
  return (teamData.members as Array<{ id: string; name: string; email?: string; color?: string; weeklyCapacity?: number }>)
    .map((m, i) => ({
      id:             m.id,
      name:           m.name,
      email:          m.email ?? '',
      color:          m.color ?? '#9aadbd',
      weeklyCapacity: m.weeklyCapacity ?? 0,
      position:       i,
      hidden:         false,
    }))
}
