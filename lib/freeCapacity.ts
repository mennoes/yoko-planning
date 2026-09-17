/** Vrij blokkeert beschikbaarheid, onafhankelijk van eventueel ontbrekende
 * estHours op een agenda-item. */
export const FREE_DAY_HOURS = 8

export function blockedHoursForWorkdays(workdays: number): number {
  return Math.max(0, workdays) * FREE_DAY_HOURS
}
