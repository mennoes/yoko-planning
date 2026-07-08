import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// Budget/omzet-tracking — alleen voor Menno + Vincent (zie 0033_budget_entries.sql
// voor de server-side RLS-afscherming; de sidebar/route-guard hier is alleen UX,
// de echte beveiliging zit in de database policy).
export type BudgetEntry = {
  id:        string
  memberId:  string   // 'menno' | 'vincent'
  quarter:   string   // 'YYYY-Q1'..'YYYY-Q4'
  amount:    number   // omzet in euro's
  label?:    string   // optionele toelichting (klant/project)
  createdAt: string
  updatedAt: string
}

export const BUDGET_ALLOWED_MEMBER_IDS = ['menno', 'vincent']

const STORAGE_KEY = 'yoko-budget-entries'

export function genBudgetId(): string {
  return `bud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─── Kwartaal-helpers ───────────────────────────────────────────────────────
export function quarterOf(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1
  return `${date.getFullYear()}-Q${q}`
}

export function currentQuarter(): string {
  return quarterOf(new Date())
}

// Genereert een reeks kwartaal-labels rond de huidige, van oud naar nieuw.
// back=aantal kwartalen terug, fwd=aantal kwartalen vooruit (incl. huidige).
export function quarterRange(back: number, fwd: number): string[] {
  const now = new Date()
  const out: string[] = []
  for (let i = -back; i <= fwd; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i * 3, 1)
    out.push(quarterOf(d))
  }
  return out
}

export function quarterLabel(q: string): string {
  const [year, qq] = q.split('-Q')
  return `Q${qq} ${year}`
}

// ─── Local cache ────────────────────────────────────────────────────────────
export function loadBudgetEntries(): BudgetEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as BudgetEntry[]) : []
  } catch { return [] }
}

function writeLocal(entries: BudgetEntry[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent('yoko-budget-update'))
}

// ─── Remote sync (Supabase) ─────────────────────────────────────────────────
function rowToEntry(r: Record<string, unknown>): BudgetEntry {
  return {
    id:        String(r.id ?? ''),
    memberId:  (r.member_id as string) ?? '',
    quarter:   (r.quarter as string) ?? '',
    amount:    Number(r.amount ?? 0),
    label:     (r.label as string | undefined) ?? undefined,
    createdAt: String(r.created_at ?? new Date().toISOString()),
    updatedAt: String(r.updated_at ?? new Date().toISOString()),
  }
}

export async function pullBudgetEntries(): Promise<boolean> {
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { data, error } = await supabase.from('budget_entries').select('*').order('quarter', { ascending: true })
  if (error || !data) return false
  const entries = (data as Record<string, unknown>[]).map(rowToEntry)
  writeLocal(entries)
  return true
}

export async function upsertBudgetEntry(entry: BudgetEntry): Promise<boolean> {
  // Optimistic local update eerst, zodat de UI meteen reageert.
  const current = loadBudgetEntries()
  const next = current.some(e => e.id === entry.id)
    ? current.map(e => e.id === entry.id ? entry : e)
    : [...current, entry]
  writeLocal(next)

  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { error } = await supabase.from('budget_entries').upsert({
    id:         entry.id,
    member_id:  entry.memberId,
    quarter:    entry.quarter,
    amount:     entry.amount,
    label:      entry.label ?? null,
    created_by: uid,
    updated_at: entry.updatedAt,
  }, { onConflict: 'id' })
  return !error
}

export async function deleteBudgetEntry(id: string): Promise<boolean> {
  writeLocal(loadBudgetEntries().filter(e => e.id !== id))
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { error } = await supabase.from('budget_entries').delete().eq('id', id)
  return !error
}

let budgetChannelOn = false
export function subscribeRemoteBudget(): () => void {
  if (!supabase || budgetChannelOn) return () => {}
  budgetChannelOn = true
  const ch = supabase.channel('public:budget_entries')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_entries' }, () => {
      pullBudgetEntries()
    })
    .subscribe()
  return () => { budgetChannelOn = false; supabase!.removeChannel(ch) }
}
