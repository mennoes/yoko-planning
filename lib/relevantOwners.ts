import type { BoardItem, SubItem } from './boards'

const DAY_MS = 86_400_000

function dayStart(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

function dateTs(value: string | null | undefined): number | null {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

export function isOwnerTimelineRelevant(
  subitem: Pick<SubItem, 'status' | 'startDate' | 'endDate'>,
  now = new Date(),
  horizonDays = 35,
): boolean {
  if (subitem.status === 'Done') return false
  const start = dateTs(subitem.startDate)
  const end = dateTs(subitem.endDate) ?? start
  if (start == null && end == null) return true
  const windowStart = dayStart(now)
  const windowEnd = windowStart + horizonDays * DAY_MS + DAY_MS - 1
  const rangeStart = start ?? end!
  const rangeEnd = end ?? start!
  return Math.max(rangeStart, windowStart) <= Math.min(rangeEnd, windowEnd)
}

function orderedUnique(ids: string[]): string[] {
  return [...new Set(ids.filter(id => id && id !== 'unassigned'))]
}

export type RelevantOwnerRollup = {
  relevantOwnerIds: string[]
  historicalOwnerIds: string[]
  relevantSubitems: SubItem[]
}

export function relevantOwnerRollup(
  item: Pick<BoardItem, 'ownerIds' | 'subitems'>,
  activeMemberIds?: ReadonlySet<string>,
  now = new Date(),
  horizonDays = 35,
): RelevantOwnerRollup {
  const subitems = item.subitems ?? []
  const relevantSubitems = subitems.filter(sub => isOwnerTimelineRelevant(sub, now, horizonDays))
  const allowed = (id: string) => !activeMemberIds || activeMemberIds.has(id)
  const relevantOwnerIds = orderedUnique(relevantSubitems.flatMap(sub => sub.ownerIds ?? [])).filter(allowed)
  const all = orderedUnique([
    ...(item.ownerIds ?? []),
    ...subitems.flatMap(sub => sub.ownerIds ?? []),
  ]).filter(allowed)
  const current = new Set(relevantOwnerIds)
  return {
    relevantOwnerIds,
    historicalOwnerIds: all.filter(id => !current.has(id)),
    relevantSubitems,
  }
}

export function relevantOwnerHours(subitems: SubItem[]): Record<string, number> {
  const rolled: Record<string, number> = {}
  for (const sub of subitems) {
    const owners = orderedUnique(sub.ownerIds ?? [])
    const hours = Number(sub.estHours) || 0
    if (owners.length === 0 || hours <= 0) continue
    const share = hours / owners.length
    for (const owner of owners) rolled[owner] = (rolled[owner] ?? 0) + share
  }
  for (const owner of Object.keys(rolled)) rolled[owner] = Math.round(rolled[owner] * 10) / 10
  return rolled
}
