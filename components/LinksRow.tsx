'use client'

import { useState } from 'react'
import type { ItemLink } from '@/lib/boards'

const LINK_TYPES: Array<{ icon: string; label: string; test: (host: string, url: string) => boolean }> = [
  { icon: 'F',  label: 'Figma',   test: h => h.includes('figma.com') },
  { icon: 'D',  label: 'Drive',   test: h => h.includes('drive.google.com') || h.includes('docs.google.com') },
  { icon: 'YT', label: 'YouTube', test: h => h.includes('youtube.com') || h.includes('youtu.be') },
  { icon: '🎬', label: 'Vimeo',   test: h => h.includes('vimeo.com') },
  { icon: 'NB', label: 'Notion',  test: h => h.includes('notion.so') || h.includes('notion.site') },
  { icon: 'DB', label: 'Dropbox', test: h => h.includes('dropbox.com') },
  { icon: '📷', label: 'Frame',   test: (_h, url) => url.includes('frame.io') },
  { icon: 'GH', label: 'GitHub',  test: h => h.includes('github.com') },
  { icon: 'SL', label: 'Slack',   test: h => h.includes('slack.com') },
]

function detectType(url: string): { icon: string; label: string } {
  try {
    const host = new URL(url).hostname
    for (const t of LINK_TYPES) if (t.test(host, url)) return t
    return { icon: '🔗', label: host.replace(/^www\./, '') }
  } catch {
    return { icon: '🔗', label: 'Link' }
  }
}

function newLinkId(): string {
  return 'l-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

/**
 * Een rij chips met aan een board-item gekoppelde bestanden / URL's.
 * Klik op een chip = open in nieuw tabblad. + knop opent een veldje
 * waar je een URL plakt (eventueel met optioneel label).
 */
export function LinksRow({ links, onChange, readonly }: {
  links: ItemLink[] | undefined
  onChange: (links: ItemLink[]) => void
  readonly?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [url, setUrl]       = useState('')
  const [label, setLabel]   = useState('')
  const arr = links ?? []

  function add() {
    const u = url.trim()
    if (!u) return
    const next: ItemLink = { id: newLinkId(), url: u }
    if (label.trim()) next.label = label.trim()
    onChange([...arr, next])
    setUrl(''); setLabel(''); setAdding(false)
  }
  function remove(id: string) {
    onChange(arr.filter(l => l.id !== id))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {arr.map(link => {
          const t = detectType(link.url)
          const text = link.label || t.label
          return (
            <span key={link.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 4px 4px 8px', borderRadius: 999,
              background: 'var(--bg-hover)', border: '1px solid var(--border-light)',
              fontSize: 12, color: 'var(--text-secondary)', maxWidth: '100%',
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: 4,
                background: 'var(--accent-light)', color: 'var(--accent)',
                fontSize: 9, fontWeight: 800, letterSpacing: '0.02em',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>{t.icon}</span>
              <a href={link.url} target="_blank" rel="noopener noreferrer"
                title={link.url}
                style={{ color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                {text}
              </a>
              {!readonly && (
                <button onClick={() => remove(link.id)}
                  title="Verwijder"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: 14, lineHeight: 1,
                    padding: '0 4px', flexShrink: 0 }}>×</button>
              )}
            </span>
          )
        })}
        {!readonly && !adding && (
          <button onClick={() => setAdding(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 999,
              border: '1px dashed var(--border)', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
            + Link toevoegen
          </button>
        )}
      </div>
      {adding && !readonly && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input autoFocus value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://figma.com/... of andere URL"
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setAdding(false); setUrl(''); setLabel('') } }}
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
          <input value={label} onChange={e => setLabel(e.target.value)}
            placeholder="Optioneel label (anders gebruiken we de hostnaam)"
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setAdding(false); setUrl(''); setLabel('') } }}
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={add} disabled={!url.trim()}
              style={{ padding: '5px 12px', borderRadius: 6, border: 'none',
                background: url.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                color: url.trim() ? '#000' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 700, cursor: url.trim() ? 'pointer' : 'not-allowed' }}>
              Toevoegen
            </button>
            <button onClick={() => { setAdding(false); setUrl(''); setLabel('') }}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
              Annuleer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
