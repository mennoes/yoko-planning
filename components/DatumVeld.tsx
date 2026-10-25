'use client'

// Een datumveld dat altijd met de dag begint.
//
// <input type="date"> laat die volgorde niet kiezen: de browser gebruikt
// zijn eigen taalinstelling en niet lang="nl", dus in een Engelse Chrome
// staat er 11/04/2026 waar 4 november bedoeld is. Daarom een tekstveld
// met dd-mm-jjjj, en de kalender van de browser nog als knopje ernaast
// voor wie liever prikt dan typt.

import { useEffect, useRef, useState } from 'react'
import { naarIso, naarNl } from '@/lib/datumInvoer'
import { IconAgenda } from './Icon'

export function DatumVeld({
  value, onChange, disabled, style, ariaLabel, title, autoFocus, onBlur, min,
}: {
  /** ISO: 'jjjj-mm-dd', of leeg. */
  value: string | null | undefined
  onChange: (iso: string | null) => void
  disabled?: boolean
  style?: React.CSSProperties
  ariaLabel?: string
  title?: string
  autoFocus?: boolean
  onBlur?: () => void
  min?: string
}) {
  const [concept, setConcept] = useState(() => naarNl(value))
  const [bezig, setBezig] = useState(false)
  const kalender = useRef<HTMLInputElement>(null)

  // Van buitenaf gewijzigd (undo, een sync, een andere cel) — maar niet
  // terwijl iemand zit te typen, want dan tik je tegen jezelf in.
  useEffect(() => { if (!bezig) setConcept(naarNl(value)) }, [value, bezig])

  function bevestig(tekst: string) {
    if (tekst.trim() === '') {
      if (value) onChange(null)
      setConcept('')
      return
    }
    const iso = naarIso(tekst)
    // Niet te lezen? Zet terug wat er stond; een veld leeggooien omdat
    // iemand zich vertikt is erger dan niets doen.
    if (!iso) { setConcept(naarNl(value)); return }
    setConcept(naarNl(iso))
    if (iso !== (value ?? null)) onChange(iso)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <input
        type="text" inputMode="numeric" autoFocus={autoFocus} disabled={disabled}
        aria-label={ariaLabel} title={title ?? 'Dag-maand-jaar, bijvoorbeeld 04-11-2026'}
        placeholder="dd-mm-jjjj"
        value={concept}
        onFocus={() => setBezig(true)}
        onChange={event => setConcept(event.target.value)}
        onBlur={() => { setBezig(false); bevestig(concept); onBlur?.() }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.currentTarget.blur() }
          if (event.key === 'Escape') { setConcept(naarNl(value)); setBezig(false); event.currentTarget.blur() }
        }}
        style={{ minWidth: 0, ...style }} />
      {!disabled && (
        <>
          <button type="button" tabIndex={-1}
            aria-label="Kies een datum" title="Kalender openen"
            onClick={() => {
              const el = kalender.current
              if (!el) return
              // showPicker is wat je wil; waar die er niet is doet een
              // klik op het veld hetzelfde.
              if (typeof el.showPicker === 'function') el.showPicker()
              else el.click()
            }}
            style={{ border: 0, background: 'none', cursor: 'pointer', padding: '0 3px',
              color: 'var(--text-muted)', lineHeight: 0, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center' }}>
            {/* Een echt icoon uit de set, geen emoji: die rendert per
                besturingssysteem anders en valt uit de toon. */}
            <IconAgenda size={14} />
          </button>
          {/* Alleen voor de kalender zelf; de waarde lees je links af. */}
          <input ref={kalender} type="date" tabIndex={-1} aria-hidden min={min}
            value={value ?? ''}
            onChange={event => onChange(event.target.value || null)}
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} />
        </>
      )}
    </span>
  )
}
