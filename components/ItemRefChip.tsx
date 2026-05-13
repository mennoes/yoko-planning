'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { resolveItemRef, itemRefHrefFor, parseItemRefs } from '@/lib/itemRefs'

// Visuele weergave van één item-referentie. Klikbaar → opent het bord met
// ?focus=<id> zodat BoardTable de juiste rij flasht.
export function ItemRefChip({ boardId, itemId, compact }: {
  boardId: string
  itemId:  string
  compact?: boolean
}) {
  const info = useMemo(() => resolveItemRef(boardId, itemId), [boardId, itemId])
  return (
    <Link href={itemRefHrefFor(boardId, itemId)}
      title={info.exists ? `${info.name} · in ${boardId}` : 'Item is verwijderd of bestaat niet'}
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: compact ? '0 7px' : '2px 9px 2px 7px',
        borderRadius: 12,
        background: info.exists ? `${info.color}22` : 'transparent',
        border: `1px solid ${info.exists ? `${info.color}66` : 'var(--border)'}`,
        color: info.exists ? 'var(--text-primary)' : 'var(--text-muted)',
        fontSize: compact ? 11.5 : 12.5,
        fontWeight: 500,
        textDecoration: 'none',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        lineHeight: compact ? 1.4 : 1.55,
      }}>
      <span style={{ width: 6, height: 6, borderRadius: 2, background: info.color, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
        {info.exists ? info.name : '(verwijderd)'}
      </span>
    </Link>
  )
}

// Render een willekeurige tekst-string waarin `#item:<board>:<id>` tokens
// kunnen voorkomen. Tekst-stukken worden as-is uitgespuugd, refs als chip.
export function TextWithItemRefs({ text, compact }: { text: string; compact?: boolean }) {
  const parts = useMemo(() => parseItemRefs(text), [text])
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.value}</span>
        return <ItemRefChip key={i} boardId={p.ref!.boardId} itemId={p.ref!.itemId} compact={compact} />
      })}
    </>
  )
}
