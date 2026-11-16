export type SuggestedDateRange = {
  startDate: string
  endDate: string
}

type DatedSubitem = {
  id: string
  startDate?: string | null
  endDate?: string | null
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

/**
 * Verdeel de periode van een hoofditem gelijkmatig over zijn subitems.
 * Alleen volledig lege subitems krijgen een suggestie; de suggestie wordt
 * nergens opgeslagen totdat de gebruiker haar kiest.
 */
export function suggestSubitemDateRanges(
  parentStart: string | null | undefined,
  parentEnd: string | null | undefined,
  subitems: DatedSubitem[],
): Record<string, SuggestedDateRange> {
  if (subitems.length === 0) return {}

  const first = isoToDay(parentStart ?? parentEnd)
  const last = isoToDay(parentEnd ?? parentStart)
  if (first == null || last == null) return {}

  const start = Math.min(first, last)
  const end = Math.max(first, last)
  const totalDays = end - start + 1
  const result: Record<string, SuggestedDateRange> = {}

  subitems.forEach((subitem, index) => {
    if (subitem.startDate || subitem.endDate) return
    const fromOffset = Math.floor(index * totalDays / subitems.length)
    const nextOffset = Math.floor((index + 1) * totalDays / subitems.length)
    const untilOffset = Math.min(totalDays - 1, Math.max(fromOffset, nextOffset - 1))
    result[subitem.id] = {
      startDate: dayToIso(start + fromOffset),
      endDate: dayToIso(start + untilOffset),
    }
  })

  return result
}
