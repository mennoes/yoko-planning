'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// Actie-namen die we kennen — gebruikt om in de drawer een nette zin te
// renderen ('… markeerde X als done', '… verwijderde X'). De drawer
// vertaalt ze; rauwe DB-records bewaren we als plain string.
export type TodoAction =
  | 'add' | 'remove' | 'done' | 'undone' | 'rename'

export type TodoActivityMeta = {
  action?:      TodoAction
  sectionId?:   string
  sectionTitle?: string
  itemText?:    string
  before?:      string
  after?:       string
}

export type TodoActivity = {
  id:      string
  ts:      string
  user_id: string | null
  action:  string
  target:  string | null
  detail:  string | null
  meta:    TodoActivityMeta | null
}

const TARGET_PREFIX = 'todo:'
const EVENT         = 'yoko-todo-activity'

// Log een actie op een todo-item. Schrijft naar dezelfde public.activity
// tabel als boards — alleen target-prefix verschilt zodat de drawer kan
// filteren. No-op bij ontbrekende auth/supabase.
let metaSupported = true
export async function logTodoActivity(itemId: string, action: string, detail?: string, meta?: TodoActivityMeta): Promise<void> {
  if (!supabase) return
  const uid = await getCurrentUserId()
  if (!uid) return
  const base: Record<string, unknown> = {
    user_id: uid,
    action,
    target:  TARGET_PREFIX + itemId,
    detail:  detail ?? null,
  }
  if (metaSupported) {
    const { error } = await supabase.from('activity').insert({ ...base, meta: meta ?? null })
    if (error) {
      if (/column .*meta.*does not exist|PGRST204|schema cache|cannot find/i.test(error.message ?? '')) {
        metaSupported = false
        await supabase.from('activity').insert(base)
      } else {
        return
      }
    }
  } else {
    await supabase.from('activity').insert(base)
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export async function loadTodosActivity(limit = 100): Promise<TodoActivity[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('activity')
    .select('*')
    .like('target', TARGET_PREFIX + '%')
    .order('ts', { ascending: false })
    .limit(limit)
  return (data as TodoActivity[] | null) ?? []
}

export function todoIdFromTarget(target: string | null): string | null {
  if (!target || !target.startsWith(TARGET_PREFIX)) return null
  return target.slice(TARGET_PREFIX.length)
}

export function onTodosActivityChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
