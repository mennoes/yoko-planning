'use client'

import { supabase } from './supabase'
import { cacheComment, loadAllComments, notifyCommentsUpdate, onCommentsUpdate, pullCommentsAll, type CommentThread } from './commentsStore'
import { completionContext, type CompletionState, type PersonalTaskStatus, type CompletionTarget } from './personalCompletion'
import { loadGroups } from './boardStore'

function completionKey(target: CompletionTarget, memberId: string) {
  return JSON.stringify([target.parentItemId, target.subitemId, memberId])
}

// Serverdata blijft leidend, maar een klik wordt lokaal meteen zichtbaar.
// Deze tijdelijke laag bestaat alleen zolang de opslagrequest onderweg is.
const optimisticCompletions = new Map<string, CompletionState>()
let completionIndex: Map<string, CompletionState> | null = null

/** Build the latest personal state for every item/member in one pass.
 * Planning asks for hundreds of combinations at once; parsing and scanning the
 * complete comment history for every cell made the authenticated app freeze. */
function loadCompletionIndex() {
  if (completionIndex) return completionIndex
  const next = new Map<string, CompletionState>()
  for (const thread of loadAllComments()) {
    for (const reply of thread.thread) {
      const state = reply.personalCompletion
      if (state?.version !== 1) continue
      const key = completionKey(state, state.memberId)
      const current = next.get(key)
      if (!current || reply.createdAt > current.createdAt ||
        (reply.createdAt === current.createdAt && thread.id > current.eventId)) {
        next.set(key, { ...state, eventId: thread.id, createdAt: reply.createdAt })
      }
    }
  }
  completionIndex = next
  return next
}

if (typeof window !== 'undefined') onCommentsUpdate(() => { completionIndex = null })

export function loadPersonalCompletion(target: CompletionTarget, memberId: string) {
  const key = completionKey(target, memberId)
  const optimistic = optimisticCompletions.get(key)
  if (optimistic) return optimistic
  return loadCompletionIndex().get(key)
}

/** Resolve index-based legacy task references to the actual stable subitem ID. */
export function completionTargetForProject(ref: { board: string; itemId: string }) {
  const match = ref.itemId.match(/^(.+)__si(\d+)$/)
  const parentItemId = match ? match[1] : ref.itemId.replace(/__vrij_\d{4}-\d{2}-\d{2}$/, '')
  const parent = loadGroups(ref.board, []).flatMap(g => g.items).find(i => i.id === parentItemId)
  if (!parent) return null
  const sub = match ? parent.subitems?.[Number(match[2])] : undefined
  if (match && !sub) return null
  const own = (sub?.ownerIds ?? []).filter(id => id && id !== 'unassigned')
  return {
    parentItemId, ...(sub ? { subitemId: sub.id } : {}),
    ownerIds: own.length ? own : parent.ownerIds.filter(id => id && id !== 'unassigned'),
    status: parent.status === 'Done' ? 'Done' : sub?.status ?? parent.status,
  }
}

const pending = new Map<string, Promise<{ notificationError: boolean }>>()
export function updatePersonalCompletion(target: CompletionTarget, memberId: string, done: boolean, status?: PersonalTaskStatus,
  timeline?: { start: string | null; end: string | null }): Promise<{ notificationError: boolean }> {
  const key = completionKey(target, memberId)
  const existing = pending.get(key)
  if (existing) return existing
  const previous = loadPersonalCompletion(target, memberId)
  optimisticCompletions.set(key, {
    version: 1, ...target, memberId, done,
    ...(status !== undefined ? { status } : previous?.status !== undefined ? { status: previous.status } : {}),
    timelineStart: timeline ? timeline.start : previous?.timelineStart,
    timelineEnd: timeline ? timeline.end : previous?.timelineEnd,
    mentions: [], eventId: `optimistic:${Date.now()}`, createdAt: new Date().toISOString(),
  })
  notifyCommentsUpdate(completionContext(target))
  const request = (async () => {
    try {
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')) throw new Error('Niet beschikbaar in de demo.')
      if (!supabase) throw new Error('Log eerst in om je voortgang op te slaan.')
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw new Error('Log opnieuw in om je voortgang op te slaan.')
      const res = await fetch('/api/items/personal-completion', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({
          parentItemId: target.parentItemId, subitemId: target.subitemId, memberId, done, status,
          ...(timeline ? { timelineStart: timeline.start, timelineEnd: timeline.end } : {}),
          expectedEventId: previous?.eventId ?? null,
        }),
      })
      const result = await res.json() as { error?: string; comment?: CommentThread; notificationError?: boolean }
      if (!res.ok || !result.comment) {
        if (res.status === 409) await pullCommentsAll()
        throw new Error(result.error ?? 'Opslaan mislukt. Probeer opnieuw.')
      }
      optimisticCompletions.delete(key)
      cacheComment(result.comment)
      return { notificationError: !!result.notificationError }
    } catch (error) {
      optimisticCompletions.delete(key)
      notifyCommentsUpdate(completionContext(target))
      throw error
    }
  })().finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

/** Personal linked tasks always use the shared completion state, never the
 * global project status. Returns false for plain/unassigned local tasks. */
export async function completeLinkedTask(ref: { board: string; itemId: string } | undefined, memberId: string, done: boolean): Promise<boolean> {
  if (!ref) return false
  const target = completionTargetForProject(ref)
  if (!target || !target.ownerIds.includes(memberId)) return false
  const result = await updatePersonalCompletion(target, memberId, done)
  if (result.notificationError) window.alert('Je taakstatus is opgeslagen, maar de melding is nog niet verstuurd. Open het item en klik op “Melding opnieuw versturen”.')
  return true
}
