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

function isPast(item: GoogleMeetingHistorySubitem, todayIso: string): boolean {
  const end = item.endDate ?? item.startDate
  return !!end && end < todayIso
}

/**
 * Occurrences die al voorbij zijn én uren dragen. Deze uren zijn nodig voor
 * uren- en factuurverantwoording: zodra een rij ze draagt mag een opruimpad
 * 'm niet meer soft-deleten, want `deleted_at` haalt de rij in één klap uit
 * planning, maandtotalen, budget én de publieke share-API.
 */
export function pastBillableOccurrences<T extends GoogleMeetingHistorySubitem>(
  subitems: T[], todayIso: string,
): T[] {
  return subitems.filter(item => isPast(item, todayIso) && (Number(item.estHours) || 0) > 0)
}

/**
 * Alleen de occurrences die al geweest zijn. Gebruikt om een geweigerde of
 * uit Google verdwenen reeks te snoeien: de toekomst komt niet meer, de
 * historie moet leesbaar blijven staan.
 */
export function historicalOccurrencesOnly<T extends GoogleMeetingHistorySubitem>(
  subitems: T[], todayIso: string,
): T[] {
  return subitems.filter(item => isPast(item, todayIso))
}

/**
 * Alleen occurrences van vóór het begin van een vervangende reeks. Google
 * geeft bij "deze en volgende" geregeld een nieuw iCalUID, terwijl de oude
 * rij óók alvast toekomstige occurrences kan bevatten. Die toekomstige
 * overlap mag herstel van augustus/september niet blokkeren.
 */
export function occurrencesBefore<T extends GoogleMeetingHistorySubitem>(
  subitems: T[], cutoffIso: string,
): T[] {
  return subitems.filter(item => {
    const date = item.startDate ?? item.endDate
    return !!date && date < cutoffIso
  })
}

export function allDatedOccurrencesBefore<T extends GoogleMeetingHistorySubitem>(
  subitems: T[], cutoffIso: string,
): boolean {
  const dated = subitems.filter(item => item.startDate || item.endDate)
  return dated.length > 0 && dated.every(item => (item.startDate ?? item.endDate ?? '') < cutoffIso)
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

/**
 * Database invariant for every board save: an already stored, dated occurrence
 * from the past may only disappear after an explicit delete (tombstone).
 *
 * This is deliberately broader than Google sync. Historical subitems are the
 * work log used for time accountability. A stale browser tab, sync rebuild or
 * whole-item update must therefore never be able to erase them incidentally.
 */
export function preserveStoredHistory<T extends GoogleMeetingHistorySubitem>(
  incoming: T[], stored: T[], dismissedIds: Set<string>, todayIso = new Date().toISOString().slice(0, 10),
): T[] {
  const protectedHistory = stored.filter(item => {
    if (!item?.id || dismissedIds.has(item.id) || (item.sourceItemId && dismissedIds.has(item.sourceItemId))) return false
    return isPast(item, todayIso)
  })

  // `incoming` is the item the user has just edited. Earlier we fed stored
  // history through mergeGoogleMeetingHistory(), whose defensive status/hour
  // precedence could put the OLD Done value back on the row. The write then
  // succeeded technically, but a refresh showed the old value again.
  //
  // This guard has only one job: append historical occurrences that vanished
  // from a stale snapshot. It must never merge old fields into an occurrence
  // that is still present. Match both the row id and the stable Google source
  // id/link; the incoming occurrence wins in full, including an intentional
  // change from Done to active and an intentional change to 0 hours.
  const incomingIds = new Set(incoming.map(item => item.id).filter(Boolean))
  const incomingSources = new Set(incoming.map(item => item.sourceItemId).filter((id): id is string => !!id))
  const incomingLinks = new Set(incoming.map(item => item.externalLink).filter((link): link is string => !!link))
  const missingHistory = protectedHistory.filter(item => {
    if (incomingIds.has(item.id)) return false
    if (item.sourceItemId && incomingSources.has(item.sourceItemId)) return false
    if (item.externalLink && incomingLinks.has(item.externalLink)) return false
    return true
  })

  return [...incoming, ...missingHistory].sort((a, b) => {
    const date = (a.startDate ?? '').localeCompare(b.startDate ?? '')
    return date || (a.startTime ?? '').localeCompare(b.startTime ?? '')
  })
}
