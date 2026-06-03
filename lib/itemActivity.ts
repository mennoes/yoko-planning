'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// Veld-namen die de drawer kent en kan terugzetten via 'Ongedaan maken'.
// Komen overeen met sleutels op BoardItem (zie lib/boards.ts).
export type ActivityField =
  | 'startDate' | 'endDate' | 'estHours' | 'status' | 'ownerIds'
  | 'ownerHours' | 'name' | 'notes' | 'deadline'

export type ActivityMeta = {
  field?:    ActivityField
  before?:   unknown
  after?:    unknown
  boardId?:  string
  itemName?: string
}

export type ItemActivity = {
  id:      string
  ts:      string
  user_id: string | null
  action:  string
  target:  string | null
  detail:  string | null
  meta:    ActivityMeta | null
}

const TARGET_PREFIX = 'board_item:'
const EVENT         = 'yoko-item-activity'

/** Log a change on a board item. Wraps the existing public.activity
 *  Supabase table (target = `board_item:${itemId}`). Stilletjes-no-op
 *  als de gebruiker niet ingelogd is of Supabase ontbreekt.
 *  Meta bevat optioneel gestructureerde before/after-data zodat de
 *  /activity-drawer 'Ongedaan maken' kan tonen. */
export async function logItemActivity(itemId: string, action: string, detail?: string, meta?: ActivityMeta): Promise<void> {
  if (!supabase) return
  const uid = await getCurrentUserId()
  if (!uid) return
  await supabase.from('activity').insert({
    user_id: uid,
    action,
    target:  TARGET_PREFIX + itemId,
    detail:  detail ?? null,
    meta:    meta ?? null,
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

/** Laad recente activiteit, eventueel beperkt tot één board via meta.boardId.
 *  Gebruikt door de board-activity-drawer. */
export async function loadBoardActivity(boardId?: string, limit = 100): Promise<ItemActivity[]> {
  if (!supabase) return []
  let q = supabase.from('activity').select('*').like('target', TARGET_PREFIX + '%').order('ts', { ascending: false }).limit(limit)
  if (boardId) q = q.eq('meta->>boardId', boardId)
  const { data } = await q
  return (data as ItemActivity[] | null) ?? []
}

export function itemIdFromTarget(target: string | null): string | null {
  if (!target || !target.startsWith(TARGET_PREFIX)) return null
  return target.slice(TARGET_PREFIX.length)
}

export function onAnyItemActivityChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
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
