'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
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

function categoryLabel(value: IdeaCategory) {
  return CATEGORIES.find(category => category.value === value)?.label ?? 'Inspiratie'
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
  const [color, setColor] = useState(COLORS[0])
  const [editing, setEditing] = useState<IdeaItem | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const refresh = () => setIdeas(loadIdeas())
    refresh()
    pullIdeas().then(refresh).catch(() => {})
    const stopLocal = onIdeasChange(refresh)
    const stopRemote = subscribeRemoteIdeas()
    return () => { stopLocal(); stopRemote() }
  }, [])

  // Een suggestie op Home kan rechtstreeks naar een specifiek idee linken.
  // Open geen bewerkvenster ongevraagd: breng de kaart rustig in beeld.
  useEffect(() => {
    const ideaId = new URLSearchParams(window.location.search).get('idea')
    if (!ideaId || !ideas.some(idea => idea.id === ideaId)) return
    setCategoryFilter('all')
    setStatusFilter('active')
    setHighlighted(ideaId)
    const scrollTimer = window.setTimeout(() => {
      boardRef.current?.querySelector<HTMLElement>(`[data-idea-id="${CSS.escape(ideaId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 30)
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

  const openCount = ideas.filter(idea => idea.status === 'open').length
  const doingCount = ideas.filter(idea => idea.status === 'doing').length
  const doneCount = ideas.filter(idea => idea.status === 'done').length

  async function addIdea(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    await createIdea({
      title,
      body,
      category,
      color,
      authorId: profile?.memberId ?? null,
      authorName: profile?.name ?? null,
    })
    setTitle('')
    setBody('')
    setCategory('inspiratie')
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
    window.setTimeout(() => {
      boardRef.current?.querySelector<HTMLElement>(`[data-idea-id="${chosen.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 30)
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
          {CATEGORIES.map(item => (
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
            <label>Soort
              <select value={category} onChange={event => setCategory(event.target.value as IdeaCategory)}>
                {CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label} — {item.short}</option>)}
              </select>
            </label>
            <fieldset>
              <legend>Kleur</legend>
              <div className={styles.swatches}>
                {COLORS.map(value => <button key={value} type="button" aria-label={`Kleur ${value}`} className={color === value ? styles.selectedSwatch : ''} style={{ background: value }} onClick={() => setColor(value)} />)}
              </div>
            </fieldset>
            <button className={styles.pinButton} type="submit" disabled={!title.trim() || saving}>{saving ? 'Plakken…' : 'Op de muur'}</button>
          </div>
        </form>
      )}

      <div className={styles.board} ref={boardRef}>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyNotes} aria-hidden>
              <span>podcastvorm?</span><span>klein experiment</span><span>ooit eens maken</span>
            </div>
            <h2>{statusFilter === 'done' ? 'Nog niets afgerond' : 'Hier is nog alle ruimte.'}</h2>
            <p>Plak het eerste idee op de muur. Een halve gedachte is ook welkom.</p>
            {statusFilter !== 'done' && <button type="button" onClick={() => setComposerOpen(true)}>+ Eerste idee</button>}
          </div>
        ) : visible.map((idea, index) => (
          <article
            key={idea.id}
            data-idea-id={idea.id}
            className={`${styles.note} ${idea.status === 'doing' ? styles.doing : ''} ${highlighted === idea.id ? styles.highlighted : ''}`}
            style={{ '--note-color': idea.color, '--tilt': `${[-1.2, .7, -.4, 1.1, -.8][index % 5]}deg` } as React.CSSProperties}
          >
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

      {editing && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setEditing(null); setDeleteArmed(false) } }}>
          <form className={styles.editModal} onSubmit={saveEdit} style={{ '--note-color': editing.color } as React.CSSProperties}>
            <button className={styles.closeButton} type="button" onClick={() => { setEditing(null); setDeleteArmed(false) }} aria-label="Sluiten"><IconClose size={20} /></button>
            <span className={styles.editLabel}>Idee aanpassen</span>
            <input value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} maxLength={120} />
            <textarea value={editing.body} onChange={event => setEditing({ ...editing, body: event.target.value })} placeholder="Voeg een toelichting toe…" rows={6} />
            <div className={styles.editOptions}>
              <select value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value as IdeaCategory })}>
                {CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
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
