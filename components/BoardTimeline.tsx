'use client'

// Tijdlijn: dezelfde agenda, maar als balken over de tijd in plaats van
// rijen onder elkaar.
//
// Het verschil met /planning is wat een rij betekent. Daar is een rij een
// persoon ('wie heeft het te druk'), hier een item ('wat loopt wanneer').
// Dezelfde kolom-rekenkunde (lib/timelineCols.ts), andere vraag.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardGroup, BoardItem } from '@/lib/boards'
import {
  buildCols, getMonthGroupsFromCols, rangeToPx, pxNaarDagen, lokaleIso,
  ZOOM_COL_W, type ZoomLevel,
} from '@/lib/timelineCols'
import { UserAvatar } from './UserAvatar'
import { getWeekStart } from '@/lib/workload'

const NAAM_W = 240
const RIJ_H  = 30
const BALK_H = 18

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

export default function BoardTimeline({ groups, color, onOpenItem, onMoveItem }: {
  groups: BoardGroup[]
  color: string
  /** Klikken op een balk opent de item-popup. */
  onOpenItem: (itemId: string) => void
  /** Slepen verzet de datums. Zonder dit kun je hier alleen kijken, en dan
   *  is de tijdlijn een slechtere versie van de planning. */
  onMoveItem: (itemId: string, startDate: string, endDate: string) => void
}) {
  // Wat er nú gesleept wordt, zodat de balk meteen meebeweegt in plaats
  // van pas te springen als je loslaat.
  const [sleep, setSleep] = useState<
    { itemId: string; soort: 'heel' | 'start' | 'eind'; dagen: number } | null>(null)
  // Na een sleep volgt er ook een click. Zonder dit vlaggetje opende de
  // popup zodra je losliet — en die ligt dan over de balk heen, dus je
  // kon niet twee keer achter elkaar slepen.
  const netGesleept = useRef(false)
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
  const relevant = useMemo(() => groups.map(groep => ({
    groep,
    items: groep.items.filter(item => toonAfgerond || !isAfgerond(item, groep.name)),
  })), [groups, toonAfgerond])

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
    const drieWekenTerug = new Date(vandaag); drieWekenTerug.setDate(vandaag.getDate() - 21)
    if (!toonEerder && !toonAfgerond) return drieWekenTerug

    const vroegste = relevant
      .flatMap(({ items }) => items.map(itemPeriode))
      .filter((p): p is { van: Date; tot: Date } => p !== null)
      .reduce<Date | null>((min, p) => (min === null || p.van < min ? p.van : min), null)
    const jaarTerug = new Date(vandaag); jaarTerug.setFullYear(vandaag.getFullYear() - 1)
    if (!vroegste || vroegste > drieWekenTerug) return drieWekenTerug
    return vroegste < jaarTerug ? jaarTerug : vroegste
  }, [relevant, toonEerder, toonAfgerond])

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

  const dagenTussen = (van: Date, tot: Date) => {
    const dag = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000
    return Math.max(1, dag(tot) - dag(van) + 1)
  }

  /** Begin een sleepactie op een balk. 'heel' schuift de hele periode op,
   *  'start' en 'eind' verzetten één kant. We rekenen pixels pas bij het
   *  loslaten om naar datums, zodat tussentijds niets wordt opgeslagen. */
  function startSleep(
    event: React.PointerEvent,
    item: BoardItem,
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
      setSleep({ itemId: item.id, soort, dagen })
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
      onMoveItem(item.id, lokaleIso(van), lokaleIso(tot))
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

      <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'visible' }}>
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
                <div style={{ display: 'flex', background: 'var(--overlay-faint)', borderBottom: '1px solid var(--border-light)' }}>
                  <div style={{ width: NAAM_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--overlay-faint)', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: groep.color || color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{groep.name}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{metDatum.length}</span>
                  </div>
                  <div style={{ width: totaleBreedte, flexShrink: 0 }} />
                </div>
                {metDatum.map(({ item, periode }) => {
                  const balk = rangeToPx(cols, periode.van, periode.tot)
                  const isDone = item.status === 'Done'
                  return (
                    <div key={item.id} style={{ display: 'flex', minHeight: RIJ_H, borderBottom: '1px solid var(--border-light)' }}>
                      <div style={{ width: NAAM_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
                        background: 'var(--bg-card)', padding: '0 12px', display: 'flex', alignItems: 'center',
                        borderRight: '1px solid var(--border)' }}>
                        {/* Wie het doet hoort erbij: zonder eigenaren mis je
                            precies wat de planning wél laat zien. */}
                        <span style={{ display: 'inline-flex', flexShrink: 0, marginRight: 7 }}>
                          {(item.ownerIds ?? []).filter(id => id && id !== 'unassigned').slice(0, 3).map((id, i) => (
                            <span key={id} style={{ marginLeft: i === 0 ? 0 : -7, display: 'inline-flex' }}>
                              <UserAvatar memberId={id} size={20} />
                            </span>
                          ))}
                        </span>
                        <button onClick={() => onOpenItem(item.id)}
                          title={`${item.name} — open`}
                          style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                            fontSize: 12.5, color: 'var(--text-primary)', opacity: isDone ? 0.55 : 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                          {item.name || '(naamloos)'}
                        </button>
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
                          const bezig = sleep?.itemId === item.id ? sleep : null
                          const dagBreedte = balk.width / Math.max(1, dagenTussen(periode.van, periode.tot))
                          const verschuif = bezig ? bezig.dagen * dagBreedte : 0
                          const left  = balk.left + (bezig?.soort === 'eind' ? 0 : verschuif)
                          const width = Math.max(6, balk.width + (bezig?.soort === 'heel' ? 0 : bezig?.soort === 'start' ? -verschuif : verschuif))
                          const sleepbaar = !!onMoveItem && !isDone
                          return (
                            <div
                              onPointerDown={e => sleepbaar && startSleep(e, item, periode, 'heel')}
                              onClick={() => { if (!sleep && !netGesleept.current) onOpenItem(item.id) }}
                              title={`${item.name} · ${periode.van.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} – ${periode.tot.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}${sleepbaar ? ' · sleep om te verzetten' : ''}`}
                              style={{ position: 'absolute', left, width,
                                top: (RIJ_H - BALK_H) / 2, height: BALK_H, borderRadius: 5,
                                cursor: sleepbaar ? (bezig ? 'grabbing' : 'grab') : 'pointer',
                                background: groep.color || color, opacity: isDone ? 0.4 : bezig ? 1 : 0.9,
                                boxShadow: bezig ? '0 2px 10px rgba(0,0,0,0.35)' : undefined,
                                color: '#fff', fontSize: 10.5, fontWeight: 700,
                                display: 'flex', alignItems: 'center', padding: '0 6px',
                                overflow: 'hidden', whiteSpace: 'nowrap', userSelect: 'none', touchAction: 'none' }}>
                              {sleepbaar && (
                                <span onPointerDown={e => { e.stopPropagation(); startSleep(e, item, periode, 'start') }}
                                  title="Sleep om de startdatum te verzetten"
                                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {width > 54 ? item.name : ''}
                              </span>
                              {sleepbaar && (
                                <span onPointerDown={e => { e.stopPropagation(); startSleep(e, item, periode, 'eind') }}
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
