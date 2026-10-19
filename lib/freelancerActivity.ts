// Wie telt er als actieve freelancer?
//
// Tot nu toe was 'inactief' een vinkje dat iemand met de hand zette. Dat
// liep altijd achter: een freelancer die een half jaar niets deed stond
// nog in de actieve lijst, en iemand die na lange tijd weer meedraaide
// bleef onder 'Inactief team' hangen tot je eraan dacht.
//
// Nu bepaalt het werk het: heeft iemand in de afgelopen of komende drie
// weken werk bij ons staan, dan is die actief. Zo niet, dan inactief.
// Afgerond werk telt mee — 'vorige week drie dagen gedaan' is precies wat
// 'afgelopen drie weken voor ons gefreelancet' betekent.

import type { Project } from './workload'

/** Hoe ver kijken we terug en vooruit. Drie weken aan beide kanten. */
export const FREELANCER_ACTIVE_DAYS = 21

type Window = {
  backDays?: number
  forwardDays?: number
  now?: Date
  /** Afgerond werk meetellen. Standaard ja: voor de vraag 'heeft deze
   *  persoon recent voor ons gewerkt' is afgerond werk juist het bewijs.
   *  Voor 'wie draait er nú mee' wil je het soms uit. */
  includeDone?: boolean
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const DAY = 86400000

/** Alle member-id's met werk dat het venster raakt. */
export function membersWithWorkInWindow(projects: Project[], options: Window = {}): Set<string> {
  const {
    backDays = FREELANCER_ACTIVE_DAYS,
    forwardDays = FREELANCER_ACTIVE_DAYS,
    now = new Date(),
    includeDone = true,
  } = options

  const vanaf = dayStart(now) - backDays * DAY
  const tot   = dayStart(now) + forwardDays * DAY + (DAY - 1)

  const ids = new Set<string>()
  for (const project of projects) {
    if (!includeDone && project.status === 'done') continue
    const startIso = project.startDate ?? project.endDate
    const endIso   = project.endDate ?? project.startDate
    if (!startIso || !endIso) continue
    const start = new Date(startIso).getTime()
    const end   = new Date(endIso).getTime() + (DAY - 1)
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    // Overlapt het werk het venster? Iets dat vóór het venster begon en
    // er nog doorheen loopt telt dus ook mee.
    if (end < vanaf || start > tot) continue
    for (const ownerId of project.ownerIds) ids.add(ownerId)
  }
  return ids
}

/**
 * Is deze freelancer actief?
 *
 * Alleen bedoeld voor freelancers. Voor het eigen team blijft het
 * handmatige vinkje gelden: iemand die weggaat is weg, ook in een week
 * zonder geplande uren.
 */
export function isActiveFreelancer(memberId: string, actieveIds: Set<string>): boolean {
  return actieveIds.has(memberId)
}
