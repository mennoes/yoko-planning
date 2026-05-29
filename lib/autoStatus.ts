// Auto-status sweep — zet items waarvan de timeline "nu" is en die nog
// geen status hebben automatisch op 'Working on...'. Idempotent: items met
// een handmatige status (Done / Stuck / etc.) worden niet aangeraakt.

import type { BoardGroup, BoardItem, SubItem } from './boards'
import { loadGroups, saveGroups, pushBoardToRemote } from './boardStore'
import { getBoardIds } from './boardsRegistry'
import { createNotification } from './notificationsStore'

const WORKING = 'Working on...'
const DONE    = 'Done'
// Google-events worden agressiever opgeruimd dan zelf-gemaakte items: zodra
// de dag erna is, mogen ze op Done. Voor handmatige items hanteren we 3
// dagen zodat een vergeten afvinkje niet meteen weggewerkt wordt — de user
// krijgt eerst een notificatie via notifyOverdueItems.
const AUTO_DONE_AFTER_DAYS_GOOGLE = 0
const AUTO_DONE_AFTER_DAYS_MANUAL = 3

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

// Auto-Done — Google-items zodra de dag erna is (>0 dagen voorbij),
// handmatige items pas na 3 dagen. Handmatige Stuck/Done laten we ongemoeid.
function shouldAutoDone(status: string | undefined | null, end: string | null | undefined, today: string, source: 'manual' | 'google' | undefined | null): boolean {
  const s = (status ?? '').trim()
  if (s === DONE || s === 'Stuck') return false
  if (!end) return false
  const endTs   = Date.parse(end)
  const todayTs = Date.parse(today)
  if (Number.isNaN(endTs) || Number.isNaN(todayTs)) return false
  const threshold = source === 'google' ? AUTO_DONE_AFTER_DAYS_GOOGLE : AUTO_DONE_AFTER_DAYS_MANUAL
  return (todayTs - endTs) / 86400000 > threshold
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
        //  - Loopt vandaag → Working on...
        //  - End-datum > 3 dagen voorbij → Done. Vangt Google-instances op
        //    die nog niet in een sync-pass zaten. Stuck/Done blijven.
        if (item.subitems && item.subitems.length > 0) {
          let subChanged = false
          // Subitems van een Google-parent (recurring instances) tellen als
          // Google-source — die mogen agressief Done worden zodra de dag
          // erna is. Voor subitems onder een handmatige parent valt het
          // terug op de subitem's eigen source-veld of 'manual'.
          const subSource: 'manual' | 'google' | undefined = item.source === 'google' ? 'google' : undefined
          const subs: SubItem[] = item.subitems.map(sub => {
            const effSource = subSource ?? (sub as { source?: 'manual' | 'google' }).source
            if (shouldAutoDone(sub.status, sub.endDate ?? sub.startDate, today, effSource)) {
              subChanged = true
              return { ...sub, status: DONE }
            }
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
        // Parent-item: Google-events die voorbij zijn (één-off of recurring
        // waarvan de laatste instance gepasseerd is) op Done; live items
        // krijgen Working on…; handmatige items vallen alleen onder de
        // 3-dagen-regel zodat zelf-aangemaakt werk niet ongezien wegglijdt.
        if (shouldAutoDone(mutated.status, mutated.endDate ?? mutated.startDate, today, mutated.source)) {
          mutated = { ...mutated, status: DONE }
          changed++
          boardChanged = true
        } else if (needsAuto(mutated.status) && isLive(mutated.startDate, mutated.endDate, today)) {
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

// Voor items DIE DOOR JEZELF (of het team) zijn aangemaakt, willen we NIET
// automatisch afvinken zoals bij Google-events. Wel een seintje wanneer de
// eind-datum voorbij is en je nog niets hebt afgevinkt. notifyOverdueItems
// stuurt eenmalig een notificatie aan de huidige gebruiker per item — daarna
// stempelen we 't item met expiryNotifiedAt zodat 't niet bij elke pull weer
// een melding triggert.
export async function notifyOverdueItems(currentMemberId: string | null | undefined): Promise<{ notified: number }> {
  if (!currentMemberId) return { notified: 0 }
  const todayIso = new Date().toISOString().slice(0, 10)
  const boardIds = getBoardIds()
  let notified = 0

  for (const boardId of boardIds) {
    const groups = loadGroups(boardId, [])
    let boardChanged = false
    const nextGroups: BoardGroup[] = groups.map(g => {
      const items = g.items.map(item => {
        // Skip Google-items (die handelen we via auto-Done in googleSync af)
        if (item.source === 'google') return item
        const owners = item.ownerIds ?? []
        if (!owners.includes(currentMemberId)) return item
        const end = item.endDate ?? item.startDate ?? null
        if (!end) return item
        if (end >= todayIso) return item                       // nog niet voorbij
        const status = (item.status ?? '').trim()
        if (status === 'Done' || status === 'Stuck') return item
        const stamped = item as BoardItem & { expiryNotifiedAt?: string }
        if (stamped.expiryNotifiedAt) return item              // al genotificeerd

        createNotification({
          recipientId: currentMemberId,
          actorId:     null,
          kind:        'comment',
          contextKind: 'board_item',
          contextId:   item.id,
          href:        `/projects/${boardId}`,
          body:        `'${item.name}' is over z'n eind-datum — klaar?`,
        }).catch(() => {})

        notified++
        boardChanged = true
        return { ...item, expiryNotifiedAt: todayIso } as BoardItem
      })
      return { ...g, items }
    })
    if (boardChanged) {
      saveGroups(boardId, nextGroups)
      pushBoardToRemote(boardId, nextGroups).catch(() => {})
    }
  }
  return { notified }
}
