'use client'

import { useRef, useState, useEffect } from 'react'
import teamData from '@/data/team.json'
import { loadAllItemsFlat, formatItemRef, type ItemRefResolved } from '@/lib/itemRefs'

type Member = { id: string; name: string; color?: string }
const MEMBERS: Member[] = teamData.members as Member[]

type Mode = 'mention' | 'itemref'
type ItemOpt = ItemRefResolved

/**
 * Textarea met @-mention en #item-referentie autocomplete.
 *
 * `@` opent een dropdown met team-leden, gefilterd op de tekst na de `@`.
 * Pijl-omhoog/-omlaag navigeert, Enter (of klik) voegt `@Voornaam ` in.
 *
 * `#` opent een dropdown met board-items uit alle bordjes, gefilterd op
 * naam. Selecteren voegt een token `#item:<board>:<id>` in dat bij
 * rendering wordt vervangen door een klikbare chip
 * (zie {@link TextWithItemRefs}).
 *
 * `onMentionsChange` rapporteert welke member_ids er nu in de tekst staan.
 */
export function MentionTextarea({
  value, onChange, onMentionsChange, placeholder, rows = 2, autoFocus,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onMentionsChange?: (ids: string[]) => void
  placeholder?: string
  rows?: number
  autoFocus?: boolean
  onSubmit?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [filter, setFilter] = useState('')
  const [idx, setIdx]       = useState(0)
  const [allItems, setAllItems] = useState<ItemOpt[]>([])

  // Laad alle board-items een keer + ververs als een bord wijzigt zodat
  // nieuwe items meteen vindbaar zijn vanuit de picker.
  useEffect(() => {
    function refresh() { setAllItems(loadAllItemsFlat()) }
    refresh()
    window.addEventListener('yoko-board-update', refresh)
    return () => window.removeEventListener('yoko-board-update', refresh)
  }, [])

  // detecteer "@filter" of "#filter" net vóór de caret
  function detectTrigger(text: string, caret: number) {
    const before = text.slice(0, caret)
    const mAt = before.match(/(?:^|\s)@([A-Za-z\-]*)$/)
    if (mAt) { setMode('mention'); setFilter(mAt[1]); setIdx(0); return }
    const mHash = before.match(/(?:^|\s)#([A-Za-z0-9\-_ ]*)$/)
    if (mHash) { setMode('itemref'); setFilter(mHash[1]); setIdx(0); return }
    setMode(null)
  }

  function handleChange(v: string) {
    onChange(v)
    const caret = ref.current?.selectionStart ?? v.length
    detectTrigger(v, caret)
    onMentionsChange?.(currentMentionIds(v))
  }

  function currentMentionIds(v: string): string[] {
    const found = new Set<string>()
    for (const m of MEMBERS) {
      const first = m.name.split(' ')[0]
      const re = new RegExp(`(^|\\s)@${escapeRegex(first)}\\b`, 'i')
      if (re.test(v)) found.add(m.id)
    }
    return [...found]
  }

  const filteredMembers = mode === 'mention'
    ? MEMBERS.filter(m => !filter || m.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 6)
    : []
  const filteredItems = mode === 'itemref'
    ? allItems
        .filter(i => !filter || i.name.toLowerCase().includes(filter.toLowerCase()))
        .slice(0, 8)
    : []
  const filteredCount = mode === 'mention' ? filteredMembers.length : filteredItems.length

  function applyMember(m: Member) {
    const ta = ref.current
    if (!ta) return
    const caret = ta.selectionStart
    const before = value.slice(0, caret)
    const after  = value.slice(caret)
    const mention = before.match(/(?:^|\s)@([A-Za-z\-]*)$/)
    if (!mention) return
    const start = caret - mention[1].length - 1   // include the '@'
    const firstName = m.name.split(' ')[0]
    const insert = `@${firstName} `
    const newVal = before.slice(0, start) + insert + after
    onChange(newVal)
    setMode(null)
    requestAnimationFrame(() => {
      if (!ta) return
      const pos = start + insert.length
      ta.focus(); ta.setSelectionRange(pos, pos)
    })
    onMentionsChange?.(currentMentionIds(newVal))
  }

  function applyItem(it: ItemOpt) {
    const ta = ref.current
    if (!ta) return
    const caret = ta.selectionStart
    const before = value.slice(0, caret)
    const after  = value.slice(caret)
    const trig = before.match(/(?:^|\s)#([A-Za-z0-9\-_ ]*)$/)
    if (!trig) return
    const start = caret - trig[1].length - 1  // include de '#'
    const insert = formatItemRef(it.boardId, it.itemId) + ' '
    const newVal = before.slice(0, start) + insert + after
    onChange(newVal)
    setMode(null)
    requestAnimationFrame(() => {
      if (!ta) return
      const pos = start + insert.length
      ta.focus(); ta.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => ref.current?.focus())
  }, [autoFocus])

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <textarea ref={ref}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={e => {
          if (mode && filteredCount > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(filteredCount - 1, i + 1)); return }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); return }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              if (mode === 'mention') applyMember(filteredMembers[idx])
              else                    applyItem(filteredItems[idx])
              return
            }
            if (e.key === 'Escape') { setMode(null); return }
          }
          if (onSubmit && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault(); onSubmit(); return
          }
        }}
        placeholder={placeholder}
        rows={rows}
        style={{
          width: '100%',
          background: 'var(--bg-hover)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 8px', color: 'var(--text-primary)',
          fontSize: 13, outline: 'none', resize: 'vertical',
          boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />
      {mode === 'mention' && filteredMembers.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4, minWidth: 200, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          zIndex: 9100,
        }}>
          {filteredMembers.map((m, i) => (
            <button key={m.id}
              onMouseDown={e => { e.preventDefault(); applyMember(m) }}
              onMouseEnter={() => setIdx(i)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 5, textAlign: 'left',
                background: i === idx ? 'var(--bg-hover)' : 'transparent',
                border: 'none', cursor: 'pointer', fontSize: 13,
                color: 'var(--text-primary)',
              }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color ?? '#888', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{m.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{m.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      )}
      {mode === 'itemref' && filteredItems.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4, minWidth: 280, maxWidth: 360, maxHeight: 280, overflowY: 'auto',
          boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          zIndex: 9100,
        }}>
          <div style={{ padding: '4px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Items · {filteredItems.length}
          </div>
          {filteredItems.map((it, i) => (
            <button key={`${it.boardId}-${it.itemId}`}
              onMouseDown={e => { e.preventDefault(); applyItem(it) }}
              onMouseEnter={() => setIdx(i)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 5, textAlign: 'left',
                background: i === idx ? 'var(--bg-hover)' : 'transparent',
                border: 'none', cursor: 'pointer', fontSize: 13,
                color: 'var(--text-primary)',
              }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: it.color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{it.boardId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
