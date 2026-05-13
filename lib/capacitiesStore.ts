// Team-capaciteiten per persoon. Gedeeld team-breed via Supabase
// (`team_capacities` tabel) zodat een aanpassing op je PC ook op mobiel zichtbaar
// is. localStorage blijft als cache + offline fallback.

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

const STORAGE_KEY  = 'yoko-capacities'
const UPDATE_EVENT = 'yoko-capacities-update'

export type CapacityMap = Record<string, number>

function readCache(): CapacityMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CapacityMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function writeCache(map: CapacityMap) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function loadCapacities(): CapacityMap {
  return readCache()
}

export function setCapacity(memberId: string, capacity: number): CapacityMap {
  const next = { ...readCache(), [memberId]: capacity }
  writeCache(next)
  pushCapacity(memberId, capacity).catch(() => {})
  return next
}

export function onCapacitiesChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

// ─── Remote sync ──────────────────────────────────────────────────────────────
export async function pullCapacities(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('team_capacities')
    .select('member_id, weekly_capacity')
  if (error || !data) return false

  // First-time seed: remote leeg — duw de lokale cache omhoog zodat andere
  // devices wat dit browser-tabblad al had kunnen ophalen.
  if (data.length === 0) {
    const local = readCache()
    const ids   = Object.keys(local)
    if (ids.length === 0) return true
    const rows = ids.map(id => ({
      member_id:       id,
      weekly_capacity: local[id],
      updated_at:      new Date().toISOString(),
    }))
    await supabase.from('team_capacities').upsert(rows, { onConflict: 'member_id' })
    return true
  }

  const map: CapacityMap = {}
  for (const r of data as { member_id: string; weekly_capacity: number }[]) {
    map[r.member_id] = Number(r.weekly_capacity) || 0
  }
  if (JSON.stringify(readCache()) === JSON.stringify(map)) return true
  writeCache(map)
  return true
}

async function pushCapacity(memberId: string, capacity: number): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  await supabase.from('team_capacities').upsert({
    member_id:       memberId,
    weekly_capacity: capacity,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'member_id' })
}

let capacitiesChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullCapacities().catch(() => {})
  }, 400)
}

export function subscribeRemoteCapacities(): () => void {
  if (!supabase) return () => {}
  if (capacitiesChannel) return () => {}
  const ch = supabase.channel('team_capacities')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_capacities' }, () => schedulePull())
    .subscribe()
  capacitiesChannel = ch
  return () => {
    if (supabase && capacitiesChannel) {
      supabase.removeChannel(capacitiesChannel)
      capacitiesChannel = null
    }
  }
}
