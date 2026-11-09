'use client'

// Een datumveld dat altijd met de dag begint.
//
// Het tekstveld gebruikt altijd dd-mm-jjjj. Het kalendericoon opent onze
// eigen maandkalender, zodat de werking en vorm niet afhangen van de taal
// of datumkiezer van de browser.

import { useCallback, useEffect, useRef, useState } from 'react'
import { naarIso, naarNl } from '@/lib/datumInvoer'
import { IconAgenda } from './Icon'
import SingleDateCalendar from './SingleDateCalendar'

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
  const [kalenderOpen, setKalenderOpen] = useState(false)
  const kalenderKnop = useRef<HTMLButtonElement>(null)
  const sluitKalender = useCallback(() => setKalenderOpen(false), [])

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
          <button ref={kalenderKnop} type="button" data-testid="datum-kalender"
            aria-label={ariaLabel ? `${ariaLabel} kiezen` : 'Kies een datum'}
            aria-haspopup="dialog" aria-expanded={kalenderOpen} title="Kalender openen"
            // Voorkom dat EditableCell zijn onBlur afvuurt en de editor
            // verwijdert voordat de kalender kan openen.
            onMouseDown={event => event.preventDefault()}
            onClick={() => setKalenderOpen(open => !open)}
            style={{
              width: 26, minWidth: 26, height: 28, padding: 0, border: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: kalenderOpen ? 'var(--bg-hover)' : 'transparent', borderRadius: 5,
              color: kalenderOpen ? 'var(--text-primary)' : 'var(--text-muted)',
              lineHeight: 0, flexShrink: 0, cursor: 'pointer',
            }}>
          <IconAgenda size={14} />
          </button>
          {kalenderOpen && <SingleDateCalendar anchor={kalenderKnop} value={value ?? null} min={min}
            onClose={sluitKalender}
            onChange={date => {
              setConcept(naarNl(date))
              onChange(date)
            }} />}
        </>
      )}
    </span>
  )
}
