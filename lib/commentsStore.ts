'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type CommentReply = {
  id:        string
  author:    string
  authorId?: string
  body:      string
  createdAt: string
  reactions?: Record<string, string[]>
}

export type CommentThread = {
  id:        string
  contextId: string  // e.g. page id, project id, 'todo:X'
  quote:     string
  thread:    CommentReply[]
  resolved:  boolean
  createdAt: string
}

export const QUICK_REACTIONS = ['👍', '❤️', '🎉', '🤔', '👀'] as const

export function toggleReaction(reply: CommentReply, emoji: string, memberId: string): CommentReply {
  const reactions = { ...(reply.reactions ?? {}) }
  const arr = new Set(reactions[emoji] ?? [])
  if (arr.has(memberId)) arr.delete(memberId)
  else                   arr.add(memberId)
  if (arr.size === 0) delete reactions[emoji]
  else                reactions[emoji] = [...arr]
  return { ...reply, reactions }
}

const KEY        = 'yoko-comments'
const EVENT_NAME = 'yoko-comments-update'

export function loadAllComments(): CommentThread[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function loadCommentsFor(contextId: string): CommentThread[] {
  return loadAllComments().filter(c => c.contextId === contextId)
}

export function loadComment(id: string): CommentThread | undefined {
  return loadAllComments().find(c => c.id === id)
}

function writeCache(all: CommentThread[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

function inferKind(contextId: string): string {
  if (contextId.startsWith('todo:')) return 'todo'
  if (contextId.startsWith('board:')) return 'board_item'
  if (contextId.startsWith('page:'))  return 'page'
  return 'page'  // pages don't use a prefix in our codebase
}

export function saveComment(c: CommentThread): void {
  const all = loadAllComments()
  const idx = all.findIndex(x => x.id === c.id)
  if (idx >= 0) all[idx] = c
  else all.unshift(c)
  writeCache(all)
  pushCommentRemote(c).catch(() => {})
}

export function deleteComment(id: string): void {
  const all = loadAllComments().filter(c => c.id !== id)
  writeCache(all)
  deleteCommentRemote(id).catch(() => {})
}

export function onCommentsUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT_NAME, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT_NAME, handler)
    window.removeEventListener('storage', handler)
  }
}

export function newCommentId(): string {
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

// ─── Remote sync ──────────────────────────────────────────────────────────────
type CommentRow = {
  id:           string
  context_kind: string
  context_id:   string
  quote:        string
  thread:       CommentReply[]
  resolved:     boolean
  created_at:   string
}

async function pushCommentRemote(c: CommentThread): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  await supabase.from('comments').upsert({
    id:           c.id,
    context_kind: inferKind(c.contextId),
    context_id:   c.contextId,
    quote:        c.quote ?? '',
    thread:       c.thread,
    resolved:     c.resolved,
  }, { onConflict: 'id' })
}

async function deleteCommentRemote(id: string): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  await supabase.from('comments').delete().eq('id', id)
}

export async function pullCommentsAll(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('comments').select('*').order('created_at', { ascending: false })
  if (error || !data) return false
  if (data.length === 0) {
    // Remote leeg — upload de huidige lokale cache (eerste sync).
    const local = loadAllComments()
    if (local.length === 0) return true
    const rows = local.map(c => ({
      id:           c.id,
      context_kind: inferKind(c.contextId),
      context_id:   c.contextId,
      quote:        c.quote ?? '',
      thread:       c.thread,
      resolved:     c.resolved,
    }))
    await supabase.from('comments').upsert(rows, { onConflict: 'id' })
    return true
  }
  const next: CommentThread[] = (data as CommentRow[]).map(r => ({
    id:        r.id,
    contextId: r.context_id,
    quote:     r.quote ?? '',
    thread:    r.thread ?? [],
    resolved:  r.resolved ?? false,
    createdAt: r.created_at,
  }))
  if (JSON.stringify(loadAllComments()) === JSON.stringify(next)) return true
  writeCache(next)
  return true
}

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullCommentsAll().catch(() => {})
  }, 400)
}

export function subscribeRemoteComments(): () => void {
  if (!supabase) return () => {}
  if (channel) return () => {}
  channel = supabase.channel('comments:all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => schedulePull())
    .subscribe()
  return () => {
    if (supabase && channel) { supabase.removeChannel(channel); channel = null }
  }
}
