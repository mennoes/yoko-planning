'use client'

import { supabase } from './supabase'
import { cacheComment, loadAllComments, pullCommentsAll, type CommentThread } from './commentsStore'
import { completionState, type PersonalTaskStatus, type CompletionTarget } from './personalCompletion'
import { loadGroups } from './boardStore'

export function loadPersonalCompletion(target: CompletionTarget, memberId: string) {
  return completionState(loadAllComments(), target, memberId)
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
export function updatePersonalCompletion(target: CompletionTarget, memberId: string, done: boolean, status?: PersonalTaskStatus): Promise<{ notificationError: boolean }> {
  const key = JSON.stringify([target.parentItemId, target.subitemId, memberId])
  const existing = pending.get(key)
  if (existing) return existing
  const request = (async () => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')) throw new Error('Niet beschikbaar in de demo.')
    if (!supabase) throw new Error('Log eerst in om je voortgang op te slaan.')
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new Error('Log opnieuw in om je voortgang op te slaan.')
    const previous = loadPersonalCompletion(target, memberId)
    const res = await fetch('/api/items/personal-completion', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ parentItemId: target.parentItemId, subitemId: target.subitemId, done, status, expectedEventId: previous?.eventId ?? null }),
    })
    const result = await res.json() as { error?: string; comment?: CommentThread; notificationError?: boolean }
    if (!res.ok || !result.comment) {
      if (res.status === 409) await pullCommentsAll()
      throw new Error(result.error ?? 'Opslaan mislukt. Probeer opnieuw.')
    }
    cacheComment(result.comment)
    return { notificationError: !!result.notificationError }
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
