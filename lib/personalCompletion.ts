import type { CommentThread, CommentReply } from './commentsStore'

export const PERSONAL_TASK_STATUSES = ['', 'Working on...', 'Done', 'Stuck', 'Not started', 'Doorlopend'] as const
export type PersonalTaskStatus = typeof PERSONAL_TASK_STATUSES[number]
export function isPersonalTaskStatus(value: unknown): value is PersonalTaskStatus {
  return typeof value === 'string' && PERSONAL_TASK_STATUSES.some(status => status === value)
}
/** Older completion records only stored done; keep those and To do toggles compatible. */
export function personalTaskStatus(state?: { done: boolean; status?: PersonalTaskStatus }): PersonalTaskStatus {
  return state?.done ? 'Done' : state?.status ?? 'Not started'
}

/** A completion transition and its chat message are ONE immutable record.
 * Keeping them outside board_items prevents stale board/Google saves from
 * overwriting personal status. Each member has an independent event chain. */
export type PersonalCompletion = {
  version: 1
  memberId: string
  parentItemId: string
  subitemId?: string
  done: boolean
  status?: PersonalTaskStatus
  timelineStart?: string | null
  timelineEnd?: string | null
  mentions: string[]
}
export type CompletionTarget = { parentItemId: string; subitemId?: string }
export type CompletionState = PersonalCompletion & { eventId: string; createdAt: string }

export function completionContext(target: CompletionTarget): string {
  return 'board-item:' + (target.subitemId ?? target.parentItemId)
}

export function completionState(threads: CommentThread[], target: CompletionTarget, memberId: string): CompletionState | undefined {
  let latest: CompletionState | undefined
  const context = completionContext(target)
  for (const thread of threads) {
    if (thread.contextId !== context) continue
    for (const reply of thread.thread) {
      const state = reply.personalCompletion
      if (state?.version !== 1 || state.memberId !== memberId || state.parentItemId !== target.parentItemId || state.subitemId !== target.subitemId) continue
      if (!latest || reply.createdAt > latest.createdAt || (reply.createdAt === latest.createdAt && thread.id > latest.eventId)) {
        latest = { ...state, eventId: thread.id, createdAt: reply.createdAt }
      }
    }
  }
  return latest
}

export function completionReply(eventId: string, actor: { memberId: string; name: string }, target: CompletionTarget,
  done: boolean, taskName: string, recipients: Array<{ id: string; name: string }>, createdAt: string,
  status?: PersonalTaskStatus, reopened = !done, timelineStart?: string | null, timelineEnd?: string | null,
  timelineChanged = false, subject?: { memberId: string; name: string }): CommentReply {
  const others = [...new Map(recipients.filter(p => p.id !== actor.memberId && p.id !== 'unassigned').map(p => [p.id, p])).values()]
  const stateMemberId = subject?.memberId ?? actor.memberId
  const timelineActor = subject && subject.memberId !== actor.memberId
    ? `${actor.name} heeft de tijdlijn van ${subject.name} aangepast`
    : `${actor.name} heeft de eigen tijdlijn aangepast`
  return {
    id: eventId, author: actor.name, authorId: actor.memberId, createdAt,
    body: `${timelineChanged ? timelineActor : `${actor.name} heeft ${done ? 'de eigen taak afgerond' : reopened ? 'de eigen taak heropend' : `de eigen taakstatus gewijzigd naar “${status || 'geen status'}”`}`}: “${taskName}”. ${timelineChanged ? 'De projecttijdlijn wordt automatisch uit alle persoonlijke tijdlijnen opgebouwd.' : 'De status voor de anderen blijft ongewijzigd.'}` +
      (others.length ? '\n' + others.map(p => '@' + p.name).join(' ') : ''),
    personalCompletion: {
      version: 1, ...target, memberId: stateMemberId, done,
      ...(status !== undefined ? { status } : {}),
      ...(timelineStart !== undefined ? { timelineStart } : {}),
      ...(timelineEnd !== undefined ? { timelineEnd } : {}),
      mentions: others.map(p => p.id),
    },
  }
}

/** Buitenste grens van alle persoonlijke planningen. Zonder persoonlijke
 * datums blijft de bestaande projecttijdlijn leidend. */
export function personalTimelineEnvelope(
  threads: CommentThread[], target: CompletionTarget, ownerIds: string[],
  fallbackStart: string | null | undefined, fallbackEnd: string | null | undefined,
): { startDate: string | null; endDate: string | null } {
  const states = [...new Set(ownerIds.filter(Boolean))].map(id => completionState(threads, target, id))
  if (!states.some(state => state?.timelineStart || state?.timelineEnd)) {
    return { startDate: fallbackStart ?? null, endDate: fallbackEnd ?? null }
  }
  // Een eigenaar zonder eigen invoer gebruikt nog de projecttijdlijn. Die
  // fallback telt dus ook mee in de envelope; anders zou één persoon het
  // gezamenlijke project per ongeluk voor alle anderen kunnen inkorten.
  const starts = states.map(state => state?.timelineStart || state?.timelineEnd || fallbackStart || fallbackEnd).filter((value): value is string => !!value)
  const ends = states.map(state => state?.timelineEnd || state?.timelineStart || fallbackEnd || fallbackStart).filter((value): value is string => !!value)
  return {
    startDate: starts.length ? starts.sort()[0] : fallbackStart ?? null,
    endDate: ends.length ? ends.sort().at(-1)! : fallbackEnd ?? null,
  }
}
