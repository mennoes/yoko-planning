export type GoogleMeetingHistorySubitem = {
  id: string
  sourceItemId?: string
  name?: string
  status?: string
  statusOverride?: 'active' | 'done'
  startDate?: string | null
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  estHours?: number
  externalLink?: string | null
}

function identity(item: GoogleMeetingHistorySubitem): string {
  if (item.sourceItemId) return `source:${item.sourceItemId}`
  if (item.externalLink) return `link:${item.externalLink}`
  return `date:${item.startDate ?? ''}:${item.startTime ?? ''}:${(item.name ?? '').trim().toLowerCase()}`
}

function statusRank(status: string | undefined): number {
  if (status === 'Done') return 4
  if (status === 'Stuck') return 3
  if (status === 'Working on...') return 2
  if (status === 'Doorlopend') return 1
  return 0
}

function shouldBeDone(item: GoogleMeetingHistorySubitem, todayIso: string): boolean {
  if (item.statusOverride === 'active' || item.status === 'Stuck') return false
  if (item.statusOverride === 'done' || item.status === 'Done') return true
  const end = item.endDate ?? item.startDate
  if (!end) return false
  const age = (Date.parse(todayIso) - Date.parse(end)) / 86400000
  return Number.isFinite(age) && age > 3
}

/**
 * Union fresh and historical recurring instances without losing old hours.
 * Historical rows include soft-deleted duplicate parents from older sync
 * versions; their occurrences are repaired into the live parent before the
 * duplicate parent is hidden.
 */
export function mergeGoogleMeetingHistory<T extends GoogleMeetingHistorySubitem>(
  fresh: T[], historicalSets: T[][], dismissedIds: Set<string>, todayIso = new Date().toISOString().slice(0, 10),
): T[] {
  const merged = new Map<string, T>()
  for (const item of [...historicalSets.flat(), ...fresh]) {
    if (!item?.id || dismissedIds.has(item.id)) continue
    const key = identity(item)
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, { ...item, ...(shouldBeDone(item, todayIso) ? { status: 'Done' } : {}) } as T)
      continue
    }
    const next = { ...previous, ...item } as T
    if (!(Number(item.estHours) > 0) && Number(previous.estHours) > 0) next.estHours = previous.estHours
    if (statusRank(previous.status) > statusRank(item.status)) next.status = previous.status
    if (shouldBeDone(next, todayIso)) next.status = 'Done'
    merged.set(key, next)
  }
  return [...merged.values()].sort((a, b) => {
    const date = (a.startDate ?? '').localeCompare(b.startDate ?? '')
    return date || (a.startTime ?? '').localeCompare(b.startTime ?? '')
  })
}
