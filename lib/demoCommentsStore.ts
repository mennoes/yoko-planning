'use client'

// Demo-variant van lib/commentsStore.ts — eigen, geïsoleerde localStorage-
// key en GEEN Supabase-push. toggleReaction is puur (geen storage), dus
// die hergebruiken we direct vanuit de echte module.
import { toggleReaction, type CommentThread } from './commentsStore'

const KEY   = 'yoko-demo-comments'
const EVENT = 'yoko-demo-comments-update'

function loadAll(): CommentThread[] {
  if (typeof window === 'undefined') return []
  try { const s = window.localStorage.getItem(KEY); return s ? JSON.parse(s) as CommentThread[] : [] } catch { return [] }
}

export function loadCommentsFor(contextId: string): CommentThread[] {
  return loadAll().filter(c => c.contextId === contextId)
}

export function saveComment(c: CommentThread): void {
  if (typeof window === 'undefined') return
  const all = loadAll()
  const idx = all.findIndex(x => x.id === c.id)
  if (idx >= 0) all[idx] = c
  else all.unshift(c)
  try { window.localStorage.setItem(KEY, JSON.stringify(all)) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function onCommentsUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

export function newCommentId(): string {
  return 'demo-c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

export { toggleReaction }
export type { CommentThread }
