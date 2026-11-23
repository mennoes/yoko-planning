export type SuggestedDateRange = {
  startDate: string
  endDate: string
}

export type SuggestedSubitemPlan = SuggestedDateRange & {
  deadline: string
  effortDays: number
  totalEffortDays: number
  availableDays: number
  isTight: boolean
}

type SchedulableSubitem = {
  id: string
  startDate?: string | null
  endDate?: string | null
  deadline?: string | null
  estHours?: number | null
}

const DAY_MS = 86_400_000

function isoToDay(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const result = Date.UTC(year, month - 1, day) / DAY_MS
  return Number.isFinite(result) ? result : null
}

function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

function isWorkday(day: number): boolean {
  const weekday = new Date(day * DAY_MS).getUTCDay()
  return weekday !== 0 && weekday !== 6
}

function workdayOnOrBefore(day: number): number {
  let result = day
  while (!isWorkday(result)) result--
  return result
}

function workdayOnOrAfter(day: number): number {
  let result = day
  while (!isWorkday(result)) result++
  return result
}

function workdays(start: number, end: number): number[] {
  const result: number[] = []
  for (let day = start; day <= end; day++) if (isWorkday(day)) result.push(day)
  return result
}

function workdaysBack(end: number, count: number): number {
  let day = workdayOnOrBefore(end)
  let remaining = Math.max(1, count) - 1
  while (remaining > 0) {
    day--
    if (isWorkday(day)) remaining--
  }
  return day
}

function effortDays(subitem: SchedulableSubitem): number {
  const hours = Number(subitem.estHours)
  return Number.isFinite(hours) && hours > 0 ? hours / 8 : 1
}

/**
 * Maak één samenhangend voorstel voor de subitems van een item.
 *
 * - de hoofdtimeline begrenst waar het werk mag liggen;
 * - de hoofddeadline begrenst die periode verder, of is het eindanker als
 *   er nog geen timeline staat;
 * - uren / 8 bepalen hoeveel ruimte iedere stap relatief krijgt;
 * - weekenden tellen niet als beschikbare productiedagen;
 * - iedere voorgestelde subitemdeadline is het einde van zijn eigen stap.
 *
 * Er wordt niets opgeslagen: de agenda toont dit als een aanklikbare
 * suggestie. Bestaande subitemdatums/deadlines blijven altijd leidend.
 */
export function suggestSubitemPlans(
  parentStart: string | null | undefined,
  parentEnd: string | null | undefined,
  parentDeadline: string | null | undefined,
  subitems: SchedulableSubitem[],
): Record<string, SuggestedSubitemPlan> {
  if (subitems.length === 0) return {}

  const deadlineDay = isoToDay(parentDeadline)
  let timelineStart = isoToDay(parentStart)
  let timelineEnd = isoToDay(parentEnd)
  if (timelineStart != null && timelineEnd != null && timelineStart > timelineEnd) {
    ;[timelineStart, timelineEnd] = [timelineEnd, timelineStart]
  }
  let end = timelineEnd ?? deadlineDay ?? timelineStart
  if (end == null) return {}
  if (deadlineDay != null) end = Math.min(end, deadlineDay)
  end = workdayOnOrBefore(end)

  const weights = subitems.map(effortDays)
  const totalEffortDays = weights.reduce((sum, days) => sum + days, 0)
  const requiredWholeDays = Math.max(1, Math.ceil(totalEffortDays))
  let start = timelineStart == null
    ? workdaysBack(end, requiredWholeDays)
    : workdayOnOrAfter(timelineStart)
  if (start > end) start = end

  const available = workdays(start, end)
  if (available.length === 0) return {}
  const isTight = available.length < requiredWholeDays
  const result: Record<string, SuggestedSubitemPlan> = {}
  let cumulative = 0
  let nextIndex = 0

  subitems.forEach((subitem, index) => {
    const weight = weights[index]
    const fromIndex = Math.min(available.length - 1, nextIndex)
    cumulative += weight
    const nextBoundary = index === subitems.length - 1
      ? available.length
      : Math.round(cumulative / totalEffortDays * available.length)
    const untilIndex = Math.min(
      available.length - 1,
      Math.max(fromIndex, nextBoundary - 1),
    )
    nextIndex = Math.min(available.length, untilIndex + 1)

    const suggestedStart = dayToIso(available[fromIndex])
    const ownStart = isoToDay(subitem.startDate)
    const ownEnd = isoToDay(subitem.endDate)
    const effectiveStart = ownStart == null ? suggestedStart : dayToIso(ownStart)
    const effectiveEndDay = Math.min(ownEnd ?? ownStart ?? available[untilIndex], end)
    const effectiveEnd = dayToIso(effectiveEndDay)

    result[subitem.id] = {
      startDate: effectiveStart,
      endDate: effectiveEnd,
      deadline: effectiveEnd,
      effortDays: weight,
      totalEffortDays,
      availableDays: available.length,
      isTight,
    }
  })

  return result
}

/** Alleen de datumranges, voor bestaande aanroepers. */
export function suggestSubitemDateRanges(
  parentStart: string | null | undefined,
  parentEnd: string | null | undefined,
  subitems: SchedulableSubitem[],
): Record<string, SuggestedDateRange> {
  const plans = suggestSubitemPlans(parentStart, parentEnd, null, subitems)
  const result: Record<string, SuggestedDateRange> = {}
  for (const subitem of subitems) {
    if (subitem.startDate || subitem.endDate || !plans[subitem.id]) continue
    result[subitem.id] = {
      startDate: plans[subitem.id].startDate,
      endDate: plans[subitem.id].endDate,
    }
  }
  return result
}
