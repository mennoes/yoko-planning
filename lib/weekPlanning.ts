export type InferredWeekPlanning = {
  week: number
  year: number
  startDate: string
  endDate: string
  estHours: number
}

function utcDate(value: string | Date): Date {
  if (value instanceof Date) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
  return new Date(`${value.slice(0, 10)}T12:00:00Z`)
}

export function isoWeekNumber(value: string | Date): number {
  const date = utcDate(value)
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function isoWeekYear(value: Date): number {
  const date = utcDate(value)
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  return date.getUTCFullYear()
}

function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Herkent o.a. "week 44", "wk 44" en "week 44 2027". */
export function inferWeekPlanning(name: string, now = new Date()): InferredWeekPlanning | null {
  const match = name.match(/\b(?:week|wk)\s*[-.:]?\s*(\d{1,2})(?:\s+(20\d{2}))?\b/i)
  if (!match) return null
  const week = Number(match[1])
  if (week < 1 || week > 53) return null

  const currentWeek = isoWeekNumber(now)
  let year = match[2] ? Number(match[2]) : isoWeekYear(now)
  // Rond de jaarwisseling betekent "week 2" doorgaans de eerstvolgende
  // week 2, niet eentje die bijna een jaar geleden was.
  if (!match[2] && week < currentWeek - 12) year += 1
  if (week > isoWeekNumber(`${year}-12-28`)) return null

  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Offset = (jan4.getUTCDay() + 6) % 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - jan4Offset + (week - 1) * 7)
  const friday = new Date(monday)
  friday.setUTCDate(monday.getUTCDate() + 4)

  return {
    week, year,
    startDate: formatUtc(monday),
    endDate: formatUtc(friday),
    estHours: 5 * 8,
  }
}

