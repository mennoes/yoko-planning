// ISO weekday: 1 = maandag, ... 7 = zondag.
export function isoWeekday(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

/** Sluit de werkweek af na de laatste ingestelde werkdag om 18:00. */
export function isWorkWeekFinished(now: Date, daysOff: number[], endHour = 18): boolean {
  const off = new Set(daysOff)
  const workingDays = [1, 2, 3, 4, 5].filter(day => !off.has(day))
  if (workingDays.length === 0) return false

  const lastWorkingDay = workingDays[workingDays.length - 1]
  const currentDay = isoWeekday(now)
  return currentDay > lastWorkingDay
    || (currentDay === lastWorkingDay && now.getHours() >= endHour)
}
