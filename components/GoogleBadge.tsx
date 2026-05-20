'use client'

import type { CSSProperties } from 'react'

type Props = { href?: string; size?: number; style?: CSSProperties; title?: string }

export function GoogleBadge({ href, size = 14, style, title }: Props) {
  // Een klikbare 'pill' wanneer er een Google-link bij hoort, anders een
  // kleine niet-klikbare badge. Hover toont 'Open ↗' zodat 't duidelijk is
  // dat 'ie te openen valt — eerder zat 't te verstopt als 14px-square 'G'.
  const labelTitle = title ?? (href ? 'Open in Google Calendar' : 'Google Calendar item')
  if (!href) {
    return (
      <span title={labelTitle}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: size + 2, height: size + 2, borderRadius: 4,
          background: 'var(--sup-yellow)', color: '#000',
          fontSize: size - 3, fontWeight: 800, lineHeight: 1,
          flexShrink: 0, ...style,
        }}>G</span>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={labelTitle}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 6px 1px 4px', borderRadius: 5,
        background: 'var(--sup-yellow)', color: '#000',
        fontSize: size - 3, fontWeight: 800, lineHeight: 1.2,
        flexShrink: 0, textDecoration: 'none', cursor: 'pointer',
        boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
        ...style,
      }}
      onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(0.92)')}
      onMouseLeave={e => (e.currentTarget.style.filter = 'none')}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, fontSize: size - 4 }}>G</span>
      <span style={{ fontSize: size - 5, fontWeight: 700, opacity: 0.85 }}>↗</span>
    </a>
  )
}
