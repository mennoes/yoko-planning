'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { VacationModal } from './VacationModal'

// Reusable vacation request button.
// `variant='row'`  → settings-popup style row (transparent, full width).
// `variant='chip'` → compact chip with border, fits in tight UIs / on the home card.
export function VacationButton({ variant = 'row' }: { variant?: 'row' | 'chip' }) {
  const [open, setOpen]             = useState(false)
  const [fromDraft, setFromDraft]   = useState('')
  const [untilDraft, setUntilDraft] = useState('')
  const [active, setActive]         = useState<{ from: string | null; until: string | null }>({ from: null, until: null })

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id; if (!uid || cancelled) return
      supabase!.from('profiles').select('vacation_from, vacation_until').eq('user_id', uid).maybeSingle()
        .then(({ data: row }) => {
          if (cancelled || !row) return
          const r = row as { vacation_from?: string | null; vacation_until?: string | null }
          setActive({ from: r.vacation_from ?? null, until: r.vacation_until ?? null })
        })
    })
    return () => { cancelled = true }
  }, [])

  const onVacation = !!active.until && new Date(active.until).getTime() > Date.now()
  const fmt = (d: string) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  const label = onVacation
    ? (active.from ? `${fmt(active.from)} – ${fmt(active.until!)}` : `tot ${fmt(active.until!)}`)
    : 'Vakantie aanvragen'

  async function save(f: string | null, u: string | null) {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user?.id; if (!uid) return
    await supabase.from('profiles').update({ vacation_from: f, vacation_until: u }).eq('user_id', uid)
    setActive({ from: f, until: u })
  }

  const rowStyle: React.CSSProperties = variant === 'row'
    ? {
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 8,
        border: 'none',
        background: 'transparent',
        color: 'var(--text-primary)',
        fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
      }
    : {
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '6px 12px', borderRadius: 999,
        border: `1px solid ${onVacation ? 'rgba(255,123,36,0.5)' : 'var(--border)'}`,
        background: onVacation ? 'rgba(255,123,36,0.15)' : 'var(--bg-card)',
        color: onVacation ? '#a05400' : 'var(--text-primary)',
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
      }

  return (
    <>
      <button onClick={() => { setFromDraft(active.from ?? ''); setUntilDraft(active.until ?? ''); setOpen(true) }}
        style={rowStyle}>
        <span style={{ fontSize: 14 }}>🏝</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <VacationModal
          fromDraft={fromDraft} setFromDraft={setFromDraft}
          untilDraft={untilDraft} setUntilDraft={setUntilDraft}
          canClear={!!active.from || !!active.until}
          onClose={() => setOpen(false)}
          onSave={() => { save(fromDraft || null, untilDraft || null); setOpen(false) }}
          onClear={() => { save(null, null); setOpen(false) }} />,
        document.body)}
    </>
  )
}
