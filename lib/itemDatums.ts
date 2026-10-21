// Welke periode geldt er voor een item met subitems?
//
// Lang was het antwoord: de subitems, altijd — tenzij je in de datumcel
// zelf iets koos (datesOverride). Dat pakte verkeerd uit zodra je eerst
// een periode op het item zette en er daarna een kort subitem in hing:
// dat ene subitem van twee dagen kaapte dan de hele klus van acht weken,
// zonder dat je er iets voor deed.
//
// De regel is nu zo saai mogelijk: heeft het item zelf datums, dan gelden
// die. Haal je ze weg, dan valt hij terug op de omspanning van de
// subitems. Eén plek, zodat de lijst, de sortering en de Tijdlijn
// hetzelfde antwoord geven.

export type DatumBron = 'eigen' | 'subitems' | 'geen'

type SubLike = { status?: string; startDate?: string | null; endDate?: string | null }
type ItemLike = {
  startDate?: string | null
  endDate?:   string | null
  subitems?:  SubLike[] | null
  /** 'google' betekent: de datums op dit item worden door de agenda-sync
   *  geschreven, niet door jou. */
  source?:    string | null
  /** Staat alleen op true als iemand de periode zelf heeft ingevuld. */
  datesOverride?: boolean
}

/**
 * Heeft dit item een periode die iemand er zelf op heeft gezet?
 *
 * Voor een gewoon item is dat simpel: staat er een datum, dan heb jij 'm
 * erop gezet. Bij een Google-serie niet: daar schrijft de sync elke keer
 * de omspanning van de instances op het hoofditem, dus 'er staat een
 * datum' zegt niets. Alleen als je 'm in de datumcel hebt overschreven
 * (datesOverride) is het een eigen periode — anders volgt hij gewoon de
 * subitems, en hoort er ook geen ↺-knop bij te staan.
 */
function heeftEigenPeriode(item: ItemLike): boolean {
  if (!item.startDate && !item.endDate) return false
  if (item.source === 'google') return item.datesOverride === true
  return true
}

/**
 * De omspanning van de subitems, of null als die er geen datums hebben.
 *
 * Done-subitems tellen niet mee: anders blijft een klus op 20 mei staan
 * terwijl al het resterende werk pas in juni begint. Zijn ze állemaal
 * af, dan vallen we terug op de hele set — een lege periode is minder
 * bruikbaar dan een verlopen periode.
 */
function uitSubitems(item: ItemLike): { startDate: string; endDate: string } | null {
  const alle   = item.subitems ?? []
  const actief = alle.filter(sub => sub.status !== 'Done')
  const bron   = actief.length > 0 ? actief : alle

  const starts = bron.map(sub => sub.startDate).filter((d): d is string => !!d).sort()
  const einden = bron.map(sub => sub.endDate).filter((d): d is string => !!d).sort()
  if (starts.length === 0 && einden.length === 0) return null
  return {
    startDate: starts[0] ?? einden[0],
    endDate:   einden[einden.length - 1] ?? starts[starts.length - 1],
  }
}

/** De periode van een item, en waar die vandaan komt. */
export function itemDatums(item: ItemLike): {
  startDate: string | null
  endDate:   string | null
  bron:      DatumBron
} {
  const eigenStart = item.startDate ?? null
  const eigenEind  = item.endDate ?? null
  const eigen = {
    startDate: eigenStart ?? eigenEind,
    endDate:   eigenEind ?? eigenStart,
    bron: 'eigen' as const,
  }
  if (heeftEigenPeriode(item)) return eigen

  const geleend = uitSubitems(item)
  if (!geleend) {
    // Geen subitems om op terug te vallen. Heeft het item zelf wel datums
    // (een Google-afspraak zonder instances), dan zijn die alles wat er is.
    return eigen.startDate ? eigen : { startDate: null, endDate: null, bron: 'geen' }
  }
  return { ...geleend, bron: 'subitems' }
}

/**
 * Valt er iets terug te vallen op de subitems?
 *
 * Staan er wel subitems onder maar hebben die geen datums, dan is er
 * niets om de periode van het hoofditem uit af te leiden. Een ↺ naast
 * de datumcel zou dan alleen de periode leeghalen en er niets voor
 * terugzetten — dus die hoort er in dat geval niet te staan.
 */
export function subitemsGevenPeriode(item: ItemLike): boolean {
  return uitSubitems(item) !== null
}

/** Volgt dit item (nog) automatisch zijn subitems? Bepaalt of de datumcel
 *  uitlegt dat je een eigen periode kunt zetten, of juist hoe je terug
 *  gaat naar automatisch. */
export function volgtSubitems(item: ItemLike): boolean {
  return (item.subitems?.length ?? 0) > 0 && itemDatums(item).bron !== 'eigen'
}
