'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type ProjectLink = { board: string; itemId: string; name: string; startDate?: string | null; endDate?: string | null }
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
  // Zet de lokale-write-lock zodat realtime pulls die hierna binnenkomen
  // (door onze eigen pushToRemote) niet de ongedeleted/ongepushte
  // staat terugplakken bovenop wat we net lokaal wijzigden.
  markLocalWrite()
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

/** Pull from Supabase. Returns null if no auth, empty remote, or a local
 *  write is still within its lock window (zie withinLocalWriteLock). */
export async function pullFromRemote(): Promise<Section[] | null> {
  if (!supabase) return null
  // Net lokaal een vinkje gezet en meteen de pagina ververst? Dan is de
  // fire-and-forget push naar Supabase misschien nog niet aangekomen.
  // Vertrouw dan de lokale cache i.p.v. de (mogelijk nog stale) remote-
  // rijen terug te plakken — de caller valt terug op z'n eigen
  // localStorage-copy en pusht die opnieuw om te reconciliëren.
  if (withinLocalWriteLock()) return null
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

  // Verwijder items die lokaal verdwenen zijn.
  const localItemIds = new Set(itemRows.map(r => r.id))
  const { data: remoteItemIds } = await supabase.from('todo_items').select('id')
  if (remoteItemIds) {
    const stale = (remoteItemIds as { id: string }[])
      .filter(r => !localItemIds.has(r.id)).map(r => r.id)
    if (stale.length > 0) {
      await supabase.from('todo_items').delete().in('id', stale)
    }
  }
  // Verwijder secties die lokaal verdwenen zijn — anders kwam een
  // verwijderde sectie (bv. 'Test') bij elke refresh terug omdat de
  // remote rij bleef bestaan.
  const localSectionIds = new Set(sectionRows.map(r => r.id))
  const { data: remoteSectionIds } = await supabase.from('todo_sections').select('id')
  if (remoteSectionIds) {
    const stale = (remoteSectionIds as { id: string }[])
      .filter(r => !localSectionIds.has(r.id)).map(r => r.id)
    if (stale.length > 0) {
      await supabase.from('todo_sections').delete().in('id', stale)
    }
  }
  return true
}

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
// Lokale-mutatie-lock: tijdens en enkele seconden na een eigen push
// negeren we pulls (zowel de realtime schedulePull als de initiële pull
// op page-load). Anders haalt een pull binnen dat venster de oude state
// op — vóór onze eigen upsert in Supabase is doorgevoerd — en plakt die
// terug over wat we net lokaal wijzigden (bv. een net afgevinkt todo-item
// dat na een refresh weer 'open' lijkt).
// In-memory ÉN localStorage: de module-var reset naar 0 bij een hard
// page-refresh, dus zonder de localStorage-kopie zou de lock exact het
// scenario missen waarvoor-ie bedoeld is.
let lastLocalWriteAt = 0
const LOCAL_WRITE_LOCK_MS = 5000
const LAST_WRITE_KEY = 'yoko-todos-last-write-at'

function markLocalWrite(): void {
  lastLocalWriteAt = Date.now()
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LAST_WRITE_KEY, String(lastLocalWriteAt)) } catch {}
}

function withinLocalWriteLock(): boolean {
  if (Date.now() - lastLocalWriteAt < LOCAL_WRITE_LOCK_MS) return true
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(LAST_WRITE_KEY)
    return !!raw && Date.now() - Number(raw) < LOCAL_WRITE_LOCK_MS
  } catch { return false }
}

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
