// Cache van profiles.days_off → ISO weekday-nummers per member.
// We synchroniseren hier zodat countWorkdays sync kan checken zonder
// een Supabase-roundtrip per project per dag. Vroeger had ik
// daysOffStore (team_capacities.days_off) — die is verwijderd omdat
// profile-page al een veel rijkere days_off-editor heeft. Eén bron.

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// ISO weekday: 1=Ma, …, 5=Vr, 6=Za, 7=Zo
const DAY_TO_ISO: Record<string, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
}

const STORAGE_KEY  = 'yoko-profile-days-off'
const UPDATE_EVENT = 'yoko-profile-days-off-update'

export type ProfileDaysOffMap = Record<string, number[]>

function readCache(): ProfileDaysOffMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ProfileDaysOffMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function writeCache(map: ProfileDaysOffMap) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function loadProfileDaysOff(): ProfileDaysOffMap {
  return readCache()
}

export function isProfileOff(memberId: string, date: Date): boolean {
  const map = readCache()
  const off = map[memberId]
  if (!off || off.length === 0) return false
  const dow = date.getDay()
  const iso = dow === 0 ? 7 : dow
  return off.includes(iso)
}

export function onProfileDaysOffChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

export async function pullProfileDaysOff(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  // Primaire bron: team_members.days_off (geen auth-dependency, dus
  // werkt voor ALLE teamleden inclusief degenen zonder profiles-rij).
  // Profiles.days_off is een legacy fallback voor signed-up users
  // wiens days_off vóór de team_members-migratie alleen daar landde.
  const map: ProfileDaysOffMap = {}
  const tm = await supabase.from('team_members').select('id, days_off')
  if (tm.data) {
    for (const r of tm.data as { id: string | null; days_off: string[] | null }[]) {
      if (!r.id) continue
      const arr = Array.isArray(r.days_off) ? r.days_off : []
      const iso = arr.map(d => DAY_TO_ISO[d.toLowerCase()]).filter((n): n is number => !!n)
      if (iso.length > 0) map[r.id] = iso
    }
  }
  // Legacy: profiles.days_off — alleen overschrijven als team_members
  // geen waarde had (mid-migratie, zodat oude data niet verloren gaat).
  const pr = await supabase.from('profiles').select('member_id, days_off')
  if (pr.data) {
    for (const r of pr.data as { member_id: string | null; days_off: string[] | null }[]) {
      if (!r.member_id) continue
      if (map[r.member_id]) continue
      const arr = Array.isArray(r.days_off) ? r.days_off : []
      const iso = arr.map(d => DAY_TO_ISO[d.toLowerCase()]).filter((n): n is number => !!n)
      if (iso.length > 0) map[r.member_id] = iso
    }
  }
  if (JSON.stringify(readCache()) === JSON.stringify(map)) return true
  writeCache(map)
  return true
}

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullProfileDaysOff().catch(() => {})
  }, 400)
}
export function subscribeRemoteProfileDaysOff(): () => void {
  if (!supabase) return () => {}
  if (channel) return () => {}
  const ch = supabase.channel('profile_days_off')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => schedulePull())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => schedulePull())
    .subscribe()
  channel = ch
  return () => {
    if (supabase && channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
