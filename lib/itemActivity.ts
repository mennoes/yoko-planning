'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type ItemActivity = {
  id:      string
  ts:      string
  user_id: string | null
  action:  string
  target:  string | null
  detail:  string | null
}

const TARGET_PREFIX = 'board_item:'
const EVENT         = 'yoko-item-activity'

/** Log a change on a board item. Wraps the existing public.activity
 *  Supabase table (target = `board_item:${itemId}`). Stilletjes-no-op
 *  als de gebruiker niet ingelogd is of Supabase ontbreekt. */
export async function logItemActivity(itemId: string, action: string, detail?: string): Promise<void> {
  if (!supabase) return
  const uid = await getCurrentUserId()
  if (!uid) return
  await supabase.from('activity').insert({
    user_id: uid,
    action,
    target:  TARGET_PREFIX + itemId,
    detail:  detail ?? null,
  })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { itemId } }))
}

export async function loadItemActivity(itemId: string): Promise<ItemActivity[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('activity')
    .select('*')
    .eq('target', TARGET_PREFIX + itemId)
    .order('ts', { ascending: false })
    .limit(50)
  return (data as ItemActivity[] | null) ?? []
}

export function onItemActivityChange(itemId: string, handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<{ itemId: string }>
    if (ce.detail?.itemId === itemId) handler()
  }
  window.addEventListener(EVENT, wrapped)
  return () => window.removeEventListener(EVENT, wrapped)
}
