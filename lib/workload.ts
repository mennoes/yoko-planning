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
  estHours: number
  ownerHours?: Record<string, number>   // optional per-owner hours override
  status: 'active' | 'done'
  source?: 'manual' | 'google'
  externalLink?: string
}

export const BOARD_COLORS: Record<string, string> = {
  yoko:       '#579bfc',
  pnp:        '#e2445c',
  nederland:  '#9c7ee8',
  vlaanderen: '#ff7a00',
  dienjaar:   '#00c875',
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

/**
 * Hours a specific project contributes to `memberId` in the week starting `weekStart`.
 * Hours are distributed evenly across all calendar days of the project timeline,
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

  const totalMs   = pEnd.getTime()   - pStart.getTime()
  const overlapMs = overlapEnd.getTime() - overlapStart.getTime()

  const fraction        = overlapMs / totalMs
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
