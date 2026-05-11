'use client'

import { useRef, useState, useEffect } from 'react'
import teamData from '@/data/team.json'

type Member = { id: string; name: string; color?: string }
const MEMBERS: Member[] = teamData.members as Member[]

/**
 * Textarea met @-mention autocomplete. Wanneer de cursor net achter
 * een `@` staat verschijnt er een dropdown met team-leden, gefilterd op
 * de tekst na de `@`. Pijl-omhoog/-omlaag navigeert, Enter (of klik)
 * voegt `@Voornaam ` in. De `onMentionsChange` callback rapporteert
 * welke member_ids er nu in de tekst staan.
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
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [idx, setIdx]       = useState(0)

  // detecteer "@filter" net vóór de caret bij elke change
  function detectMention(text: string, caret: number) {
    const before = text.slice(0, caret)
    const m = before.match(/(?:^|\s)@([A-Za-z\-]*)$/)
    if (!m) { setOpen(false); return }
    setFilter(m[1])
    setIdx(0)
    setOpen(true)
  }

  function handleChange(v: string) {
    onChange(v)
    const caret = ref.current?.selectionStart ?? v.length
    detectMention(v, caret)
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

  const filtered = open
    ? MEMBERS.filter(m => !filter || m.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 6)
    : []

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
    setOpen(false)
    // herstel cursor positie net achter de mention
    requestAnimationFrame(() => {
      if (!ta) return
      const pos = start + insert.length
      ta.focus(); ta.setSelectionRange(pos, pos)
    })
    onMentionsChange?.(currentMentionIds(newVal))
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
          if (open && filtered.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(filtered.length - 1, i + 1)); return }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); return }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault(); applyMember(filtered[idx]); return
            }
            if (e.key === 'Escape') { setOpen(false); return }
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
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4, minWidth: 200, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          zIndex: 9100,
        }}>
          {filtered.map((m, i) => (
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
    </div>
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
