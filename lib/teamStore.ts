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
  startDate:       string | null
  // Gestopt (bv. stage afgerond) — blijft zichtbaar (i.t.t. 'hidden') maar
  // telt niet mee in actieve capaciteitsplanning. Los van 'kind': iemand
  // blijft yoko/freelance, wordt alleen als inactief gegroepeerd.
  inactive:        boolean
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
  start_date:      string | null
  inactive:        boolean | null
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
    startDate:      r.start_date ?? null,
    inactive:       !!r.inactive,
  }
}

const YOKO_IDS = new Set(['menno','vincent','odette','anne-fleur','kars'])
const START_DATE_META_PREFIX = '__team_start_date__:'
function defaultKindFor(id: string): TeamKind {
  if (id === 'unassigned') return 'unassigned'
  if (YOKO_IDS.has(id))    return 'yoko'
  return 'freelance'
}

export async function pullTeam(): Promise<TeamMember[] | null> {
  if (!supabase) return null
  if (!await getCurrentUserId()) return null
  const sel = 'id, name, email, color, weekly_capacity, position, hidden, kind, start_date, inactive'
  const { data, error } = await supabase
    .from('team_members')
    .select(sel)
    .order('position', { ascending: true })
  if (!error && data) return (data as Row[]).map(rowToMember)
  // Fallback: migratie 0018/0036/0037 niet gedraaid → kolom 'kind',
  // 'start_date' of 'inactive' bestaat nog niet. Probeer zonder zodat de
  // UI alsnog leden toont. Voor de kind-classificatie vallen we terug op
  // defaultKindFor(id) zodat freelancers niet allemaal als 'yoko'
  // verschijnen (wat zou gebeuren als normalizeKind z'n default 'yoko'
  // zou toepassen). 'inactive' ontbreekt dan simpelweg → rowToMember
  // defaultet 'm naar false, wat exact het pre-migratie gedrag is.
  if (error && /(kind|start_date|inactive)/.test(error.message)) {
    const fbWithKind = await supabase
      .from('team_members')
      .select('id, name, email, color, weekly_capacity, position, hidden, kind')
      .order('position', { ascending: true })
    const fb = fbWithKind.error
      ? await supabase
      .from('team_members')
      .select('id, name, email, color, weekly_capacity, position, hidden')
      .order('position', { ascending: true })
      : fbWithKind
    if (!fb.error && fb.data) {
      const hasKind = !fbWithKind.error
      const members = (fb.data as Array<Omit<Row, 'start_date'> & { kind?: string | null }>).map(r => {
        const member = rowToMember({ ...r, kind: hasKind ? (r.kind ?? null) : null, start_date: null })
        if (!hasKind) member.kind = defaultKindFor(member.id)
        return member
      })
      const { data: metaRows } = await supabase
        .from('team_members_extra')
        .select('id, email')
        .like('id', `${START_DATE_META_PREFIX}%`)
      const starts = new Map(((metaRows as Array<{ id: string; email: string | null }> | null) ?? [])
        .map(r => [r.id.slice(START_DATE_META_PREFIX.length), r.email] as const))
      return members.map(member => ({ ...member, startDate: starts.get(member.id) || null }))
    }
  }
  return null
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
    start_date:      m.startDate,
    inactive:        m.inactive,
    updated_at:      new Date().toISOString(),
  }
  const { error } = await supabase.from('team_members').upsert(payload, { onConflict: 'id' })
  if (error) {
    // Migratie 0037 (inactive) nog niet gedraaid, maar kind/start_date wél
    // aanwezig — simpele retry zonder 'inactive' zodat opslaan blijft
    // werken terwijl de admin de migratie draait.
    if (/inactive/.test(error.message) && !/(kind|start_date)/.test(error.message)) {
      const { inactive: _inactive, ...withoutInactive } = payload
      void _inactive
      const retry = await supabase.from('team_members').upsert(withoutInactive, { onConflict: 'id' })
      if (!retry.error) return { ok: true, error: 'inactive_column_missing_run_0037' }
      return { ok: false, error: `${error.message} — én fallback faalde: ${retry.error.message}` }
    }
    // Fallback: migratie 0018 niet gedraaid → 'kind' kolom bestaat niet.
    // Probeer zonder kind zodat de rij in elk geval gemaakt wordt. Strip
    // ook 'inactive' als die kolom er evenmin is (oudere installaties
    // missen soms meerdere migraties tegelijk).
    if (/(kind|start_date)/.test(error.message)) {
      const missingStartDate = /start_date/.test(error.message)
      const missingKind = /kind/.test(error.message)
      const missingInactive = /inactive/.test(error.message)
      const { kind: _kind, start_date: _startDate, inactive: _inactive, ...basePayload } = payload
      void _kind; void _startDate; void _inactive
      let compatiblePayload: Record<string, unknown> = basePayload
      if (!missingKind) compatiblePayload = { ...compatiblePayload, kind: payload.kind }
      if (!missingStartDate) compatiblePayload = { ...compatiblePayload, start_date: payload.start_date }
      if (!missingInactive) compatiblePayload = { ...compatiblePayload, inactive: payload.inactive }
      let second = await supabase.from('team_members').upsert(compatiblePayload, { onConflict: 'id' })
      if (second.error && compatiblePayload !== basePayload) {
        second = await supabase.from('team_members').upsert(basePayload, { onConflict: 'id' })
      }
      if (!second.error) {
        await saveLegacyStartDate(m.id, m.startDate)
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
  await supabase.from('team_members_extra').delete().eq('id', `${START_DATE_META_PREFIX}${id}`)
  return !error
}

async function saveLegacyStartDate(memberId: string, startDate: string | null): Promise<void> {
  if (!supabase) return
  const id = `${START_DATE_META_PREFIX}${memberId}`
  if (!startDate) {
    await supabase.from('team_members_extra').delete().eq('id', id)
    return
  }
  await supabase.from('team_members_extra').upsert({
    id,
    name: 'Team startdatum',
    email: startDate,
    weekly_capacity: 0,
    color: '#9aadbd',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
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
      start_date:      null,
      inactive:        false,
      updated_at:      new Date().toISOString(),
    }))
  if (missing.length === 0) return
  const { error } = await supabase.from('team_members').upsert(missing, { onConflict: 'id' })
  if (error && /(kind|start_date|inactive)/.test(error.message)) {
    // Migratie 0018/0036/0037 nog niet gedraaid → probeer zonder.
    const legacyRows = missing.map(({ kind: _kind, start_date: _startDate, inactive: _inactive, ...rest }) => { void _kind; void _startDate; void _inactive; return rest })
    await supabase.from('team_members').upsert(legacyRows, { onConflict: 'id' })
  }
}

export function subscribeRemoteTeam(onChange: () => void): () => void {
  if (!supabase) return () => {}
  const ch = supabase.channel('team_members')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members_extra' }, payload => {
      const id = String((payload.new as { id?: string } | null)?.id ?? (payload.old as { id?: string } | null)?.id ?? '')
      if (id.startsWith(START_DATE_META_PREFIX)) onChange()
    })
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
      startDate:      null,
      inactive:       false,
    }))
}

export function isTeamMemberStarted(member: Pick<TeamMember, 'startDate'>, today = new Date()): boolean {
  if (!member.startDate) return true
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return member.startDate <= localToday
}
