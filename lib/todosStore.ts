'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type ProjectLink = { board: string; itemId: string; name: string }
export type TodoItem    = { id: string; text: string; done: boolean; projectRef?: ProjectLink }
export type Section     = { id: string; title: string; emoji: string; items: TodoItem[]; kind?: 'personal' | 'general' }

const STORAGE_KEY = 'yoko-todos'
const EVENT       = 'yoko-todos-update'

export function loadSections(fallback: Section[]): Section[] {
  if (typeof window === 'undefined') return fallback
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? JSON.parse(s) : fallback
  } catch { return fallback }
}

function writeCache(sections: Section[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sections)) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function saveSections(sections: Section[]): void {
  writeCache(sections)
  pushToRemote(sections).catch(() => {})
}

export function onTodosUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

// ─── Remote sync ──────────────────────────────────────────────────────────────
type SectionRow = { id: string; title: string; emoji: string; position: number }
type ItemRow    = { id: string; section_id: string; text: string; done: boolean; position: number; project_ref: ProjectLink | null }

/** Pull from Supabase. Returns null if no auth, or empty remote. */
export async function pullFromRemote(): Promise<Section[] | null> {
  if (!supabase) return null
  if (!await getCurrentUserId()) return null
  const { data: sections, error: sErr } = await supabase
    .from('todo_sections').select('*').order('position')
  if (sErr || !sections || sections.length === 0) return null
  const { data: items, error: iErr } = await supabase
    .from('todo_items').select('*').order('position')
  if (iErr || !items) return null

  const itemsBySection = new Map<string, TodoItem[]>()
  for (const r of items as ItemRow[]) {
    const arr = itemsBySection.get(r.section_id) ?? []
    arr.push({
      id:         r.id,
      text:       r.text,
      done:       r.done,
      projectRef: r.project_ref ?? undefined,
    })
    itemsBySection.set(r.section_id, arr)
  }

  return (sections as SectionRow[]).map(s => ({
    id:    s.id,
    title: s.title,
    emoji: s.emoji,
    items: itemsBySection.get(s.id) ?? [],
  }))
}

/** Push everything up. Used as the seed when remote is empty, and on
 *  every saveSections call. Diffs deletions via id-set comparison. */
export async function pushToRemote(sections: Section[]): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false

  const sectionRows = sections.map((s, i) => ({
    id: s.id, title: s.title, emoji: s.emoji ?? '📋', position: i,
  }))
  if (sectionRows.length > 0) {
    const { error } = await supabase
      .from('todo_sections')
      .upsert(sectionRows, { onConflict: 'id' })
    if (error) return false
  }

  const itemRows: { id: string; section_id: string; text: string; done: boolean; position: number; project_ref: ProjectLink | null }[] = []
  for (const s of sections) {
    s.items.forEach((it, idx) => {
      itemRows.push({
        id:          it.id,
        section_id:  s.id,
        text:        it.text,
        done:        it.done,
        position:    idx,
        project_ref: it.projectRef ?? null,
      })
    })
  }
  if (itemRows.length > 0) {
    const { error } = await supabase
      .from('todo_items')
      .upsert(itemRows, { onConflict: 'id' })
    if (error) return false
  }

  // Verwijder rijen die lokaal verdwenen zijn.
  const localIds = new Set(itemRows.map(r => r.id))
  const { data: remoteIds } = await supabase.from('todo_items').select('id')
  if (remoteIds) {
    const stale = (remoteIds as { id: string }[])
      .filter(r => !localIds.has(r.id)).map(r => r.id)
    if (stale.length > 0) {
      await supabase.from('todo_items').delete().in('id', stale)
    }
  }
  return true
}

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null

function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(async () => {
    pullTimer = null
    const remote = await pullFromRemote()
    if (remote) writeCache(remote)
  }, 400)
}

export function subscribeRemoteTodos(): () => void {
  if (!supabase) return () => {}
  if (channel) return () => {}
  channel = supabase.channel('todos:all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_items' },    () => schedulePull())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_sections' }, () => schedulePull())
    .subscribe()
  return () => {
    if (supabase && channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
