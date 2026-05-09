// Workload categories (Maken / Overhead / Meeting) and per-item overrides.
// Shared between the home page workload widget and the planning page popovers
// so a category change in one place is reflected in the other.

export type WorkloadCategory = 'meeting' | 'overhead' | 'maken'

export const CAT_COLOR: Record<WorkloadCategory, string> = {
  meeting:  '#D8B62E',
  overhead: '#9aadbd',
  maken:    '#5fa06e',
}
export const CAT_LABEL: Record<WorkloadCategory, string> = {
  meeting:  'Meeting',
  overhead: 'Overhead',
  maken:    'Maken',
}

const MEETING_PATTERNS = [
  /\bmeeting\b/i, /\boverleg\b/i, /\bcall\b/i, /\bbel\b/i, /\b1on1\b/i, /\bsync\b/i,
  /\bcheck-?in\b/i, /\bincheck\b/i, /\bstand-?up\b/i, /\bweekstart\b/i, /\bweek-?afsluiting\b/i,
  /\byoko check\b/i, /\bcheckout\b/i, /\bcheck out\b/i, /\bbpd\b/i, /\bketcho\b/i,
]
const OVERHEAD_PATTERNS = [
  /\bvisie\b/i, /\bto.?do/i, /\bformuleer/i, /\bplanning\b/i, /\bsocials\b/i, /\bthuiswerken\b/i,
  /\bvrij\b/i, /\bvakantie\b/i, /\bnab\b/i, /\bonbetaald\b/i, /\bemail\b/i, /\bmail\b/i,
  /\bonboarding\b/i, /\bevaluatie\b/i, /\beind-?gesprek\b/i,
]

export function classifyItem(item: { name: string; hours: number; source?: string }): WorkloadCategory {
  const n = item.name || ''
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
  if (override === 'meeting' || override === 'overhead' || override === 'maken') return override
  return classifyItem(item)
}

const STORAGE_KEY  = 'yoko-workload-categories'
const UPDATE_EVENT = 'yoko-workload-categories-update'

export function loadCategoryOverrides(): Record<string, WorkloadCategory> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, WorkloadCategory>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

export function setCategoryOverride(id: string, cat: WorkloadCategory | null): Record<string, WorkloadCategory> {
  const current = loadCategoryOverrides()
  const next = { ...current }
  if (cat === null) delete next[id]
  else              next[id] = cat
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
  }
  return next
}

export function onCategoryOverridesChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}
