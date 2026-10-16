export type HourSubitem = {
  estHours?: number | null
  source?: string | null
}

export type HourItem = {
  estHours?: number | null
  source?: string | null
  subitems?: readonly unknown[] | null
}

function hours(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Canonical roll-up for an item and the subitems that belong in the current
 * view. Callers decide which rows are visible/active; this function decides
 * how parent, manual subitem and Google occurrence hours combine.
 *
 * - manual subitems replace the parent total once they contain real hours;
 * - Google occurrences are additive to a manual parent/task;
 * - a Google parent is only a container and never adds its series total.
 */
export function itemRollupHours(item: HourItem, subitems: HourSubitem[] | null | undefined): number {
  const own = hours(item.estHours)
  const rows = subitems ?? []
  const manual = rows
    .filter(subitem => subitem.source !== 'google')
    .reduce((sum, subitem) => sum + hours(subitem.estHours), 0)
  const google = rows
    .filter(subitem => subitem.source === 'google')
    .reduce((sum, subitem) => sum + hours(subitem.estHours), 0)

  const isGoogleContainer = item.source === 'google'
    && (rows.length > 0 || (item.subitems?.length ?? 0) > 0)
  if (isGoogleContainer) return manual + google
  return (manual > 0 ? manual : own) + google
}
