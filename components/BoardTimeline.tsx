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
  buildCols, getMonthGroupsFromCols, rangeToPx,
  ZOOM_COL_W, HISTORY_BACK, type ZoomLevel,
} from '@/lib/timelineCols'
import { getWeekStart } from '@/lib/workload'

const NAAM_W = 240
const RIJ_H  = 30
const BALK_H = 18

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

export default function BoardTimeline({ groups, color, onOpenItem }: {
  groups: BoardGroup[]
  color: string
  /** Klikken op een balk brengt je naar dat item in de lijst. */
  onOpenItem: (itemId: string) => void
}) {
  const [zoom, setZoom] = useState<ZoomLevel>('week')
  const scrollRef = useRef<HTMLDivElement>(null)
  const naarVandaagGescrold = useRef(false)

  const colW = ZOOM_COL_W[zoom]
  const cols = useMemo(() => {
    const vandaag = new Date()
    const start = zoom === 'maand'
      ? new Date(vandaag.getFullYear(), vandaag.getMonth() - HISTORY_BACK.maand, 1)
      : new Date(getWeekStart(vandaag))
    if (zoom === 'week')  start.setDate(start.getDate() - HISTORY_BACK.week * 7)
    if (zoom === 'dag')   start.setDate(start.getDate() - HISTORY_BACK.dag)
    return buildCols(zoom, start, colW)
  }, [zoom, colW])

  const totaleBreedte = cols.reduce((som, col) => som + col.widthPx, 0)
  const maandKoppen = useMemo(() => getMonthGroupsFromCols(cols), [cols])

  // Open op vandaag in plaats van op maanden geschiedenis.
  useEffect(() => { naarVandaagGescrold.current = false }, [zoom])
  useEffect(() => {
    if (naarVandaagGescrold.current || !scrollRef.current) return
    const index = cols.findIndex(col => col.isCurrent)
    if (index < 0) return
    const x = cols.slice(0, index).reduce((som, col) => som + col.widthPx, 0)
    scrollRef.current.scrollLeft = Math.max(0, x - 120)
    naarVandaagGescrold.current = true
  }, [cols])

  const zonderDatum = groups.flatMap(groep =>
    groep.items.filter(item => itemPeriode(item) === null).map(item => ({ groep, item })))

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card)' }}>
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

          {groups.map(groep => {
            const metDatum = groep.items
              .map(item => ({ item, periode: itemPeriode(item) }))
              .filter((entry): entry is { item: BoardItem; periode: { van: Date; tot: Date } } => entry.periode !== null)
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
                        <button onClick={() => onOpenItem(item.id)}
                          title={`${item.name} — open in de lijst`}
                          style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                            fontSize: 12.5, color: 'var(--text-primary)', opacity: isDone ? 0.55 : 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
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
                        {balk && (
                          <button onClick={() => onOpenItem(item.id)}
                            title={`${item.name} · ${periode.van.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} – ${periode.tot.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}`}
                            style={{ position: 'absolute', left: balk.left, width: balk.width,
                              top: (RIJ_H - BALK_H) / 2, height: BALK_H, borderRadius: 5, border: 0, cursor: 'pointer',
                              background: groep.color || color, opacity: isDone ? 0.4 : 0.9,
                              color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '0 6px',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                            {balk.width > 54 ? item.name : ''}
                          </button>
                        )}
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
