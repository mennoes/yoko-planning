export type CommentReply = {
  id:        string
  author:    string
  authorId?: string
  body:      string
  createdAt: string
}

export type CommentThread = {
  id:        string
  contextId: string  // e.g. page id, project id
  quote:     string
  thread:    CommentReply[]
  resolved:  boolean
  createdAt: string
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

export function saveComment(c: CommentThread): void {
  const all = loadAllComments()
  const idx = all.findIndex(x => x.id === c.id)
  if (idx >= 0) all[idx] = c
  else all.unshift(c)
  localStorage.setItem(KEY, JSON.stringify(all))
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function deleteComment(id: string): void {
  const all = loadAllComments().filter(c => c.id !== id)
  localStorage.setItem(KEY, JSON.stringify(all))
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
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
