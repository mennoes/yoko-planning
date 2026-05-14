// Floating feedback / ideeën / bug-meldingen — gedeeld team-breed via
// Supabase. localStorage cache voor instant-render zonder netwerk-flash.

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type FeedbackKind = 'bug' | 'idee' | 'feedback'

export type FeedbackItem = {
  id:          string
  kind:        FeedbackKind
  body:        string
  authorId:    string | null
  authorName:  string | null
  upvotes:     string[]
  createdAt:   string
}

const STORAGE_KEY  = 'yoko-feedback-items'
const UPDATE_EVENT = 'yoko-feedback-update'

function readCache(): FeedbackItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function writeCache(items: FeedbackItem[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function loadFeedback(): FeedbackItem[] {
  return readCache()
}

export function onFeedbackChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

type Row = {
  id:          string
  kind:        string
  body:        string
  author_id:   string | null
  author_name: string | null
  upvotes:     unknown
  created_at:  string
}

function rowToItem(r: Row): FeedbackItem | null {
  if (r.kind !== 'bug' && r.kind !== 'idee' && r.kind !== 'feedback') return null
  const upvotes = Array.isArray(r.upvotes) ? (r.upvotes as unknown[]).filter(x => typeof x === 'string') as string[] : []
  return {
    id:         r.id,
    kind:       r.kind,
    body:       r.body,
    authorId:   r.author_id,
    authorName: r.author_name,
    upvotes,
    createdAt:  r.created_at,
  }
}

export async function pullFeedback(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('feedback_items')
    .select('id, kind, body, author_id, author_name, upvotes, created_at')
    .order('created_at', { ascending: false })
  if (error || !data) return false

  const items = (data as Row[]).map(rowToItem).filter((x): x is FeedbackItem => x !== null)
  if (JSON.stringify(readCache()) === JSON.stringify(items)) return true
  writeCache(items)
  return true
}

export async function submitFeedback(
  kind: FeedbackKind,
  body: string,
  authorId: string | null,
  authorName: string | null,
): Promise<FeedbackItem | null> {
  const trimmed = body.trim()
  if (!trimmed) return null
  if (!supabase) return null
  if (!await getCurrentUserId()) return null
  const { data, error } = await supabase
    .from('feedback_items')
    .insert({
      kind,
      body:        trimmed,
      author_id:   authorId,
      author_name: authorName,
      upvotes:     [],
    })
    .select('id, kind, body, author_id, author_name, upvotes, created_at')
    .single()
  if (error || !data) return null
  const item = rowToItem(data as Row)
  if (item) writeCache([item, ...readCache().filter(x => x.id !== item.id)])
  return item
}

export async function toggleUpvote(itemId: string, memberId: string): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  const current = readCache().find(i => i.id === itemId)
  if (!current) return
  const has = current.upvotes.includes(memberId)
  const next = has ? current.upvotes.filter(x => x !== memberId) : [...current.upvotes, memberId]
  // Optimistic update
  writeCache(readCache().map(i => i.id === itemId ? { ...i, upvotes: next } : i))
  await supabase.from('feedback_items').update({ upvotes: next }).eq('id', itemId)
}

export async function deleteFeedback(itemId: string): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  writeCache(readCache().filter(i => i.id !== itemId))
  await supabase.from('feedback_items').delete().eq('id', itemId)
}

let feedbackChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullFeedback().catch(() => {})
  }, 400)
}

export function subscribeRemoteFeedback(): () => void {
  if (!supabase) return () => {}
  if (feedbackChannel) return () => {}
  const ch = supabase.channel('feedback_items')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback_items' }, () => schedulePull())
    .subscribe()
  feedbackChannel = ch
  return () => {
    if (supabase && feedbackChannel) {
      supabase.removeChannel(feedbackChannel)
      feedbackChannel = null
    }
  }
}
