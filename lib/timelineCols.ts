// De kolom-indeling van een tijdlijn: welke kolommen zijn er, hoe breed,
// en waar op de x-as valt een datum.
//
// Stond in app/planning/page.tsx. Nu ook nodig voor de Tijdlijn-weergave
// van één agenda, en het is pure rekenkunde zonder React — dus hier, waar
// beide pagina's 'm kunnen gebruiken en er tests op kunnen.

import { getWeeks, getWeekLabel } from './workload'

export type ZoomLevel = 'dag' | 'week' | 'maand'

export type Col = {
  key: string
  rangeStart: Date
  rangeEnd:   Date
  label1:     string
  label2:     string
  widthPx:    number
  isCurrent:  boolean
  isPast:     boolean
}

export const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
export const NL_DAY = ['zo','ma','di','wo','do','vr','za']

export const ZOOM_COL_W: Record<ZoomLevel, number> = { dag: 200, week: 104, maand: 120 }
export const ZOOM_COUNT: Record<ZoomLevel, number> = { dag: 56, week: 104, maand: 48 }
/** Hoeveel kolommen historie we vóór vandaag tekenen bij het openen. */
export const HISTORY_BACK: Record<ZoomLevel, number> = { dag: 28, week: 26, maand: 18 }

export function getWeekCols(from: Date, count: number, colW: number): Col[] {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return getWeeks(from, count).map(ws => {
    const we  = new Date(ws); we.setDate(ws.getDate() + 6); we.setHours(23,59,59,999)
    const lbl = getWeekLabel(ws)
    return { key: ws.toISOString(), rangeStart: ws, rangeEnd: we,
      label1: lbl.weekNum, label2: lbl.range, widthPx: colW, isCurrent: lbl.isCurrentWeek,
      isPast: we.getTime() < today.getTime() }
  })
}

export function getMonthCols(from: Date, count: number, colW: number): Col[] {
  const cols: Col[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const ms = new Date(d)
    const me = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
    cols.push({ key: ms.toISOString(), rangeStart: ms, rangeEnd: me,
      label1: NL_MON[ms.getMonth()].toUpperCase(),
      label2: String(ms.getFullYear()),
      widthPx: colW,
      isCurrent: now >= ms && now <= me,
      isPast: me.getTime() < now.getTime() })
    d.setMonth(d.getMonth() + 1)
  }
  return cols
}

export function getDayCols(from: Date, count: number, colW: number): Col[] {
  // Week-view toont werkdagen (ma–vr) als volle kolommen en za+zo
  // samengevoegd in één smalle 'we'-kolom — zo blijft de week-grens
  // visueel intact maar slokt weekendwerk niet onnodig veel ruimte op.
  const WEEKEND_W = Math.max(28, Math.round(colW * 0.35))
  const cols: Col[] = []
  const today = new Date(); today.setHours(0,0,0,0)
  let added = 0, offset = 0
  while (added < count) {
    const ds = new Date(from); ds.setDate(from.getDate() + offset); ds.setHours(0,0,0,0)
    const dow = ds.getDay() // 0=zo, 6=za
    if (dow === 6) {
      // Zaterdag: één combo-kolom voor za + zo. Range loopt t/m
      // zondag 23:59 zodat hours-in-range beide dagen capteert.
      const zo = new Date(ds); zo.setDate(ds.getDate() + 1); zo.setHours(23,59,59,999)
      const isCurrent = today >= ds && today <= zo
      cols.push({ key: ds.toISOString(), rangeStart: ds, rangeEnd: zo,
        label1: 'we',
        label2: `${ds.getDate()}/${zo.getDate()}`,
        widthPx: WEEKEND_W,
        isCurrent,
        isPast: zo.getTime() < today.getTime() })
      offset += 2
      added++
      continue
    }
    if (dow === 0) { offset++; continue } // zondag los: skip (al gecoverd door za)
    const de = new Date(ds); de.setHours(23,59,59,999)
    cols.push({ key: ds.toISOString(), rangeStart: ds, rangeEnd: de,
      label1: NL_DAY[ds.getDay()],
      label2: String(ds.getDate()),
      widthPx: colW,
      isCurrent: ds.getTime() === today.getTime(),
      isPast: de.getTime() < today.getTime() })
    added++
    offset++
  }
  return cols
}

export function buildCols(zoom: ZoomLevel, from: Date, colW: number): Col[] {
  const count = ZOOM_COUNT[zoom]
  if (zoom === 'maand') return getMonthCols(from, count, colW)
  if (zoom === 'dag')   return getDayCols(from, count, colW)
  return getWeekCols(from, count, colW)
}

/** Maandkoppen boven de week- en dagkolommen. */
export function getMonthGroupsFromCols(cols: Col[]): { label: string; count: number; widthPx: number }[] {
  const groups: { label: string; count: number; widthPx: number }[] = []
  for (const col of cols) {
    const d     = col.rangeStart
    const label = `${NL_MON[d.getMonth()].toUpperCase()}. ${d.getFullYear()}`
    const last  = groups[groups.length - 1]
    if (last?.label === label) { last.count++; last.widthPx += col.widthPx }
    else groups.push({ label, count: 1, widthPx: col.widthPx })
  }
  return groups
}

/**
 * Waar valt een datum op de x-as, in pixels vanaf het begin van het raster?
 *
 * In week-zoom tekenen we binnen elke weekkolom alleen ma–vr; zaterdag en
 * zondag klappen naar het einde van vrijdag, zodat een weekend geen
 * horizontale ruimte opslokt.
 */
export function dateToWeekPx(d: Date, gridStart: Date, weekColW: number): number {
  // Kalenderdagen, geen verstreken milliseconden. Het raster begint maanden
  // vóór vandaag; zit daar een zomer-/wintertijdgrens tussen, dan is
  // getTime() een uur korter of langer dan N × 24u en schuift alles na die
  // grens een hele dagsleuf op. Date.UTC op alleen Y/M/D is DST-neutraal.
  const calendarDay = (value: Date) => Date.UTC(
    value.getFullYear(), value.getMonth(), value.getDate(),
  ) / 86400000
  const days = calendarDay(d) - calendarDay(gridStart)
  const weekIdx = Math.floor(days / 7)
  const dowMon = ((days % 7) + 7) % 7  // 0=ma..6=zo (gridStart is een maandag)
  const cellInWeek = Math.min(dowMon, 5) // za/zo klappen naar het kolomeinde
  return weekIdx * weekColW + (cellInWeek / 5) * weekColW
}

/**
 * Waar valt een datum in dit kolomraster, in pixels vanaf links?
 *
 * Werkt voor elke zoom: zoek de kolom waar de datum in valt en interpoleer
 * binnen die kolom. Valt de datum vóór of na het raster, dan komt er null
 * uit — de aanroeper beslist dan zelf of hij afkapt of niets tekent.
 */
export function dateToPx(cols: Col[], date: Date): number | null {
  if (cols.length === 0) return null
  const t = date.getTime()
  let x = 0
  for (const col of cols) {
    const start = col.rangeStart.getTime()
    const eind  = col.rangeEnd.getTime()
    if (t < start) return x          // vóór deze kolom: begin van de kolom
    if (t <= eind) {
      const deel = (t - start) / Math.max(1, eind - start)
      return x + deel * col.widthPx
    }
    x += col.widthPx
  }
  return null                         // voorbij het raster
}

/**
 * Een balk van start tot eind, afgekapt op de randen van het raster.
 * Geeft null als de periode helemaal buiten beeld valt, zodat er geen
 * balk van nul pixels blijft hangen.
 */
export function rangeToPx(cols: Col[], start: Date, eind: Date): { left: number; width: number } | null {
  if (cols.length === 0) return null
  const gridStart = cols[0].rangeStart.getTime()
  const gridEnd   = cols[cols.length - 1].rangeEnd.getTime()
  const van = start.getTime()
  const tot = Math.max(eind.getTime(), van)
  if (tot < gridStart || van > gridEnd) return null

  const totaleBreedte = cols.reduce((som, col) => som + col.widthPx, 0)
  const links = van < gridStart ? 0 : (dateToPx(cols, start) ?? 0)
  const rechts = tot > gridEnd ? totaleBreedte : (dateToPx(cols, new Date(tot)) ?? totaleBreedte)
  // Minimaal een paar pixels, anders is een klus van één dag in maandzoom
  // onzichtbaar.
  return { left: links, width: Math.max(4, rechts - links) }
}
