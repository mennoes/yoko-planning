// Custom team-leden (toegevoegd via de /team UI) staan in localStorage en
// worden bij module-load gemerged in de gedeelde teamData.members array.
// data/team.json blijft de seed; runtime-additions komen erbij zonder dat
// elke import-locatie aangepast hoeft te worden.
//
// Cross-device sync gebeurt via Supabase: zie supabase/0019_team_members_
// extra.sql. We pullen 'm bij eerstvolgende boot van een ander device en
// pushen 'm zodra je 'm hier toevoegt.

import teamData from '@/data/team.json'
import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type TeamMemberExtra = {
  id:              string
  name:            string
  email:           string
  weeklyCapacity:  number
  color:           string
}

const KEY = 'yoko-team-extras'

function readExtras(): TeamMemberExtra[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TeamMemberExtra[]) : []
  } catch { return [] }
}

function writeExtras(list: TeamMemberExtra[]): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
}

// Eén bestaande member-id mag NIET overschreven worden — als de seed
// (team.json) 'menno' al heeft, negeren we een extra met dezelfde id.
// Zo blijft 'menno' altijd 'menno'.
function mergeIntoTeamData(extras: TeamMemberExtra[]): boolean {
  let added = false
  const existing = new Set(teamData.members.map(m => m.id))
  for (const m of extras) {
    if (existing.has(m.id)) continue
    teamData.members.push({ ...m })
    existing.add(m.id)
    added = true
  }
  return added
}

function notify() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('yoko-team-update'))
}

// ── Side-effect bij eerste import: localStorage → teamData ────────────────
// Componenten die `import teamData from '@/data/team.json'` doen, zien de
// extras vanaf nu in hun renders zodra deze module ergens (in AppShell)
// geïmporteerd is.
if (typeof window !== 'undefined') {
  const extras = readExtras()
  if (extras.length > 0) mergeIntoTeamData(extras)
}

// ── Public API ────────────────────────────────────────────────────────────
export function listExtras(): TeamMemberExtra[] {
  return readExtras()
}

export function addExtra(m: TeamMemberExtra): boolean {
  if (teamData.members.some(x => x.id === m.id)) return false
  const next = [...readExtras().filter(x => x.id !== m.id), m]
  writeExtras(next)
  mergeIntoTeamData(next)
  notify()
  pushExtraToRemote(m).catch(() => {})
  return true
}

export function removeExtra(id: string): boolean {
  const next = readExtras().filter(x => x.id !== id)
  writeExtras(next)
  // We muteren teamData niet bij verwijdering — een runtime member die
  // ergens al referenties heeft (board-items, todos) zou anders 'verdwijnen'.
  // Hij blijft in de huidige sessie zichtbaar; na refresh is-ie weg.
  notify()
  deleteExtraFromRemote(id).catch(() => {})
  return true
}

export function onTeamUpdate(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('yoko-team-update', cb)
  return () => window.removeEventListener('yoko-team-update', cb)
}

// ── Remote sync ───────────────────────────────────────────────────────────
type DbRow = {
  id:              string
  name:            string
  email:           string | null
  weekly_capacity: number
  color:           string
}

async function pushExtraToRemote(m: TeamMemberExtra): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  await supabase.from('team_members_extra').upsert({
    id:              m.id,
    name:            m.name,
    email:           m.email || null,
    weekly_capacity: m.weeklyCapacity,
    color:           m.color,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'id' })
}

async function deleteExtraFromRemote(id: string): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  await supabase.from('team_members_extra').delete().eq('id', id)
}

export async function pullExtrasFromRemote(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase.from('team_members_extra').select('*')
  if (error || !data) return false
  const remote: TeamMemberExtra[] = (data as DbRow[]).map(r => ({
    id:             r.id,
    name:           r.name,
    email:          r.email ?? '',
    weeklyCapacity: Number(r.weekly_capacity) || 0,
    color:          r.color,
  }))
  writeExtras(remote)
  if (mergeIntoTeamData(remote)) notify()
  return true
}

// Module-level dedup: voorkomt 'cannot add postgres_changes callbacks
// after subscribe()' wanneer AppShell start() opnieuw runt (bv. na
// auth-change) terwijl 't channel-object intern nog leeft. Pas opnieuw
// subscriben als de vorige expliciet is opgeruimd.
let extrasChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
export function subscribeRemoteExtras(): () => void {
  if (!supabase) return () => {}
  if (extrasChannel) return () => {}
  const ch = supabase.channel('team_members_extra')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members_extra' }, () => {
      pullExtrasFromRemote().catch(() => {})
    })
    .subscribe()
  extrasChannel = ch
  return () => {
    if (supabase && extrasChannel) {
      supabase.removeChannel(extrasChannel)
      extrasChannel = null
    }
  }
}
