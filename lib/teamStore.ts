// Team-leden komen voortaan uit Supabase (tabel team_members). Bij eerste
// bezoek seeden we de huidige data/team.json daar naartoe zodat bestaande
// installaties geen lege team-lijst krijgen. data/team.json blijft fallback
// voor offline / niet-geauthenticeerde sessies.

import { supabase } from './supabase'
import teamData from '@/data/team.json'
import { getCurrentUserId } from './sync'

export type TeamKind = 'yoko' | 'freelance' | 'unassigned'

export type TeamMember = {
  id:              string
  name:            string
  email:           string
  color:           string
  weeklyCapacity:  number
  position:        number
  hidden:          boolean
  kind:            TeamKind
}

type Row = {
  id:              string
  name:            string
  email:           string | null
  color:           string | null
  weekly_capacity: number | null
  position:        number | null
  hidden:          boolean | null
  kind:            string | null
}

function normalizeKind(k: string | null | undefined): TeamKind {
  if (k === 'freelance' || k === 'unassigned') return k
  return 'yoko'
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
    kind:           normalizeKind(r.kind),
  }
}

const YOKO_IDS = new Set(['menno','vincent','odette','anne-fleur','kars'])
function defaultKindFor(id: string): TeamKind {
  if (id === 'unassigned') return 'unassigned'
  if (YOKO_IDS.has(id))    return 'yoko'
  return 'freelance'
}

export async function pullTeam(): Promise<TeamMember[] | null> {
  if (!supabase) return null
  if (!await getCurrentUserId()) return null
  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, email, color, weekly_capacity, position, hidden, kind')
    .order('position', { ascending: true })
  if (error || !data) return null
  return (data as Row[]).map(rowToMember)
}

export async function upsertTeamMember(m: TeamMember): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'supabase_not_configured' }
  if (!await getCurrentUserId()) return { ok: false, error: 'not_authenticated' }
  const payload = {
    id:              m.id,
    name:            m.name,
    email:           m.email,
    color:           m.color,
    weekly_capacity: m.weeklyCapacity,
    position:        m.position,
    hidden:          m.hidden,
    kind:            m.kind,
    updated_at:      new Date().toISOString(),
  }
  const { error } = await supabase.from('team_members').upsert(payload, { onConflict: 'id' })
  if (error) {
    // Fallback: migratie 0018 niet gedraaid → 'kind' kolom bestaat niet.
    // Probeer zonder kind zodat de rij in elk geval gemaakt wordt.
    if (/kind/.test(error.message)) {
      const { kind: _drop, ...sansKind } = payload
      void _drop
      const second = await supabase.from('team_members').upsert(sansKind, { onConflict: 'id' })
      if (!second.error) {
        return { ok: true, error: 'kind_column_missing_run_0018' }
      }
      return { ok: false, error: `${error.message} — én fallback faalde: ${second.error.message}` }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function deleteTeamMember(id: string): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('team_members').delete().eq('id', id)
  return !error
}

// Seed-helper: vult team_members aan met leden uit data/team.json die er
// nog niet in staan. Idempotent — bestaande rijen behouden hun huidige
// kind/email/foto/kleur; alleen écht ontbrekende ids krijgen een
// default-rij. Eerdere versie bailde uit zodra de tabel óók maar één
// rij had (bv. de unassigned-placeholder), waardoor het hele Yoko-crew
// nooit verscheen. Nu vergelijken we per-id.
export async function ensureTeamSeed(): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  const { data } = await supabase.from('team_members').select('id')
  const existing = new Set((data as { id: string }[] | null)?.map(r => r.id) ?? [])
  const seedSource = teamData.members as Array<{ id: string; name: string; email?: string; color?: string; weeklyCapacity?: number }>
  const missing = seedSource
    .filter(m => !existing.has(m.id))
    .map((m, i) => ({
      id:              m.id,
      name:            m.name,
      email:           m.email ?? '',
      color:           m.color ?? '#9aadbd',
      weekly_capacity: m.weeklyCapacity ?? 0,
      position:        existing.size + i,
      hidden:          false,
      kind:            defaultKindFor(m.id),
      updated_at:      new Date().toISOString(),
    }))
  if (missing.length === 0) return
  await supabase.from('team_members').upsert(missing, { onConflict: 'id' })
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
      kind:           defaultKindFor(m.id),
    }))
}
