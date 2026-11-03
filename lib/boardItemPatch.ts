import type { BoardItem } from './boards'
import { scaleOwnerHours } from './ownerHours'

export function mergeDetailPatch(i: BoardItem, updates: Partial<BoardItem>): BoardItem {
  const merged: BoardItem = {
    ...i,
    ...updates,
    ...(i.source === 'google' && 'status' in updates
      ? { statusOverride: updates.status === 'Done' ? 'done' : 'active' }
      : {}),
    ...(i.source === 'google' && 'name' in updates ? { nameOverride: true } : {}),
    ...(i.source === 'google' && ('startDate' in updates || 'endDate' in updates)
      ? { datesOverride: updates.datesOverride === false ? false : true }
      : {}),
    ...(i.source === 'google' && 'estHours' in updates ? { hoursOverride: true } : {}),
    ...(i.source === 'google' && 'notes' in updates ? { notesOverride: true } : {}),
    ...(i.source === 'google' && 'deadline' in updates ? { deadlineOverride: true } : {}),
  }
  // estHours veranderd én item heeft ownerHours? Schaal de
  // verdeling proportioneel zodat de verhoudingen kloppen
  // met de nieuwe totalen — pie + cijfers blijven in sync.
  if ('estHours' in updates && i.ownerHours && Object.keys(i.ownerHours).length > 0) {
    const oldSum = Object.values(i.ownerHours).reduce((s, v) => s + (Number(v) || 0), 0)
    const newTotal = Number(updates.estHours) || 0
    if (oldSum > 0 && newTotal > 0 && Math.abs(oldSum - newTotal) > 0.01) {
      merged.ownerHours = scaleOwnerHours(i.ownerHours, newTotal)
    } else if (newTotal === 0) {
      // Naar 0u: leeg de verdeling, anders blijft de pie
      // verkeerd staan met som > 0.
      merged.ownerHours = undefined
    }
  }
  // ownerIds veranderd → cleanup stale ownerHours-entries (zelfde
  // safeguard als in OwnersCell, voor bulk-updates die rechtstreeks
  // updateItem aanroepen zonder het Cell-pad).
  if ('ownerIds' in updates && !('ownerHours' in updates) && i.ownerHours && Object.keys(i.ownerHours).length > 0) {
    const active = new Set(updates.ownerIds ?? [])
    const cleaned: Record<string, number> = {}
    for (const [oid, hrs] of Object.entries(i.ownerHours)) {
      if (active.has(oid)) cleaned[oid] = hrs
    }
    merged.ownerHours = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  return merged
}


