'use client'
import { supabase } from './supabase'
import { getCurrentUserId } from './sync'
import { isTeamMetadataId } from './teamMemberIdentity'
export type ProjectLink = { board: string; itemId: string; name: string; startDate?: string | null; endDate?: string | null; status?: string | null; googleSeriesId?: string; movedFromSections?: string[] }
export type TodoItem = { id: string; text: string; done: boolean; projectRef?: ProjectLink }
export type Section = { id: string; title: string; emoji: string; items: TodoItem[]; kind?: 'personal' | 'general' }
// Old clients created todo sections for internal team start-date records.
// Hide only empty metadata sections, never real sections or user tasks.
export function visibleTodoSections(sections: Section[]): Section[] {
  return sections.filter(s => !isTeamMetadataId(s.id) || s.items.length > 0)
}
const KEY = 'yoko-todos', QUEUE = 'yoko-todos-outbox-v2', EVENT = 'yoko-todos-update'
type Row = Record<string, unknown> & { id: string }
type Op = { token: string; table: 'todo_sections' | 'todo_items'; action: 'insert' | 'update' | 'delete'; row: Row }
export function loadSections(fallback: Section[]): Section[] {
  if (typeof window === 'undefined') return fallback
  try { return visibleTodoSections(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? fallback) } catch { return visibleTodoSections(fallback) }
}
export function cacheRemoteSections(sections: Section[]) {
  sections = visibleTodoSections(sections)
  // Keep the pre-upgrade cache recoverable; never delete local-only legacy data.
  if (!localStorage.getItem('yoko-todos-before-sync-v2')) {
    const previous = localStorage.getItem(KEY)
    if (previous) localStorage.setItem('yoko-todos-before-sync-v2', previous)
  }
  localStorage.setItem(KEY, JSON.stringify(sections))
  window.dispatchEvent(new CustomEvent(EVENT))
}
function pending(): Op[] {
  try { return JSON.parse(localStorage.getItem(QUEUE) ?? '[]') } catch { return [] }
}
function rows(sections: Section[]) {
  return {
    sections: sections.map((s, position) => ({ id: s.id, title: s.title, emoji: s.emoji, position } as Row)),
    items: sections.flatMap(s => s.items.map((i, position) => ({ id: i.id, section_id: s.id, text: i.text, done: i.done, project_ref: i.projectRef ?? null, position } as Row))),
  }
}
// Diff the user edit, never an entire stale snapshot. Updates cannot resurrect deleted rows.
export function diffTodoRows(before: Section[], after: Section[]): Op[] {
  const a = rows(before), b = rows(after), ops: Op[] = []
  for (const [table, prevRows, next] of [['todo_sections', a.sections, b.sections], ['todo_items', a.items, b.items]] as const) {
    const old = new Map(prevRows.map(r => [r.id, r])), ids = new Set(next.map(r => r.id))
    for (const row of next) {
      const prev = old.get(row.id), patch: Row = { id: row.id }
      for (const k of Object.keys(row)) if (!prev || JSON.stringify(prev[k]) !== JSON.stringify(row[k])) patch[k] = row[k]
      if (!prev || Object.keys(patch).length > 1) ops.push({ token: crypto.randomUUID(), table, action: prev ? 'update' : 'insert', row: patch })
    }
    for (const row of prevRows) if (!ids.has(row.id)) ops.push({ token: crypto.randomUUID(), table, action: 'delete', row })
  }
  const rank = (op: Op) => op.table === 'todo_sections' ? op.action === 'delete' ? 2 : 0 : 1
  return ops.sort((x,y) => rank(x)-rank(y))
}
export function saveSections(sections: Section[]) {
  const ops = diffTodoRows(loadSections([]), sections)
  if (!ops.length) return
  localStorage.setItem(QUEUE, JSON.stringify([...pending(), ...ops]))
  localStorage.setItem('yoko-todos-revision-v2', crypto.randomUUID())
  cacheRemoteSections(sections)
  void pushToRemote()
}
export function markItemDeleted(_id: string) { void _id }
export function mergeSections(local: Section[], remote: Section[]): Section[] {
  return typeof window !== 'undefined' && pending().length ? local : remote
}
export function onTodosUpdate(handler: () => void) {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
let flight: Promise<boolean> | null = null
let retry: ReturnType<typeof setTimeout> | undefined
function report(error: boolean) {
  window.dispatchEvent(new CustomEvent('yoko-todos-sync', { detail: { pending: pending().length > 0, error } }))
}
export function pushToRemote(_sections?: Section[]): Promise<boolean> {
  if (flight) return flight
  flight = (async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('yoko-todos-sync', flush)
    return await flush()
  })().finally(() => { flight = null })
  return flight
}
async function flush(): Promise<boolean> {
  if (!supabase || !await getCurrentUserId()) { report(true); return false }
  try {
    while (pending().length) {
      const op = pending()[0], table = supabase.from(op.table)
      const { error } = op.action === 'delete' ? op.table === 'todo_items'
        ? await table.update({ project_ref: { ...(op.row.project_ref as object ?? {}), _deleted: true } }).eq('id', op.row.id)
        : await table.delete().eq('id', op.row.id)
        : op.action === 'insert' ? await table.upsert(op.row, { onConflict: 'id', ignoreDuplicates: true })
        : op.table === 'todo_items' ? await table.update(op.row).is('project_ref->>_deleted', null).eq('id', op.row.id)
          : await table.update(op.row).eq('id', op.row.id)
      if (error) throw error
      localStorage.setItem(QUEUE, JSON.stringify(pending().filter(p => p.token !== op.token)))
    }
    report(false)
    return true
  } catch {
    report(true)
    if (!retry) retry = setTimeout(() => { retry = undefined; void pushToRemote() }, 5000)
    return false
  }
}
export async function pullFromRemote(): Promise<Section[] | null> {
  if (!supabase || !await getCurrentUserId()) return null
  if (pending().length && !await pushToRemote()) return null
  const revision = localStorage.getItem('yoko-todos-revision-v2')
  const { data: sections, error: sErr } = await supabase.from('todo_sections').select('*').order('position').order('id')
  const { data: items, error: iErr } = await supabase.from('todo_items').select('*').order('position').order('id')
  if (sErr || iErr || !sections || !items || pending().length || revision !== localStorage.getItem('yoko-todos-revision-v2')) return null
  // Keep deletion markers server-side so old devices cannot re-seed removed projects.
  const removed = new Set<string>(JSON.parse(localStorage.getItem('yoko-todos-removed-projects') ?? '[]'))
  for (const i of items) if (i.project_ref?._deleted && i.project_ref.board && i.project_ref.itemId) removed.add(i.project_ref.board + ':' + i.project_ref.itemId)
  localStorage.setItem('yoko-todos-removed-projects', JSON.stringify([...removed]))
  const result: Section[] = sections.map(s => ({
    id: s.id, title: s.title, emoji: s.emoji,
    items: items.filter(i => i.section_id === s.id && !i.project_ref?._deleted).map(i => ({ id: i.id, text: i.text, done: i.done, projectRef: i.project_ref ?? undefined })),
  }))
  const visible = visibleTodoSections(result)
  cacheRemoteSections(visible)
  return visible
}
let listeners = 0
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | undefined
function schedulePull() {
  if (pullTimer) clearTimeout(pullTimer)
  pullTimer = setTimeout(() => { pullTimer = undefined; void pullFromRemote() }, 600)
}
export function subscribeRemoteTodos(): () => void {
  if (!supabase) return () => {}
  listeners++
  if (!channel) {
    channel = supabase.channel('todos:all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_items' }, schedulePull)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_sections' }, schedulePull).subscribe()
    window.addEventListener('online', schedulePull)
    window.addEventListener('focus', schedulePull)
  }
  return () => {
    if (--listeners > 0) return
    if (channel) { void supabase!.removeChannel(channel); channel = null }
    window.removeEventListener('online', schedulePull)
    window.removeEventListener('focus', schedulePull)
    if (pullTimer) { clearTimeout(pullTimer); pullTimer = undefined }
  }
}
