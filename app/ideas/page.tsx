'use client'

import { FormEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useProfile } from '@/components/ProfileContext'
import { IconClose, IconIdea } from '@/components/Icon'
import {
  createIdea, deleteIdea, loadIdeas, onIdeasChange, pullIdeas,
  subscribeRemoteIdeas, updateIdea,
  type IdeaCategory, type IdeaItem,
} from '@/lib/ideasStore'
import styles from './ideas.module.css'

const CATEGORIES: Array<{ value: IdeaCategory; label: string; short: string }> = [
  { value: 'inspiratie', label: 'Inspiratie', short: 'Iets om te onthouden' },
  { value: 'tussendoor', label: 'Als je tijd hebt', short: 'Lekker tussendoor' },
  { value: 'experiment', label: 'Experiment', short: 'Gewoon eens proberen' },
  { value: 'verbetering', label: 'Kan slimmer', short: 'Een verbetering' },
]

const COLORS = ['#fff0a8', '#ffd1bd', '#cce9db', '#dce5ff', '#ead7f0', '#f8d3df']
type CategoryFilter = 'all' | IdeaCategory
type StatusFilter = 'active' | 'doing' | 'done'
type NotePosition = { x: number; y: number }
type NotePositions = Record<string, NotePosition>
type CanvasView = { x: number; y: number; zoom: number }
const POSITIONS_KEY = 'yoko-ideas-positions-v1'
const VIEW_KEY = 'yoko-ideas-canvas-view-v1'
const DEFAULT_VIEW: CanvasView = { x: 0, y: 0, zoom: 1 }

function categoryLabel(value: IdeaCategory) {
  return CATEGORIES.find(category => category.value === value)?.label ?? value
}

function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  if (days <= 0) return 'vandaag'
  if (days === 1) return 'gisteren'
  if (days < 7) return `${days} dagen geleden`
  return new Date(value).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function IdeasPage() {
  const { profile } = useProfile()
  const [ideas, setIdeas] = useState<IdeaItem[]>([])
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<IdeaCategory>('inspiratie')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [editing, setEditing] = useState<IdeaItem | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [positions, setPositions] = useState<NotePositions>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [canvasView, setCanvasView] = useState<CanvasView>(DEFAULT_VIEW)
  const [panning, setPanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)

  function persistCanvasView(next: CanvasView) {
    setCanvasView(next)
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(next)) } catch {}
  }

  function focusNote(ideaId: string) {
    const viewport = boardRef.current
    const note = viewport?.querySelector<HTMLElement>(`[data-idea-id="${CSS.escape(ideaId)}"]`)
    if (!viewport || !note) return
    const viewportRect = viewport.getBoundingClientRect()
    const noteRect = note.getBoundingClientRect()
    persistCanvasView({
      ...canvasView,
      x: canvasView.x + viewportRect.left + viewportRect.width / 2 - (noteRect.left + noteRect.width / 2),
      y: canvasView.y + viewportRect.top + viewportRect.height / 2 - (noteRect.top + noteRect.height / 2),
    })
  }

  useEffect(() => {
    const refresh = () => setIdeas(loadIdeas())
    refresh()
    pullIdeas().then(refresh).catch(() => {})
    const stopLocal = onIdeasChange(refresh)
    const stopRemote = subscribeRemoteIdeas()
    return () => { stopLocal(); stopRemote() }
  }, [])

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}') as NotePositions
      if (stored && typeof stored === 'object') setPositions(stored)
      const savedView = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as CanvasView | null
      if (savedView && Number.isFinite(savedView.x) && Number.isFinite(savedView.y) && Number.isFinite(savedView.zoom)) {
        setCanvasView({ x: savedView.x, y: savedView.y, zoom: Math.max(.45, Math.min(1.8, savedView.zoom)) })
      }
    } catch {}
  }, [])

  // Een suggestie op Home kan rechtstreeks naar een specifiek idee linken.
  // Open geen bewerkvenster ongevraagd: breng de kaart rustig in beeld.
  useEffect(() => {
    const ideaId = new URLSearchParams(window.location.search).get('idea')
    if (!ideaId || !ideas.some(idea => idea.id === ideaId)) return
    setCategoryFilter('all')
    setStatusFilter('active')
    setHighlighted(ideaId)
    const scrollTimer = window.setTimeout(() => focusNote(ideaId), 30)
    const clearTimer = window.setTimeout(() => setHighlighted(null), 2600)
    return () => { window.clearTimeout(scrollTimer); window.clearTimeout(clearTimer) }
  }, [ideas])

  const visible = useMemo(() => {
    return ideas
      .filter(idea => {
        const categoryMatches = categoryFilter === 'all' || idea.category === categoryFilter
        const statusMatches = statusFilter === 'active' ? idea.status !== 'done' : idea.status === statusFilter
        return categoryMatches && statusMatches
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'doing' ? -1 : 1
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
  }, [ideas, categoryFilter, statusFilter])

  const categoryOptions = useMemo(() => {
    const known = new Set(CATEGORIES.map(item => item.value))
    const custom = [...new Set(ideas.map(idea => idea.category.trim()).filter(Boolean))]
      .filter(value => !known.has(value))
      .sort((a, b) => a.localeCompare(b, 'nl'))
      .map(value => ({ value, label: value, short: 'Eigen categorie' }))
    return [...CATEGORIES, ...custom]
  }, [ideas])

  const openCount = ideas.filter(idea => idea.status === 'open').length
  const doingCount = ideas.filter(idea => idea.status === 'doing').length
  const doneCount = ideas.filter(idea => idea.status === 'done').length

  async function addIdea(event: FormEvent) {
    event.preventDefault()
    const selectedCategory = creatingCategory ? newCategory.trim() : category
    if (!title.trim() || !selectedCategory || saving) return
    setSaving(true)
    await createIdea({
      title,
      body,
      category: selectedCategory,
      color,
      authorId: profile?.memberId ?? null,
      authorName: profile?.name ?? null,
    })
    setTitle('')
    setBody('')
    setCategory('inspiratie')
    setCreatingCategory(false)
    setNewCategory('')
    setColor(COLORS[Math.floor(Math.random() * COLORS.length)])
    setSaving(false)
    setComposerOpen(false)
    setCategoryFilter('all')
    setStatusFilter('active')
  }

  async function claim(idea: IdeaItem) {
    await updateIdea(idea.id, {
      status: 'doing',
      claimedBy: profile?.memberId ?? null,
      claimedName: profile?.name ?? 'Iemand',
    })
  }

  function surpriseMe() {
    const options = ideas.filter(idea => idea.status === 'open')
    if (!options.length) return
    const chosen = options[Math.floor(Math.random() * options.length)]
    setCategoryFilter('all')
    setStatusFilter('active')
    setHighlighted(chosen.id)
    window.setTimeout(() => focusNote(chosen.id), 30)
    window.setTimeout(() => setHighlighted(null), 2600)
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing?.title.trim()) return
    await updateIdea(editing.id, {
      title: editing.title.trim(),
      body: editing.body.trim(),
      category: editing.category,
      color: editing.color,
    })
    setEditing(null)
  }

  function persistPositions(next: NotePositions) {
    setPositions(next)
    try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(next)) } catch {}
  }

  function startCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    const target = event.target as HTMLElement
    if (target.closest('article, button, input, textarea, select, label')) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const start = canvasView
    let latest = start
    setPanning(true)
    const onMove = (moveEvent: PointerEvent) => {
      latest = { ...start, x: start.x + moveEvent.clientX - startX, y: start.y + moveEvent.clientY - startY }
      setCanvasView(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      persistCanvasView(latest)
      setPanning(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const rect = event.currentTarget.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const nextZoom = Math.max(.45, Math.min(1.8, canvasView.zoom * Math.exp(-event.deltaY * .005)))
      const ratio = nextZoom / canvasView.zoom
      persistCanvasView({
        x: pointerX - (pointerX - canvasView.x) * ratio,
        y: pointerY - (pointerY - canvasView.y) * ratio,
        zoom: nextZoom,
      })
      return
    }
    persistCanvasView({ ...canvasView, x: canvasView.x - event.deltaX, y: canvasView.y - event.deltaY })
  }

  function zoomCanvas(factor: number) {
    const viewport = boardRef.current
    if (!viewport) return
    const nextZoom = Math.max(.45, Math.min(1.8, canvasView.zoom * factor))
    const centerX = viewport.clientWidth / 2
    const centerY = viewport.clientHeight / 2
    const ratio = nextZoom / canvasView.zoom
    persistCanvasView({
      x: centerX - (centerX - canvasView.x) * ratio,
      y: centerY - (centerY - canvasView.y) * ratio,
      zoom: nextZoom,
    })
  }

  function startNoteDrag(event: ReactPointerEvent<HTMLButtonElement>, ideaId: string) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = positions[ideaId] ?? { x: 0, y: 0 }
    const startX = event.clientX
    const startY = event.clientY
    let latest = start
    setDraggingId(ideaId)

    const onMove = (moveEvent: PointerEvent) => {
      latest = {
        x: Math.round(start.x + (moveEvent.clientX - startX) / canvasView.zoom),
        y: Math.round(start.y + (moveEvent.clientY - startY) / canvasView.zoom),
      }
      setPositions(current => ({ ...current, [ideaId]: latest }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      persistPositions({ ...positions, [ideaId]: latest })
      setDraggingId(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
  }

  function nudgeNote(ideaId: string, dx: number, dy: number) {
    const current = positions[ideaId] ?? { x: 0, y: 0 }
    persistPositions({ ...positions, [ideaId]: { x: current.x + dx, y: current.y + dy } })
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.titleRow}><IconIdea size={30} /><h1>Ideeën</h1></div>
          <p>Inspiratie, experimenten en ideeën voor als je ruimte hebt.</p>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.surpriseButton} type="button" onClick={surpriseMe} disabled={openCount === 0}>
            <span aria-hidden>✦</span> Verras me
          </button>
          <button className={styles.addButton} type="button" onClick={() => setComposerOpen(true)}>
            + Nieuw idee
          </button>
        </div>
      </header>

      <section className={styles.toolbar} aria-label="Ideeën filteren">
        <div className={styles.categoryFilters} aria-label="Filter op soort">
          <button className={categoryFilter === 'all' ? styles.activeFilter : ''} onClick={() => setCategoryFilter('all')}>Alles</button>
          {categoryOptions.map(item => (
            <button key={item.value} className={categoryFilter === item.value ? styles.activeFilter : ''} onClick={() => setCategoryFilter(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className={styles.statusFilter}>
          <span>Status</span>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="active">Open en bezig ({openCount + doingCount})</option>
            <option value="doing">Wordt opgepakt ({doingCount})</option>
            <option value="done">Klaar ({doneCount})</option>
          </select>
        </label>
      </section>

      {composerOpen && (
        <form className={styles.composer} onSubmit={addIdea}>
          <button className={styles.closeButton} type="button" onClick={() => setComposerOpen(false)} aria-label="Sluiten"><IconClose size={19} /></button>
          <div className={styles.composerIntro}>
            <span>Plak iets op de muur</span>
            <small>Ruw mag. Het hoeft nog geen plan te zijn.</small>
          </div>
          <div className={styles.composerFields}>
            <input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="Wat is het idee?" maxLength={120} />
            <textarea value={body} onChange={event => setBody(event.target.value)} placeholder="Een gedachte, link of kleine toelichting (mag leeg)" rows={3} />
          </div>
          <div className={styles.composerOptions}>
            <label className={styles.categoryControl}>Soort
              <select value={creatingCategory ? '__new__' : category} onChange={event => {
                if (event.target.value === '__new__') {
                  setCreatingCategory(true)
                  window.setTimeout(() => document.getElementById('new-idea-category')?.focus(), 0)
                } else {
                  setCreatingCategory(false)
                  setNewCategory('')
                  setCategory(event.target.value)
                }
              }}>
                {categoryOptions.map(item => <option key={item.value} value={item.value}>{item.label} — {item.short}</option>)}
                <option value="__new__">＋ Eigen categorie toevoegen…</option>
              </select>
              {creatingCategory && (
                <input id="new-idea-category" className={styles.newCategoryInput} value={newCategory}
                  onChange={event => setNewCategory(event.target.value)}
                  placeholder="Naam van categorie" maxLength={40} />
              )}
            </label>
            <fieldset>
              <legend>Kleur</legend>
              <div className={styles.swatches}>
                {COLORS.map(value => <button key={value} type="button" aria-label={`Kleur ${value}`} className={color === value ? styles.selectedSwatch : ''} style={{ background: value }} onClick={() => setColor(value)} />)}
              </div>
            </fieldset>
            <button className={styles.pinButton} type="submit" disabled={!title.trim() || (creatingCategory && !newCategory.trim()) || saving}>{saving ? 'Plakken…' : 'Op de muur'}</button>
          </div>
        </form>
      )}

      <div className={`${styles.canvasViewport} ${panning ? styles.panning : ''}`} ref={boardRef}
        onPointerDown={startCanvasPan} onWheel={handleCanvasWheel}>
        <div className={styles.canvasHint}>Sleep de lege ruimte om rond te kijken</div>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyNotes} aria-hidden>
              <span>podcastvorm?</span><span>klein experiment</span><span>ooit eens maken</span>
            </div>
            <h2>{statusFilter === 'done' ? 'Nog niets afgerond' : 'Hier is nog alle ruimte.'}</h2>
            <p>Plak het eerste idee op de muur. Een halve gedachte is ook welkom.</p>
            {statusFilter !== 'done' && <button type="button" onClick={() => setComposerOpen(true)}>+ Eerste idee</button>}
          </div>
        ) : (
          <div className={styles.board} style={{ transform: `translate(${canvasView.x}px, ${canvasView.y}px) scale(${canvasView.zoom})` }}>
          {visible.map((idea, index) => (
          <article
            key={idea.id}
            data-idea-id={idea.id}
            className={`${styles.note} ${idea.status === 'doing' ? styles.doing : ''} ${highlighted === idea.id ? styles.highlighted : ''} ${draggingId === idea.id ? styles.dragging : ''}`}
            style={{
              '--note-color': idea.color,
              '--tilt': `${[-1.2, .7, -.4, 1.1, -.8][index % 5]}deg`,
              '--note-x': `${positions[idea.id]?.x ?? 0}px`,
              '--note-y': `${positions[idea.id]?.y ?? 0}px`,
            } as React.CSSProperties}
          >
            <button
              className={styles.dragHandle}
              type="button"
              aria-label={`${idea.title} verplaatsen`}
              title="Sleep om deze post-it te verplaatsen"
              onPointerDown={event => startNoteDrag(event, idea.id)}
              onClick={event => { event.preventDefault(); event.stopPropagation() }}
              onKeyDown={event => {
                const step = event.shiftKey ? 30 : 10
                const delta = event.key === 'ArrowLeft' ? [-step, 0]
                  : event.key === 'ArrowRight' ? [step, 0]
                    : event.key === 'ArrowUp' ? [0, -step]
                      : event.key === 'ArrowDown' ? [0, step]
                        : null
                if (!delta) return
                event.preventDefault()
                nudgeNote(idea.id, delta[0], delta[1])
              }}
            ><span /><span /><span /><span /><span /><span /></button>
            <button className={styles.noteMain} type="button" onClick={() => { setDeleteArmed(false); setEditing({ ...idea }) }} aria-label={`${idea.title} bewerken`}>
              <div className={styles.noteTop}>
                <span>{categoryLabel(idea.category)}</span>
                <span className={styles.notePin} aria-hidden />
              </div>
              <h2>{idea.title}</h2>
              {idea.body && <p>{idea.body}</p>}
            </button>
            <footer className={styles.noteFooter}>
              <span>{idea.authorName ? `van ${idea.authorName}` : relativeDate(idea.createdAt)}</span>
              {idea.status === 'open' && <button type="button" onClick={() => claim(idea)}>Pak op →</button>}
              {idea.status === 'doing' && <button type="button" onClick={() => updateIdea(idea.id, { status: 'done' })}>{idea.claimedName ?? 'Iemand'} · klaar</button>}
              {idea.status === 'done' && <button type="button" onClick={() => updateIdea(idea.id, { status: 'open', claimedBy: null, claimedName: null })}>Terug op muur</button>}
            </footer>
          </article>
          ))}
          </div>
        )}
        <div className={styles.canvasControls} aria-label="Canvasweergave">
          <button type="button" onClick={() => zoomCanvas(1 / 1.15)} aria-label="Uitzoomen">−</button>
          <button className={styles.zoomValue} type="button" onClick={() => persistCanvasView(DEFAULT_VIEW)} title="Herstel beeld">{Math.round(canvasView.zoom * 100)}%</button>
          <button type="button" onClick={() => zoomCanvas(1.15)} aria-label="Inzoomen">+</button>
        </div>
      </div>

      {editing && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setEditing(null); setDeleteArmed(false) } }}>
          <form className={styles.editModal} onSubmit={saveEdit} style={{ '--note-color': editing.color } as React.CSSProperties}>
            <button className={styles.closeButton} type="button" onClick={() => { setEditing(null); setDeleteArmed(false) }} aria-label="Sluiten"><IconClose size={20} /></button>
            <span className={styles.editLabel}>Idee aanpassen</span>
            <input value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} maxLength={120} />
            <textarea value={editing.body} onChange={event => setEditing({ ...editing, body: event.target.value })} placeholder="Voeg een toelichting toe…" rows={6} />
            <div className={styles.editOptions}>
              <select value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value as IdeaCategory })}>
                {categoryOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <div className={styles.swatches}>{COLORS.map(value => <button key={value} type="button" aria-label={`Kleur ${value}`} className={editing.color === value ? styles.selectedSwatch : ''} style={{ background: value }} onClick={() => setEditing({ ...editing, color: value })} />)}</div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.deleteButton} type="button" onClick={async () => {
                if (!deleteArmed) { setDeleteArmed(true); return }
                await deleteIdea(editing.id)
                setEditing(null)
                setDeleteArmed(false)
              }}>{deleteArmed ? 'Zeker weten?' : 'Verwijder'}</button>
              <button className={styles.saveButton} type="submit">Bewaar</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
