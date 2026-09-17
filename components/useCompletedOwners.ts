'use client'

import { useEffect, useMemo, useState } from 'react'
import { loadCommentsFor, onCommentsUpdate, type CommentThread } from '@/lib/commentsStore'
import { completionContext, completionState, type CompletionTarget } from '@/lib/personalCompletion'

/**
 * Keep distribution rows in sync with the same immutable personal-completion
 * events used by Agenda's, To do's and Status mijn taak.
 */
export function useCompletedOwners(target: CompletionTarget | null, ownerIds: string[]): Set<string> {
  const context = target ? completionContext(target) : ''
  const [threads, setThreads] = useState<CommentThread[]>([])

  useEffect(() => {
    if (!context) {
      setThreads([])
      return
    }
    const refresh = () => setThreads(loadCommentsFor(context))
    refresh()
    return onCommentsUpdate(refresh)
  }, [context])

  const ownersKey = ownerIds.join('\u0000')
  return useMemo(() => {
    if (!target) return new Set<string>()
    return new Set(ownerIds.filter(memberId => completionState(threads, target, memberId)?.done))
    // target is represented by the stable context string; ownersKey tracks
    // in-place owner list changes without depending on array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, context, ownersKey])
}

