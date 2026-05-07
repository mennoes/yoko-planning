'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useProfile } from './ProfileContext'
import {
  loadSections, saveSections,
  type NavItem, type SidebarSection,
} from '@/lib/navStore'
import { loadRecentPages, savePage, loadDocFolders, saveDocFolders, type PageDoc, type DocFolder } from '@/lib/pagesStore'
import { requiresAuth, supabase } from '@/lib/supabase'
import {
  startGoogleOAuth, fetchGoogleCalendars, updateGoogleCalendar,
  disconnectGoogle, syncGoogleNow, cleanupGoogleDuplicates,
  type GoogleConnection, type GoogleCalAvailable,
} from '@/lib/googleClient'
import { BOARD_CONFIGS } from '@/lib/boards'
import { pullBoardFromRemote, BOARD_NAMES } from '@/lib/boardStore'
import {
  IconHome, IconPlanning, IconCheckList, IconClose, IconSettings,
  IconArrowUp, IconArrowDown, IconSun, IconMoon, IconAuto, IconLogoutOutline,
  IconDocument, IconFolder, IconFolderOpen, IconSort, IconRefresh,
} from './Icon'
import { UserAvatar } from './UserAvatar'

// ─── Main nav defaults ────────────────────────────────────────────────────────
const MAIN_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  '/':         IconHome,
  '/planning': IconPlanning,
  '/todos':    IconCheckList,
}
const DEFAULT_MAIN = [
  { id: 'home',     href: '/',         label: 'Home' },
  { id: 'planning', href: '/planning', label: 'Planning' },
  { id: 'todos',    href: '/todos',    label: "To do's" },
]
type MainNavItem = typeof DEFAULT_MAIN[number]

const PALETTE = [
  '#579bfc','#0086c0','#9c7ee8','#784bd1','#e2445c','#bb3354',
  '#ff642e','#ff7a00','#ffcb00','#00c875','#037f4c','#ff5ac4','#9aadbd',
]

type Theme = 'auto' | 'dark' | 'light'
const THEMES: { value: Theme; Icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { value: 'auto',  Icon: IconAuto, label: 'Auto'   },
  { value: 'dark',  Icon: IconMoon, label: 'Donker' },
  { value: 'light', Icon: IconSun,  label: 'Licht'  },
]
function applyTheme(t: Theme) {
  if (t === 'auto') {
    const h = new Date().getHours()
    document.documentElement.setAttribute('data-theme', (h >= 7 && h < 19) ? 'light' : 'dark')
  } else {
    document.documentElement.setAttribute('data-theme', t)
  }
}

// ─── Generic drag-to-reorder ──────────────────────────────────────────────────
function useReorder<T>(items: T[], setItems: (items: T[]) => void) {
  const dragIdx = useRef<number | null>(null)
  function onDragStart(i: number) { dragIdx.current = i }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...items]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    dragIdx.current = i
    setItems(next)
  }
  function onDragEnd() { dragIdx.current = null }
  return { onDragStart, onDragOver, onDragEnd }
}

// ─── Documenten / pages section (dynamic from pagesStore) ────────────────────
function PageLink({ p, active }: { p: PageDoc; active: boolean }) {
  return (
    <Link href={`/pages/${p.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px 6px 28px',
        borderRadius: 6, marginBottom: 1,
        color: 'var(--text-primary)',
        background: active ? 'var(--bg-hover)' : 'transparent',
        textDecoration: 'none', fontSize: 14, fontWeight: active ? 600 : 500, minWidth: 0,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontSize: 13, flexShrink: 0 }}>{p.emoji || '📄'}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {p.title || 'Naamloos'}
      </span>
    </Link>
  )
}

function DocSubfolder({ folder, pages, pathname, onAddDoc, onRename, onDelete }: {
  folder: DocFolder; pages: PageDoc[]; pathname: string
  onAddDoc: (folderId: string) => void
  onRename: (folderId: string, name: string) => void
  onDelete: (folderId: string) => void
}) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(folder.name)
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 14px', cursor: 'pointer' }}
        onClick={e => { if ((e.target as HTMLElement).closest('button,input')) return; setOpen(o => !o) }}
        onMouseEnter={e => { e.currentTarget.querySelectorAll<HTMLElement>('.subf-act').forEach(b => (b.style.opacity = '1')) }}
        onMouseLeave={e => { e.currentTarget.querySelectorAll<HTMLElement>('.subf-act').forEach(b => (b.style.opacity = '0')) }}>
        <IconFolder size={13} style={{ color: 'var(--text-muted)' }} />
        {editing ? (
          <input autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { onRename(folder.id, draft.trim() || folder.name); setEditing(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { onRename(folder.id, draft.trim() || folder.name); setEditing(false) } if (e.key === 'Escape') { setDraft(folder.name); setEditing(false) } }}
            style={{ background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 6px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', flex: 1, minWidth: 0 }} />
        ) : (
          <span onDoubleClick={() => { setDraft(folder.name); setEditing(true) }}
            style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {folder.name}
          </span>
        )}
        <button className="subf-act" onClick={e => { e.stopPropagation(); onAddDoc(folder.id) }} title="Document hierin toevoegen"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 3px', opacity: 0, flexShrink: 0 }}>+</button>
        <button className="subf-act" onClick={e => { e.stopPropagation(); if (confirm(`Map "${folder.name}" verwijderen?`)) onDelete(folder.id) }} title="Map verwijderen"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, padding: '0 3px', opacity: 0, flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #C9483D)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
      </div>
      {open && (
        <div>
          {pages.length === 0 ? (
            <div style={{ padding: '4px 10px 4px 28px', fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>Leeg</div>
          ) : pages.map(p => (
            <PageLink key={p.id} p={p} active={pathname === `/pages/${p.id}`} />
          ))}
        </div>
      )}
    </div>
  )
}

function PagesSectionItems({ pathname }: { pathname: string }) {
  const router = useRouter()
  const [pages, setPages] = useState<PageDoc[]>([])
  const [folders, setFolders] = useState<DocFolder[]>([])
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')

  useEffect(() => {
    function refresh() { setPages(loadRecentPages()); setFolders(loadDocFolders()) }
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener('yoko-pages-update', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('yoko-pages-update', refresh)
    }
  }, [])

  function createNewIn(folderId: string | null) {
    const id  = Date.now().toString()
    const now = new Date().toISOString()
    savePage({ id, title: '', content: '', emoji: '📄', createdAt: now, updatedAt: now, folderId })
    router.push(`/pages/${id}`)
  }
  function addFolder() {
    const name = folderDraft.trim()
    if (!name) { setAddingFolder(false); return }
    const next: DocFolder = { id: Date.now().toString(), name }
    saveDocFolders([...folders, next])
    setFolderDraft(''); setAddingFolder(false)
  }
  function renameFolder(id: string, name: string) {
    saveDocFolders(folders.map(f => f.id === id ? { ...f, name } : f))
  }
  function deleteFolder(id: string) {
    // Move pages back to root before removing folder
    for (const p of pages.filter(p => p.folderId === id)) {
      savePage({ ...p, folderId: null })
    }
    saveDocFolders(folders.filter(f => f.id !== id))
  }

  const looseDocs = pages.filter(p => !p.folderId)

  return (
    <div style={{ marginTop: 2, paddingBottom: 6 }}>
      {folders.map(f => (
        <DocSubfolder key={f.id} folder={f}
          pages={pages.filter(p => p.folderId === f.id)}
          pathname={pathname}
          onAddDoc={createNewIn}
          onRename={renameFolder}
          onDelete={deleteFolder} />
      ))}

      {looseDocs.length > 0 && (
        <div style={{ marginTop: folders.length > 0 ? 6 : 0 }}>
          {looseDocs.map(p => (
            <PageLink key={p.id} p={p} active={pathname === `/pages/${p.id}`} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, paddingLeft: 14, paddingRight: 10, paddingBottom: 2 }}>
        {addingFolder ? (
          <input autoFocus value={folderDraft}
            onChange={e => setFolderDraft(e.target.value)}
            onBlur={addFolder}
            onKeyDown={e => { if (e.key === 'Enter') addFolder(); if (e.key === 'Escape') { setFolderDraft(''); setAddingFolder(false) } }}
            placeholder="Mapnaam…"
            style={{ flex: 1, background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 5, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
        ) : (
          <>
            <button onClick={() => createNewIn(null)} title="Nieuw document"
              style={tinyAddBtn}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}>
              <IconDocument size={12} /> doc
            </button>
            <button onClick={() => { setFolderDraft(''); setAddingFolder(true) }} title="Nieuwe submap"
              style={tinyAddBtn}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}>
              <IconFolder size={12} /> map
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Single section ───────────────────────────────────────────────────────────
function SectionBlock({
  section, allSections, setAllSections, pathname, onDelete,
  editOrder, isFirstSection, isLastSection, onMoveSection,
}: {
  section:        SidebarSection
  allSections:    SidebarSection[]
  setAllSections: (s: SidebarSection[]) => void
  pathname:       string
  onDelete:       () => void
  editOrder:      boolean
  isFirstSection: boolean
  isLastSection:  boolean
  onMoveSection:  (dir: -1 | 1) => void
}) {
  // All sections are collapsible. Default open for 'projects' (Agenda's),
  // collapsed for 'docs' (Pagina's) and 'pages' (Documenten). Auto-open if
  // the current route lives inside.
  const [open,          setOpen]          = useState(
    section.type === 'projects'
    || section.items.some(i => pathname.startsWith(i.href))
  )
  useEffect(() => {
    if (section.items.some(i => pathname.startsWith(i.href))) setOpen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [addingItem,    setAddingItem]    = useState(false)
  const [newLabel,      setNewLabel]      = useState('')
  const [editName,      setEditName]      = useState(false)
  const [nameDraft,     setNameDraft]     = useState(section.name)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  const { onDragStart, onDragOver, onDragEnd } = useReorder(section.items, items => {
    const updated = allSections.map(s => s.id === section.id ? { ...s, items } : s)
    setAllSections(updated)
    saveSections(updated)
  })

  useEffect(() => {
    if (section.items.some(i => pathname.startsWith(i.href))) setOpen(true)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (addingItem) setTimeout(() => addInputRef.current?.focus(), 50)
  }, [addingItem])

  function updateItems(items: NavItem[]) {
    const updated = allSections.map(s => s.id === section.id ? { ...s, items } : s)
    setAllSections(updated)
    saveSections(updated)
  }
  function moveItem(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= section.items.length) return
    const items = [...section.items]
    items[idx] = items[next]; items[next] = section.items[idx]
    updateItems(items)
  }
  function saveName(name: string) {
    const updated = allSections.map(s => s.id === section.id ? { ...s, name } : s)
    setAllSections(updated)
    saveSections(updated)
  }
  function renameItem(id: string, label: string) { updateItems(section.items.map(i => i.id === id ? { ...i, label } : i)) }
  function removeItem(id: string) { updateItems(section.items.filter(i => i.id !== id)) }
  function addItem() {
    const lbl = newLabel.trim()
    if (!lbl) { setAddingItem(false); return }
    const slug  = lbl.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const href  = section.type === 'projects' ? `/projects/${slug}` : `/${slug}`
    const color = PALETTE[section.items.length % PALETTE.length]
    updateItems([...section.items, {
      id: Date.now().toString(), label: lbl, href,
      ...(section.type === 'projects' ? { color } : { icon: '📄' }),
    }])
    setNewLabel('')
    setAddingItem(false)
  }

  return (
    <div style={{
      marginTop: 8,
      background: 'transparent',
      border: '1px solid var(--border-light)',
      borderRadius: 10,
      overflow: 'hidden',
      transition: 'background 0.15s',
    }}>
      {/* Section header — gentle tint, white items below */}
      <div onClick={e => {
        // Click anywhere on the header (except buttons / inputs) toggles open state
        const t = e.target as HTMLElement
        if (t.closest('button') || t.closest('input')) return
        setOpen(o => !o)
      }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 12px', cursor: 'pointer',
          background: open ? 'transparent' : 'var(--overlay-faint)',
          borderBottom: open ? '1px solid var(--border-light)' : 'none' }}
        onMouseEnter={e => {
          e.currentTarget.querySelectorAll<HTMLElement>('.sec-del,.sec-toggle-hint').forEach(b => (b.style.opacity = '1'))
        }}
        onMouseLeave={e => {
          e.currentTarget.querySelectorAll<HTMLElement>('.sec-del,.sec-toggle-hint').forEach(b => (b.style.opacity = '0'))
        }}>
        <button onClick={() => setOpen(o => !o)}
          title={open ? 'Inklappen' : 'Uitklappen'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0 }}>
          {open ? <IconFolderOpen size={16} /> : <IconFolder size={16} />}
        </button>

        {editName ? (
          <input autoFocus value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => { saveName(nameDraft.trim() || section.name); setEditName(false) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { saveName(nameDraft.trim() || section.name); setEditName(false) } }}
            style={{ background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', outline: 'none', width: 140 }}
          />
        ) : (
          <span onDoubleClick={() => { setNameDraft(section.name); setEditName(true) }} title="Dubbelklik om naam te bewerken"
            style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.01em', cursor: 'text', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {section.name}
          </span>
        )}

        {!editOrder && (
          <button onClick={() => { setOpen(true); setAddingItem(true) }} title="Toevoegen"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>+</button>
        )}

        {editOrder && (
          <>
            <button onClick={() => onMoveSection(-1)} disabled={isFirstSection} title="Omhoog"
              style={reorderArrowBtn(isFirstSection)}><IconArrowUp size={14} /></button>
            <button onClick={() => onMoveSection(1)} disabled={isLastSection} title="Omlaag"
              style={reorderArrowBtn(isLastSection)}><IconArrowDown size={14} /></button>
          </>
        )}

        {!editOrder && section.type === 'folder' && (
          <button className="sec-del" onClick={onDelete} title="Map verwijderen"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, padding: '0 2px', opacity: 0, flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #e2445c)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
        )}

        {/* Toggle affordance — visible on hover */}
        {!editOrder && (
          <span className="sec-toggle-hint"
            style={{ width: 18, height: 18, borderRadius: 5,
              background: 'var(--bg-card)', border: '1px solid var(--border-light)',
              color: 'var(--text-muted)', fontSize: 12, lineHeight: 1, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: 0, flexShrink: 0, transition: 'opacity 0.15s' }}>
            {open ? '−' : '+'}
          </span>
        )}
      </div>

      {open && section.type === 'pages' && (
        <PagesSectionItems pathname={pathname} />
      )}

      {open && section.type !== 'pages' && (
        <div style={{ marginTop: 2 }}>
          {section.items.map((item, idx) => {
            const active  = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
            const editing = editingItemId === item.id
            return (
              <div key={item.id} draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={e => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', cursor: 'grab' }}
                onMouseEnter={e => { e.currentTarget.querySelectorAll<HTMLElement>('.row-action').forEach(b => (b.style.opacity = '1')) }}
                onMouseLeave={e => { e.currentTarget.querySelectorAll<HTMLElement>('.row-action').forEach(b => (b.style.opacity = '0')) }}
              >
                {editing ? (
                  <input autoFocus defaultValue={item.label}
                    onBlur={e => { const v = e.target.value.trim(); if (v) renameItem(item.id, v); setEditingItemId(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) renameItem(item.id, v); setEditingItemId(null) } if (e.key === 'Escape') setEditingItemId(null) }}
                    style={{ flex: 1, margin: '2px 4px 2px 14px', background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 7px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                  />
                ) : (
                  <Link href={item.href}
                    onClick={e => { if (editOrder) e.preventDefault() }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, flex: 1,
                      padding: '7px 10px 7px 18px',
                      borderRadius: 6, marginBottom: 1,
                      color: 'var(--text-primary)',
                      background: active ? 'var(--bg-hover)' : 'transparent',
                      textDecoration: 'none', fontSize: 14.5, fontWeight: active ? 600 : 500, minWidth: 0,
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  </Link>
                )}

                {editOrder && !editing && (
                  <>
                    <button onClick={e => { e.stopPropagation(); moveItem(idx, -1) }} disabled={idx === 0}
                      title="Omhoog" style={reorderArrowBtn(idx === 0)}><IconArrowUp size={14} /></button>
                    <button onClick={e => { e.stopPropagation(); moveItem(idx, 1) }} disabled={idx === section.items.length - 1}
                      title="Omlaag" style={reorderArrowBtn(idx === section.items.length - 1)}><IconArrowDown size={14} /></button>
                  </>
                )}

                {!editOrder && !editing && <button className="row-action" onClick={e => { e.stopPropagation(); setEditingItemId(item.id) }} title="Naam wijzigen"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 3px', opacity: 0, flexShrink: 0 }}>✎</button>}
                {!editOrder && !editing && <button className="row-action" onClick={() => removeItem(item.id)} title="Verwijderen"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', opacity: 0, flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #e2445c)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>}
              </div>
            )
          })}

          {addingItem && (
            <div style={{ padding: '4px 10px 4px 14px' }}>
              <input ref={addInputRef} value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onBlur={() => { if (!newLabel.trim()) setAddingItem(false) }}
                onKeyDown={e => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') { setNewLabel(''); setAddingItem(false) } }}
                placeholder="Naam…"
                style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Settings popup ───────────────────────────────────────────────────────────
function SettingsPopup({ onClose, profile, openEdit, theme, setTheme, signOut }: {
  onClose: () => void
  profile: ReturnType<typeof useProfile>['profile']
  openEdit: () => void
  theme: Theme
  setTheme: (t: Theme) => void
  signOut: () => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      {/* Click-away backdrop, no dimming — Vercel-style popover */}
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'transparent' }} />
      <div style={{
        position: 'fixed', bottom: 12, left: 12,
        zIndex: 10001, background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 12,
        padding: '6px', width: 290, maxWidth: '92vw',
        maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 14px 40px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.1)',
      }}>
        {/* Profile header */}
        <button onClick={openEdit}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', textAlign: 'left' }}>
          {profile?.photo ? (
            <img src={profile.photo} alt="" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
          ) : profile ? (
            <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: profile.color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: profile.color }}>
              {profile.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
          ) : (
            <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'var(--overlay-medium)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text-muted)' }}>?</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.name ?? 'Profiel instellen'}
            </div>
            {profile && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Bewerk profiel →</div>}
          </div>
        </button>

        <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />

        {/* Inline theme row — small Vercel-style 3-button toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px' }}>
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Thema</span>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--overlay-faint)', border: '1px solid var(--border-light)', borderRadius: 999, padding: 2, gap: 0 }}>
            {THEMES.map(t => {
              const on = theme === t.value
              return (
                <button key={t.value} onClick={() => setTheme(t.value)} title={t.label}
                  style={{ width: 26, height: 22, borderRadius: 999, border: 'none',
                    background: on ? 'var(--bg-card)' : 'transparent',
                    color: on ? 'var(--text-primary)' : 'var(--text-muted)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: on ? '0 1px 2px rgba(0,0,0,0.1)' : 'none', padding: 0 }}>
                  <t.Icon size={13} />
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />

        {/* Google Calendar */}
        {requiresAuth && (
          <div style={{ padding: '4px 10px 8px' }}>
            <GoogleConnector />
          </div>
        )}

        {/* Set / change password */}
        {requiresAuth && (
          <div style={{ padding: '0 10px 8px' }}>
            <PasswordSetter />
          </div>
        )}

        {requiresAuth && <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />}

        {/* Sign out */}
        {requiresAuth && (
          <button onClick={() => { onClose(); signOut() }}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
              border: 'none', background: 'transparent',
              color: 'var(--red)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
            <IconLogoutOutline size={14} /> Uitloggen
          </button>
        )}
      </div>
    </>,
    document.body
  )
}

// ─── Quick Google sync button (footer) ───────────────────────────────────────
function SyncButton() {
  const [busy,    setBusy]    = useState(false)
  const [flash,   setFlash]   = useState<'ok' | 'err' | null>(null)

  async function go() {
    if (busy) return
    setBusy(true); setFlash(null)
    try {
      const results = await syncGoogleNow()
      // Always force-pull every board after sync — realtime broadcast can lag
      // a second or two, and the user explicitly asked for an immediate refresh.
      await Promise.all(BOARD_NAMES.map(b => pullBoardFromRemote(b)))
      const errs = results.filter(r => r.error)
      if (errs.length > 0) setFlash('err'); else setFlash('ok')
    } finally {
      setBusy(false)
      setTimeout(() => setFlash(null), 1800)
    }
  }

  const color = flash === 'ok' ? '#1e8a4e' : flash === 'err' ? '#C4453A' : 'var(--text-secondary)'
  return (
    <button onClick={go} disabled={busy}
      title={busy ? 'Synchroniseren…' : 'Sync Google Calendar nu (auto elke 5 min)'}
      style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, background: 'transparent', border: '1px solid var(--border-light)',
        color, cursor: busy ? 'wait' : 'pointer', flexShrink: 0,
        transform: busy ? 'rotate(180deg)' : undefined, transition: 'transform 0.6s ease, color 0.2s' }}>
      <IconRefresh size={16} />
    </button>
  )
}

// ─── Google Calendar connector (in Settings popup) ───────────────────────────
function GoogleConnector() {
  const [loaded,      setLoaded]      = useState(false)
  const [connections, setConnections] = useState<GoogleConnection[]>([])
  const [available,   setAvailable]   = useState<GoogleCalAvailable[]>([])
  const [busy,        setBusy]        = useState(false)
  const [msg,         setMsg]         = useState<{ text: string; ok: boolean } | null>(null)

  async function reload() {
    const r = await fetchGoogleCalendars()
    setConnections(r.connections)
    setAvailable(r.available)
    setLoaded(true)
  }

  async function runSync() {
    const results = await syncGoogleNow()
    // Refresh local cache for every board the user has connected
    const boards = new Set(connections.map(c => c.boardId).filter(Boolean) as string[])
    for (const b of boards) await pullBoardFromRemote(b)

    const errs = results.filter(r => r.error)
    if (errs.length > 0) {
      setMsg({ text: `Sync fout: ${errs[0].error}`, ok: false })
    } else if (results.length > 0) {
      const tot = results.reduce((s, r) => s + r.added + r.updated, 0)
      setMsg({ text: `${tot} events gesynchroniseerd`, ok: true })
    }
    return results
  }

  useEffect(() => {
    reload()
    // Surface ?google=connected / ?google=error from the OAuth callback
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      const status = sp.get('google')
      if (status === 'connected') {
        setMsg({ text: 'Google Calendar verbonden — synchroniseren…', ok: true })
        runSync().then(() => reload())
      } else if (status === 'error') {
        setMsg({ text: `Verbinden mislukt: ${sp.get('msg') ?? ''}`, ok: false })
      }
      if (status) {
        sp.delete('google'); sp.delete('msg'); sp.delete('board')
        const q = sp.toString()
        window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''))
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    setBusy(true); setMsg(null)
    try { await startGoogleOAuth(null) }
    catch (e) { setMsg({ text: String(e), ok: false }); setBusy(false) }
  }

  async function setBoard(calendarId: string, boardId: string) {
    setBusy(true)
    await updateGoogleCalendar(calendarId, { boardId: boardId || null })
    await runSync()
    await reload()
    setBusy(false)
  }

  async function setCalendar(oldCalendarId: string, newCalendarId: string) {
    setBusy(true)
    await updateGoogleCalendar(oldCalendarId, { newCalendarId })
    await runSync()
    await reload()
    setBusy(false)
  }

  async function disconnect(calendarId: string) {
    if (!confirm('Verbinding met Google Calendar verbreken?')) return
    setBusy(true)
    await disconnectGoogle(calendarId)
    await reload()
    setBusy(false)
  }

  const boards = Object.values(BOARD_CONFIGS).map(b => ({ id: b.id, label: b.name }))

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Google Calendar
      </div>

      {!loaded ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Laden…</div>
      ) : connections.length === 0 ? (
        <button onClick={connect} disabled={busy}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-hover)',
            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
            cursor: busy ? 'wait' : 'pointer', textAlign: 'left' }}>
          Verbind Google Calendar
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
            Trekt afspraken automatisch in een gekozen bord, leest enkel.
          </span>
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {connections.map(c => (
            <div key={c.calendarId} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.calendarName ?? c.calendarId}
              </div>

              {available.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Kalender:
                  <select value={c.calendarId} disabled={busy}
                    onChange={e => setCalendar(c.calendarId, e.target.value)}
                    style={{ flex: 1, padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}>
                    {available.map(a => <option key={a.id} value={a.id}>{a.summary}{a.primary ? ' (primary)' : ''}</option>)}
                  </select>
                </label>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                Bord:
                <select value={c.boardId ?? ''} disabled={busy}
                  onChange={e => setBoard(c.calendarId, e.target.value)}
                  style={{ flex: 1, padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}>
                  <option value="">— Geen —</option>
                  {boards.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </label>

              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={async () => { setBusy(true); await runSync(); await reload(); setBusy(false) }} disabled={busy}
                  style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
                  Sync nu
                </button>
                <button onClick={() => disconnect(c.calendarId)} disabled={busy}
                  style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
                  Ontkoppel
                </button>
              </div>
              {c.lastSyncAt && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  Laatst gesynchroniseerd: {new Date(c.lastSyncAt).toLocaleString('nl-NL')}
                </div>
              )}
            </div>
          ))}
          <button onClick={async () => {
              if (!confirm('Verwijder alle handmatige rijen die dezelfde naam hebben als een Google-event? (Bijv. duplicaten van vóór de Google koppeling.)')) return
              setBusy(true)
              const r = await cleanupGoogleDuplicates()
              await Promise.all((connections.map(c => c.boardId).filter(Boolean) as string[]).map(b => import('@/lib/boardStore').then(m => m.pullBoardFromRemote(b))))
              setMsg(r ? { text: `${r.deleted} dubbelen verwijderd`, ok: true } : { text: 'Opschonen mislukt', ok: false })
              setBusy(false)
            }} disabled={busy}
            style={{ padding: '7px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
            🧹 Opschonen — verwijder dubbelen
          </button>
          <button onClick={connect} disabled={busy}
            style={{ padding: '7px', borderRadius: 7, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
            + Extra Google account koppelen
          </button>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 6, fontSize: 12,
          background: msg.ok ? 'rgba(0,200,117,0.12)' : 'rgba(196,69,58,0.12)',
          color: msg.ok ? '#037f4c' : '#C4453A' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}

// ─── Password setter (in Settings popup) ─────────────────────────────────────
function PasswordSetter() {
  const [open,    setOpen]    = useState(false)
  const [pw,      setPw]      = useState('')
  const [pw2,     setPw2]     = useState('')
  const [busy,    setBusy]    = useState(false)
  const [msg,     setMsg]     = useState<{ text: string; ok: boolean } | null>(null)

  async function save() {
    if (!supabase) return
    if (pw.length < 6) { setMsg({ text: 'Minimaal 6 tekens.', ok: false }); return }
    if (pw !== pw2)    { setMsg({ text: 'Wachtwoorden komen niet overeen.', ok: false }); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) { setMsg({ text: error.message, ok: false }); return }
    setMsg({ text: 'Wachtwoord opgeslagen.', ok: true })
    setPw(''); setPw2('')
    setTimeout(() => { setMsg(null); setOpen(false) }, 1500)
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Wachtwoord</div>
      {!open ? (
        <button onClick={() => setOpen(true)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-hover)',
            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}>
          Stel een wachtwoord in
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
            Zo kan je ook met email + wachtwoord inloggen, geen mail nodig.
          </span>
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)}
            placeholder="Nieuw wachtwoord (min 6 tekens)" style={pwInputStyle} />
          <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="Herhaal wachtwoord" style={pwInputStyle} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setOpen(false); setPw(''); setPw2(''); setMsg(null) }}
              style={{ flex: 1, padding: '8px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Annuleer
            </button>
            <button onClick={save} disabled={busy}
              style={{ flex: 2, padding: '8px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
          {msg && (
            <div style={{ padding: '7px 10px', borderRadius: 6, fontSize: 12,
              background: msg.ok ? 'rgba(0,200,117,0.12)' : 'rgba(196,69,58,0.12)',
              color: msg.ok ? '#037f4c' : '#C4453A' }}>
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const pwInputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 7,
  border: '1px solid var(--border)', background: 'var(--bg-base)',
  color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

const tinyAddBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: 'transparent', border: 'none',
  color: 'var(--text-muted)', fontSize: 11, fontWeight: 500,
  padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
  textTransform: 'lowercase', letterSpacing: '0.02em',
}

// ─── Reorder arrow button style ───────────────────────────────────────────────
function reorderArrowBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'var(--bg-hover)', border: '1px solid var(--border)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12, fontWeight: 700, lineHeight: 1,
    padding: '2px 7px', borderRadius: 4, flexShrink: 0,
    opacity: disabled ? 0.4 : 1,
    minHeight: 26, minWidth: 26,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const DEFAULT_SIDEBAR_W = 248
const MIN_SIDEBAR_W     = 200
const MAX_SIDEBAR_W     = 400

export default function Sidebar({
  isMobile = false,
  open     = true,
  onClose,
}: {
  isMobile?: boolean
  open?:     boolean
  onClose?:  () => void
} = {}) {
  const pathname              = usePathname()
  const { profile, openEdit, signOut } = useProfile()
  const [theme,       setTheme]       = useState<Theme>('auto')
  const [sections,    setSectionsRaw] = useState<SidebarSection[]>([])
  const [hydrated,    setHydrated]    = useState(false)
  const [width,       setWidth]       = useState(DEFAULT_SIDEBAR_W)
  const [mainNav,     setMainNavRaw]  = useState<MainNavItem[]>(DEFAULT_MAIN)
  const [editingMainId, setEditingMainId] = useState<string | null>(null)
  const [addingFolder,  setAddingFolder]  = useState(false)
  const [folderName,    setFolderName]    = useState('')
  const [editOrder,     setEditOrder]     = useState(false)
  const [settingsOpen,  setSettingsOpen]  = useState(false)
  const resizingRef   = useRef(false)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const { onDragStart: mainDS, onDragOver: mainDO, onDragEnd: mainDE } = useReorder(mainNav, items => {
    setMainNavRaw(items)
    localStorage.setItem('sidebar-main-nav', JSON.stringify(items))
  })

  const { onDragStart: secDS, onDragOver: secDO, onDragEnd: secDE } = useReorder(sections, updated => {
    setSectionsRaw(updated)
    saveSections(updated)
  })

  useEffect(() => {
    function onNavUpdate() { setSectionsRaw(loadSections()) }
    window.addEventListener('yoko-nav-update', onNavUpdate)
    return () => window.removeEventListener('yoko-nav-update', onNavUpdate)
  }, [])

  useEffect(() => {
    setSectionsRaw(loadSections())
    const saved = localStorage.getItem('theme') as Theme | null
    if (saved && THEMES.some(t => t.value === saved)) { setTheme(saved); applyTheme(saved) }
    const savedW = parseInt(localStorage.getItem('sidebar-width') ?? '')
    if (!isNaN(savedW)) setWidth(Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, savedW)))
    try {
      const savedMain = localStorage.getItem('sidebar-main-nav')
      if (savedMain) {
        const parsed = JSON.parse(savedMain) as MainNavItem[]
        if (DEFAULT_MAIN.every(d => parsed.some(p => p.href === d.href))) setMainNavRaw(parsed)
      }
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (addingFolder) setTimeout(() => folderInputRef.current?.focus(), 50)
  }, [addingFolder])

  function setSections(s: SidebarSection[]) { setSectionsRaw(s); saveSections(s) }

  function renameMainItem(id: string, label: string) {
    const next = mainNav.map(i => i.id === id ? { ...i, label } : i)
    setMainNavRaw(next)
    localStorage.setItem('sidebar-main-nav', JSON.stringify(next))
  }

  function addFolder() {
    const name = folderName.trim()
    if (!name) { setAddingFolder(false); return }
    const newSection: SidebarSection = { id: Date.now().toString(), name, type: 'folder', items: [] }
    setSections([...sections, newSection])
    setFolderName('')
    setAddingFolder(false)
  }

  function deleteSection(id: string) {
    setSections(sections.filter(s => s.id !== id))
  }

  function moveMainNav(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= mainNav.length) return
    const items = [...mainNav]
    items[idx] = items[next]; items[next] = mainNav[idx]
    setMainNavRaw(items)
    localStorage.setItem('sidebar-main-nav', JSON.stringify(items))
  }

  function moveSection(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= sections.length) return
    const updated = [...sections]
    updated[idx] = updated[next]; updated[next] = sections[idx]
    setSections(updated)
  }

  function cycleTheme() {
    const idx  = THEMES.findIndex(t => t.value === theme)
    const next = THEMES[(idx + 1) % THEMES.length].value
    setTheme(next); applyTheme(next)
    localStorage.setItem('theme', next)
  }

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX, startW = width
    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return
      setWidth(Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, startW + ev.clientX - startX)))
    }
    function onUp() {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setWidth(w => { localStorage.setItem('sidebar-width', String(w)); return w })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const containerStyle: React.CSSProperties = isMobile
    ? {
        width: 320, minWidth: 320, maxWidth: 320,
        position: 'fixed', top: 0, right: 0, height: '100vh',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s ease',
        zIndex: 60, display: 'flex', alignItems: 'stretch',
        boxShadow: open ? '0 0 30px rgba(0,0,0,0.3)' : 'none',
      }
    : {
        width, minWidth: width, maxWidth: width, flexShrink: 0,
        position: 'sticky', top: 0, height: '100vh',
        display: 'flex', alignItems: 'stretch',
      }

  return (
    <div style={containerStyle}>
      <aside style={{ flex: 1, minWidth: 0, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto' }}
        onClick={e => {
          if (!isMobile || !onClose || editOrder) return
          const target = e.target as HTMLElement
          if (target.closest('a')) onClose()
        }}
      >

        {/* Mobile close button (top-right inside drawer) */}
        {isMobile && onClose && (
          <button onClick={onClose} aria-label="Menu sluiten"
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 5,
              width: 36, height: 36, borderRadius: 9,
              background: 'var(--bg-hover)', border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0 }}>
            <IconClose size={18} />
          </button>
        )}

        {/* Logo + my-avatar header */}
        <div style={{ padding: isMobile ? '20px 60px 16px 18px' : '20px 18px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Link href="/"
            onClick={e => { if (editOrder) e.preventDefault() }}
            style={{ textDecoration: 'none', display: 'block', flex: 1, minWidth: 0 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
            <svg width="100" height="18" viewBox="0 0 323 57" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', color: 'var(--sup-yellow)' }}>
              <path d="M28.1953 0L38.8008 21.0498L49.3555 0H77.5508L53.1279 37.75V57H24.4229V37.75L0 0H28.1953ZM126.141 0C142.252 0 155.305 12.75 155.254 28.5C155.254 44.25 142.252 57 126.141 57H100.749C84.6885 56.9998 71.6357 44.2498 71.6357 28.5C71.6357 12.7502 84.6375 0.000245086 100.749 0H126.141ZM191.607 28.4004L211.34 0H243.104L223.78 28.9004L243.104 57H211.34L191.607 28.4004V57H161.22V0H191.607V28.4004ZM293.887 0C309.947 1.6438e-05 323 12.75 323 28.5C323 44.25 309.998 57 293.887 57H268.495C252.434 56.9999 239.382 44.2499 239.382 28.5C239.382 12.7501 252.383 0.000120154 268.495 0H293.887ZM128.792 4.9502C122.113 0.850233 110.08 7.85003 101.974 20.5498C93.8668 33.2498 92.7446 46.9 99.4238 51C106.103 55.1 118.136 48.1003 126.243 35.4004C134.35 22.7004 135.471 9.0502 128.792 4.9502ZM296.487 4.9502C289.808 0.850206 277.775 7.84987 269.668 20.5498C261.561 33.2498 260.44 46.9 267.119 51C273.798 55.0996 285.831 48.1 293.938 35.4004C302.044 22.7006 303.217 9.05043 296.487 4.9502Z" fill="currentColor"/>
            </svg>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sup-yellow)', letterSpacing: '0.28em', textTransform: 'uppercase', marginTop: 6 }}>PLANNING</div>
          </Link>
        </div>

        {/* Nav */}
        <nav style={{ padding: '8px 8px', flex: 1 }}>

          {/* Main nav */}
          {mainNav.map((item, idx) => {
            const active  = pathname === item.href
            const editing = editingMainId === item.id
            return (
              <div key={item.id} draggable={!editOrder}
                onDragStart={() => mainDS(idx)}
                onDragOver={e => mainDO(e, idx)}
                onDragEnd={mainDE}
                style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1, position: 'relative' }}
                onMouseEnter={e => { e.currentTarget.querySelectorAll<HTMLElement>('.mn-action').forEach(b => (b.style.opacity = '1')) }}
                onMouseLeave={e => { e.currentTarget.querySelectorAll<HTMLElement>('.mn-action').forEach(b => (b.style.opacity = '0')) }}
              >
                {editing ? (
                  <input autoFocus defaultValue={item.label}
                    onBlur={e => { const v = e.target.value.trim(); if (v) renameMainItem(item.id, v); setEditingMainId(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) renameMainItem(item.id, v); setEditingMainId(null) } if (e.key === 'Escape') setEditingMainId(null) }}
                    style={{ flex: 1, margin: '1px 4px', background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none', boxSizing: 'border-box' }}
                  />
                ) : (
                  <Link href={item.href}
                    onClick={e => { if (editOrder) e.preventDefault() }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 11, flex: 1,
                      padding: '11px 12px', borderRadius: 8,
                      color: '#000',
                      background: active ? 'var(--accent-light)' : 'transparent',
                      textDecoration: 'none', fontSize: 18, fontWeight: active ? 800 : 600,
                      letterSpacing: '-0.02em',
                      borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                      paddingLeft: active ? 9 : 12,
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    {(() => { const NavIcon = MAIN_ICONS[item.href]; return NavIcon ? <NavIcon size={22} /> : null })()}
                    <span>{item.label}</span>
                  </Link>
                )}
                {editOrder && !editing && (
                  <>
                    <button onClick={() => moveMainNav(idx, -1)} disabled={idx === 0} title="Omhoog"
                      style={reorderArrowBtn(idx === 0)}><IconArrowUp size={14} /></button>
                    <button onClick={() => moveMainNav(idx, 1)} disabled={idx === mainNav.length - 1} title="Omlaag"
                      style={reorderArrowBtn(idx === mainNav.length - 1)}><IconArrowDown size={14} /></button>
                  </>
                )}
                {!editOrder && !editing && (
                  <button className="mn-action" onClick={e => { e.preventDefault(); e.stopPropagation(); setEditingMainId(item.id) }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 5px', opacity: 0, flexShrink: 0, position: 'absolute', right: 0 }}>✎</button>
                )}
              </div>
            )
          })}

          {/* Dynamic sections — draggable */}
          {hydrated && sections.map((section, idx) => (
            <div key={section.id} draggable={!editOrder}
              onDragStart={() => secDS(idx)}
              onDragOver={e => secDO(e, idx)}
              onDragEnd={secDE}
            >
              <SectionBlock
                section={section}
                allSections={sections}
                setAllSections={setSections}
                pathname={pathname}
                onDelete={() => deleteSection(section.id)}
                editOrder={editOrder}
                isFirstSection={idx === 0}
                isLastSection={idx === sections.length - 1}
                onMoveSection={dir => moveSection(idx, dir)}
              />
            </div>
          ))}

          {/* Add folder */}
          <div style={{ marginTop: 10, padding: '0 8px' }}>
            {addingFolder ? (
              <input ref={folderInputRef} value={folderName}
                onChange={e => setFolderName(e.target.value)}
                onBlur={() => { if (!folderName.trim()) setAddingFolder(false) }}
                onKeyDown={e => { if (e.key === 'Enter') addFolder(); if (e.key === 'Escape') { setFolderName(''); setAddingFolder(false) } }}
                placeholder="Mapnaam…"
                style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 6, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
              />
            ) : (
              <button onClick={() => setAddingFolder(true)}
                style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '5px 10px', width: '100%', textAlign: 'left' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--text-muted)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                + Nieuwe map
              </button>
            )}
          </div>
        </nav>

        {/* Reorder toggle — small, just above footer */}
        <div style={{ padding: '4px 12px 6px' }}>
          <button onClick={() => setEditOrder(o => !o)}
            title={editOrder ? 'Klaar met sorteren' : 'Volgorde aanpassen'}
            style={{ display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none',
              color: editOrder ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: 11, fontWeight: 500,
              padding: '4px 6px', borderRadius: 4 }}
            onMouseEnter={e => (e.currentTarget.style.color = editOrder ? 'var(--accent)' : 'var(--text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = editOrder ? 'var(--accent)' : 'var(--text-muted)')}>
            <IconSort size={12} />
            {editOrder ? 'Klaar' : 'Volgorde'}
          </button>
        </div>

        {/* Footer — profile + theme + settings */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {profile?.memberId ? (
            <Link href={`/profile/${profile.memberId}`} title="Mijn profiel"
              style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 8px', textAlign: 'left', textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              <UserAvatar memberId={profile.memberId} size={32} />
              <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile.name}
              </span>
            </Link>
          ) : (
            <button onClick={openEdit} title="Profiel instellen"
              style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 8px', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'var(--overlay-medium)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text-muted)' }}>?</span>
              <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>Profiel instellen</span>
            </button>
          )}

          <button onClick={cycleTheme} title={`Thema: ${(THEMES.find(t => t.value === theme) ?? THEMES[0]).label}`}
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
            {(() => { const T = (THEMES.find(t => t.value === theme) ?? THEMES[0]).Icon; return <T size={17} /> })()}
          </button>

          {requiresAuth && <SyncButton />}

          <button onClick={() => setSettingsOpen(true)} title="Instellingen"
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
            <IconSettings size={17} />
          </button>
        </div>
      </aside>

      {settingsOpen && (
        <SettingsPopup
          onClose={() => setSettingsOpen(false)}
          profile={profile}
          openEdit={() => { setSettingsOpen(false); openEdit() }}
          theme={theme}
          setTheme={(t) => { setTheme(t); applyTheme(t); localStorage.setItem('theme', t) }}
          signOut={signOut}
        />
      )}

      {/* Resize handle (desktop only) */}
      {!isMobile && (
        <div onMouseDown={onResizeMouseDown} title="Sleep om breedte aan te passen"
          style={{ width: 5, cursor: 'col-resize', flexShrink: 0, background: 'transparent', transition: 'background 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')} />
      )}
    </div>
  )
}
