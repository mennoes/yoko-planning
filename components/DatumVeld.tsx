'use client'

// Een datumveld dat altijd met de dag begint.
//
// <input type="date"> laat die volgorde niet kiezen: de browser gebruikt
// zijn eigen taalinstelling en niet lang="nl", dus in een Engelse Chrome
// staat er 11/04/2026 waar 4 november bedoeld is. Daarom een tekstveld
// met dd-mm-jjjj, en de kalender van de browser nog als knopje ernaast
// voor wie liever prikt dan typt.

import { useEffect, useState } from 'react'
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
        <span title="Kalender openen" style={{
          position: 'relative', width: 26, minWidth: 26, height: 28,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', lineHeight: 0, flexShrink: 0,
        }}>
          {/* De date-input ligt echt over het icoon. De oude input was 0×0
              pixels en had pointer-events:none; showPicker() werd daardoor
              in Chrome geregeld geweigerd. Een directe gebruikersklik op
              een invoer met echte afmetingen opent de kalender betrouwbaar. */}
          <IconAgenda size={14} />
          <input type="date" min={min} value={value ?? ''}
            data-testid="datum-kalender"
            aria-label={ariaLabel ? `${ariaLabel} kiezen` : 'Kies een datum'}
            onChange={event => onChange(event.target.value || null)}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              opacity: 0, cursor: 'pointer', border: 0, padding: 0,
            }} />
        </span>
      )}
    </span>
  )
}
