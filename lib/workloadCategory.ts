// Workload categories (Maken / Overhead / Meeting) and per-item overrides.
// Shared between the home page workload widget and the planning page popovers
// so a category change in one place is reflected in the other. Persisted in
// Supabase (`workload_categories` table) so every browser/device sees the
// same categorisation; localStorage is kept as a fast cache + offline fallback.

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// `overhead` blijft als data-key bestaan zodat oude rijen in Supabase niet
// opnieuw geclassificeerd hoeven; alleen het label is gewijzigd naar
// "Overige maken". `vrij` is nieuw — vakantie / verlof / niet-werkdagen.
export type WorkloadCategory = 'meeting' | 'overhead' | 'maken' | 'vrij'
export const ALL_CATEGORIES: readonly WorkloadCategory[] = ['maken', 'overhead', 'meeting', 'vrij'] as const

export const CAT_COLOR: Record<WorkloadCategory, string> = {
  meeting:  '#D8B62E',
  overhead: '#9aadbd',
  maken:    '#5fa06e',
  vrij:     '#3db883',
}
export const CAT_LABEL: Record<WorkloadCategory, string> = {
  meeting:  'Meeting',
  overhead: 'Overige maken',
  maken:    'Maken',
  vrij:     'Vrij',
}

const MEETING_PATTERNS = [
  /\bmeeting\b/i, /\boverleg\b/i, /\bcall\b/i, /\bbel\b/i, /\b1on1\b/i, /\bsync\b/i,
  /\bcheck-?in\b/i, /\bincheck\b/i, /\bstand-?up\b/i, /\bweekstart\b/i, /\bweek-?afsluiting\b/i,
  /\byoko check\b/i, /\bcheckout\b/i, /\bcheck out\b/i, /\bbpd\b/i, /\bketcho\b/i,
]
const OVERHEAD_PATTERNS = [
  /\bvisie\b/i, /\bto.?do/i, /\bformuleer/i, /\bplanning\b/i, /\bsocials\b/i,
  /\bnab\b/i, /\bonbetaald\b/i, /\bemail\b/i, /\bmail\b/i,
  /\bonboarding\b/i, /\bevaluatie\b/i, /\beind-?gesprek\b/i,
]
const VRIJ_PATTERNS = [
  /\bvrij\b/i, /\bvakantie\b/i, /\bverlof\b/i, /\bthuiswerken\b/i, /\bziek\b/i,
  /\bfeestdag\b/i, /\bhemelvaart\b/i, /\bpinksteren\b/i, /\bpasen\b/i, /\bkerst\b/i,
  /\bkoningsdag\b/i, /\bbevrijdingsdag\b/i,
]

function isValidCategory(c: unknown): c is WorkloadCategory {
  return c === 'meeting' || c === 'overhead' || c === 'maken' || c === 'vrij'
}

export function classifyItem(item: { name: string; hours: number; source?: string }): WorkloadCategory {
  const n = item.name || ''
  if (VRIJ_PATTERNS.some(re => re.test(n))) return 'vrij'
  if (MEETING_PATTERNS.some(re => re.test(n))) return 'meeting'
  // Short Google events without a clear "maken" name → meeting
  if (item.source === 'google' && item.hours > 0 && item.hours <= 1.5) return 'meeting'
  if (OVERHEAD_PATTERNS.some(re => re.test(n))) return 'overhead'
  return 'maken'
}

export function effectiveCategory(
  item: { name: string; hours: number; source?: string },
  override?: WorkloadCategory | null,
): WorkloadCategory {
  if (isValidCategory(override)) return override
  return classifyItem(item)
}

const STORAGE_KEY  = 'yoko-workload-categories'
const UPDATE_EVENT = 'yoko-workload-categories-update'

function readCache(): Record<string, WorkloadCategory> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, WorkloadCategory>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function writeCache(map: Record<string, WorkloadCategory>) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function loadCategoryOverrides(): Record<string, WorkloadCategory> {
  return readCache()
}

export function setCategoryOverride(id: string, cat: WorkloadCategory | null): Record<string, WorkloadCategory> {
  const next = { ...readCache() }
  if (cat === null) delete next[id]
  else              next[id] = cat
  writeCache(next)
  pushCategoryOverride(id, cat).catch(() => {})
  return next
}

export function onCategoryOverridesChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

// ─── Remote sync ──────────────────────────────────────────────────────────────
export async function pullCategoryOverrides(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('workload_categories')
    .select('item_id, category')
  if (error || !data) return false

  // First-time seed: remote is empty — push the local cache up so other
  // devices can pull whatever this browser already had.
  if (data.length === 0) {
    const local = readCache()
    const ids   = Object.keys(local)
    if (ids.length === 0) return true
    const rows = ids.map(id => ({
      item_id:    id,
      category:   local[id],
      updated_at: new Date().toISOString(),
    }))
    await supabase.from('workload_categories').upsert(rows, { onConflict: 'item_id' })
    return true
  }

  const map: Record<string, WorkloadCategory> = {}
  for (const r of data as { item_id: string; category: string }[]) {
    if (isValidCategory(r.category)) map[r.item_id] = r.category
  }
  // Skip the update event if the cache already matches.
  if (JSON.stringify(readCache()) === JSON.stringify(map)) return true
  writeCache(map)
  return true
}

async function pushCategoryOverride(id: string, cat: WorkloadCategory | null): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  if (cat === null) {
    await supabase.from('workload_categories').delete().eq('item_id', id)
  } else {
    await supabase.from('workload_categories').upsert({
      item_id:    id,
      category:   cat,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'item_id' })
  }
}

let categoryChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullCategoryOverrides().catch(() => {})
  }, 400)
}

export function subscribeRemoteCategories(): () => void {
  if (!supabase) return () => {}
  if (categoryChannel) return () => {}
  const ch = supabase.channel('workload_categories')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workload_categories' }, () => schedulePull())
    .subscribe()
  categoryChannel = ch
  return () => {
    if (supabase && categoryChannel) {
      supabase.removeChannel(categoryChannel)
      categoryChannel = null
    }
  }
}
