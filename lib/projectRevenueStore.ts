import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// Verwachte/bevestigde omzet per PROJECT — koppelt aan een board_items-rij
// (item_id) i.p.v. losse handmatige regels (zie budgetStore.ts). Alleen
// Menno + Vincent kunnen dit zien/bewerken (RLS, zie 0034_project_revenue.sql).
export type ProjectRevenue = {
  itemId:    string
  boardId:   string
  amount:    number
  confirmed: boolean
  updatedAt: string
}

const STORAGE_KEY = 'yoko-project-revenue'

export function loadProjectRevenue(): ProjectRevenue[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ProjectRevenue[]) : []
  } catch { return [] }
}

function writeLocal(entries: ProjectRevenue[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent('yoko-project-revenue-update'))
}

function rowToEntry(r: Record<string, unknown>): ProjectRevenue {
  return {
    itemId:    (r.item_id as string) ?? '',
    boardId:   (r.board_id as string) ?? '',
    amount:    Number(r.amount ?? 0),
    confirmed: !!r.confirmed,
    updatedAt: String(r.updated_at ?? new Date().toISOString()),
  }
}

export async function pullProjectRevenue(): Promise<boolean> {
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { data, error } = await supabase.from('project_revenue').select('*')
  if (error || !data) return false
  writeLocal((data as Record<string, unknown>[]).map(rowToEntry))
  return true
}

export async function upsertProjectRevenue(entry: ProjectRevenue): Promise<boolean> {
  const current = loadProjectRevenue()
  const next = current.some(e => e.itemId === entry.itemId)
    ? current.map(e => e.itemId === entry.itemId ? entry : e)
    : [...current, entry]
  writeLocal(next)

  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { error } = await supabase.from('project_revenue').upsert({
    item_id:    entry.itemId,
    board_id:   entry.boardId,
    amount:     entry.amount,
    confirmed:  entry.confirmed,
    created_by: uid,
    updated_at: entry.updatedAt,
  }, { onConflict: 'item_id' })
  return !error
}

export async function deleteProjectRevenue(itemId: string): Promise<boolean> {
  writeLocal(loadProjectRevenue().filter(e => e.itemId !== itemId))
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { error } = await supabase.from('project_revenue').delete().eq('item_id', itemId)
  return !error
}

let revenueChannelOn = false
export function subscribeRemoteProjectRevenue(): () => void {
  if (!supabase || revenueChannelOn) return () => {}
  revenueChannelOn = true
  const ch = supabase.channel('public:project_revenue')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_revenue' }, () => {
      pullProjectRevenue()
    })
    .subscribe()
  return () => { revenueChannelOn = false; supabase!.removeChannel(ch) }
}
