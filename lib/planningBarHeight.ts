export type PlanningBarHeightInput = {
  hours: number
  startDate?: string | null
  endDate?: string | null
}

function countWorkdays(startDate?: string | null, endDate?: string | null): number {
  if (!startDate || !endDate) return 1
  const start = new Date(`${startDate.slice(0, 10)}T12:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1
  let workdays = 0
  for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay()
    if (weekday !== 0 && weekday !== 6) workdays++
  }
  return Math.max(1, workdays)
}

/**
 * Hoogte representeert de gemiddelde belasting per werkdag, niet het totale
 * projectbudget. Zo blijft 40u verspreid over maanden subtiel, terwijl 40u
 * in één werkweek nog steeds als een volle balk wordt getoond.
 */
export function planningBarHeightRatio({ hours, startDate, endDate }: PlanningBarHeightInput): number {
  const hoursPerWorkday = Math.max(0, Number(hours) || 0) / countWorkdays(startDate, endDate)
  const intensity = Math.min(1, hoursPerWorkday / 8)
  return 0.05 + 0.95 * intensity
}
