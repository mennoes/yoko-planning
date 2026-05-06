'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { useProfile } from './ProfileContext'
import {
  loadSections, saveSections,
  type NavItem, type SidebarSection,
} from '@/lib/navStore'
import { hasSupabase } from '@/lib/supabase'

// ─── Main nav defaults ────────────────────────────────────────────────────────
const DEFAULT_MAIN = [
  { id: 'home',     href: '/',         label: 'Home',     icon: '👋' },
  { id: 'planning', href: '/planning', label: 'Planning', icon: '📅' },
  { id: 'todos',    href: '/todos',    label: "To do's",  icon: '✅' },
]
type MainNavItem = typeof DEFAULT_MAIN[number]

const PALETTE = [
  '#579bfc','#0086c0','#9c7ee8','#784bd1','#e2445c','#bb3354',
  '#ff642e','#ff7a00','#ffcb00','#00c875','#037f4c','#ff5ac4','#9aadbd',
]

type Theme = 'auto' | 'dark' | 'light'
const THEMES: { value: Theme; icon: string; label: string }[] = [
  { value: 'auto',  icon: '🌓', label: 'Auto'   },
  { value: 'dark',  icon: '🌙', label: 'Donker' },
  { value: 'light', icon: '☀️', label: 'Licht'  },
]
function applyTheme(t: Theme) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
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
  const [open,          setOpen]          = useState(section.items.some(i => pathname.startsWith(i.href)))
  const [addingItem,    setAddingItem]    = useState(false)
  const [newLabel,      setNewLabel]      = useState('')
  const [editName,      setEditName]      = useState(false)
  const [nameDraft,     setNameDraft]     = useState(section.name)
  const [colorTarget,   setColorTarget]   = useState<string | null>(null)
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
  function recolorItem(id: string, color: string) { updateItems(section.items.map(i => i.id === id ? { ...i, color } : i)); setColorTarget(null) }
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
    <div style={{ marginTop: 8 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px 5px 6px' }}
        onMouseEnter={e => { e.currentTarget.querySelectorAll<HTMLElement>('.sec-del').forEach(b => (b.style.opacity = '1')) }}
        onMouseLeave={e => { e.currentTarget.querySelectorAll<HTMLElement>('.sec-del').forEach(b => (b.style.opacity = '0')) }}>
        <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 9, padding: '2px 4px', flexShrink: 0 }}>
          {open ? '▼' : '▶'}
        </button>

        {editName ? (
          <input autoFocus value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => { saveName(nameDraft.trim() || section.name); setEditName(false) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { saveName(nameDraft.trim() || section.name); setEditName(false) } }}
            style={{ background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 5px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', outline: 'none', width: 100 }}
          />
        ) : (
          <span onDoubleClick={() => { setNameDraft(section.name); setEditName(true) }} title="Dubbelklik om naam te bewerken"
            style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', cursor: 'text', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              style={reorderArrowBtn(isFirstSection)}>↑</button>
            <button onClick={() => onMoveSection(1)} disabled={isLastSection} title="Omlaag"
              style={reorderArrowBtn(isLastSection)}>↓</button>
          </>
        )}

        {!editOrder && section.type === 'folder' && (
          <button className="sec-del" onClick={onDelete} title="Map verwijderen"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, padding: '0 2px', opacity: 0, flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #e2445c)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
        )}
      </div>

      {open && (
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
                {section.type === 'projects' && (
                  <div style={{ position: 'relative', paddingLeft: 14, flexShrink: 0 }}>
                    <button onClick={e => { e.stopPropagation(); setColorTarget(colorTarget === item.id ? null : item.id) }}
                      style={{ width: 9, height: 9, borderRadius: '50%', padding: 0, background: item.color ?? '#579bfc', border: 'none', cursor: 'pointer' }} />
                    {colorTarget === item.id && (
                      <div style={{ position: 'absolute', top: 14, left: 10, zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                          {PALETTE.map(c => (
                            <button key={c} onClick={() => recolorItem(item.id, c)} style={{ width: 18, height: 18, borderRadius: 4, background: c, padding: 0, border: 'none', cursor: 'pointer', outline: item.color === c ? '2px solid var(--text-primary)' : 'none', outlineOffset: 1 }} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                      display: 'flex', alignItems: 'center', gap: 7, flex: 1,
                      padding: section.type === 'projects' ? '6px 6px' : '6px 10px 6px 14px',
                      borderRadius: 6, marginBottom: 1,
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: active ? 'var(--bg-hover)' : 'transparent',
                      textDecoration: 'none', fontSize: 13, fontWeight: active ? 600 : 400, minWidth: 0,
                    }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
                  >
                    {section.type !== 'projects' && item.icon && <span style={{ fontSize: 13, flexShrink: 0 }}>{item.icon}</span>}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  </Link>
                )}

                {editOrder && !editing && (
                  <>
                    <button onClick={e => { e.stopPropagation(); moveItem(idx, -1) }} disabled={idx === 0}
                      title="Omhoog" style={reorderArrowBtn(idx === 0)}>↑</button>
                    <button onClick={e => { e.stopPropagation(); moveItem(idx, 1) }} disabled={idx === section.items.length - 1}
                      title="Omlaag" style={reorderArrowBtn(idx === section.items.length - 1)}>↓</button>
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
  return (
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 251, background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 14,
        padding: '16px 20px 18px', width: 360, maxWidth: '92vw',
        maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Instellingen</h3>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, lineHeight: 1, color: 'var(--text-muted)', padding: '0 4px' }}>×</button>
        </div>

        {/* Profile */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Profiel</div>
          <button onClick={openEdit}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' }}>
            {profile?.photo ? (
              <img src={profile.photo} alt="" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
            ) : profile ? (
              <span style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: profile.color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: profile.color }}>
                {profile.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </span>
            ) : (
              <span style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: 'var(--overlay-medium)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-muted)' }}>?</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.name ?? 'Profiel instellen'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Tik om te bewerken</div>
            </div>
          </button>
        </div>

        {/* Theme */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Thema</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {THEMES.map(t => (
              <button key={t.value} onClick={() => setTheme(t.value)}
                style={{ padding: '10px 6px', borderRadius: 8,
                  border: `1px solid ${theme === t.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: theme === t.value ? 'var(--accent-light)' : 'var(--bg-hover)',
                  color: theme === t.value ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sign out */}
        {hasSupabase && (
          <button onClick={() => { onClose(); signOut() }}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-hover)',
              color: 'var(--red)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <span>↪</span> Uitloggen
          </button>
        )}
      </div>
    </>
  )
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
const DEFAULT_SIDEBAR_W = 210
const MIN_SIDEBAR_W     = 160
const MAX_SIDEBAR_W     = 380

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

  const themeInfo = THEMES.find(t => t.value === theme)!

  const containerStyle: React.CSSProperties = isMobile
    ? {
        width: 320, minWidth: 320, maxWidth: 320,
        position: 'fixed', top: 0, left: 0, height: '100vh',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
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
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--bg-hover)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', fontSize: 20, lineHeight: 1,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0 }}>
            ✕
          </button>
        )}

        {/* Logo — bigger, clickable to home */}
        <Link href="/"
          onClick={e => { if (editOrder) e.preventDefault() }}
          style={{ padding: isMobile ? '20px 60px 16px 18px' : '20px 18px 16px', borderBottom: '1px solid var(--border)', textDecoration: 'none', display: 'block' }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
          <svg width="100" height="18" viewBox="0 0 323 57" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', color: 'var(--text-primary)' }}>
            <path d="M28.1953 0L38.8008 21.0498L49.3555 0H77.5508L53.1279 37.75V57H24.4229V37.75L0 0H28.1953ZM126.141 0C142.252 0 155.305 12.75 155.254 28.5C155.254 44.25 142.252 57 126.141 57H100.749C84.6885 56.9998 71.6357 44.2498 71.6357 28.5C71.6357 12.7502 84.6375 0.000245086 100.749 0H126.141ZM191.607 28.4004L211.34 0H243.104L223.78 28.9004L243.104 57H211.34L191.607 28.4004V57H161.22V0H191.607V28.4004ZM293.887 0C309.947 1.6438e-05 323 12.75 323 28.5C323 44.25 309.998 57 293.887 57H268.495C252.434 56.9999 239.382 44.2499 239.382 28.5C239.382 12.7501 252.383 0.000120154 268.495 0H293.887ZM128.792 4.9502C122.113 0.850233 110.08 7.85003 101.974 20.5498C93.8668 33.2498 92.7446 46.9 99.4238 51C106.103 55.1 118.136 48.1003 126.243 35.4004C134.35 22.7004 135.471 9.0502 128.792 4.9502ZM296.487 4.9502C289.808 0.850206 277.775 7.84987 269.668 20.5498C261.561 33.2498 260.44 46.9 267.119 51C273.798 55.0996 285.831 48.1 293.938 35.4004C302.044 22.7006 303.217 9.05043 296.487 4.9502Z" fill="currentColor"/>
          </svg>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.28em', textTransform: 'uppercase', marginTop: 6 }}>PLANNING</div>
        </Link>

        {/* Nav */}
        <nav style={{ padding: '8px 8px', flex: 1 }}>

          {/* Reorder toggle */}
          <div style={{ padding: '2px 4px 6px' }}>
            <button onClick={() => setEditOrder(o => !o)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: 6,
                border: '1px solid var(--border)',
                background: editOrder ? 'var(--accent)' : 'transparent',
                color: editOrder ? '#fff' : 'var(--text-muted)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {editOrder ? '✓ Klaar met sorteren' : '↕ Volgorde aanpassen'}
            </button>
          </div>

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
                      display: 'flex', alignItems: 'center', gap: 8, flex: 1,
                      padding: '7px 10px', borderRadius: 6,
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: active ? 'var(--bg-hover)' : 'transparent',
                      textDecoration: 'none', fontSize: 13.5, fontWeight: active ? 600 : 400,
                    }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
                  >
                    <span style={{ fontSize: 14 }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                )}
                {editOrder && !editing && (
                  <>
                    <button onClick={() => moveMainNav(idx, -1)} disabled={idx === 0} title="Omhoog"
                      style={reorderArrowBtn(idx === 0)}>↑</button>
                    <button onClick={() => moveMainNav(idx, 1)} disabled={idx === mainNav.length - 1} title="Omlaag"
                      style={reorderArrowBtn(idx === mainNav.length - 1)}>↓</button>
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

        {/* Footer — single settings button */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
          <button onClick={() => setSettingsOpen(true)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '8px 10px', textAlign: 'left' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <span style={{ fontSize: 18 }}>⚙</span>
            <span style={{ fontSize: 13.5, color: 'var(--text-secondary)', fontWeight: 500 }}>Instellingen</span>
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
