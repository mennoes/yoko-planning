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
  /** Wat de hoofdregel laat zien. Zie de terugvalvolgorde in
   *  relevantOwnerRollup — nooit leeg zolang iemand ergens eigenaar is. */
  displayOwnerIds: string[]
  /** De subitems waar de urenverdeling van de hoofdregel op slaat. Leeg
   *  wanneer de hoofdregel op z'n eigen eigenaren terugvalt. */
  displaySubitems: SubItem[]
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
  // Zodra er subitems zijn, zijn uitsluitend die subitems de bron voor de
  // parent-rollup. Oude owners die alleen nog op het hoofditem zelf staan
  // mogen dus niet opnieuw in de avatar- of urenverdeling verschijnen.
  const all = orderedUnique(subitems.flatMap(sub => sub.ownerIds ?? [])).filter(allowed)
  const own = orderedUnique(item.ownerIds ?? []).filter(allowed)
  // Terugvalvolgorde voor de hoofdregel:
  //   1. eigenaren van lopende subitems — die doen het werk nú;
  //   2. staat daar niemand, dan de eigenaren van het hoofditem zelf;
  //   3. en anders alsnog iedereen uit de subitems. Dat laatste is het
  //      geval bij een afgerond item: alle subitems staan op Done, dus
  //      stap 1 levert niets op en de rij stond leeg terwijl je er juist
  //      wil zien wie 't gedaan heeft (en wiens uren eronder hangen).
  const displayOwnerIds = relevantOwnerIds.length > 0 ? relevantOwnerIds
    : own.length > 0 ? own
    : all
  const displaySubitems = relevantOwnerIds.length > 0 ? relevantSubitems
    : own.length > 0 ? []
    : subitems
  const shown = new Set(displayOwnerIds)
  return {
    relevantOwnerIds,
    historicalOwnerIds: all.filter(id => !shown.has(id)),
    relevantSubitems,
    displayOwnerIds,
    displaySubitems,
  }
}

export function relevantOwnerHours(subitems: SubItem[]): Record<string, number> {
  const rolled: Record<string, number> = {}
  for (const sub of subitems) {
    const owners = orderedUnique(sub.ownerIds ?? [])
    const hours = Number(sub.estHours) || 0
    if (owners.length === 0 || hours <= 0) continue
    const stored = sub.ownerHours ?? {}
    const storedTotal = owners.reduce((sum, owner) => sum + Math.max(0, Number(stored[owner]) || 0), 0)
    if (storedTotal > 0) {
      // Bewaar de echte verdeling van het subitem. Schaal alleen wanneer
      // oudere data niet exact optelt tot estHours.
      const factor = hours / storedTotal
      for (const owner of owners) {
        rolled[owner] = (rolled[owner] ?? 0) + Math.max(0, Number(stored[owner]) || 0) * factor
      }
    } else {
      const share = hours / owners.length
      for (const owner of owners) rolled[owner] = (rolled[owner] ?? 0) + share
    }
  }
  for (const owner of Object.keys(rolled)) rolled[owner] = Math.round(rolled[owner] * 10) / 10
  return rolled
}
