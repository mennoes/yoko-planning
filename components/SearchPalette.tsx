'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { IconSearch } from './Icon'
import { useProfile } from './ProfileContext'
import { loadRecentPages } from '@/lib/pagesStore'
import { loadGroups, BOARD_NAMES } from '@/lib/boardStore'
import { markAllRead } from '@/lib/notificationsStore'
import yokoRaw       from '@/data/boards/yoko.json'
import pnpRaw        from '@/data/boards/pnp.json'
import nederlandRaw  from '@/data/boards/nederland.json'
import vlaanderenRaw from '@/data/boards/vlaanderen.json'
import dienjaarRaw   from '@/data/boards/dienjaar.json'
import { pullAccounts } from '@/lib/accountsStore'
import type { BoardGroup } from '@/lib/boards'

const BOARD_RAW: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw,
  vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
}

type Result = {
  id:       string
  title:    string
  subtitle: string
  href:     string
  emoji:    string
  action?:  () => void  // wanneer gezet wordt deze i.p.v. de href uitgevoerd
}

type TodoSection = { id: string; title: string; emoji: string; items: { id: string; text: string; done: boolean }[] }

function loadTodoSections(): TodoSection[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem('yoko-todos'); return s ? JSON.parse(s) : [] } catch { return [] }
}

export default function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { profile } = useProfile()
  const [query, setQuery] = useState('')
  const [data, setData]   = useState<Result[]>([])
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    if (!open) return
    setQuery(''); setHighlight(0)

    const all: Result[] = []

    // ─── Acties bovenaan ──────────────────────────────────────────────────
    // Komen eerst zodat ze direct boven de search-results staan zodra je
    // ze typt ('mark', 'thema', 'naar', etc.)
    all.push({
      id: 'cmd-new-todo', title: 'Nieuwe todo toevoegen…', subtitle: 'Actie · type een naam en druk Enter',
      href: '/todos', emoji: '➕',
    })
    if (profile?.memberId) {
      const me = profile.memberId
      all.push({
        id: 'cmd-mark-read', title: 'Markeer alle meldingen als gelezen', subtitle: 'Actie · 🔔',
        href: '', emoji: '✓', action: () => { onClose(); markAllRead(me).catch(() => {}) },
      })
    }
    for (const t of ['auto','dark','light'] as const) {
      const label = t === 'auto' ? 'Thema: automatisch' : t === 'dark' ? 'Thema: donker' : 'Thema: licht'
      all.push({
        id: `cmd-theme-${t}`, title: label, subtitle: 'Actie · 🎨',
        href: '', emoji: t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '⚙️',
        action: () => {
          try {
            localStorage.setItem('theme', t)
            // Direct toepassen op <html> zodat het zonder refresh werkt.
            const applied = t === 'auto'
              ? (new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'light' : 'dark')
              : t
            document.documentElement.setAttribute('data-theme', applied)
          } catch {}
          onClose()
        },
      })
    }
    for (const b of BOARD_NAMES) {
      all.push({
        id: `cmd-open-board-${b}`, title: `Open agenda ${b}`, subtitle: 'Actie · agenda',
        href: `/projects/${b}`, emoji: '📋',
      })
    }

    // ─── Pages ────────────────────────────────────────────────────────────
    for (const p of loadRecentPages()) {
      all.push({ id: `page-${p.id}`, title: p.title || 'Naamloos', subtitle: 'Document', href: `/pages/${p.id}`, emoji: p.emoji || '📄' })
    }

    // Board items
    for (const board of BOARD_NAMES) {
      const groups = loadGroups(board, BOARD_RAW[board].groups as BoardGroup[])
      for (const g of groups) for (const item of g.items) {
        all.push({ id: `board-${board}-${item.id}`, title: item.name, subtitle: `${board} · ${g.name}`, href: `/projects/${board}`, emoji: '📌' })
      }
    }

    // Todos
    for (const s of loadTodoSections()) for (const t of s.items) {
      if (!t.done) all.push({ id: `todo-${s.id}-${t.id}`, title: t.text, subtitle: `Todo · ${s.title}`, href: '/todos', emoji: '✅' })
    }

    // Accounts — alleen voor ingelogde gebruikers, achter Supabase RLS.
    // We laden async; bij anon-toegang krijgen we niks terug en blijft
    // het palette zonder account-results (geen lek van titels).
    pullAccounts().then(rows => {
      if (!rows) return
      setData(prev => [
        ...prev,
        ...rows.map(a => ({ id: `account-${a.id}`, title: a.account, subtitle: 'Account', href: '/accounts', emoji: '🔑' })),
      ])
    })

    // Static pages
    all.push({ id: 'nav-home',     title: 'Home',       subtitle: 'Pagina',  href: '/',          emoji: '🏠' })
    all.push({ id: 'nav-planning', title: 'Planning',   subtitle: 'Pagina',  href: '/planning',  emoji: '📅' })
    all.push({ id: 'nav-todos',    title: "Todo's",     subtitle: 'Pagina',  href: '/todos',     emoji: '✅' })
    all.push({ id: 'nav-team',     title: 'Team',       subtitle: 'Pagina',  href: '/team',      emoji: '👥' })
    all.push({ id: 'nav-kantoor',  title: 'Kantoor',    subtitle: 'Pagina',  href: '/kantoor',   emoji: '🏢' })
    all.push({ id: 'nav-activity', title: 'Activiteit', subtitle: 'Pagina',  href: '/activity',  emoji: '📜' })
    all.push({ id: 'nav-accounts', title: 'Accounts',   subtitle: 'Pagina',  href: '/accounts',  emoji: '🔑' })

    setData(all)
  }, [open, profile?.memberId, onClose])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data.slice(0, 12)
    return data
      .filter(r => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q))
      .slice(0, 30)
  }, [query, data])

  useEffect(() => { setHighlight(0) }, [query])

  function go(r: Result) {
    if (r.action) { r.action(); return }
    onClose(); router.push(r.href)
  }

  function quickAddTodo() {
    const text = query.trim()
    if (!text) return
    const sections = loadTodoSections()
    let inbox = sections.find(s => s.id === 'inbox')
    if (!inbox) { inbox = { id: 'inbox', title: 'Inbox', emoji: '📥', items: [] }; sections.unshift(inbox) }
    inbox.items = [...inbox.items, { id: Date.now().toString(), text, done: false }]
    localStorage.setItem('yoko-todos', JSON.stringify(sections))
    onClose(); router.push('/todos')
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight < results.length) go(results[highlight])
      else if (query.trim()) quickAddTodo()
    }
  }

  if (!open) return null

  return (
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 280, background: 'rgba(0,0,0,0.45)' }} />
      <div style={{
        position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)',
        zIndex: 281, background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 14,
        width: 560, maxWidth: '94vw', maxHeight: '70vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 18px 48px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconSearch size={18} style={{ color: 'var(--text-muted)' }} />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder="Zoek of typ om een todo toe te voegen…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 16 }} />
          <kbd style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>esc</kbd>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 14 }}>
              {query.trim() ? (
                <button onClick={quickAddTodo}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--bg-hover)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 14, textAlign: 'left' }}>
                  + Voeg <strong>“{query.trim()}”</strong> toe als todo (Inbox)
                </button>
              ) : 'Geen resultaten.'}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: '6px 0' }}>
              {results.map((r, i) => (
                <li key={r.id}>
                  <button onClick={() => go(r)} onMouseEnter={() => setHighlight(i)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 16px', textAlign: 'left', border: 'none',
                      background: highlight === i ? 'var(--bg-hover)' : 'transparent',
                      cursor: 'pointer', color: 'var(--text-primary)' }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{r.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subtitle}</div>
                    </div>
                  </button>
                </li>
              ))}
              {query.trim() && (
                <li>
                  <button onClick={quickAddTodo} onMouseEnter={() => setHighlight(results.length)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 16px', textAlign: 'left', border: 'none',
                      background: highlight === results.length ? 'var(--bg-hover)' : 'transparent',
                      cursor: 'pointer', color: 'var(--text-primary)', borderTop: '1px solid var(--border-light)', fontWeight: 600 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>＋</span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>Voeg “{query.trim()}” toe als todo</span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
