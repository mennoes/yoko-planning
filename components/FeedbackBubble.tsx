'use client'

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useProfile } from './ProfileContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { IconClose, IconComment } from './Icon'
import {
  loadFeedback, submitFeedback, toggleUpvote, deleteFeedback, onFeedbackChange,
  type FeedbackItem, type FeedbackKind,
} from '@/lib/feedbackStore'

const KIND_LABEL: Record<FeedbackKind, string> = {
  bug:      'Bug',
  idee:     'Idee',
  feedback: 'Feedback',
}
const KIND_COLOR: Record<FeedbackKind, string> = {
  bug:      '#e2445c',
  idee:     '#D8B62E',
  feedback: '#579bfc',
}

function fmtRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)    return 'zojuist'
  if (diff < 60)   return `${diff}m`
  if (diff < 1440) return `${Math.floor(diff / 60)}u`
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export function FeedbackBubble() {
  const { profile } = useProfile()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [filter, setFilter] = useState<FeedbackKind | 'all'>('all')
  const [draftKind, setDraftKind] = useState<FeedbackKind>('idee')
  const [draftBody, setDraftBody] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setItems(loadFeedback())
    const off = onFeedbackChange(() => setItems(loadFeedback()))
    return () => off()
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const filtered = useMemo(() => {
    const list = filter === 'all' ? items : items.filter(i => i.kind === filter)
    return [...list].sort((a, b) => {
      // Eerst op upvotes (desc), daarna op datum (desc)
      if (b.upvotes.length !== a.upvotes.length) return b.upvotes.length - a.upvotes.length
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [items, filter])

  async function onSubmit() {
    const body = draftBody.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await submitFeedback(draftKind, body, profile?.memberId ?? null, profile?.name ?? null)
      setDraftBody('')
    } finally {
      setBusy(false)
    }
  }

  async function onToggleUpvote(id: string) {
    if (!profile?.memberId) return
    await toggleUpvote(id, profile.memberId)
  }

  async function onDelete(id: string) {
    if (!confirm('Verwijderen?')) return
    await deleteFeedback(id)
  }

  if (typeof document === 'undefined') return null

  const bubble = (
    <button
      onClick={() => setOpen(o => !o)}
      aria-label="Feedback / ideeën"
      title="Feedback / ideeën"
      style={{
        position: 'fixed',
        right: 16,
        bottom: `max(16px, env(safe-area-inset-bottom))`,
        width: 48, height: 48, borderRadius: '50%',
        background: 'var(--accent)', color: '#000',
        border: 'none', cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 80, padding: 0,
      }}>
      <IconComment size={22} strokeWidth={2} />
    </button>
  )

  if (!open) return createPortal(bubble, document.body)

  const myUpvote = (i: FeedbackItem) => profile?.memberId ? i.upvotes.includes(profile.memberId) : false

  const panel = (
    <>
      <div onClick={() => setOpen(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 9000, backdropFilter: 'blur(2px)' }} />
      <div onClick={e => e.stopPropagation()}
        style={isMobile ? {
          position: 'fixed', left: 0, right: 0, bottom: 0,
          maxHeight: '85vh', zIndex: 9001,
          background: 'var(--bg-card)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          borderTop: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        } : {
          position: 'fixed', right: 16, bottom: 16,
          width: 380, maxHeight: '80vh', zIndex: 9001,
          background: 'var(--bg-card)',
          borderRadius: 14, border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 14px 50px rgba(0,0,0,0.3)',
        }}>

        {/* Header */}
        <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Feedback & ideeën</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Iedereen ziet alles. Stem op wat jij belangrijk vindt.</div>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Sluiten"
            style={{ background: 'var(--bg-hover)', border: 'none', cursor: 'pointer',
              width: 30, height: 30, borderRadius: 7, color: 'var(--text-secondary)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            <IconClose size={16} />
          </button>
        </div>

        {/* New submission form */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'inline-flex', background: 'var(--bg-hover)',
            borderRadius: 8, padding: 2, alignSelf: 'flex-start' }}>
            {(['idee', 'bug', 'feedback'] as FeedbackKind[]).map(k => (
              <button key={k} onClick={() => setDraftKind(k)}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none',
                  background: draftKind === k ? 'var(--bg-card)' : 'transparent',
                  color: draftKind === k ? KIND_COLOR[k] : 'var(--text-muted)',
                  fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                  boxShadow: draftKind === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <textarea value={draftBody}
            onChange={e => setDraftBody(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit() }}
            placeholder={
              draftKind === 'bug'      ? 'Wat ging er mis? (Cmd+Enter om te versturen)' :
              draftKind === 'idee'     ? 'Welk idee heb je? (Cmd+Enter om te versturen)' :
                                          'Schrijf je feedback… (Cmd+Enter om te versturen)'
            }
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '8px 10px',
              color: 'var(--text-primary)', fontSize: 13.5, lineHeight: 1.45,
              outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onSubmit} disabled={!draftBody.trim() || busy}
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none',
                background: draftBody.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                color: draftBody.trim() ? '#000' : 'var(--text-muted)',
                fontSize: 12.5, fontWeight: 700,
                cursor: draftBody.trim() && !busy ? 'pointer' : 'not-allowed' }}>
              {busy ? 'Versturen…' : 'Plaatsen'}
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ padding: '10px 16px 6px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', gap: 4, overflowX: 'auto' }}>
          {([
            { v: 'all',      l: 'Alles' },
            { v: 'idee',     l: 'Ideeën' },
            { v: 'bug',      l: 'Bugs' },
            { v: 'feedback', l: 'Feedback' },
          ] as Array<{ v: FeedbackKind | 'all'; l: string }>).map(t => (
            <button key={t.v} onClick={() => setFilter(t.v)}
              style={{
                padding: '4px 10px', borderRadius: 999, border: 'none',
                background: filter === t.v ? 'var(--accent-light)' : 'transparent',
                color: filter === t.v ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 11.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
              }}>
              {t.l}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 14px' }}>
          {filtered.length === 0 ? (
            <p style={{ padding: '14px 6px', fontSize: 13, color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
              Nog geen items in deze categorie.
            </p>
          ) : filtered.map(item => {
            const mine    = profile?.memberId && item.authorId === profile.memberId
            const upvoted = myUpvote(item)
            return (
              <div key={item.id}
                style={{ display: 'flex', gap: 10, padding: '10px 6px',
                  borderBottom: '1px solid var(--border-light)' }}>
                <button onClick={() => onToggleUpvote(item.id)} disabled={!profile?.memberId}
                  title={upvoted ? 'Stem intrekken' : 'Mee eens'}
                  style={{ flexShrink: 0, width: 38, padding: '4px 0',
                    background: upvoted ? 'var(--accent-light)' : 'var(--bg-hover)',
                    border: `1px solid ${upvoted ? 'var(--accent)' : 'var(--border-light)'}`,
                    borderRadius: 7, cursor: profile?.memberId ? 'pointer' : 'default',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    color: upvoted ? 'var(--accent)' : 'var(--text-muted)' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>▲</span>
                  <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1, color: 'var(--text-primary)' }}>{item.upvotes.length}</span>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                      padding: '1px 6px', borderRadius: 4,
                      background: KIND_COLOR[item.kind] + '22',
                      color: KIND_COLOR[item.kind],
                    }}>{KIND_LABEL[item.kind]}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {item.authorName ?? 'Iemand'} · {fmtRelative(item.createdAt)}
                    </span>
                    {mine && (
                      <button onClick={() => onDelete(item.id)} title="Verwijderen"
                        style={{ marginLeft: 'auto', background: 'none', border: 'none',
                          color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 2 }}>×</button>
                    )}
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45 }}>
                    {item.body}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )

  return createPortal(<>{bubble}{panel}</>, document.body)
}
