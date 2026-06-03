export type TeamMember = {
  id: string
  name: string
  weeklyCapacity: number
  color: string
}

export type Project = {
  id: string
  name: string
  board: string
  group?: string
  ownerIds: string[]
  startDate: string | null
  endDate: string | null
  // HH:MM strings (24-uurs) wanneer er een specifieke tijd bekend is —
  // Google-events met dateTime krijgen hem mee, all-day blijft null. De
  // Week-zoom in Planning gebruikt 'm voor uur-positionering.
  startTime?: string | null
  endTime?:   string | null
  estHours: number
  ownerHours?: Record<string, number>   // optional per-owner hours override
  status: 'active' | 'done'
  source?: 'manual' | 'google'
  externalLink?: string
  // Set on virtual projects produced by merging same-name Google items in
  // the planner. The detail panel uses it to render a sub-event list.
  mergedFrom?: Project[]
}

import { getBoardColor } from './boardsRegistry'
import type { BoardGroup } from './boards'
// Proxy zodat code als BOARD_COLORS[boardId] blijft werken, maar nu
// dynamisch op de registry. Toegevoegde borden krijgen hun eigen kleur
// uit de boards-tabel; onbekende keys vallen terug op grijs.
export const BOARD_COLORS = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) { return getBoardColor(prop) },
})

// Bouw een vlakke project-lijst uit bord-groepen. Subitems die hun eigen
// startDate/endDate hebben (typisch: recurring Google-events, één per
// instance) worden als afzonderlijke projects gerenderd zodat ze in de
// werkdruk-widget op de juiste dag landen met de juiste duur — anders
// zou bv. 'Weekstart (34×)' als één multi-week-project van 28 mrt t/m
// 24 mei tellen i.p.v. een half-uurtje per maandag.
//
// Subitems zonder eigen datums vallen onder de parent: we sommeren hun
// uren en gebruiken de parent-datums. Subitems met status='Done' slaan
// we over zodat afgevinkte instances niet meer in totalen meetellen.
export function groupsToProjects(boardName: string, groups: BoardGroup[]): Project[] {
  return groups.flatMap(g =>
    g.items
      .filter(i => Array.isArray(i.ownerIds) && (i.ownerIds as string[]).length > 0)
      .flatMap((i): Project[] => {
        const subs = (i.subitems as Array<{ id?: string; name?: string; estHours?: number; startDate?: string | null; endDate?: string | null; startTime?: string | null; endTime?: string | null; ownerIds?: string[]; status?: string }> | undefined) ?? []
        const subsWithDates = subs.filter(si => (si.status ?? '') !== 'Done' && (si.startDate || si.endDate))
        if (subsWithDates.length > 0) {
          return subsWithDates.map((si, idx): Project => {
            // Subitem-ownerIds gebruiken we alleen als 't ECHT toegewezen is
            // (niet leeg en niet alleen 'unassigned'). Anders valt-ie terug
            // op de parent-owners — anders telt een 'unassigned'-subitem 0u
            // voor de parent-owner in de werkdruk, terwijl de parent zelf
            // wel iemand als verantwoordelijke heeft staan. Bug die zorgde
            // dat items met onbenoemde subitems uit Home/Werkdruk vielen.
            const subOwners = (si.ownerIds ?? []).filter(o => o && o !== 'unassigned')
            const owners = subOwners.length > 0
              ? (si.ownerIds as string[])
              : (i.ownerIds as string[])
            return {
              id:        `${boardName}__${i.id}__si${idx}`,
              name:      `${i.name}${si.name ? ' · ' + si.name : ''}`,
              board:     boardName,
              group:     g.name,
              ownerIds:  owners,
              startDate: si.startDate ?? null,
              endDate:   si.endDate ?? si.startDate ?? null,
              startTime: si.startTime ?? null,
              endTime:   si.endTime ?? null,
              estHours:  Number(si.estHours) || 0,
              status:    (i.status as string) === 'Done' ? 'done' : 'active',
              source:    (i.source as 'manual' | 'google' | undefined),
              externalLink: (i.externalLink as string | undefined),
            }
          })
        }
        const activeSubs = subs.filter(si => (si.status ?? '') !== 'Done')
        const hours = activeSubs.length > 0
          ? activeSubs.reduce((s, si) => s + (Number(si.estHours) || 0), 0)
          : (Number(i.estHours) || 0)
        return [{
          id: `${boardName}__${i.id}`,
          name: i.name as string,
          board: boardName,
          group: g.name,
          ownerIds:  i.ownerIds  as string[],
          startDate: i.startDate as string | null,
          endDate:   i.endDate   as string | null,
          startTime: (i.startTime as string | null | undefined) ?? null,
          endTime:   (i.endTime   as string | null | undefined) ?? null,
          estHours:  hours,
          ownerHours: (i.ownerHours as Record<string, number> | undefined),
          status:    (i.status as string) === 'Done' ? 'done' : 'active',
          source:        (i.source as 'manual' | 'google' | undefined),
          externalLink:  (i.externalLink as string | undefined),
        }]
      })
  )
}

/** Returns the Monday of the week containing `date` */
export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

/** Returns an array of `count` week-start Dates, starting from `from` */
export function getWeeks(from: Date, count: number): Date[] {
  const start = getWeekStart(from)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i * 7)
    return d
  })
}

const NL_MONTHS = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

/** ISO week number (Mon = start of week) */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export type WeekLabel = {
  weekNum: string   // "W18"
  range: string     // "apr. 27 – 3"
  weekStart: Date
  isCurrentWeek: boolean
}

export function getWeekLabel(weekStart: Date): WeekLabel {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  const startDay   = weekStart.getDate()
  const startMonth = NL_MONTHS[weekStart.getMonth()]
  const endDay     = weekEnd.getDate()
  const endMonth   = NL_MONTHS[weekEnd.getMonth()]

  const range =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${startMonth}. ${startDay} – ${endDay}`
      : `${startMonth}. ${startDay} – ${endDay} ${endMonth}.`

  const now = new Date()
  const isCurrentWeek =
    weekStart <= now && now < new Date(weekStart.getTime() + 7 * 86400000)

  return {
    weekNum: `W${isoWeekNumber(weekStart)}`,
    range,
    weekStart,
    isCurrentWeek,
  }
}

export type ProjectContribution = {
  project: Project
  hours: number
}

// Telt het aantal werkdagen (Ma-Vr) tussen twee datums inclusief beide
// uiteinden. Werk-items vallen NOOIT in 't weekend bij de werkdruk-
// distributie — anders zou een vrijdag-pizzasessie de helft van z'n uren
// naar zaterdag schuiven. Gebruikt door zowel projectHoursInWeek als
// hoursInRange.
function countWorkdays(startMs: number, endMs: number): number {
  if (endMs < startMs) return 0
  let count = 0
  const oneDay = 86400000
  // Loop dag-voor-dag op middernacht zodat een Saturday partial range niet
  // halfgeteld wordt.
  const start = new Date(startMs)
  start.setHours(0, 0, 0, 0)
  const end = new Date(endMs)
  end.setHours(0, 0, 0, 0)
  for (let t = start.getTime(); t <= end.getTime(); t += oneDay) {
    const dow = new Date(t).getDay()  // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

/**
 * Hours a specific project contributes to `memberId` in the week starting `weekStart`.
 * Hours are distributed evenly across WORKING DAYS (Mon-Fri) of the project timeline,
 * then the overlap with the given week is taken, split equally among owners.
 */
export function projectHoursInWeek(
  project: Project,
  memberId: string,
  weekStart: Date,
): number {
  if (!project.ownerIds.includes(memberId)) return 0
  if (project.estHours === 0) return 0
  if (!project.startDate || !project.endDate) return 0

  // Per-owner override: if ownerHours[memberId] is set, that's this owner's
  // share. Otherwise split estHours evenly across owners.
  const myShare = project.ownerHours && memberId in project.ownerHours
    ? Number(project.ownerHours[memberId]) || 0
    : project.estHours / Math.max(project.ownerIds.length, 1)
  if (myShare === 0) return 0

  const pStart = new Date(project.startDate)
  const pEnd   = new Date(project.endDate)
  pEnd.setHours(23, 59, 59, 999)

  const wStart = new Date(weekStart)
  const wEnd   = new Date(weekStart)
  wEnd.setDate(wEnd.getDate() + 6)
  wEnd.setHours(23, 59, 59, 999)

  // No overlap
  if (wEnd < pStart || wStart > pEnd) return 0

  const overlapStart = wStart > pStart ? wStart : pStart
  const overlapEnd   = wEnd   < pEnd   ? wEnd   : pEnd

  // Verdeling alleen over werkdagen — weekenden krijgen 0u uit een
  // project. Als 't project alleen weekend overspant (zeldzaam) krijgen
  // we 0u terug, wat klopt: 't werk valt simpelweg niet in werkdagen.
  const totalWork  = countWorkdays(pStart.getTime(), pEnd.getTime())
  const overlapWork = countWorkdays(overlapStart.getTime(), overlapEnd.getTime())
  if (totalWork === 0) return 0

  const fraction        = overlapWork / totalWork
  const result          = fraction * myShare

  return Math.round(result * 10) / 10
}

/** All project contributions for one member in one week */
export function memberContributions(
  projects: Project[],
  memberId: string,
  weekStart: Date,
): ProjectContribution[] {
  return projects
    .map(p => ({ project: p, hours: projectHoursInWeek(p, memberId, weekStart) }))
    .filter(c => c.hours > 0)
}

/** Total hours for one member in one week */
export function memberTotalHours(
  projects: Project[],
  memberId: string,
  weekStart: Date,
): number {
  return memberContributions(projects, memberId, weekStart)
    .reduce((s, c) => s + c.hours, 0)
}
