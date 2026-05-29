// Auto-move Done items naar een dedicated "Done" groep — wordt aangeroepen
// door zowel de UI (status-wijziging via BoardTable) als de auto-status
// sweep (lib/autoStatus.ts), zodat Google-events die de dag erna automatisch
// op Done belanden óók verhuizen i.p.v. in 'Projecten' te blijven staan.
//
// Logica:
//  - Items met status === 'Done' uit niet-Done groepen worden naar de Done
//    groep verplaatst (één wordt aangemaakt op eerste gebruik).
//  - Items in de Done-groep waarvan de status weer iets anders is dan 'Done'
//    keren terug naar hun originGroupId (gestempeld bij de heenweg).
//
// Idempotent: een tweede pass op een al-verwerkte staat verandert niks.

import type { BoardGroup, BoardItem } from './boards'

export function autoMoveDoneItems(next: BoardGroup[]): BoardGroup[] {
  const doneIdx   = next.findIndex(g => g.name.toLowerCase() === 'done')
  const doneGroup = doneIdx >= 0 ? next[doneIdx] : null

  const additions: BoardItem[] = []
  const restorations = new Map<string, { item: BoardItem; targetGroupId: string }>()

  let updated = next.map(g => {
    if (doneGroup && g.id === doneGroup.id) {
      const keep: BoardItem[] = []
      for (const i of g.items) {
        if (i.status !== 'Done') {
          const originId = (i as { originGroupId?: string }).originGroupId
          const target = originId && next.some(g2 => g2.id === originId && g2.id !== doneGroup.id)
            ? originId
            : (next.find(g2 => g2.id !== doneGroup.id)?.id ?? doneGroup.id)
          if (target === doneGroup.id) { keep.push(i); continue }
          const { originGroupId: _drop, ...clean } = i as BoardItem & { originGroupId?: string }
          void _drop
          restorations.set(i.id, { item: clean as BoardItem, targetGroupId: target })
        } else {
          keep.push(i)
        }
      }
      return keep.length === g.items.length ? g : { ...g, items: keep }
    }
    const stay = g.items.filter(i => {
      if (i.status === 'Done') {
        const tagged = { ...i, originGroupId: (i as { originGroupId?: string }).originGroupId ?? g.id } as BoardItem
        additions.push(tagged)
        return false
      }
      return true
    })
    return stay.length === g.items.length ? g : { ...g, items: stay }
  })

  if (restorations.size > 0) {
    updated = updated.map(g => {
      const back = [...restorations.values()].filter(r => r.targetGroupId === g.id).map(r => r.item)
      if (back.length === 0) return g
      return { ...g, items: [...g.items, ...back] }
    })
  }

  if (additions.length === 0) return restorations.size > 0 ? updated : next

  if (doneGroup) {
    return updated.map(g =>
      g.id === doneGroup.id
        ? { ...g, items: [...g.items, ...additions.filter(a => !g.items.some(b => b.id === a.id))] }
        : g,
    )
  }
  return [...updated, {
    id: `g_done_${Date.now()}`, name: 'Done', color: '#9aa39a', collapsed: true,
    items: additions,
  }]
}
