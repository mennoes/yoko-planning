/** Vrij blokkeert beschikbaarheid, onafhankelijk van eventueel ontbrekende
 * estHours op een agenda-item. */
export const FREE_DAY_HOURS = 8

export function blockedHoursForWorkdays(workdays: number): number {
  return Math.max(0, workdays) * FREE_DAY_HOURS
}

/**
 * Hoeveel uur blokkeert een vrij-item in dit stuk van de periode?
 *
 * Standaard een hele werkdag per dag. Een vakantie is geen klus met een
 * urenschatting, en Google-items hebben vaak 0 uur staan — die zouden
 * anders helemaal uit de werkdruk verdwijnen.
 *
 * Maar staat er op een eigen item wél een aantal uren, dan telt dát.
 * Anders typ je in de popup een ander getal en verandert er niets aan de
 * bol: precies de verwarring waar dit voor is. Die uren gelden per
 * persoon, niet gedeeld door het aantal mensen — twee mensen die samen
 * een dag reizen zijn allebei die dag weg.
 *
 * Een nieuw item krijgt automatisch werkdagen × 8 uur, dus zonder
 * ingreep komt er hetzelfde getal uit als voorheen.
 */
export function vrijHoursForOverlap(options: {
  /** Werkdagen in het zichtbare stuk (week, dag, maand). */
  overlapWorkdays: number
  /** Werkdagen in de hele periode van het item. */
  totalWorkdays: number
  /** De uren die op dit item staan voor deze persoon, 0 als er niets staat. */
  ownHours: number
  /** Google blijft op de hele dag: die uren komen uit de afspraakduur en
   *  zijn geen keuze van de gebruiker. */
  allowOwnHours: boolean
}): number {
  const { overlapWorkdays, totalWorkdays, ownHours, allowOwnHours } = options
  if (!allowOwnHours || !(ownHours > 0) || totalWorkdays <= 0) {
    return blockedHoursForWorkdays(overlapWorkdays)
  }
  return Math.round((overlapWorkdays / totalWorkdays) * ownHours * 10) / 10
}
