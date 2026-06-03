// Vrije dagen per teamlid. ISO weekday-nummers (1=Ma, 2=Di, …, 7=Zo).
// Bijv. Menno die vrijdag vrij is → setDaysOff('menno', [5]).
//
// Storage: localStorage als cache + Supabase team_capacities.days_off
// kolom voor cross-device sync. Mirror van capacitiesStore patroon.

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

const STORAGE_KEY  = 'yoko-days-off'
const UPDATE_EVENT = 'yoko-days-off-update'

export type DaysOffMap = Record<string, number[]>

function readCache(): DaysOffMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DaysOffMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function writeCache(map: DaysOffMap) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function loadDaysOff(): DaysOffMap {
  return readCache()
}

export function setDaysOff(memberId: string, days: number[]): DaysOffMap {
  const cleaned = Array.from(new Set(days.filter(d => d >= 1 && d <= 7))).sort()
  const next = { ...readCache(), [memberId]: cleaned }
  writeCache(next)
  pushDaysOff(memberId, cleaned).catch(() => {})
  return next
}

// JS Date getDay(): 0=Sun..6=Sat. Wij gebruiken ISO: 1=Mon..7=Sun.
// Helper converteert een Date naar ISO weekday-nummer.
export function isoWeekday(d: Date): number {
  const dow = d.getDay()
  return dow === 0 ? 7 : dow
}

export function isDayOffForMember(memberId: string, date: Date, cache?: DaysOffMap): boolean {
  const map = cache ?? readCache()
  const off = map[memberId]
  if (!off || off.length === 0) return false
  return off.includes(isoWeekday(date))
}

export function onDaysOffChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

// ─── Remote sync ──────────────────────────────────────────────────────────────
export async function pullDaysOff(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('team_capacities')
    .select('member_id, days_off')
  if (error || !data) return false
  const map: DaysOffMap = {}
  for (const r of data as { member_id: string; days_off: number[] | null }[]) {
    if (Array.isArray(r.days_off) && r.days_off.length > 0) {
      map[r.member_id] = r.days_off
    }
  }
  if (JSON.stringify(readCache()) === JSON.stringify(map)) return true
  writeCache(map)
  return true
}

async function pushDaysOff(memberId: string, days: number[]): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  await supabase.from('team_capacities').upsert({
    member_id:  memberId,
    days_off:   days.length > 0 ? days : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'member_id' })
}

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullDaysOff().catch(() => {})
  }, 400)
}
export function subscribeRemoteDaysOff(): () => void {
  if (!supabase) return () => {}
  if (channel) return () => {}
  const ch = supabase.channel('team_days_off')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_capacities' }, () => schedulePull())
    .subscribe()
  channel = ch
  return () => {
    if (supabase && channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
