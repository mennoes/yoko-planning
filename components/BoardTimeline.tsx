'use client'

// Tijdlijn: dezelfde agenda, maar als balken over de tijd in plaats van
// rijen onder elkaar.
//
// Het verschil met /planning is wat een rij betekent. Daar is een rij een
// persoon ('wie heeft het te druk'), hier een item ('wat loopt wanneer').
// Dezelfde kolom-rekenkunde (lib/timelineCols.ts), andere vraag.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardGroup, BoardItem, SubItem } from '@/lib/boards'
import {
  buildCols, getMonthGroupsFromCols, rangeToPx, pxNaarDagen, lokaleIso,
  ZOOM_COL_W, type ZoomLevel,
} from '@/lib/timelineCols'
import { UserAvatar } from './UserAvatar'
import { getWeekStart } from '@/lib/workload'

const NAAM_W = 270
const RIJ_H  = 32
const OUDER_RIJ_H = 24
const BALK_H = 18
/** Een ouder met subitems is een samenvatting, geen werk op zich. Zijn
 *  balk is daarom een dun grijs streepje boven de subitems: je ziet de
 *  omspanning, maar je blik gaat naar de regels eronder. */
const OUDER_H = 5
/** Tot hoever je terug kunt scrollen voordat we stoppen met bijladen. */
const MAX_EXTRA_TERUG = 730

/** '· 120u' achter een groepskop. */
function urenVanGroep(items: BoardItem[]): string {
  const totaal = items.reduce((som, item) => som + (Number(item.estHours) || 0), 0)
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

/** De getoonde periode van een item: subitems met datums winnen van het
 *  (vaak verouderde) veld op het item zelf — net als in de lijst. */
export function itemPeriode(item: BoardItem): { van: Date; tot: Date } | null {
  const datums: string[] = []
  for (const sub of item.subitems ?? []) {
    if (sub.status === 'Done') continue
    if (sub.startDate) datums.push(sub.startDate)
    if (sub.endDate)   datums.push(sub.endDate)
  }
  if (datums.length === 0) {
    if (item.startDate) datums.push(item.startDate)
    if (item.endDate)   datums.push(item.endDate)
  }
  if (datums.length === 0) return null
  const gesorteerd = [...datums].sort()
  const van = new Date(`${gesorteerd[0]}T00:00:00`)
  const tot = new Date(`${gesorteerd[gesorteerd.length - 1]}T23:59:59`)
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
   *  regel is uit of in te klappen, en de balk draagt een bolletje met dit
   *  aantal. */
  subAantal: number
  isDone: boolean
}

/**
 * Zet items om in regels.
 *
 * Een item met subitems staat standaard ingeklapt: één gewone balk in de
 * groepskleur, met een bolletje dat zegt hoeveel er onder zit. Klap je 'm
 * uit, dan krijgt elk subitem een eigen regel en zakt de ouder terug tot
 * een dun grijs streepje erboven — daar zit het werk immers niet in.
 */
export function bouwRegels(
  metDatum: { item: BoardItem; periode: { van: Date; tot: Date } }[],
  opties: { toonAfgerond: boolean; rasterStart: Date; uitgeklapt?: Set<string> },
): TijdlijnRegel[] {
  const regels: TijdlijnRegel[] = []
  for (const { item, periode } of metDatum) {
    const subs = (item.subitems ?? [])
      .filter(sub => opties.toonAfgerond || sub.status !== 'Done')
      .map(sub => ({ sub, periode: subPeriode(sub) }))
      .filter((e): e is { sub: SubItem; periode: { van: Date; tot: Date } } => e.periode !== null)
      // Een subitem dat helemaal vóór het raster ligt heeft geen balk en
      // dus geen regel — zelfde regel als voor items.
      .filter(e => e.periode.tot >= opties.rasterStart)
      .sort((a, b) => a.periode.van.getTime() - b.periode.van.getTime())
    const open = subs.length > 0 && (opties.uitgeklapt?.has(item.id) ?? false)
    regels.push({
      key: item.id, itemId: item.id, naam: item.name || '(naamloos)',
      ownerIds: item.ownerIds ?? [], periode,
      isOuder: open, subAantal: subs.length, isDone: item.status === 'Done',
    })
    if (!open) continue
    for (const { sub, periode: subTijd } of subs) {
      regels.push({
        key: `${item.id}:${sub.id}`, itemId: item.id, subitemId: sub.id,
        naam: sub.name || '(naamloos)', ownerIds: sub.ownerIds ?? [], periode: subTijd,
        isOuder: false, subAantal: 0, isDone: sub.status === 'Done',
      })
    }
  }
  return regels
}

export default function BoardTimeline({ groups, color, onOpenItem, onMoveItem }: {
  groups: BoardGroup[]
  color: string
  /** Klikken op een balk opent de item-popup, desnoods op een subitem. */
  onOpenItem: (itemId: string, subitemId?: string) => void
  /** Slepen verzet de datums. Zonder dit kun je hier alleen kijken, en dan
   *  is de tijdlijn een slechtere versie van de planning. */
  onMoveItem: (itemId: string, startDate: string, endDate: string, subitemId?: string) => void
}) {
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
  const [verborgenGroepen, setVerborgenGroepen] = useState<Set<string>>(new Set())
  // Hoeveel extra historie er is bijgeladen door naar links te scrollen.
  const [extraTerug, setExtraTerug] = useState(0)
  const ladenBezig = useRef(false)
  const [zoom, setZoom] = useState<ZoomLevel>('week')
  const scrollRef = useRef<HTMLDivElement>(null)
  const naarVandaagGescrold = useRef(false)

  const [toonAfgerond, setToonAfgerond] = useState(false)
  const [toonEerder, setToonEerder] = useState(false)

  const colW = ZOOM_COL_W[zoom]

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
    return buildCols(zoom, start, colW)
  }, [zoom, colW, vensterStart])

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
    bouwRegels(metDatum, { toonAfgerond, rasterStart: cols[0]?.rangeStart ?? vensterStart, uitgeklapt })

  const dagenTussen = (van: Date, tot: Date) => {
    const dag = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000
    return Math.max(1, dag(tot) - dag(van) + 1)
  }

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
    const startX = event.clientX
    let dagen = 0

    const beweeg = (move: PointerEvent) => {
      dagen = pxNaarDagen(cols, 0, move.clientX - startX)
      setSleep({ rijKey: rij.key, soort, dagen })
    }
    const los = () => {
      window.removeEventListener('pointermove', beweeg)
      window.removeEventListener('pointerup', los)
      window.removeEventListener('pointercancel', los)
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
    window.addEventListener('pointermove', beweeg)
    window.addEventListener('pointerup', los)
    window.addEventListener('pointercancel', los)
  }

  const totaleBreedte = cols.reduce((som, col) => som + col.widthPx, 0)
  const maandKoppen = useMemo(() => getMonthGroupsFromCols(cols), [cols])

  // Open op vandaag in plaats van op maanden geschiedenis.
  useEffect(() => { naarVandaagGescrold.current = false }, [zoom, toonAfgerond])
  useEffect(() => {
    if (naarVandaagGescrold.current || !scrollRef.current) return
    const index = cols.findIndex(col => col.isCurrent)
    if (index < 0) return
    const x = cols.slice(0, index).reduce((som, col) => som + col.widthPx, 0)
    scrollRef.current.scrollLeft = Math.max(0, x - 120)
    naarVandaagGescrold.current = true
  }, [cols])


  return (
    <div data-board-timeline
      style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-light)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Zoom
        </span>
        {(['dag', 'week', 'maand'] as const).map(niveau => (
          <button key={niveau} onClick={() => setZoom(niveau)} aria-pressed={zoom === niveau}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
              background: zoom === niveau ? 'var(--control-active)' : 'var(--bg-card)',
              color: 'var(--text-primary)', fontSize: 12, fontWeight: zoom === niveau ? 700 : 500 }}>
            {niveau === 'dag' ? 'Dag' : niveau === 'week' ? 'Week' : 'Maand'}
          </button>
        ))}
        {groups.length > 1 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginLeft: 6 }}>
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
      </div>

      <div ref={scrollRef}
        onScroll={e => {
          // Naar links blijven scrollen laadt eerdere weken bij, in plaats
          // van tegen een harde rand te lopen. We houden de kijkpositie
          // gelijk door net zoveel terug te scrollen als er kolommen bij
          // komen; anders springt het beeld.
          const el = e.currentTarget
          if (el.scrollLeft > 40 || ladenBezig.current) return
          // Niet eindeloos doorladen: twee jaar historie is ruim, en zonder
          // deze grens blijft hij bijladen zolang je aan de linkerrand staat.
          if (extraTerug >= MAX_EXTRA_TERUG) return
          ladenBezig.current = true
          const breedteVoor = el.scrollWidth
          setExtraTerug(vorige => Math.min(MAX_EXTRA_TERUG, vorige + 56))
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollLeft += scrollRef.current.scrollWidth - breedteVoor
            }
            ladenBezig.current = false
          })
        }}
        style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <div style={{ minWidth: NAAM_W + totaleBreedte }}>
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
              Item
            </div>
            {cols.map(col => (
              <div key={col.key} style={{ width: col.widthPx, flexShrink: 0, padding: '4px 6px',
                borderLeft: '1px solid var(--border-light)',
                background: col.isCurrent ? 'var(--accent-light)' : col.isPast ? 'var(--overlay-faint)' : 'transparent' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)' }}>{col.label1}</div>
                <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{col.label2}</div>
              </div>
            ))}
          </div>

          {relevant.map(({ groep, items }) => {
            const metDatum = items
              .map(item => ({ item, periode: itemPeriode(item) }))
              .filter((entry): entry is { item: BoardItem; periode: { van: Date; tot: Date } } => entry.periode !== null)
              // Geen rij zonder balk: dat is wat de lijst onleesbaar maakte.
              .filter(entry => !valtEerder(entry.item))
              .sort((a, b) => a.periode.van.getTime() - b.periode.van.getTime())
            if (metDatum.length === 0) return null
            return (
              <div key={groep.id}>
                {/* Groepskop duidelijker: een gekleurde band links, een
                    dikkere scheiding erboven en wat lucht. Eerder was het
                    verschil tussen een groepskop en een itemrij een iets
                    ander grijs — dan zie je de indeling niet. */}
                <div style={{ display: 'flex', background: 'var(--overlay-faint)',
                  borderTop: '2px solid var(--border-strong)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: NAAM_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--overlay-faint)', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8,
                    borderLeft: `4px solid ${groep.color || color}`, boxSizing: 'border-box' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{groep.name}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {metDatum.length}{urenVanGroep(metDatum.map(e => e.item))}
                    </span>
                  </div>
                  <div style={{ width: totaleBreedte, flexShrink: 0 }} />
                </div>
                {regelsVan(metDatum).map(regel => {
                  const balk = rangeToPx(cols, regel.periode.van, regel.periode.tot)
                  const hoog = regel.isOuder ? OUDER_RIJ_H : RIJ_H
                  const hoogte = regel.isOuder ? OUDER_H : BALK_H
                  // Een item met subitems laat zich niet verslepen: zijn
                  // datums zijn de optelsom van de subitems, dus schuiven
                  // zou meteen weer worden overschreven. Klap 'm uit en
                  // versleep het subitem dat je bedoelt.
                  const heeftSubs = regel.subAantal > 0
                  const sleepbaar = !heeftSubs && !regel.isDone
                  const aan = hoverItem === regel.key
                  return (
                    <div key={regel.key}
                      onMouseEnter={() => setHoverItem(regel.key)}
                      onMouseLeave={() => setHoverItem(current => current === regel.key ? null : current)}
                      style={{ display: 'flex', minHeight: hoog,
                        borderBottom: regel.isOuder ? 'none' : '1px solid var(--border-light)',
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
                        <button onClick={() => onOpenItem(regel.itemId, regel.subitemId)}
                          title={`${regel.naam} — open`}
                          style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                            minWidth: 0, flex: 1, opacity: regel.isDone ? 0.55 : 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontSize: regel.isOuder ? 11 : 12.5,
                            fontWeight: regel.isOuder ? 700 : 500,
                            letterSpacing: regel.isOuder ? '0.03em' : undefined,
                            color: regel.isOuder ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                          {regel.naam}
                        </button>
                        {/* Eigenaren rechts van de titel: zo staan ze bij
                            elkaar in één kolom en loopt de naam niet in
                            een wisselend aantal avatars vast. */}
                        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                          {regel.ownerIds.filter(id => id && id !== 'unassigned').slice(0, 3).map((id, i) => (
                            <span key={id} style={{ marginLeft: i === 0 ? 0 : -7, display: 'inline-flex' }}>
                              <UserAvatar memberId={id} size={regel.isOuder ? 17 : 21} />
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
                        {balk && (() => {
                          // Tijdens het slepen schuift de balk alvast mee,
                          // zodat je ziet waar je 'm neerlegt.
                          const bezig = sleep?.rijKey === regel.key ? sleep : null
                          const dagBreedte = balk.width / Math.max(1, dagenTussen(regel.periode.van, regel.periode.tot))
                          const verschuif = bezig ? bezig.dagen * dagBreedte : 0
                          const left  = balk.left + (bezig?.soort === 'eind' ? 0 : verschuif)
                          const width = Math.max(6, balk.width + (bezig?.soort === 'heel' ? 0 : bezig?.soort === 'start' ? -verschuif : verschuif))
                          const datum = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
                          const subs = `${regel.subAantal} subitem${regel.subAantal === 1 ? '' : 's'}`
                          const staart = heeftSubs
                            ? ` · ${subs} · klik om ${regel.isOuder ? 'in' : 'uit'} te klappen`
                            : sleepbaar ? ' · sleep om te verzetten' : ''
                          return (
                            <div
                              onPointerDown={e => sleepbaar && startSleep(e, regel, regel.periode, 'heel')}
                              // Een balk met subitems klapt open in plaats van
                              // de popup te openen: dat is waar je op dat
                              // moment naar op zoek bent. De naam ernaast
                              // opent nog steeds het item zelf.
                              onClick={() => {
                                if (sleep || netGesleept.current) return
                                if (heeftSubs) klapOmgekeerd(regel.itemId)
                                else onOpenItem(regel.itemId, regel.subitemId)
                              }}
                              title={`${regel.naam} · ${datum(regel.periode.van)} – ${datum(regel.periode.tot)}${staart}`}
                              style={{ position: 'absolute', left, width,
                                top: (hoog - hoogte) / 2, height: hoogte, borderRadius: regel.isOuder ? 3 : 5,
                                cursor: sleepbaar ? (bezig ? 'grabbing' : 'grab') : 'pointer',
                                background: regel.isOuder ? 'var(--text-muted)' : (groep.color || color),
                                opacity: regel.isOuder ? 0.32 : regel.isDone ? 0.4 : bezig ? 1 : 0.9,
                                boxShadow: bezig ? '0 2px 10px rgba(0,0,0,0.35)' : undefined,
                                color: '#fff', fontSize: 10.5, fontWeight: 700,
                                display: 'flex', alignItems: 'center', padding: '0 6px',
                                overflow: 'hidden', whiteSpace: 'nowrap', userSelect: 'none', touchAction: 'none' }}>
                              {sleepbaar && (
                                <span onPointerDown={e => { e.stopPropagation(); startSleep(e, regel, regel.periode, 'start') }}
                                  title="Sleep om de startdatum te verzetten"
                                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {!regel.isOuder && width > 54 ? regel.naam : ''}
                              </span>
                              {/* Bolletje met het aantal subitems: aan een
                                  balk zie je anders niet dat er nog iets
                                  onder zit. Op de uitgeklapte grijze streep
                                  past het niet en is het ook overbodig — daar
                                  staan de subitems er gewoon. */}
                              {heeftSubs && !regel.isOuder && (
                                <span aria-hidden style={{ marginLeft: 'auto', flexShrink: 0,
                                  minWidth: 15, height: 15, borderRadius: 999, padding: '0 4px',
                                  background: 'rgba(255,255,255,0.92)', color: 'rgba(0,0,0,0.75)',
                                  fontSize: 9.5, fontWeight: 800, lineHeight: '15px', textAlign: 'center' }}>
                                  {regel.subAantal}
                                </span>
                              )}
                              {sleepbaar && (
                                <span onPointerDown={e => { e.stopPropagation(); startSleep(e, regel, regel.periode, 'eind') }}
                                  title="Sleep om de einddatum te verzetten"
                                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />
                              )}
                            </div>
                          )
                        })()}
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
