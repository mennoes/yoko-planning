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

// Schrijf-API: gebruikt door de /team werkdagen-toggle als primaire
// opslag. Persisteert direct in localStorage (geen Supabase-RTT, geen
// schema-dependency). Realtime cross-device sync gebeurt later via een
// echte DB-kolom; tot die migratie gedraaid is is per-browser de bron.
export function setProfileDaysOff(memberId: string, isoDays: number[]): void {
  const map = readCache()
  if (isoDays.length === 0) delete map[memberId]
  else map[memberId] = [...isoDays].sort((a, b) => a - b)
  writeCache(map)
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
  // Primaire bron: team_capacities.days_off (int[], ISO weekday-nummers).
  // Geen auth-FK dus werkt voor ALLE teamleden, ook degenen zonder
  // profiles-rij. Profiles.days_off blijft legacy fallback voor
  // signed-up users wiens werkdagen daar nog stonden vóór de switch.
  const map: ProfileDaysOffMap = {}
  const tc = await supabase.from('team_capacities').select('member_id, days_off')
  if (tc.data) {
    for (const r of tc.data as { member_id: string | null; days_off: number[] | null }[]) {
      if (!r.member_id) continue
      const arr = Array.isArray(r.days_off) ? r.days_off.filter(n => typeof n === 'number') : []
      if (arr.length > 0) map[r.member_id] = arr
    }
  }
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },         () => schedulePull())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_capacities' },  () => schedulePull())
    .subscribe()
  channel = ch
  return () => {
    if (supabase && channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
