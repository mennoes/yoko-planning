// Alleen een statuswijziging naar Done verplaatst een item niet automatisch:
// afgerond werk hoort standaard in zijn eigen groep te blijven. Een bewuste
// drag naar een Done-groep is wél leidend en wordt voor Google-items gemarkeerd
// met googlePlacementLocked, zodat sync en refresh die keuze respecteren.
//
// Wat 'ie wel nog doet: eenmalig herstel van items die door de OUDE
// (verwijderde) auto-move-logica al in zo'n Done-groep terecht waren
// gekomen — teruggezet naar hun oorspronkelijke groep (via de bewaarde
// originGroupId), of voor Google-items zonder die tag naar de bord's
// Meetings & doorlopend-groep, wat de logische thuis-groep is voor elke
// gesyncte meeting ongeacht status. Items zonder aanknopingspunt (geen
// originGroupId, geen Google-herkomst) laten we met rust — gokken naar de
// verkeerde groep is erger dan even laten staan.
//
// Idempotent: een tweede pass op een al-herstelde staat verandert niks.

import type { BoardGroup, BoardItem } from './boards'
import { isDoneGroupName } from './groupMove'

function isMeetingsGroupName(name: string): boolean {
  const n = name.toLowerCase().trim()
  return n === 'meetings & doorlopend' || n === 'meetings en doorlopend' || n === 'meetings' || n === 'doorlopend'
}

export function autoMoveDoneItems(next: BoardGroup[]): BoardGroup[] {
  const doneGroups = next.filter(g => isDoneGroupName(g.name))
  if (doneGroups.length === 0) return next
  const doneGroupIds = new Set(doneGroups.map(g => g.id))
  const meetingsGroup = next.find(g => isMeetingsGroupName(g.name) && !doneGroupIds.has(g.id))

  const restorations: Array<{ item: BoardItem; targetGroupId: string }> = []

  const updated = next.map(g => {
    if (!doneGroupIds.has(g.id)) return g
    const keep: BoardItem[] = []
    for (const i of g.items) {
      // Een Google-meeting die de gebruiker bewust hierheen sleepte, hoort
      // juist in Done te blijven. Alleen oude, onbedoelde plaatsingen zonder
      // deze lock vallen nog onder de herstelcode hieronder.
      if (i.source === 'google' && i.googlePlacementLocked) {
        keep.push(i)
        continue
      }
      const originId = (i as { originGroupId?: string }).originGroupId
      const originAlive = originId && next.some(g2 => g2.id === originId && !doneGroupIds.has(g2.id))
      const target = originAlive
        ? originId!
        : (i.source === 'google' && meetingsGroup ? meetingsGroup.id : null)
      if (!target) { keep.push(i); continue }
      const { originGroupId: _drop, ...clean } = i as BoardItem & { originGroupId?: string }
      void _drop
      restorations.push({ item: clean as BoardItem, targetGroupId: target })
    }
    return keep.length === g.items.length ? g : { ...g, items: keep }
  })

  if (restorations.length === 0) return next
  return updated.map(g => {
    const back = restorations.filter(r => r.targetGroupId === g.id).map(r => r.item)
    if (back.length === 0) return g
    return { ...g, items: [...g.items, ...back] }
  })
}
