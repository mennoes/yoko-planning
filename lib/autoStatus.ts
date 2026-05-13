// Auto-status sweep — zet items waarvan de timeline "nu" is en die nog
// geen status hebben automatisch op 'Working on...'. Idempotent: items met
// een handmatige status (Done / Stuck / etc.) worden niet aangeraakt.

import type { BoardGroup, BoardItem, SubItem } from './boards'
import { loadGroups, saveGroups, pushBoardToRemote } from './boardStore'
import { getBoardIds } from './boardsRegistry'

const WORKING = 'Working on...'

function isLive(start: string | null | undefined, end: string | null | undefined, today: string): boolean {
  if (!start) return false
  const s = start
  const e = end || start
  return today >= s && today <= e
}

function needsAuto(status: string | undefined | null): boolean {
  const s = (status ?? '').trim()
  return s === '' || s === 'Not started'
}

export async function applyAutoStatus(): Promise<{ changed: number }> {
  const today = new Date().toISOString().slice(0, 10)
  const boardIds = getBoardIds()
  let changed = 0
  const dirty = new Set<string>()

  for (const boardId of boardIds) {
    const groups = loadGroups(boardId, [])
    let boardChanged = false
    const nextGroups: BoardGroup[] = groups.map(g => {
      const items: BoardItem[] = g.items.map(item => {
        let mutated = item
        // Subitems eerst — die rollen niet automatisch op naar de parent
        // (zie eerdere keuze), maar mogen wel zelf hun status oppikken.
        if (item.subitems && item.subitems.length > 0) {
          let subChanged = false
          const subs: SubItem[] = item.subitems.map(sub => {
            if (needsAuto(sub.status) && isLive(sub.startDate, sub.endDate, today)) {
              subChanged = true
              return { ...sub, status: WORKING }
            }
            return sub
          })
          if (subChanged) {
            mutated = { ...mutated, subitems: subs }
            changed += subs.filter((s, i) => s.status !== (item.subitems?.[i].status ?? '')).length
            boardChanged = true
          }
        }
        if (needsAuto(mutated.status) && isLive(mutated.startDate, mutated.endDate, today)) {
          mutated = { ...mutated, status: WORKING }
          changed++
          boardChanged = true
        }
        return mutated
      })
      return { ...g, items }
    })
    if (boardChanged) {
      saveGroups(boardId, nextGroups)
      pushBoardToRemote(boardId, nextGroups).catch(() => {})
      dirty.add(boardId)
    }
  }
  void dirty
  return { changed }
}
