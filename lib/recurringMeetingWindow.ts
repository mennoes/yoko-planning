export const RECURRING_MEETING_FUTURE_DAYS = 56

type DatedSubitem = { startDate?: string | null }

export function recurringMeetingCutoffIso(from = new Date()): string {
  const cutoff = new Date(from)
  cutoff.setDate(cutoff.getDate() + RECURRING_MEETING_FUTURE_DAYS)
  return cutoff.toISOString().slice(0, 10)
}

/**
 * Keep all history, undated/manual children and at most eight weeks of
 * future occurrences for a recurring Google container. This read-side guard
 * makes the window apply immediately, even when the canonical row belongs to
 * another team member whose Google connection has not synced yet.
 */
export function visibleRecurringSubitems<T extends DatedSubitem>(
  source: string | null | undefined,
  subitems: T[],
  from = new Date(),
): T[] {
  if (source !== 'google') return subitems
  const cutoff = recurringMeetingCutoffIso(from)
  return subitems.filter(subitem => !subitem.startDate || subitem.startDate <= cutoff)
}
