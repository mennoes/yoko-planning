import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// Omzet-sjabloon voor een herkende terugkerende reeks (bv. 'UvNL S04
// aflevering X'): één default-bedrag dat automatisch geldt voor alle
// items met dezelfde genormaliseerde naam op dat bord, tenzij een item
// een eigen expliciete project_revenue-override heeft.
export type RevenueTemplate = {
  pattern:       string  // genormaliseerde naam, zie lib/subitemRules.ts normalizeTitle
  boardId:       string
  defaultAmount: number
  updatedAt:     string
}

const STORAGE_KEY = 'yoko-revenue-templates'

function templateKey(boardId: string, pattern: string): string {
  return `${boardId}::${pattern}`
}

export function loadRevenueTemplates(): RevenueTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RevenueTemplate[]) : []
  } catch { return [] }
}

function writeLocal(templates: RevenueTemplate[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  window.dispatchEvent(new CustomEvent('yoko-revenue-template-update'))
}

function rowToTemplate(r: Record<string, unknown>): RevenueTemplate {
  return {
    pattern:       (r.pattern as string) ?? '',
    boardId:       (r.board_id as string) ?? '',
    defaultAmount: Number(r.default_amount ?? 0),
    updatedAt:     String(r.updated_at ?? new Date().toISOString()),
  }
}

export async function pullRevenueTemplates(): Promise<boolean> {
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { data, error } = await supabase.from('revenue_templates').select('*')
  if (error || !data) return false
  writeLocal((data as Record<string, unknown>[]).map(rowToTemplate))
  return true
}

export async function upsertRevenueTemplate(t: RevenueTemplate): Promise<boolean> {
  const current = loadRevenueTemplates()
  const k = templateKey(t.boardId, t.pattern)
  const next = current.some(x => templateKey(x.boardId, x.pattern) === k)
    ? current.map(x => templateKey(x.boardId, x.pattern) === k ? t : x)
    : [...current, t]
  writeLocal(next)

  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { error } = await supabase.from('revenue_templates').upsert({
    pattern: t.pattern, board_id: t.boardId, default_amount: t.defaultAmount,
    created_by: uid, updated_at: t.updatedAt,
  }, { onConflict: 'board_id,pattern' })
  return !error
}

let templateChannelOn = false
export function subscribeRemoteRevenueTemplates(): () => void {
  if (!supabase || templateChannelOn) return () => {}
  templateChannelOn = true
  const ch = supabase.channel('public:revenue_templates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'revenue_templates' }, () => {
      pullRevenueTemplates()
    })
    .subscribe()
  return () => { templateChannelOn = false; supabase!.removeChannel(ch) }
}
