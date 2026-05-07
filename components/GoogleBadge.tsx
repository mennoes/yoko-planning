'use client'

import type { CSSProperties } from 'react'

type Props = { href?: string; size?: number; style?: CSSProperties; title?: string }

export function GoogleBadge({ href, size = 14, style, title = 'Google Calendar — bewerk in Google' }: Props) {
  const inner = (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size + 2, height: size + 2, borderRadius: 4,
        background: 'var(--sup-yellow)', color: '#000',
        fontSize: size - 3, fontWeight: 800, lineHeight: 1,
        flexShrink: 0,
        ...style,
      }}>
      G
    </span>
  )
  if (!href) return inner
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      style={{ textDecoration: 'none', flexShrink: 0 }}>
      {inner}
    </a>
  )
}
