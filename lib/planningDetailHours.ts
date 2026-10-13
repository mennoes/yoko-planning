import type { SubItem } from './boards'

export type PlanningDetailHours = {
  total: number
  source: 'subitems' | 'parent' | 'owners' | 'empty'
}

function positive(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Eén bron voor het totaal in de planning-popup.
 *
 * Subitems zijn leidend zodra daar werkelijk uren op staan. Een parent met
 * alleen 0u-placeholder-subs mag zijn eigen bestaande uren/verdeling echter
 * niet verliezen; dat was de oorzaak van een lege taart naast 40u aan regels.
 */
export function planningDetailHours(
  parentHours: unknown,
  subitems: Pick<SubItem, 'estHours'>[] | null | undefined,
  ownerHours: Record<string, number> | null | undefined,
): PlanningDetailHours {
  const subitemsTotal = round1((subitems ?? []).reduce((sum, sub) => sum + positive(sub.estHours), 0))
  if (subitemsTotal > 0) return { total: subitemsTotal, source: 'subitems' }

  const parentTotal = round1(positive(parentHours))
  if (parentTotal > 0) return { total: parentTotal, source: 'parent' }

  const ownersTotal = round1(Object.values(ownerHours ?? {}).reduce((sum, hours) => sum + positive(hours), 0))
  if (ownersTotal > 0) return { total: ownersTotal, source: 'owners' }

  return { total: 0, source: 'empty' }
}
