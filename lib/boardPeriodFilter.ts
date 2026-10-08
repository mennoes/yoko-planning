import type { BoardItem } from './boards'

export type BoardPeriod = {
  from: number | null
  until: number | null
}

export function dateRangeOverlapsPeriod(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  { from, until }: BoardPeriod,
): boolean {
  if (!startDate) return false
  const start = new Date(startDate).getTime()
  if (!Number.isFinite(start)) return false
  const parsedEnd = endDate ? new Date(endDate).getTime() : start
  const end = Number.isFinite(parsedEnd) ? parsedEnd + 86_400_000 - 1 : start + 86_400_000 - 1
  if (from !== null && end < from) return false
  if (until !== null && start > until) return false
  return true
}

/**
 * Undated standalone items stay visible so a newly-created item does not
 * appear to vanish. A parent with dated children, however, only belongs to a
 * period when its own explicit range or at least one dated child overlaps it.
 */
export function boardItemMatchesPeriod(item: BoardItem, period: BoardPeriod): boolean {
  if (period.from === null && period.until === null) return true

  const datedSubitems = (item.subitems ?? []).filter(subitem => !!subitem.startDate)
  const hasAnyDate = !!item.startDate || datedSubitems.length > 0
  if (!hasAnyDate) return true

  return dateRangeOverlapsPeriod(item.startDate, item.endDate, period)
    || datedSubitems.some(subitem => dateRangeOverlapsPeriod(subitem.startDate, subitem.endDate, period))
}
