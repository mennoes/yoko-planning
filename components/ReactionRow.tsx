'use client'

import { useState } from 'react'
import teamData from '@/data/team.json'
import { QUICK_REACTIONS } from '@/lib/commentsStore'

const MEMBERS = teamData.members as Array<{ id: string; name: string }>

/**
 * Compacte rij met reactie-chips onder een opmerking. Bestaande reacties
 * krijgen een chip met emoji + telling; klik = toggle (jouw reactie
 * toevoegen / verwijderen). Een '+' knop opent een mini-picker met de
 * vijf snelle emojis. Hover op een chip toont wie er reageerden.
 */
export function ReactionRow({ reactions, currentMemberId, onToggle }: {
  reactions: Record<string, string[]> | undefined
  currentMemberId: string | undefined
  onToggle: (emoji: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const entries = Object.entries(reactions ?? {}).filter(([, ids]) => ids.length > 0)

  function tooltip(ids: string[]): string {
    const names = ids.map(id => MEMBERS.find(m => m.id === id)?.name?.split(' ')[0] ?? id)
    return names.join(', ')
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, position: 'relative' }}>
      {entries.map(([emoji, ids]) => {
        const mine = currentMemberId ? ids.includes(currentMemberId) : false
        return (
          <button key={emoji}
            onClick={() => onToggle(emoji)}
            title={tooltip(ids)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '1px 7px', borderRadius: 999,
              border: `1px solid ${mine ? 'var(--accent)' : 'var(--border-light)'}`,
              background: mine ? 'var(--accent-light)' : 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              fontSize: 11.5, lineHeight: 1.6, cursor: 'pointer',
            }}>
            <span style={{ fontSize: 12 }}>{emoji}</span>
            <span style={{ fontWeight: 600 }}>{ids.length}</span>
          </button>
        )
      })}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setPickerOpen(o => !o)}
          title="Reactie toevoegen"
          style={{
            background: 'none', border: '1px dashed var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer',
            padding: '1px 7px', borderRadius: 999, fontSize: 11.5, lineHeight: 1.6,
          }}>
          ☺ +
        </button>
        {pickerOpen && (
          <>
            <div onClick={() => setPickerOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }} />
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 51,
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
              padding: 4, display: 'flex', gap: 2,
              boxShadow: '0 12px 24px rgba(0,0,0,0.20)',
            }}>
              {QUICK_REACTIONS.map(e => (
                <button key={e} onClick={() => { onToggle(e); setPickerOpen(false) }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 17, padding: '3px 5px', borderRadius: 5,
                  }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
                  {e}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
