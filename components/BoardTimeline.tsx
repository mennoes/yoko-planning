'use client'

// Tijdlijn: dezelfde agenda, maar als balken over de tijd in plaats van
// rijen onder elkaar.
//
// Het verschil met /planning is wat een rij betekent. Daar is een rij een
// persoon ('wie heeft het te druk'), hier een item ('wat loopt wanneer').
// Dezelfde kolom-rekenkunde (lib/timelineCols.ts), andere vraag.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BoardGroup, BoardItem, SubItem } from '@/lib/boards'
import {
  getWeekCols, getDayCols, getMonthCols, getMonthGroupsFromCols, rangeToPx, dateToPx, pxNaarDagen, lokaleIso,
  type ZoomLevel,
} from '@/lib/timelineCols'
import { sortSubitems, type AgendaSort } from '@/lib/sortSubitems'
import { useTeam } from './TeamContext'
import DeadlineFlag from './DeadlineFlag'
import { UserAvatar } from './UserAvatar'
import { getWeekStart } from '@/lib/workload'
import { werkdagenIn } from '@/lib/sjabloonPlan'
import { planningBarHeightRatio, planningBarPixelHeight } from '@/lib/planningBarHeight'
import { timelineEffort, isWaitingStatus, nextClientMoment } from '@/lib/timelineEffort'
import { itemDatums } from '@/lib/itemDatums'

// Same palette as the status pickers in Planning and the agenda.
function timelineStatusColor(status: string): string {
  if (status === 'Done') return '#00c875'
  if (/^working on/i.test(status)) return '#ff7b24'
  if (status === 'Stuck') return '#e2445c'
  if (status === 'Doorlopend') return '#579bfc'
  return '#808080'
}

const NAAM_W = 290
const RIJ_H  = 30
const OUDER_RIJ_H = 36
const BALK_H = 20
/** Een ouder met subitems is een samenvatting, geen werk op zich. Zijn
 *  balk is daarom een dun grijs streepje boven de subitems: je ziet de
 *  omspanning, maar je blik gaat naar de regels eronder. */
const OUDER_H = 22
/** Tot hoever je terug kunt scrollen voordat we stoppen met bijladen. */
const MAX_EXTRA_TERUG = 730

/** '· 120u' achter een groepskop. */
function urenVanGroep(items: BoardItem[]): string {
  const totaal = items.reduce((som, item) => som + timelineEffort(item).hours, 0)
  const afgerond = Math.round(totaal * 10) / 10
  return afgerond > 0 ? ` · ${afgerond}u` : ''
}

/** Een groep die 'Done…' heet is een archief; daar staat per definitie
 *  alleen afgerond werk in. Zelfde regel als in de lijst. */
export function isArchiefGroep(naam: string): boolean {
  return naam.toLowerCase().trim().startsWith('done')
}

/** Is dit item klaar? De lijst stopt deze in een ingeklapt 'Afgerond'-blok;
 *  de tijdlijn laat ze standaard weg. Zonder dit stond een agenda met 81
 *  afgeronde items vol met balken waar je niets meer aan hebt. */
export function isAfgerond(item: BoardItem, groepsNaam: string): boolean {
  if (isArchiefGroep(groepsNaam)) return true
  return item.status === 'Done'
}

/** De getoonde periode van een item. Zelfde regel als in de lijst: eigen
 *  datums winnen, en pas als die er niet zijn telt de omspanning van de
 *  subitems. */
export function itemPeriode(item: BoardItem): { van: Date; tot: Date } | null {
  const { startDate, endDate } = itemDatums(item)
  const datums = [startDate, endDate].filter((d): d is string => !!d).sort()
  if (datums.length === 0) return null
  const van = new Date(`${datums[0]}T00:00:00`)
  const tot = new Date(`${datums[datums.length - 1]}T23:59:59`)
  if (Number.isNaN(van.getTime()) || Number.isNaN(tot.getTime())) return null
  return { van, tot }
}

/** De periode van één subitem. Anders dan bij een item kijken we hier
 *  niet verder omlaag: een subitem heeft zelf datums of het heeft ze niet. */
export function subPeriode(sub: SubItem): { van: Date; tot: Date } | null {
  const datums = [sub.startDate, sub.endDate].filter((d): d is string => !!d)
  if (datums.length === 0) return null
  const gesorteerd = [...datums].sort()
  const van = new Date(`${gesorteerd[0]}T00:00:00`)
  const tot = new Date(`${gesorteerd[gesorteerd.length - 1]}T23:59:59`)
  if (Number.isNaN(van.getTime()) || Number.isNaN(tot.getTime())) return null
  return { van, tot }
}

/** Eén regel in het raster: een item, of een subitem van dat item. */
export type TijdlijnRegel = {
  key: string
  itemId: string
  subitemId?: string
  naam: string
  ownerIds: string[]
  periode: { van: Date; tot: Date }
  /** Een uitgeklapte ouder. Die regel is een samenvatting van de regels
   *  eronder, geen werk op zich — vandaar het dunne grijze streepje. */
  isOuder: boolean
  /** Hoeveel subitems met datums eronder zitten. Boven nul betekent: deze
   *  regel is uit of in te klappen, en naast de naam staat een bolletje
   *  met dit aantal. */
  subAantal: number
  /** Losse stukjes in plaats van één doorlopende balk. Komt de periode
   *  van een ingeklapt item alleen uit zijn subitems, dan zou één balk
   *  van oktober tot maart iets beweren wat niet waar is: er wordt alleen
   *  gewerkt op de dagen van de subitems. */
  segmenten?: { van: Date; tot: Date; id: string; name: string; hours: number; status: string }[]
  isDone: boolean
  deadline?: string | null
  hours: number
  missingEstimates: number
  status: string
  projectDeadline?: string | null
  nextMoment?: { name: string; deadline: string }
}

/**
 * Zet items om in regels.
 *
 * Een item met subitems staat standaard ingeklapt: één gewone balk in de
 * groepskleur, met een bolletje dat zegt hoeveel er onder zit. Klap je 'm
 * uit, dan krijgt elk subitem een eigen regel onder de projectsamenvatting.
 */
export function bouwRegels(
  metDatum: { item: BoardItem; periode: { van: Date; tot: Date } }[],
  opties: { toonAfgerond: boolean; rasterStart: Date; uitgeklapt?: Set<string>; sortBy?: AgendaSort; ownerName?: (id:string)=>string },
): TijdlijnRegel[] {
  const regels: TijdlijnRegel[] = []
  for (const { item, periode } of metDatum) {
    const subOrder = opties.sortBy === undefined ? item.subitems ?? [] : sortSubitems(item.subitems ?? [], opties.sortBy, opties.ownerName ?? (id => id))
    const allDatedSubs = subOrder
      .map(sub => ({ sub, periode: subPeriode(sub) }))
      .filter((e): e is { sub: SubItem; periode: { van: Date; tot: Date } } => e.periode !== null)
      // Een subitem dat helemaal vóór het raster ligt heeft geen balk en
      // dus geen regel — zelfde regel als voor items.
      .filter(e => e.periode.tot >= opties.rasterStart)
      .sort((a, b) => opties.sortBy === undefined ? a.periode.van.getTime() - b.periode.van.getTime() : 0)
    const subs = allDatedSubs.filter(({sub}) => opties.toonAfgerond || sub.status !== 'Done')
    const open = subs.length > 0 && (opties.uitgeklapt?.has(item.id) ?? false)
    const effort = timelineEffort(item)
    const moment = nextClientMoment(item.subitems, lokaleIso(new Date()))
    regels.push({
      hours: effort.hours, missingEstimates: effort.missing, status: item.status,
      nextMoment: moment?.deadline ? { name: moment.name, deadline: moment.deadline } : undefined,
      key: item.id, itemId: item.id, naam: item.name || '(naamloos)',
      ownerIds: item.ownerIds ?? [], periode, deadline: item.deadline,
      isOuder: open, subAantal: subs.length, isDone: item.status === 'Done',
      ...(item.subitems?.length ? { segmenten: allDatedSubs.map(({sub,periode}) => ({...periode,id:sub.id,name:sub.name,hours:Math.max(0,Number(sub.estHours)||0),status:sub.status})) } : {}),
    })
    if (!open) continue
    for (const { sub, periode: subTijd } of subs) {
      regels.push({
        hours: Math.max(0, Number(sub.estHours) || 0), missingEstimates: Number(sub.estHours) > 0 ? 0 : 1,
        status: sub.status, projectDeadline: item.deadline,
        key: `${item.id}:${sub.id}`, itemId: item.id, subitemId: sub.id,
        naam: sub.name || '(naamloos)', ownerIds: sub.ownerIds ?? [], periode: subTijd,
        isOuder: false, subAantal: 0, isDone: sub.status === 'Done', deadline: sub.deadline,
      })
    }
  }
  return regels
}

export default function BoardTimeline({ groups, color, onOpenItem, onMoveItem, sortBy }: {
  groups: BoardGroup[]
  sortBy?: AgendaSort
  color: string
  /** Klikken op een balk opent de item-popup, desnoods op een subitem. */
  onOpenItem: (itemId: string, subitemId?: string) => void
  /** Slepen verzet de datums. Zonder dit kun je hier alleen kijken, en dan
   *  is de tijdlijn een slechtere versie van de planning. */
  onMoveItem: (itemId: string, startDate: string, endDate: string, subitemId?: string) => void
}) {
  const { members } = useTeam()
  const ownerName = (id:string) => members.find(m => m.id===id)?.name ?? id
  // Wat er nú gesleept wordt, zodat de balk meteen meebeweegt in plaats
  // van pas te springen als je loslaat. De sleutel is de rij, niet het
  // item: een ouder en zijn subitems staan allemaal op dezelfde item-id.
  const [sleep, setSleep] = useState<
    { rijKey: string; soort: 'heel' | 'start' | 'eind'; dagen: number } | null>(null)
  // Na een sleep volgt er ook een click. Zonder dit vlaggetje opende de
  // popup zodra je losliet — en die ligt dan over de balk heen, dus je
  // kon niet twee keer achter elkaar slepen.
  const netGesleept = useRef(false)
  const [hoverItem, setHoverItem] = useState<string | null>(null)
  // Welke items hun subitems laten zien. Standaard staat alles dicht: zo
  // blijft het raster een overzicht, en haal je er pas detail bij als je
  // er om vraagt.
  const [uitgeklapt, setUitgeklapt] = useState<Set<string>>(new Set())
  const klapOmgekeerd = (itemId: string) => setUitgeklapt(vorige => {
    const volgende = new Set(vorige)
    if (volgende.has(itemId)) volgende.delete(itemId); else volgende.add(itemId)
    return volgende
  })
  // Welke groepen je uit beeld hebt gehaald. Leeg = alles zichtbaar.
  const [ingeklapteGroepen, setIngeklapteGroepen] = useState<Set<string>>(new Set())
  const toggleGroep = (id: string) => setIngeklapteGroepen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const [verborgenGroepen, setVerborgenGroepen] = useState<Set<string>>(new Set())
  // Hoeveel extra historie er is bijgeladen door naar links te scrollen.
  const [extraTerug, setExtraTerug] = useState(0)
  const ladenBezig = useRef(false)
  /** Kijkpositie van vlak vóór het bijladen: hoe ver je gescrold was, en
   *  welke kolom toen helemaal links stond. Aan die kolom hangen we het
   *  beeld daarna weer op. */
  const herstelRef = useRef<{ scrollLeft: number; eersteKolom: string } | null>(null)
  const [zoom, setZoom] = useState<ZoomLevel>('week')
  const scrollRef = useRef<HTMLDivElement>(null)
  const naarVandaagGescrold = useRef(false)
  const [isPanning, setIsPanning] = useState(false)
  const panCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => panCleanup.current?.(), [])

  // Native two-finger scrolling stays untouched. Drag empty grid space to
  // browse, while bars and controls keep their own interactions.
  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType !== 'mouse') return
    if ((event.target as HTMLElement).closest('button, [role="button"], input, select, textarea, a, [draggable="true"]')) return
    const el = event.currentTarget
    const bounds = el.getBoundingClientRect()
    if (event.clientX >= bounds.left + el.clientWidth || event.clientY >= bounds.top + el.clientHeight) return
    event.preventDefault()
    panCleanup.current?.()
    let lastX = event.clientX
    const pointerId = event.pointerId
    setIsPanning(true)
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      // Incremental deltas also work when earlier weeks are prepended.
      el.scrollLeft += lastX - e.clientX
      lastX = e.clientX
    }
    const stop = () => { cleanup(); setIsPanning(false) }
    const end = (e: PointerEvent) => { if (e.pointerId === pointerId) stop() }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', stop)
      panCleanup.current = null
    }
    panCleanup.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', stop)
  }

  const [toonAfgerond, setToonAfgerond] = useState(false)
  const [toonEerder, setToonEerder] = useState(false)

  const [scrollX, setScrollX] = useState<number | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const zoomAnchor = useRef<{ center: number; oldWidth: number } | null>(null)
  const [viewportWidth, setViewportWidth] = useState(1100)
  const [extraVooruit, setExtraVooruit] = useState(0)
  const [toonMomenten, setToonMomenten] = useState(true)
  const dragCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanup.current?.(), [])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    observer.observe(el)
    setViewportWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])
  const baseColW = Math.max(zoom === 'dag' ? 54 : 110, (viewportWidth - NAAM_W) / (zoom === 'week' ? 4 : zoom === 'maand' ? 6 : 6))
  const colW = baseColW * zoomScale
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]') || document.querySelector('[role="dialog"]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (dragCleanup.current || !['+','=','-','_'].includes(e.key)) return
      e.preventDefault()
      const el = scrollRef.current
      if (!el) return
      zoomAnchor.current = {center:el.scrollLeft + (el.clientWidth - NAAM_W)/2,oldWidth:colW}
      setZoomScale(value => Math.max(.25,Math.min(4,Math.round((value + (e.key === '+' || e.key === '=' ? .1 : -.1))*100)/100)))
    }
    window.addEventListener('keydown',onKey)
    return () => window.removeEventListener('keydown',onKey)
  },[colW])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !zoomAnchor.current) return
    const anchor = zoomAnchor.current
    el.scrollLeft = Math.max(0,anchor.center * colW / anchor.oldWidth - (el.clientWidth - NAAM_W)/2)
    zoomAnchor.current = null
    setScrollX(el.scrollLeft)
  },[colW])

  // Afgerond werk hoort hier standaard niet thuis: de tijdlijn gaat over
  // wat loopt en wat eraan komt. Je kunt het erbij zetten, en we laten
  // altijd zien hoeveel er verborgen is — stilletjes minder tonen is hoe
  // je denkt dat items verdwenen zijn.
  const relevant = useMemo(() => groups
    .filter(groep => !verborgenGroepen.has(groep.id))
    .map(groep => ({
      groep,
      items: groep.items.filter(item => toonAfgerond || !isAfgerond(item, groep.name)),
    })), [groups, toonAfgerond, verborgenGroepen])

  const afgerondAantal = useMemo(() => groups.reduce((som, groep) =>
    som + groep.items.filter(item => isAfgerond(item, groep.name)).length, 0), [groups])

  const zonderDatum = relevant.flatMap(({ groep, items }) =>
    items.filter(item => itemPeriode(item) === null).map(item => ({ groep, item })))

  // Waar begint het raster? Standaard drie weken terug. Liet ik het bij het
  // vroegste item beginnen, dan kreeg je een raster van een jaar breed en
  // stonden de meeste balken links buiten beeld: een muur van lege rijen
  // bij vandaag. Werk dat helemaal in het verleden ligt hoort daarom niet
  // in het raster maar in een eigen blokje eronder — tenzij je het opvraagt.
  const vensterStart = useMemo(() => {
    const vandaag = new Date()
    const drieWekenTerug = new Date(vandaag)
    drieWekenTerug.setDate(vandaag.getDate() - 21 - extraTerug)
    if (!toonEerder && !toonAfgerond) return drieWekenTerug

    const vroegste = relevant
      .flatMap(({ items }) => items.map(itemPeriode))
      .filter((p): p is { van: Date; tot: Date } => p !== null)
      .reduce<Date | null>((min, p) => (min === null || p.van < min ? p.van : min), null)
    const jaarTerug = new Date(vandaag); jaarTerug.setFullYear(vandaag.getFullYear() - 1)
    if (!vroegste || vroegste > drieWekenTerug) return drieWekenTerug
    return vroegste < jaarTerug ? jaarTerug : vroegste
  }, [relevant, toonEerder, toonAfgerond, extraTerug])

  const cols = useMemo(() => {
    const start = zoom === 'maand'
      ? new Date(vensterStart.getFullYear(), vensterStart.getMonth(), 1)
      : new Date(getWeekStart(vensterStart))
    if (zoom === 'maand') return getMonthCols(start, 48 + Math.ceil(extraTerug / 28) + extraVooruit, colW)
    if (zoom === 'dag') return getDayCols(start, 56 + extraTerug + extraVooruit, colW)
    return getWeekCols(start, 104 + Math.ceil(extraTerug / 7) + extraVooruit, colW)
  }, [zoom, colW, vensterStart, extraTerug, extraVooruit])

  const isVisiblePeriod = (period: {van:Date;tot:Date}) => {
    if (scrollX === null) return true
    const pixels = rangeToPx(cols,period.van,period.tot)
    return !!pixels && pixels.left + pixels.width > scrollX && pixels.left < scrollX + viewportWidth - NAAM_W
  }
  const itemVisible = (item: BoardItem, period: {van:Date;tot:Date}) => item.subitems?.length
    ? item.subitems.some(sub => {const p = subPeriode(sub); return p && isVisiblePeriod(p)})
    : isVisiblePeriod(period)

  /** Ligt dit werk helemaal vóór het raster? Dan heeft een rij geen balk en
   *  dus geen betekenis. */
  const valtEerder = (item: BoardItem): boolean => {
    const periode = itemPeriode(item)
    if (!periode) return false
    return periode.tot < (cols[0]?.rangeStart ?? vensterStart)
  }

  const eerder = relevant.flatMap(({ groep, items }) =>
    items.filter(valtEerder).map(item => ({ groep, item })))

  const regelsVan = (metDatum: { item: BoardItem; periode: { van: Date; tot: Date } }[]) =>
    bouwRegels(metDatum, { toonAfgerond, rasterStart: cols[0]?.rangeStart ?? vensterStart, uitgeklapt, sortBy, ownerName })

  /** Begin een sleepactie op een balk. 'heel' schuift de hele periode op,
   *  'start' en 'eind' verzetten één kant. We rekenen pixels pas bij het
   *  loslaten om naar datums, zodat tussentijds niets wordt opgeslagen. */
  function startSleep(
    event: React.PointerEvent,
    rij: { key: string; itemId: string; subitemId?: string },
    periode: { van: Date; tot: Date },
    soort: 'heel' | 'start' | 'eind',
  ) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragCleanup.current?.()
    const startX = event.clientX
    const startScroll = scrollRef.current?.scrollLeft ?? 0
    const origin = dateToPx(cols, periode.van) ?? 0
    let dagen = 0
    let pointerX = startX
    let frame = 0
    const updatePreview = () => {
      dagen = pxNaarDagen(cols, origin, origin + pointerX - startX + (scrollRef.current?.scrollLeft ?? 0) - startScroll)
      setSleep({ rijKey: rij.key, soort, dagen })
    }
    const autoScroll = () => {
      const el = scrollRef.current
      if (el) {
        const bounds = el.getBoundingClientRect()
        const leftEdge = bounds.left + NAAM_W + 24
        const rightEdge = bounds.left + el.clientWidth - 24
        const delta = pointerX < leftEdge ? -8 : pointerX > rightEdge ? 8 : 0
        if (delta) { el.scrollLeft += delta; updatePreview() }
      }
      frame = requestAnimationFrame(autoScroll)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() }
    }

    const beweeg = (move: PointerEvent) => {
      pointerX = move.clientX
      updatePreview()
      if (!frame) frame = requestAnimationFrame(autoScroll)
    }
    const los = () => {
      window.removeEventListener('pointermove', beweeg)
      window.removeEventListener('pointerup', los)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', cancel)
      cancelAnimationFrame(frame)
      dragCleanup.current = null
      setSleep(null)
      if (dagen === 0) return
      netGesleept.current = true
      window.setTimeout(() => { netGesleept.current = false }, 0)
      const schuif = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
      let van = periode.van
      let tot = periode.tot
      if (soort === 'heel')  { van = schuif(van, dagen); tot = schuif(tot, dagen) }
      if (soort === 'start') { van = schuif(van, dagen); if (van > tot) van = tot }
      if (soort === 'eind')  { tot = schuif(tot, dagen); if (tot < van) tot = van }
      onMoveItem(rij.itemId, lokaleIso(van), lokaleIso(tot), rij.subitemId)
    }
    const cancel = () => {
      netGesleept.current = true
      window.setTimeout(() => { netGesleept.current = false }, 0)
      window.removeEventListener('pointermove', beweeg)
      window.removeEventListener('pointerup', los)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', cancel)
      cancelAnimationFrame(frame)
      dragCleanup.current = null
      setSleep(null)
    }
    dragCleanup.current = cancel
    window.addEventListener('pointermove', beweeg)
    window.addEventListener('pointerup', los)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', cancel)
  }

  const totaleBreedte = cols.reduce((som, col) => som + col.widthPx, 0)
  const maandKoppen = useMemo(() => getMonthGroupsFromCols(cols), [cols])

  /** Waar staat vandaag in het raster? Voor de gele streep en de knop. */
  const vandaagPx = useMemo(() => dateToPx(cols, new Date()), [cols])

  function naarVandaag() {
    const el = scrollRef.current
    if (!el || vandaagPx === null) return
    el.scrollTo({ left: Math.max(0, vandaagPx - (el.clientWidth - NAAM_W) * 0.12), behavior: 'smooth' })
  }

  // Open op vandaag in plaats van op maanden geschiedenis.
  useEffect(() => { naarVandaagGescrold.current = false }, [zoom, toonAfgerond, baseColW])
  useEffect(() => {
    if (naarVandaagGescrold.current || !scrollRef.current) return
    const index = cols.findIndex(col => col.isCurrent)
    if (index < 0) return
    const x = cols.slice(0, index).reduce((som, col) => som + col.widthPx, 0)
    scrollRef.current.scrollLeft = Math.max(0, x)
    setScrollX(scrollRef.current.scrollLeft)
    naarVandaagGescrold.current = true
  }, [cols])

  // Bijgeladen historie: blijf staan waar je stond.
  //
  // Het raster heeft een vast aantal kolommen; bijladen schuift het hele
  // venster naar achteren in plaats van er kolommen bij te plakken. De
  // totale breedte verandert dus niet, en wie daarop corrigeert
  // corrigeert nergens op — dan sprong het beeld acht weken vooruit.
  // We zoeken daarom de kolom die vóór het bijladen links stond weer op
  // en tellen zijn nieuwe x-positie bij de oude scrollpositie op.
  //
  // useLayoutEffect en niet requestAnimationFrame: dit moet gebeuren ná
  // de DOM-update en vóór het schilderen, anders zie je de sprong toch.
  useLayoutEffect(() => {
    const herstel = herstelRef.current
    const el = scrollRef.current
    if (!herstel || !el) return
    herstelRef.current = null
    ladenBezig.current = false
    const index = cols.findIndex(col => col.key === herstel.eersteKolom)
    if (index <= 0) return
    const x = cols.slice(0, index).reduce((som, col) => som + col.widthPx, 0)
    el.scrollLeft = x + herstel.scrollLeft
  }, [cols])


  return (
    <div data-board-timeline
      style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderBottom: '1px solid var(--border-light)' }}>
        <select aria-label="Tijdlijnperiode" value={zoom} onChange={e => {setZoomScale(1);setZoom(e.target.value as ZoomLevel)}} style={{padding:'5px 9px',border:'1px solid var(--border)',borderRadius:6,background:'var(--bg-card)',color:'var(--text-primary)',fontSize:12}}>
          <option value="dag">Dagen</option><option value="week">Weken</option><option value="maand">Maanden</option>
        </select>
        <button onClick={naarVandaag} title="Spring naar vandaag"
          style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'var(--yellow)', color: '#1a1a1a', marginLeft: 4,
            fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em' }}>
          VANDAAG
        </button>
        <button aria-label="Vorige periode" onClick={() => scrollRef.current?.scrollBy({left: -(viewportWidth - NAAM_W), behavior: 'smooth'})} style={{border:'1px solid var(--border)',borderRadius:6,background:'var(--bg-card)',color:'var(--text-primary)',padding:'4px 10px',cursor:'pointer'}}>←</button>
        <button aria-label="Volgende periode" onClick={() => scrollRef.current?.scrollBy({left: viewportWidth - NAAM_W, behavior: 'smooth'})} style={{border:'1px solid var(--border)',borderRadius:6,background:'var(--bg-card)',color:'var(--text-primary)',padding:'4px 10px',cursor:'pointer'}}>→</button>
        <details style={{marginLeft:'auto',position:'relative'}} onKeyDown={e => { if(e.key === 'Escape') e.currentTarget.open = false }}>
          <summary style={{cursor:'pointer',listStyle:'none',padding:'5px 10px',fontSize:12,color:'var(--text-primary)',border:'1px solid var(--border)',borderRadius:6}}>Weergave ⌄</summary>
          <div style={{position:'absolute',right:0,top:'calc(100% + 8px)',width:260,zIndex:20,display:'flex',flexDirection:'column',alignItems:'stretch',gap:12,padding:14,border:'1px solid var(--border)',borderRadius:10,background:'var(--bg-card)',boxShadow:'0 8px 24px #0003'}}>
        <button onClick={() => setUitgeklapt(current => current.size ? new Set() : new Set(groups.flatMap(g => g.items.filter(i => i.subitems?.length).map(i => i.id))))}
          style={{border:'1px solid var(--border)',borderRadius:6,background:'var(--bg-card)',color:'var(--text-primary)',padding:'4px 10px',cursor:'pointer',fontSize:12}}>
          {uitgeklapt.size ? 'Stappen inklappen' : 'Stappen uitklappen'}
        </button>
        <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text-secondary)'}}><input type="checkbox" checked={toonMomenten} onChange={e=>setToonMomenten(e.target.checked)}/>Klantmomenten</label>
        {groups.length > 1 && (
          // Duidelijk los van de zoomknoppen: met 6px ernaast las het als
          // één rij knoppen en wist je niet meer waar Zoom ophield.
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            marginLeft: 0, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Groepen
            </span>
            {groups.map(groep => {
              const aan = !verborgenGroepen.has(groep.id)
              return (
                <button key={groep.id} onClick={() => setVerborgenGroepen(vorige => {
                    const volgende = new Set(vorige)
                    if (volgende.has(groep.id)) volgende.delete(groep.id); else volgende.add(groep.id)
                    return volgende
                  })}
                  aria-pressed={aan}
                  title={aan ? `${groep.name} verbergen` : `${groep.name} tonen`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999,
                    border: '1px solid var(--border)', cursor: 'pointer',
                    background: aan ? 'var(--bg-hover)' : 'transparent',
                    color: aan ? 'var(--text-primary)' : 'var(--text-muted)',
                    opacity: aan ? 1 : 0.6, fontSize: 11.5, fontWeight: 600 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: groep.color || color, flexShrink: 0 }} />
                  {groep.name}
                </button>
              )
            })}
          </span>
        )}
        {afgerondAantal > 0 && (
          <button onClick={() => setToonAfgerond(v => !v)} aria-pressed={toonAfgerond}
            title={toonAfgerond
              ? 'Verberg afgerond werk weer'
              : `${afgerondAantal} afgeronde item${afgerondAantal === 1 ? '' : 's'} staan nu niet in beeld`}
            style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border)',
              background: toonAfgerond ? 'var(--control-active)' : 'var(--bg-card)',
              color: 'var(--text-secondary)', fontSize: 12, fontWeight: toonAfgerond ? 700 : 500 }}>
            {toonAfgerond ? '✓ ' : ''}Afgerond ({afgerondAantal})
          </button>
        )}
          <div style={{fontSize:11,color:'var(--text-muted)',lineHeight:1.6}}>Volle vlag: project · open vlag: subitem<br/>Breedte = looptijd · hoogte = uren per werkdag<br/>Gestreept = wachtstatus · ? = nog niet geschat<br/>Veeg of sleep de achtergrond om te scrollen.<br/>+ / −: in- en uitzoomen<br/>Sleep de randen voor start/einde · Escape annuleert</div>
          </div>
        </details>
      </div>

      <div ref={scrollRef} role="region" aria-label="Tijdlijn, horizontaal en verticaal scrollbaar" tabIndex={0}
        onPointerDown={startPan}
        onScroll={e => {
          // Naar links blijven scrollen laadt eerdere weken bij, in plaats
          // van tegen een harde rand te lopen. We houden de kijkpositie
          // gelijk door net zoveel terug te scrollen als er kolommen bij
          // komen; anders springt het beeld.
          const el = e.currentTarget
          setScrollX(el.scrollLeft)
          if (sleep) return
          if (el.scrollWidth - el.clientWidth - el.scrollLeft < 120 && extraVooruit < 104) setExtraVooruit(n => n + 12)
          if (el.scrollLeft > 40 || ladenBezig.current) return
          // Niet eindeloos doorladen: twee jaar historie is ruim, en zonder
          // deze grens blijft hij bijladen zolang je aan de linkerrand staat.
          if (extraTerug >= MAX_EXTRA_TERUG) return
          ladenBezig.current = true
          // De correctie zelf gebeurt in de useLayoutEffect hierboven, als
          // de nieuwe kolommen er echt staan.
          herstelRef.current = { scrollLeft: el.scrollLeft, eersteKolom: cols[0]?.key ?? '' }
          setExtraTerug(vorige => Math.min(MAX_EXTRA_TERUG, vorige + 56))
        }}
        style={{ cursor: isPanning ? 'grabbing' : 'grab', userSelect: isPanning ? 'none' : 'auto', overflow: 'auto', maxHeight: '68vh', minHeight: 240, overscrollBehaviorX: 'contain', scrollbarGutter: 'stable', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: NAAM_W + totaleBreedte, position: 'relative' }}>
          {/* Vandaag-streep over het hele raster. Ligt onder de vastgeplakte
              naamkolom (die heeft een hogere z-index), zodat hij daar niet
              overheen schuift als je naar rechts scrollt. */}
          {vandaagPx !== null && (
            <div aria-hidden data-vandaag-lijn style={{ position: 'absolute', top: 0, bottom: 0,
              left: NAAM_W + vandaagPx, width: 0, borderLeft: '2px solid var(--yellow)',
              zIndex: 1, pointerEvents: 'none' }} />
          )}
          <div style={{position:"sticky",top:0,zIndex:4,background:"var(--bg-card)"}}>
          {/* Maandkoppen */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ width: NAAM_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg-card)' }} />
            {maandKoppen.map((maand, i) => (
              <div key={`${maand.label}-${i}`} style={{ width: maand.widthPx, flexShrink: 0, padding: '4px 6px',
                fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em',
                borderLeft: '1px solid var(--border-light)' }}>
                {maand.label}
              </div>
            ))}
          </div>
          {/* Kolomkoppen */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: NAAM_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg-card)',
              padding: '6px 12px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Project / stap
            </div>
            {cols.map(col => (
              <div key={col.key} data-kolomkop style={{ width: col.widthPx, flexShrink: 0, padding: '4px 6px',
                borderLeft: '1px solid var(--border-light)',
                background: col.isCurrent ? 'var(--accent-light)' : col.isPast ? 'var(--overlay-faint)' : 'transparent' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)' }}>{col.label1}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{col.label2}</div>
              </div>
            ))}
          </div>

          </div>
          {relevant.map(({ groep, items }) => {
            const orderedItems = sortSubitems(items, sortBy ?? null, ownerName)
            const metDatum = orderedItems
              .map(item => ({ item, periode: itemPeriode(item) }))
              .filter((entry): entry is { item: BoardItem; periode: { van: Date; tot: Date } } => entry.periode !== null)
              // Geen rij zonder balk: dat is wat de lijst onleesbaar maakte.
              .filter(entry => !valtEerder(entry.item) && (sleep || itemVisible(entry.item,entry.periode)))
              .sort((a, b) => sortBy === undefined ? a.periode.van.getTime() - b.periode.van.getTime() : 0)
            if (metDatum.length === 0) return null
            return (
              <div key={groep.id}>
                {/* Groepskop duidelijker: een gekleurde band links, een
                    dikkere scheiding erboven en wat lucht. Eerder was het
                    verschil tussen een groepskop en een itemrij een iets
                    ander grijs — dan zie je de indeling niet. */}
                <div role="button" tabIndex={0} aria-expanded={!ingeklapteGroepen.has(groep.id)} aria-label={`Groep ${groep.name}`} onClick={() => toggleGroep(groep.id)} onKeyDown={e => {if(e.key === 'Enter' || e.key === ' '){e.preventDefault();toggleGroep(groep.id)}}} style={{ display: 'flex', cursor:'pointer', background: 'var(--overlay-faint)',
                  borderTop: '2px solid var(--border-strong)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: NAAM_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--overlay-faint)', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
                    borderLeft: `4px solid ${groep.color || color}`, boxSizing: 'border-box' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ingeklapteGroepen.has(groep.id) ? '▸' : '▾'} {groep.name}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {metDatum.length}{urenVanGroep(metDatum.map(e => e.item))}
                    </span>
                  </div>
                  <div style={{ width: totaleBreedte, flexShrink: 0 }} />
                </div>
                {!ingeklapteGroepen.has(groep.id) && regelsVan(metDatum).filter(regel => !regel.subitemId || sleep || isVisiblePeriod(regel.periode)).map(regel => {
                  const balk = rangeToPx(cols, regel.periode.van, regel.periode.tot)
                  const laneEnds: number[] = []
                  const segmentLanes = new Map<string,number>()
                  for (const segment of [...(regel.segmenten ?? [])].filter(isVisiblePeriod).sort((a,b) => a.van.getTime()-b.van.getTime())) {
                    let lane = laneEnds.findIndex(end => end < segment.van.getTime())
                    if (lane < 0) lane = laneEnds.length
                    laneEnds[lane] = segment.tot.getTime()
                    segmentLanes.set(segment.id,lane)
                  }
                  const hoog = Math.max(regel.subAantal > 0 ? OUDER_RIJ_H : RIJ_H, laneEnds.length * 24 + 6)
                  const hoursLabel = regel.hours > 0 ? `${regel.hours.toLocaleString('nl-NL',{maximumFractionDigits:1})} uur${regel.missingEstimates ? ' + ?' : ''}` : 'Nog niet geschat'
                  const waiting = isWaitingStatus(regel.status)
                  const alerts = [
                    regel.missingEstimates ? `${regel.missingEstimates} ontbrekende urenschatting${regel.missingEstimates > 1 ? 'en' : ''}` : '',
                    !regel.ownerIds.some(id => id && id !== 'unassigned') ? 'Geen owner' : '',
                    regel.deadline && lokaleIso(regel.periode.tot) > regel.deadline ? 'Gepland na deadline' : '',
                    regel.projectDeadline && lokaleIso(regel.periode.tot) > regel.projectDeadline ? 'Stap eindigt na projectdeadline' : '',
                  ].filter(Boolean)
                  const statusColor = timelineStatusColor(regel.status)
                  // Een project verschuift samen met zijn stappen; deadlines blijven vast.
                  const heeftSubs = regel.subAantal > 0
                  const sleepbaar = !regel.isDone
                  const aan = hoverItem === regel.key
                  return (
                    <div key={regel.key}
                      onMouseEnter={() => setHoverItem(regel.key)}
                      onMouseLeave={() => setHoverItem(current => current === regel.key ? null : current)}
                      style={{ display: 'flex', minHeight: hoog,
                        borderBottom: '1px solid var(--border-light)',
                        background: aan ? 'var(--bg-hover)' : 'transparent' }}>
                      <div style={{ width: NAAM_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
                        background: aan ? 'var(--bg-hover)' : 'var(--bg-card)',
                        padding: regel.subitemId ? '0 12px 0 44px' : '0 12px',
                        display: 'flex', alignItems: 'center', gap: 7,
                        borderRight: '1px solid var(--border)' }}>
                        {/* Uitklappijltje vóór de naam. Alleen bij items die
                            iets te openen hebben; anders houdt een lege
                            inspringing de namen uit elkaar. */}
                        {!regel.subitemId && !heeftSubs && <span style={{ width: 12, flexShrink: 0 }} />}
                        {heeftSubs && (
                          <button onClick={() => klapOmgekeerd(regel.itemId)}
                            aria-expanded={regel.isOuder}
                            title={regel.isOuder
                              ? `${regel.naam} inklappen`
                              : `${regel.naam} uitklappen — ${regel.subAantal} subitem${regel.subAantal === 1 ? '' : 's'}`}
                            style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer',
                              width: 12, flexShrink: 0, fontSize: 9, lineHeight: 1,
                              color: 'var(--text-muted)' }}>
                            {regel.isOuder ? '▼' : '▶'}
                          </button>
                        )}
                        <button onClick={() => heeftSubs ? klapOmgekeerd(regel.itemId) : onOpenItem(regel.itemId, regel.subitemId)}
                          aria-expanded={heeftSubs ? regel.isOuder : undefined}
                          title={`${regel.naam} — ${heeftSubs ? (regel.isOuder ? 'stappen inklappen' : 'stappen uitklappen') : 'open'}${regel.nextMoment ? ' · Volgend klantmoment: ' + regel.nextMoment.name + ' op ' + regel.nextMoment.deadline : ''}`}
                          style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                            minWidth: 0, flex: 1, opacity: regel.isDone ? 0.55 : 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontSize: 11.5,
                            fontWeight: heeftSubs ? 700 : 500,
                            letterSpacing: regel.isOuder ? '0.03em' : undefined,
                            color: 'var(--text-primary)' }}>
                          <span title={regel.status || 'Geen status'} style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:statusColor,marginRight:6,verticalAlign:'middle'}} />{regel.naam}
                          {!regel.subitemId && <span style={{display:'block',fontSize:10.5,fontWeight:400,color:'var(--text-muted)',marginTop:2}}>
                            {heeftSubs ? regel.subAantal + ' stappen · ' : ''}{hoursLabel}{regel.nextMoment ? ' · Naar klant: ' + regel.nextMoment.name + ' ' + new Date(regel.nextMoment.deadline+'T00:00:00').toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) : regel.deadline ? ' · Deadline ' + new Date(regel.deadline+'T00:00:00').toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) : ''}
                          </span>}
                        </button>
                        {/* Eigenaren rechts van de titel: zo staan ze bij
                            elkaar in één kolom en loopt de naam niet in
                            een wisselend aantal avatars vast. */}
                        {alerts.length > 0 && !regel.isDone && <button title={alerts.join(' · ')} aria-label={`${regel.naam}: ${alerts.join(' · ')}`} onClick={() => onOpenItem(regel.itemId,regel.subitemId)} style={{border:0,background:'none',color:'var(--text-muted)',cursor:'pointer',padding:2}}>⚠</button>}
                        {heeftSubs && <button onClick={() => onOpenItem(regel.itemId)} aria-label={`Details van ${regel.naam}`} title="Projectdetails openen" style={{border:0,background:'transparent',color:'var(--text-muted)',cursor:'pointer',padding:'3px 5px',fontSize:14}}>↗</button>}
                        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                          {regel.ownerIds.filter(id => id && id !== 'unassigned').slice(0, 3).map((id, i) => (
                            <span key={id} style={{ marginLeft: i === 0 ? 0 : -7, display: 'inline-flex' }}>
                              <UserAvatar memberId={id} size={20} />
                            </span>
                          ))}
                        </span>
                      </div>
                      <div style={{ width: totaleBreedte, flexShrink: 0, position: 'relative' }}>
                        {cols.map((col, i) => (
                          <div key={col.key} style={{ position: 'absolute', top: 0, bottom: 0,
                            left: cols.slice(0, i).reduce((som, c) => som + c.widthPx, 0), width: col.widthPx,
                            borderLeft: '1px solid var(--border-light)',
                            background: col.isCurrent ? 'var(--accent-light)' : col.isPast ? 'var(--overlay-faint)' : 'transparent',
                            pointerEvents: 'none' }} />
                        ))}
                        {toonMomenten && regel.deadline && (() => {
                          const deadlineDate = new Date(regel.deadline+'T12:00:00')
                          const x = dateToPx(cols,deadlineDate)
                          if (x === null) return null
                          return <button aria-label={`${regel.subitemId ? 'Subitemdeadline' : 'Projectdeadline'} ${regel.naam}: ${deadlineDate.toLocaleDateString('nl-NL')}`}
                            onClick={()=>onOpenItem(regel.itemId,regel.subitemId)}
                            title={`${regel.subitemId ? `Naar klant: ${regel.naam}` : 'Deadline'} · ${deadlineDate.toLocaleDateString('nl-NL')} · klik voor details`}
                            style={{position:'absolute',left:x-9,top:0,height:hoog,width:18,padding:0,border:0,background:'transparent',color:'var(--yellow)',zIndex:2,cursor:'pointer'}}>
                            <span style={{position:'absolute',left:6,top:0}}><DeadlineFlag subitem={!!regel.subitemId}/></span><span aria-hidden style={{position:'absolute',left:9,top:18,bottom:0,borderLeft:`${regel.subitemId ? 1 : 2}px dashed var(--yellow)`}}/>
                          </button>
                        })()}
                        {/* Losse stukjes als de periode geleend is van de
                            subitems, anders één balk. Eén doorlopende balk
                            van oktober tot maart beweert dat er een half
                            jaar aan gewerkt wordt, terwijl het om drie
                            losse dagen gaat. */}
                        {(regel.segmenten ?? (balk ? [regel.periode] : [])).map((stuk, stukIdx) => {
                          const vak = rangeToPx(cols,stuk.van,stuk.tot)
                          if (!vak) return null
                          const segment = regel.segmenten?.[stukIdx] ?? null
                          const segmentHours = segment ? segment.hours : regel.hours
                          const segmentLabel = segmentHours > 0 ? `${segmentHours.toLocaleString('nl-NL',{maximumFractionDigits:1})} uur` : 'Nog niet geschat'
                          const barLabel = segment ? `${segment.name} · ${segmentLabel}` : hoursLabel
                          const barStatus = segment?.status ?? regel.status
                          const barColor = timelineStatusColor(barStatus)
                          const waiting = isWaitingStatus(barStatus)
                          const hoogte = segment ? planningBarPixelHeight(OUDER_H, planningBarHeightRatio({hours:segmentHours,startDate:lokaleIso(stuk.van),endDate:lokaleIso(stuk.tot)}),6) : planningBarPixelHeight(heeftSubs ? OUDER_H : BALK_H, planningBarHeightRatio({hours:regel.hours,startDate:lokaleIso(stuk.van),endDate:lokaleIso(stuk.tot)}),6)
                          const dailyHours = segmentHours / Math.max(1,werkdagenIn(lokaleIso(stuk.van),lokaleIso(stuk.tot)))
                          // Tijdens het slepen schuift de balk alvast mee,
                          // zodat je ziet waar je 'm neerlegt.
                          const dragRow = segment ? { key: `${regel.itemId}:${segment.id}`, itemId: regel.itemId, subitemId: segment.id } : regel
                          const bezig = sleep?.rijKey === dragRow.key ? sleep : null
                          const schuifDatum = (d: Date, n: number) => { const next = new Date(d); next.setDate(next.getDate()+n); return next }
                          let previewStart = bezig && bezig.soort !== 'eind' ? schuifDatum(stuk.van, bezig.dagen) : stuk.van
                          let previewEnd = bezig && bezig.soort !== 'start' ? schuifDatum(stuk.tot, bezig.dagen) : stuk.tot
                          if(previewStart > previewEnd){if(bezig?.soort==='start')previewStart=previewEnd;else previewEnd=previewStart}
                          const preview = rangeToPx(cols,previewStart,previewEnd) ?? vak
                          const left = preview.left
                          const width = Math.max(1,preview.width - (segment ? 2 : 0))
                          const workdays = werkdagenIn(lokaleIso(previewStart),lokaleIso(previewEnd))
                          const datum = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
                          const subs = `${regel.subAantal} subitem${regel.subAantal === 1 ? '' : 's'}`
                          const staart = segment ? ' · open subitem' : heeftSubs
                            ? ` · ${subs} · ${regel.isOuder ? 'stappen inklappen' : 'stappen uitklappen'}`
                            : sleepbaar ? ' · sleep om te verzetten' : ''
                          return (
                            <div key={stukIdx} role="button" tabIndex={0} aria-label={`${regel.naam}${segment ? " — " + segment.name : ""}, ${datum(previewStart)} tot ${datum(previewEnd)}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(segment)onOpenItem(regel.itemId,segment.id);else if(heeftSubs)klapOmgekeerd(regel.itemId);else onOpenItem(regel.itemId,regel.subitemId)}}}
                              onPointerDown={e => sleepbaar && startSleep(e, dragRow, stuk, 'heel')}
                              // Segmenten openen hun subitem; de projectnaam klapt de stappen uit.
                              onClick={() => {
                                if (sleep || netGesleept.current) return
                                if (segment) onOpenItem(regel.itemId, segment.id)
                                else if (heeftSubs) klapOmgekeerd(regel.itemId)
                                else onOpenItem(regel.itemId, regel.subitemId)
                              }}
                              title={`${regel.naam}${segment ? " — " + segment.name : ""} · ${barStatus || 'Geen status'} · ${segment ? segmentLabel : hoursLabel} werk · ${workdays} werkdagen looptijd · gemiddeld ${dailyHours.toLocaleString('nl-NL',{maximumFractionDigits:1})} uur per werkdag · ${datum(stuk.van)} – ${datum(stuk.tot)}${waiting ? ' · Wachten' : ''}${staart}`}
                              style={{ position: 'absolute', left, width,
                                top: segment && laneEnds.length > 1 ? 3 + (segmentLanes.get(segment.id) ?? 0) * 24 + (22 - Math.max(18,hoogte))/2 : (hoog - Math.max(18,hoogte)) / 2, height: Math.max(18,hoogte), borderRadius: regel.isOuder ? 3 : 5,
                                cursor: sleepbaar ? (bezig ? 'grabbing' : 'grab') : 'pointer',
                                background: 'transparent',
                                opacity: regel.isDone ? 0.5 : 1,
                                boxShadow: bezig ? '0 2px 10px rgba(0,0,0,0.35)' : undefined,
                                color: hoogte >= 16 ? '#171717' : 'var(--text-primary)', fontSize: 11.5, fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 6px',
                                // Geen overflow:hidden meer: dat maakt van de
                                // balk een eigen scroll-container en dan werkt
                                // de meescrollende naam hieronder niet.
                                whiteSpace: 'nowrap', userSelect: 'none', touchAction: 'none' }}>
                              <span aria-hidden style={{position:'absolute',left:0,right:0,top:(Math.max(18,hoogte)-hoogte)/2,height:hoogte,borderRadius:4,pointerEvents:'none',background:waiting ? `repeating-linear-gradient(135deg, ${barColor}, ${barColor} 4px, var(--bg-card) 4px, var(--bg-card) 6px)` : barColor,border:segmentHours ? undefined : '1px dashed var(--text-muted)',opacity:waiting ? .6 : 1}} />
                              {bezig && <span role="status" style={{position:'absolute',bottom:'calc(100% + 5px)',left:0,padding:'4px 7px',background:'var(--text-primary)',color:'var(--bg-card)',borderRadius:5,fontSize:11,zIndex:5,pointerEvents:'none'}}>{datum(previewStart)} – {datum(previewEnd)}</span>}
                              {sleepbaar && (segment || !heeftSubs) && (
                                <span onPointerDown={e => { e.stopPropagation(); startSleep(e, dragRow, stuk, 'start') }}
                                  title="Sleep startdatum · Escape annuleert" onClick={e => e.stopPropagation()}
                                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.min(8,width/3), zIndex:3, borderLeft:'2px solid #ffffff88', borderRadius:3, cursor: 'ew-resize' }} />
                              )}
                              {/* De naam schuift mee met het scrollen en blijft
                                  binnen zijn eigen balk. Bij een klus van een
                                  half jaar begint de balk anders ver links
                                  buiten beeld en zie je alleen nog een gekleurde
                                  baan zonder te weten waarvan. */}
                              <span style={{ position: 'sticky', left: NAAM_W + 8,
                                maxWidth: Math.max(0, width - 12),
                                overflow: 'hidden', textOverflow: 'ellipsis', zIndex:1, background:hoogte < 16 ? 'var(--bg-card)' : undefined,borderRadius:3,padding:'0 3px' }}>
                                {width > 42 ? barLabel : ''}
                              </span>
                              {sleepbaar && (segment || !heeftSubs) && (
                                <span onPointerDown={e => { e.stopPropagation(); startSleep(e, dragRow, stuk, 'eind') }}
                                  title="Sleep einddatum · Escape annuleert" onClick={e => e.stopPropagation()}
                                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: Math.min(8,width/3), zIndex:3, borderRight:'2px solid #ffffff88', borderRadius:3, cursor: 'ew-resize' }} />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

        </div>
      </div>

      {/* Items zonder datum verdwijnen niet: zonder deze lijst zou de
          Tijdlijn stilzwijgend minder tonen dan de Lijst. Buiten het
          scrollende raster, want ze hebben geen plek in de tijd — daarbinnen
          scrolden ze mee naar links en stonden ze buiten beeld. */}
      {eerder.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
          <button onClick={() => setToonEerder(v => !v)} aria-expanded={toonEerder}
            title={toonEerder
              ? 'Laat alleen werk vanaf drie weken terug zien'
              : 'Dit werk ligt helemaal in het verleden; klik om het raster terug te laten lopen'}
            style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer',
              fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {toonEerder ? '▾' : '▸'} Eerder · {eerder.length}
          </button>
          {!toonEerder && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {eerder.map(({ item }) => (
                <button key={item.id} onClick={() => onOpenItem(item.id)}
                  title={`${item.name} — openen`}
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)', borderRadius: 999,
                    padding: '3px 9px', fontSize: 11.5, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {item.name || '(naamloos)'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {zonderDatum.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
            Zonder datum · {zonderDatum.length}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {zonderDatum.map(({ item }) => (
              <button key={item.id} onClick={() => onOpenItem(item.id)}
                title={`${item.name} — open in de lijst om datums te zetten`}
                style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)', borderRadius: 999,
                  padding: '3px 9px', fontSize: 11.5, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {item.name || '(naamloos)'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
