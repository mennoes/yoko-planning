// Radial pie waar je segmenten kunt slepen om de verdeling van een totaal
// (uren, percentages) over meerdere personen aan te passen. Twee modes:
//
//   • interactive: tussen elke twee aangrenzende segmenten verschijnt een
//     draggable "boundary handle". Slepen verschuift het gewicht tussen
//     die twee segmenten — andere blijven gelijk. Som blijft constant.
//
//   • read-only: zelfde visuele opbouw maar zonder handles — handig om in
//     een board-rij of agenda-pill aan te geven WIE er bij een item hoort,
//     met segment-kleuren of mini-avatars in het segment.
//
// Eén SVG-component, geen externe deps. Bewust simpel: lineaire algoritmes
// voor angle ↔ value-mapping, clamp op 0..total per drag-stap.

'use client'
import { useMemo, useRef, useState } from 'react'

export type PieSegment = {
  id:        string
  value:     number
  color:     string
  label?:    string
  avatarUrl?: string | null  // optioneel — getoond als kleine circle in het segment
  initials?: string          // fallback als avatarUrl ontbreekt
}

type Props = {
  segments:     PieSegment[]
  total:        number
  size?:        number        // diameter in px
  interactive?: boolean
  // onChange fired tijdens drag voor live visuele updates. Kan veel keren
  // achter elkaar afgaan — gebruik 'm voor in-memory state, niet voor I/O.
  onChange?:    (next: Record<string, number>) => void
  // onCommit fired ÉÉN keer wanneer de gebruiker de drag loslaat. Hier
  // hoort de DB-push thuis zodat we niet honderden writes per drag doen.
  onCommit?:    (next: Record<string, number>) => void
  className?:   string
  innerLabel?:  string        // optionele tekst middenin (bv. "12u")
  showAvatars?: boolean       // toon mini-avatars/initialen in elk segment
}

// Polar → cartesisch. SVG y-as wijst omlaag, dus we draaien 90° tegen de
// klok in zodat segment 0 op 12-uur start (Monday-stijl voelt natuurlijker).
function polar(cx: number, cy: number, r: number, angleRad: number): [number, number] {
  return [cx + r * Math.cos(angleRad - Math.PI / 2), cy + r * Math.sin(angleRad - Math.PI / 2)]
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  // Voor exact 360° SVG-arc → trek 'm op in twee halve cirkels via twee paths,
  // anders rendert een single-arc niets (start = end). Voor 1 segment dus
  // gewoon een hele cirkel via twee semi-arcs.
  if (endAngle - startAngle >= Math.PI * 2 - 1e-6) {
    const [x1, y1] = polar(cx, cy, r, 0)
    const [x2, y2] = polar(cx, cy, r, Math.PI)
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2} A ${r} ${r} 0 1 1 ${x1} ${y1} Z`
  }
  const [x1, y1] = polar(cx, cy, r, startAngle)
  const [x2, y2] = polar(cx, cy, r, endAngle)
  const large = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}

export function DistributionPie({
  segments, total, size = 120, interactive = false, onChange, onCommit,
  className, innerLabel, showAvatars = false,
}: Props) {
  const cx = size / 2, cy = size / 2
  const r  = size / 2 - 2
  const innerR = r * 0.42

  // Cumulatieve startwaarden per segment — gebruiken we om bij drag exacte
  // angles te koppelen aan value-deltas.
  const cumulative = useMemo(() => {
    const out: number[] = []
    let acc = 0
    for (const s of segments) { out.push(acc); acc += s.value }
    return out
  }, [segments])

  const [drag, setDrag] = useState<{
    boundaryIdx: number
    pointerId:   number
    startAngle:  number
    leftStart:   number  // value van het segment links van de boundary bij drag-start
    rightStart:  number  // value rechts
    leftId:      string
    rightId:     string
  } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  function angleAt(e: PointerEvent | React.PointerEvent): number {
    const svg = svgRef.current
    if (!svg) return 0
    const rect = svg.getBoundingClientRect()
    const x = e.clientX - rect.left - cx
    const y = e.clientY - rect.top  - cy
    // atan2 levert -π..π met 0 op rechts; corrigeer naar 0..2π met 0 op top.
    let a = Math.atan2(y, x) + Math.PI / 2
    if (a < 0) a += Math.PI * 2
    return a
  }

  function startDrag(boundaryIdx: number, e: React.PointerEvent) {
    if (!interactive || !onChange) return
    e.preventDefault()
    e.stopPropagation()
    // Pointer-capture op de SVG zodat móve-events blijven aankomen ook als
    // de cursor over een ander element heen schuift. Anders kan een
    // re-render door onChange de circle remounten en de drag stilvallen.
    try { svgRef.current?.setPointerCapture(e.pointerId) } catch {}

    const leftIdx  = boundaryIdx === 0 ? segments.length - 1 : boundaryIdx - 1
    const rightIdx = boundaryIdx
    // Snapshot van de huidige waarden — vasthouden tijdens de drag zodat
    // onChange-callbacks niet onze own state telkens overschrijven met een
    // stale segments-prop.
    const snapshot: Record<string, number> = {}
    for (const s of segments) snapshot[s.id] = s.value
    const start = {
      boundaryIdx,
      pointerId:  e.pointerId,
      startAngle: angleAt(e),
      leftStart:  segments[leftIdx].value,
      rightStart: segments[rightIdx].value,
      leftId:     segments[leftIdx].id,
      rightId:    segments[rightIdx].id,
    }
    setDrag(start)

    // Laatste payload tijdens drag — onUp gebruikt 'm voor onCommit.
    let latest: Record<string, number> = { ...snapshot }

    // Maximaal totaal dat het paar samen kan dragen: hun originele som. De
    // andere segmenten blijven op hun snapshot-waarde, dus alleen binnen
    // dit paar mag uitgewisseld worden. Voorheen werd geclamped op `total`
    // (de hele taart) waardoor 3+-segment-configuraties boven de 100% konden
    // uitkomen omdat één paar de totale taart opslokte.
    const pairTotal = start.leftStart + start.rightStart

    function onMove(ev: PointerEvent) {
      const cur  = angleAt(ev)
      let dA = cur - start.startAngle
      if (dA >  Math.PI) dA -= Math.PI * 2
      if (dA < -Math.PI) dA += Math.PI * 2
      const dV = (dA / (Math.PI * 2)) * total
      const newLeft  = Math.max(0, Math.min(pairTotal, start.leftStart + dV))
      // Spiegel: wat de linker-buur erbij krijgt, gaat van rechts af. Dat
      // houdt de som van de twee deelnemers EN het totaal constant.
      const realDV   = newLeft - start.leftStart
      const newRight = Math.max(0, start.rightStart - realDV)
      latest = { ...snapshot }
      latest[start.leftId]  = round1(newLeft)
      latest[start.rightId] = round1(newRight)
      onChange?.(latest)
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
      try { svgRef.current?.releasePointerCapture(ev.pointerId) } catch {}
      setDrag(null)
      // Eén keer committen aan het eind — zo doen we niet honderden writes
      // per drag. Alleen wanneer de gebruiker daadwerkelijk iets verschoven
      // heeft (anders is `latest` gelijk aan `snapshot`).
      const moved = Object.keys(latest).some(k => latest[k] !== snapshot[k])
      if (moved) onCommit?.(latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
  }

  if (total <= 0 || segments.length === 0) {
    return (
      <svg width={size} height={size} className={className}>
        <circle cx={cx} cy={cy} r={r} fill="var(--overlay-faint)" stroke="var(--border)" />
      </svg>
    )
  }

  return (
    <svg ref={svgRef} width={size} height={size} className={className} style={{ overflow: 'visible' }}>
      {/* Achtergrond-cirkel zodat 0-value segmenten een lichte schil tonen */}
      <circle cx={cx} cy={cy} r={r} fill="var(--overlay-faint)" />
      {segments.map((s, i) => {
        const start = (cumulative[i]            / total) * Math.PI * 2
        const end   = ((cumulative[i] + s.value)/ total) * Math.PI * 2
        if (s.value <= 0) return null
        const mid   = (start + end) / 2
        const [lx, ly] = polar(cx, cy, r * 0.7, mid)
        return (
          <g key={s.id}>
            <path d={arcPath(cx, cy, r, start, end)} fill={s.color} opacity={drag ? 0.78 : 0.92} />
            {showAvatars && (
              s.avatarUrl ? (
                <image href={s.avatarUrl} x={lx - 11} y={ly - 11} width={22} height={22}
                  clipPath="circle(11px at 11px 11px)" preserveAspectRatio="xMidYMid slice" />
              ) : s.initials ? (
                <g>
                  <circle cx={lx} cy={ly} r={11} fill="#fff" opacity={0.92} />
                  <text x={lx} y={ly + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={s.color}>
                    {s.initials}
                  </text>
                </g>
              ) : null
            )}
          </g>
        )
      })}
      {/* Donut-hole + center-label */}
      <circle cx={cx} cy={cy} r={innerR} fill="var(--bg-card)" stroke="var(--border-light)" />
      {innerLabel && (
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={Math.max(10, size * 0.11)} fontWeight={700} fill="var(--text-secondary)">
          {innerLabel}
        </text>
      )}
      {/* Boundary-handles (alleen wanneer interactive) — een handle per
          aangrenzend segment-paar, gepositioneerd op de buitenrand. */}
      {interactive && segments.length > 1 && segments.map((_, i) => {
        // Skip boundary 0 wanneer we niet wrap-around willen — bij N segmenten
        // bestaan er N boundaries (cirkel sluit zichzelf), wat handig is omdat
        // alle paren bereikbaar zijn. We laten ze allemaal staan.
        const boundaryAngle = (cumulative[i] / total) * Math.PI * 2
        const [hx, hy] = polar(cx, cy, r, boundaryAngle)
        const active = drag?.boundaryIdx === i
        return (
          <g key={`b-${i}`} style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={e => startDrag(i, e)}>
            {/* Onzichtbaar grote hit-zone zodat de handle makkelijker te grijpen
                is — anders moest je een 6px-cirkel exact raken. */}
            <circle cx={hx} cy={hy} r={16} fill="transparent" />
            <circle cx={hx} cy={hy} r={active ? 8 : 6}
              fill={active ? 'var(--accent)' : '#fff'}
              stroke="var(--text-secondary)" strokeWidth={1.5}
              style={{ pointerEvents: 'none' }} />
          </g>
        )
      })}
    </svg>
  )
}

function round1(n: number): number { return Math.round(n * 10) / 10 }
