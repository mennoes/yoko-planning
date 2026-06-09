'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/components/ProfileContext'
import { useTeam } from '@/components/TeamContext'
import { useMemberPopup } from '@/components/MemberPopup'
import { useIsMobile } from '@/lib/useIsMobile'
import { IconCheckList, IconHourglass, IconDocument, IconUsers, IconClock, IconAlert } from '@/components/Icon'
import { UserAvatar } from '@/components/UserAvatar'
import { VacationButton } from '@/components/VacationButton'
import { loadRecentPages, type PageDoc } from '@/lib/pagesStore'
import { saveDocs, loadDocs } from '@/lib/navStore'
import todosData from '@/data/todos.json'
import {
  loadSections as loadTodoSectionsStore,
  saveSections as saveTodoSectionsStore,
  pullFromRemote as pullTodos,
  onTodosUpdate,
  type Section as TodoSection,
  type TodoItem as TodoStoreItem,
} from '@/lib/todosStore'
import { loadMyOpenProjects } from '@/lib/todoProjectSeed'
import teamData  from '@/data/team.json'
import yokoRaw        from '@/data/boards/yoko.json'
import pnpRaw         from '@/data/boards/pnp.json'
import nederlandRaw   from '@/data/boards/nederland.json'
import vlaanderenRaw  from '@/data/boards/vlaanderen.json'
import dienjaarRaw    from '@/data/boards/dienjaar.json'
import { loadGroups, saveGroups, pushBoardToRemote } from '@/lib/boardStore'
import { getWeekStart, memberContributions, BOARD_COLORS, groupsToProjects, type Project } from '@/lib/workload'
import { setVrijDaysFromProjects } from '@/lib/vrijDays'
import {
  CAT_COLOR, CAT_LABEL, ALL_CATEGORIES,
  effectiveCategory,
  loadCategoryOverrides, setCategoryOverride, onCategoryOverridesChange,
  type WorkloadCategory,
} from '@/lib/workloadCategory'
import { supabase } from '@/lib/supabase'
import type { BoardGroup, BoardItem } from '@/lib/boards'

const RAW: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw, vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
}

type TodoItem = { id: string; text: string; done: boolean }

type SectionId = 'taken' | 'werkdruk' | 'team' | 'deadlines' | 'overload' | 'documenten' | 'paginas'
const DEFAULT_SECTION_ORDER: SectionId[] = ['taken', 'werkdruk', 'team', 'deadlines', 'overload', 'paginas', 'documenten']

type RemoteProfile = {
  member_id:       string | null
  name:            string | null
  vacation_until:  string | null
  days_off:        string[] | null
  weekly_capacity: number | null
}

const NL_DAY_CODES = ['sun','mon','tue','wed','thu','fri','sat']
const DAY_NL: Record<string, string> = { mon: 'maandag', tue: 'dinsdag', wed: 'woensdag', thu: 'donderdag', fri: 'vrijdag', sat: 'zaterdag', sun: 'zondag' }

const QUICK_LINKS: { groups: { name: string; items: { label: string; href: string; emoji: string }[] }[] } = {
  groups: [
    {
      name: 'Algemeen',
      items: [
        { label: 'Kantoor',         href: '/kantoor',         emoji: '🏢' },
        { label: 'Team',            href: '/team',            emoji: '👥' },
        { label: 'Accounts',        href: '/accounts',        emoji: '🔑' },
        { label: 'Tools',           href: '/pages/tools',     emoji: '🎨' },
        { label: 'Samenwerkingen',  href: '/pages/samenwerkingen', emoji: '❤️' },
      ],
    },
    {
      name: 'HR',
      items: [
        { label: 'Vakantieaanvragen', href: '/pages/vakantie',  emoji: '🏝' },
        { label: 'Loonstroken',       href: '/pages/loonstroken', emoji: '💰' },
      ],
    },
  ],
}

const NL_MONTHS = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

// groupsToProjects is verhuisd naar lib/workload.ts zodat home en planning
// exact dezelfde explosion-logica gebruiken. Belangrijk verschil met de
// oude home-only versie: subitems met eigen datums (bv. de 34 instances
// van een wekelijkse meeting) worden nu als losse projects opgeleverd
// met hun eigen korte duur, in plaats van als één multi-week parent.

function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate()} ${NL_MONTHS[d.getMonth()]}`
}
function deadlineColor(iso: string | null): { bg: string; fg: string } | null {
  if (!iso) return null
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days < 0)  return { bg: 'rgba(196,69,58,0.15)',  fg: '#C4453A' }
  if (days <= 3) return { bg: 'rgba(196,69,58,0.15)',  fg: '#C4453A' }
  if (days <= 7) return { bg: 'rgba(255,123,36,0.15)', fg: '#ff7b24' }
  return null
}
function fmtRelative(iso: string) {
  const now = Date.now(), then = new Date(iso).getTime()
  const diff = Math.floor((now - then) / 60000)
  if (diff < 1)    return 'zojuist'
  if (diff < 60)   return `${diff}m geleden`
  if (diff < 1440) return `${Math.floor(diff / 60)}u geleden`
  return fmtDate(iso)
}

// ─── Greeting summary helpers ────────────────────────────────────────────────
// Used to build a short, concrete recap under the greeting: which projects
// the user works on this week, who they collaborate with, and a tone for
// last and next week's load.
function joinAnd(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} en ${names[1]}`
  return `${names.slice(0, -1).join(', ')} en ${names[names.length - 1]}`
}
function pastTone(hours: number, cap: number): string {
  const r = Math.round
  if (hours <= 0)          return 'vorige week stond er niets op de planning'
  if (hours > cap * 1.05)  return `vorige week was pittig (${r(hours)}u 💪)`
  if (hours >= cap * 0.85) return `vorige week zat lekker vol (${r(hours)}u)`
  if (hours >= cap * 0.5)  return `vorige week was prima behapbaar (${r(hours)}u)`
  return `vorige week was rustig (${r(hours)}u)`
}
function nextTone(hours: number, cap: number): string {
  const r = Math.round
  if (hours <= 0)          return 'volgende week is nog leeg ✨'
  if (hours > cap * 1.05)  return `volgende week schiet je over je cap met ${r(hours)}u — pas op je tempo`
  if (hours >= cap * 0.85) return `volgende week wordt vol (${r(hours)}u)`
  if (hours >= cap * 0.5)  return `volgende week zit prima (${r(hours)}u)`
  return `volgende week is wat rustiger (${r(hours)}u)`
}
function helpHint({ slack, others }: { slack: number; others: { member: { name: string }; pct: number }[] }): string | null {
  if (slack < 4 || others.length === 0) return null
  const top   = others[0]
  const first = top.member.name.split(' ')[0]
  return `Je hebt deze week nog ~${Math.round(slack)}u ruimte — ${first} zit op ${top.pct}%, misschien iets oppakken? 🤝`
}

type WorkloadItem = { id: string; rawItemId: string; name: string; board: string; hours: number; day: number; startDate: string | null; endDate: string | null; startTime?: string | null; endTime?: string | null; source?: 'manual' | 'google'; externalLink?: string; meetLink?: string; done: boolean; parentName?: string }

type Category = WorkloadCategory

// Workload row. Click → opens the detail popover (with a category picker
// and an explicit "Open agenda" link). Hover on desktop also previews the
// popover. The row never navigates by itself — only the link inside does.
function WorkloadItemRow({ item, override, onSetCategory, onToggleDone }: {
  item: WorkloadItem
  override: Category | null
  onSetCategory: (id: string, cat: Category | null) => void
  onToggleDone: (item: WorkloadItem, next: boolean) => void
}) {
  const router = useRouter()
  const [hoverRow, setHoverRow] = useState(false)
  const [hoverPop, setHoverPop] = useState(false)
  const rowRef = useRef<HTMLLIElement>(null)
  const [popPos, setPopPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null)
  const cat       = effectiveCategory(item, override)
  const dotColor  = CAT_COLOR[cat]
  const catLabel  = CAT_LABEL[cat]
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : '—'
  const range = item.startDate || item.endDate
    ? `${fmt(item.startDate)} – ${fmt(item.endDate)}`
    : 'Geen datums'

  // Popover blijft alleen open op hover (desktop). Tap/klik op de row
  // navigeert naar de bord-pagina en opent daar de volledige detail-drawer
  // — dat is wat de gebruiker echt nodig heeft, niet alleen een mini-popup.
  const popoverOpen = hoverRow || hoverPop

  // Bereken positie op basis van de row: voorkomt clipping door card-overflow
  // (we renderen de popover via een portal in document.body) en flipt boven
  // de row als-ie anders onder de viewport zou vallen.
  useEffect(() => {
    if (!popoverOpen || !rowRef.current) { setPopPos(null); return }
    const place = () => {
      const r = rowRef.current?.getBoundingClientRect()
      if (!r) return
      const popH = 260   // geschatte hoogte — flip-trigger is een kwestie van smaak
      const room = window.innerHeight - r.bottom
      const placeAbove = room < popH && r.top > popH
      setPopPos({
        top:  placeAbove ? r.top - 4 : r.bottom + 4,
        left: r.left,
        placeAbove,
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [popoverOpen])

  const rowVisualStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 6px', margin: '0 -6px', borderRadius: 6,
    textDecoration: 'none',
    background: hoverRow ? 'var(--bg-hover)' : 'transparent',
    transition: 'background 0.12s, opacity 0.12s',
    width: '100%', textAlign: 'left',
    border: 'none', font: 'inherit', color: 'inherit',
    cursor: 'pointer',
    opacity: item.done ? 0.55 : 1,
  }

  function openDetail() {
    // Naar de bord-pagina met focus + drawer-param. BoardRow leest 'drawer'
    // uit de URL en opent zijn detail-drawer automatisch zodra de juiste
    // rij gerenderd is — geen extra klik nodig.
    const url = `/projects/${item.board}?focus=${encodeURIComponent(item.rawItemId)}&drawer=${encodeURIComponent(item.rawItemId)}`
    router.push(url)
  }

  const rowContent = (
    <>
      <span title={catLabel} style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {item.startTime && (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 36 }}>
          {item.startTime.slice(0,5)}
        </span>
      )}
      <span style={{ fontSize: 13,
        color: cat === 'maken' ? 'var(--text-primary)' : 'var(--text-muted)',
        fontWeight: cat === 'maken' ? 500 : 400, flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: item.done ? 'line-through' : 'none' }}>
        {item.name}
        {item.parentName && item.parentName !== item.name && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: 11.5 }}>
            ↳ {item.parentName}
          </span>
        )}
      </span>
      {item.meetLink && (
        <a href={item.meetLink} target="_blank" rel="noopener noreferrer"
          title="Open Google Meet"
          onClick={e => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 6px 1px 5px', borderRadius: 4,
            background: '#00ac47', color: '#fff',
            fontSize: 9.5, fontWeight: 700, lineHeight: 1.3, flexShrink: 0,
            textDecoration: 'none' }}>
          Meet<span style={{ fontSize: 8, opacity: 0.85 }}>↗</span>
        </a>
      )}
      {item.source === 'google' && (
        <a href={item.externalLink} target="_blank" rel="noopener noreferrer"
          title="Open in Google Calendar"
          onClick={e => e.stopPropagation()}
          style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, textDecoration: 'none' }}>G</a>
      )}
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, minWidth: 32, textAlign: 'right' }}>{item.hours}u</span>
    </>
  )

  return (
    <li ref={rowRef} data-workload-row={item.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}
        onMouseEnter={() => setHoverRow(true)} onMouseLeave={() => setHoverRow(false)}>
      {/* Checkbox: project Done/onDone togglen vanuit de werkdruk-widget.
          stopPropagation zodat de row-klik niet ook navigeert. */}
      <input type="checkbox" checked={item.done}
        onClick={e => e.stopPropagation()}
        onChange={e => { e.stopPropagation(); onToggleDone(item, e.target.checked) }}
        title={item.done ? 'Markeer als nog niet klaar' : 'Markeer als Done'}
        style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
      <button type="button" onClick={openDetail} style={rowVisualStyle}>
        {rowContent}
      </button>
      {popoverOpen && popPos && typeof document !== 'undefined' && createPortal(
        <div data-workload-row={item.id}
          onMouseEnter={() => setHoverPop(true)} onMouseLeave={() => setHoverPop(false)}
          style={{ position: 'fixed', top: popPos.top, left: popPos.left,
            transform: popPos.placeAbove ? 'translateY(-100%)' : 'none', zIndex: 9050,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '10px 12px', minWidth: 240, maxWidth: 320,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.08)',
            fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{catLabel}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>{item.board}</span>
          </div>
          {item.parentName && item.parentName !== item.name && (
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
              ↳ in {item.parentName}
            </div>
          )}
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{item.name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span>{range}</span>
            <span><strong style={{ color: 'var(--text-primary)' }}>{item.hours}u</strong> deze week</span>
          </div>
          <div style={{ marginTop: 10, marginBottom: 5, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Categorie</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {ALL_CATEGORIES.map(c => {
              const active = cat === c
              const color  = CAT_COLOR[c]
              return (
                <button key={c} type="button"
                  onClick={(e) => { e.stopPropagation(); onSetCategory(item.id, c) }}
                  style={{
                    flex: '1 1 calc(50% - 3px)', padding: '5px 6px', borderRadius: 6,
                    border: active ? `1.5px solid ${color}` : '1px solid var(--border)',
                    background: active ? `${color}22` : 'var(--bg-card)',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 11, fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                  {CAT_LABEL[c]}
                </button>
              )
            })}
          </div>
          {override && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onSetCategory(item.id, null) }}
              style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              Reset naar automatisch
            </button>
          )}
          <Link href={`/projects/${item.board}`}
            style={{ display: 'block', marginTop: 8, padding: '6px 10px', textAlign: 'center',
              fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
              background: 'var(--bg-hover)', borderRadius: 6, textDecoration: 'none' }}>
            Open agenda →
          </Link>
        </div>,
        document.body,
      )}
    </li>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 14,
  border: '1px solid var(--border-light)', overflow: 'hidden',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 6px 18px rgba(0,0,0,0.04)',
}
const cardHeader: React.CSSProperties = {
  padding: '14px 18px 12px', borderBottom: '1px solid var(--border-light)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  background: 'var(--overlay-faint)',
}
const cardLink: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none',
  fontWeight: 600, letterSpacing: '0.02em',
}

export default function HomePage() {
  const { profile }    = useProfile()
  const { members: liveTeam } = useTeam()
  const { showMember } = useMemberPopup()
  const router         = useRouter()
  const isMobile       = useIsMobile()
  // Helper: classificeer als yoko-crew op basis van team_members.kind,
  // fallback hardcoded set. Wordt gebruikt voor 'Team vandaag'.
  const HARDCODED_YOKO = new Set(['menno','vincent','odette','anne-fleur','kars'])
  const isYokoCrew = (id: string): boolean => {
    const fromDb = liveTeam.find(m => m.id === id)?.kind
    if (fromDb) return fromDb === 'yoko'
    return HARDCODED_YOKO.has(id)
  }

  const [recentPages,  setRecentPages]  = useState<PageDoc[]>([])
  const [myTodos,      setMyTodos]      = useState<TodoStoreItem[]>([])
  const [newTodoText,  setNewTodoText]  = useState('')
  const [weekHours,    setWeekHours]    = useState(0)
  const [weekCapacity, setWeekCapacity] = useState(40)
  const [weekItems,    setWeekItems]    = useState<{ id: string; rawItemId: string; name: string; board: string; hours: number; day: number; startDate: string | null; endDate: string | null; startTime?: string | null; endTime?: string | null; source?: 'manual' | 'google'; externalLink?: string; meetLink?: string; done: boolean }[]>([])
  const [weekOffset,   setWeekOffset]   = useState(0)
  const [hydrated,     setHydrated]     = useState(false)
  const [editOrder,    setEditOrder]    = useState(false)
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(DEFAULT_SECTION_ORDER)
  const [profilesById, setProfilesById] = useState<Record<string, RemoteProfile>>({})
  const [allProjects,  setAllProjects]  = useState<Project[]>([])
  const [deadlineItems, setDeadlineItems] = useState<{ board: string; item: BoardItem }[]>([])
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, Category>>({})

  const memberId = profile?.memberId ?? ''

  useEffect(() => {
    setCategoryOverrides(loadCategoryOverrides())
    setRecentPages(loadRecentPages().slice(0, 9))

    // My todos: lees uit de live todosStore (zelfde bron als /todos pagina)
    // i.p.v. de statische initial-data JSON. Subscribe op updates zodat
    // wijzigingen op /todos hier meteen verschijnen.
    // Daarnaast vullen we aan met openstaande project-items (loadMyOpen-
    // Projects) — anders zou de home-card minder items tonen dan /todos
    // wanneer de auto-seed daar nog niet is gedraaid (user heeft /todos
    // nooit geopend in deze sessie).
    function loadMine() {
      const fallback: TodoSection[] = todosData.sections as TodoSection[]
      const sections = loadTodoSectionsStore(fallback)
      const s = sections.find(x => x.id === memberId)
      const stored = (s?.items ?? []) as TodoStoreItem[]
      const existingIds = new Set(stored.map(t => t.projectRef?.itemId).filter((x): x is string => !!x))
      const extras: TodoStoreItem[] = loadMyOpenProjects(memberId)
        .filter(p => !existingIds.has(p.itemId))
        .map((p, i) => ({
          id: `auto-${p.board}-${p.itemId}-${i}`,
          text: p.name, done: false,
          projectRef: { board: p.board, itemId: p.itemId, name: p.name },
        }))
      setMyTodos([...stored, ...extras])
    }
    loadMine()
    pullTodos().then(remote => {
      if (remote) {
        const s = remote.find(x => x.id === memberId)
        const stored = (s?.items ?? []) as TodoStoreItem[]
        const existingIds = new Set(stored.map(t => t.projectRef?.itemId).filter((x): x is string => !!x))
        const extras: TodoStoreItem[] = loadMyOpenProjects(memberId)
          .filter(p => !existingIds.has(p.itemId))
          .map((p, i) => ({
            id: `auto-${p.board}-${p.itemId}-${i}`,
            text: p.name, done: false,
            projectRef: { board: p.board, itemId: p.itemId, name: p.name },
          }))
        setMyTodos([...stored, ...extras])
      }
    }).catch(() => {})
    const offTodos = onTodosUpdate(loadMine)

    // Load all boards once for team status / deadlines / workload widgets
    const projectList: Project[] = []
    const allDeadlines: { board: string; item: BoardItem }[] = []
    const now = Date.now(); const weekAhead = now + 7 * 86400000
    for (const [name, raw] of Object.entries(RAW)) {
      const groups = loadGroups(name, raw.groups as BoardGroup[])
      projectList.push(...groupsToProjects(name, groups))
      for (const g of groups) for (const item of g.items) {
        if (!item.deadline) continue
        const dl = new Date(item.deadline as string).getTime()
        if (dl >= now - 86400000 && dl <= weekAhead) {
          allDeadlines.push({ board: name, item })
        }
      }
    }
    setAllProjects(projectList)
    // Vrij-events cachen voor de countWorkdays-checks zodat memberContributions
    // ze direct kan overslaan in de werkdruk-berekening.
    setVrijDaysFromProjects(projectList)
    allDeadlines.sort((a, b) => new Date(a.item.deadline as string).getTime() - new Date(b.item.deadline as string).getTime())
    setDeadlineItems(allDeadlines)

    // Workload data per week is recomputed in a separate effect on weekOffset
    // Capacity: prefer the override the user set in the planning tool
    // (localStorage 'yoko-capacities'), fall back to teamData default.
    let cap =
      liveTeam.find(m => m.id === memberId)?.weeklyCapacity
      ?? teamData.members.find(m => m.id === memberId)?.weeklyCapacity
      ?? 40
    try {
      const raw = localStorage.getItem('yoko-capacities')
      if (raw) {
        const map = JSON.parse(raw) as Record<string, number>
        if (memberId in map) cap = map[memberId]
      }
    } catch {}
    // Géén extra schaling op days_off — weeklyCapacity is al wat de user
    // daadwerkelijk werkt (Menno zet 32u in als hij 4 dagen werkt).
    // Dubbele schaling zou er 25.6u van maken.
    setWeekCapacity(cap)

    // Restore mobile section order
    try {
      const saved = localStorage.getItem('home-sections-order')
      if (saved) {
        const parsed = JSON.parse(saved) as SectionId[]
        if (Array.isArray(parsed) && DEFAULT_SECTION_ORDER.every(id => parsed.includes(id))) {
          setSectionOrder(parsed)
        }
      }
    } catch {}

    setHydrated(true)

    return () => { offTodos() }
  }, [memberId])

  // Recompute the workload list whenever the week offset (or the project list
  // / member changes). Lets the user step through previous/next weeks.
  useEffect(() => {
    if (!memberId) { setWeekItems([]); setWeekHours(0); return }
    const base = getWeekStart(new Date())
    const week = new Date(base); week.setDate(week.getDate() + weekOffset * 7)
    const contribs = memberContributions(allProjects, memberId, week)
    setWeekHours(Math.round(contribs.reduce((s, c) => s + c.hours, 0) * 10) / 10)
    // Items blijven op hun start-dag staan. Eerdere variant schoof
    // ongoing items naar 'vandaag', waardoor afgelopen dagen leeg
    // raakten en uit de lijst verdwenen. Nu zie je ook gisteren en
    // eerder deze week terug — gerendered met fade zodat duidelijk is
    // dat 't verleden is.
    // Eén item per project, geclampt naar 'vandaag binnen 't project-
    // bereik'. Logica:
    //  - Loopt 't project NU (start <= today <= end): day = today
    //  - Project al voorbij (end < today): day = end (laatste actieve dag)
    //  - Project begint nog (today < start): day = start
    // Zo verschuift 'n ma-wo project op maandag naar maandag, op dinsdag
    // naar dinsdag, en blijft 't dan op woensdag op woensdag staan. Past
    // days tonen niet meer dezelfde lopende items, alleen items die op
    // die dag écht zijn afgerond.
    const todayIso = new Date().toISOString().slice(0, 10)
    const todayD = new Date(todayIso)
    const wStart = new Date(week)
    const wEnd   = new Date(week); wEnd.setDate(wEnd.getDate() + 7)
    setWeekItems(contribs.map(c => {
      const sd = c.project.startDate ? new Date(c.project.startDate) : null
      const ed = c.project.endDate   ? new Date(c.project.endDate)   : sd
      let ref: Date
      if (sd && ed) {
        if (todayD < sd) ref = sd
        else if (todayD > ed) ref = ed
        else ref = todayD
      } else if (sd) {
        ref = sd
      } else {
        ref = wStart
      }
      // Buiten de zichtbare week vallen we terug op de project-start (zo
      // verschuift een 'vorige-week-view' niet plots ongeoorloofd).
      if (ref < wStart) ref = sd ?? wStart
      if (ref >= wEnd && ed) ref = ed
      const day = (ref.getDay() + 6) % 7
      const rawItemId = c.project.id.startsWith(`${c.project.board}__`)
        ? c.project.id.slice(c.project.board.length + 2)
        : c.project.id
      return {
        id: c.project.id,
        rawItemId,
        name: c.project.name, board: c.project.board, hours: c.hours, day,
        startDate: c.project.startDate, endDate: c.project.endDate,
        startTime: c.project.startTime, endTime: c.project.endTime,
        source: c.project.source, externalLink: c.project.externalLink,
        meetLink: c.project.meetLink,
        done: c.project.status === 'done',
        parentName: c.project.parentName,
      }
    }))
  }, [memberId, weekOffset, allProjects])

  // Re-load category overrides if another view changes them.
  useEffect(() => {
    return onCategoryOverridesChange(() => setCategoryOverrides(loadCategoryOverrides()))
  }, [])

  // Pull all member profiles for team-status / vacation widgets
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase.from('profiles').select('member_id, name, vacation_until, days_off, weekly_capacity').then(({ data }) => {
      if (cancelled || !data) return
      const map: Record<string, RemoteProfile> = {}
      for (const r of data as RemoteProfile[]) { if (r.member_id) map[r.member_id] = r }
      setProfilesById(map)
    })
    return () => { cancelled = true }
  }, [])

  function setItemCategory(id: string, cat: Category | null) {
    setCategoryOverrides(setCategoryOverride(id, cat))
  }

  // Voeg een nieuwe todo toe vanuit de home 'Jouw taken'-kaart aan de eigen
  // sectie in de todosStore. Houdt dezelfde data-bron aan als /todos zodat
  // de telling daar meteen klopt.
  function addHomeTodo(text: string) {
    const t = text.trim()
    if (!t || !memberId) return
    const fallback: TodoSection[] = todosData.sections as TodoSection[]
    const sections = loadTodoSectionsStore(fallback)
    let found = false
    const next = sections.map(s => {
      if (s.id !== memberId) return s
      found = true
      return {
        ...s,
        items: [...s.items, { id: `home-${Date.now()}`, text: t, done: false }],
      }
    })
    // Nog geen eigen sectie? Maak 'm aan zodat de todo ergens kan landen.
    const finalSections: TodoSection[] = found ? next : [
      ...next,
      {
        id: memberId,
        title: profile?.name ?? memberId,
        emoji: '👤',
        items: [{ id: `home-${Date.now()}`, text: t, done: false }],
      },
    ]
    saveTodoSectionsStore(finalSections)
    setNewTodoText('')
    const mine = finalSections.find(s => s.id === memberId)
    if (mine) setMyTodos(mine.items as TodoStoreItem[])
  }

  // Tick een workload-item Done (of un-Done): laadt het juiste bord, zet
  // status='Done' (of '' bij un-Done) op de matchende row, slaat op én pusht
  // naar Supabase. Update óók optimistic in weekItems zodat de strike-through
  // direct zichtbaar is zonder te wachten op de board-update-event.
  async function toggleWorkloadDone(it: WorkloadItem, next: boolean) {
    setWeekItems(items => items.map(w => w.id === it.id ? { ...w, done: next } : w))
    const groups = loadGroups(it.board, [])
    const updated = groups.map(g => ({
      ...g,
      items: g.items.map(i => {
        if (i.id !== it.rawItemId) return i
        // Bij uitvinken zetten we 'm terug naar 'Working on...' (default voor
        // actief werk) tenzij 'ie al een andere niet-Done status had.
        if (next) return { ...i, status: 'Done' }
        const prev = (i.status as string) ?? ''
        return { ...i, status: prev === 'Done' ? '' : prev }
      }),
    }))
    saveGroups(it.board, updated)
    pushBoardToRemote(it.board, updated).catch(() => {})
  }

  function moveSection(id: SectionId, dir: -1 | 1) {
    setSectionOrder(prev => {
      const idx = prev.indexOf(id)
      const next = idx + dir
      if (idx < 0 || next < 0 || next >= prev.length) return prev
      const updated = [...prev]
      updated[idx] = updated[next]; updated[next] = id
      localStorage.setItem('home-sections-order', JSON.stringify(updated))
      return updated
    })
  }

  function createNewPage() {
    const id   = Date.now().toString()
    const href = `/pages/${id}`
    const docs = loadDocs()
    saveDocs([...docs, { id, label: 'Naamloos document', href, icon: '📄' }])
    router.push(href)
  }

  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond'
  const firstName = profile?.name?.split(' ')[0] ?? ''
  const openTodos = myTodos.filter(t => !t.done)
  const doneTodos = myTodos.filter(t => t.done)
  const pct       = weekCapacity > 0 ? Math.min(weekHours / weekCapacity, 1) : 0
  const barColor  = pct > 0.9 ? '#e2445c' : pct > 0.6 ? 'var(--accent)' : '#00c875'

  if (!hydrated) return null

  // ─── Team status helpers ────────────────────────────────────────────────────
  const todayCode = NL_DAY_CODES[new Date().getDay()]
  type Status = { kind: 'vacation' | 'free' | 'available'; detail?: string }
  function statusFor(memberIdLocal: string): Status {
    const p = profilesById[memberIdLocal]
    if (p?.vacation_until) {
      const until = new Date(p.vacation_until)
      until.setHours(23, 59, 59, 999)
      if (until.getTime() >= Date.now()) {
        const fmt = until.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
        return { kind: 'vacation', detail: `terug ${fmt}` }
      }
    }
    if (p?.days_off?.includes(todayCode)) return { kind: 'free', detail: 'vrij vandaag' }
    return { kind: 'available' }
  }

  // Hours per member this week — list = alle leden waarvan
  // team_members.kind = 'yoko'; fallback op hardcoded set voor
  // pre-DB / extras. Zo verschijnt Manuel direct in 'Team vandaag'
  // zodra-ie via /team-admin is toegevoegd.
  const allMembersForHome: Array<{ id: string; name: string; color?: string; weeklyCapacity?: number }> = (() => {
    const seen = new Set<string>()
    const out: Array<{ id: string; name: string; color?: string; weeklyCapacity?: number }> = []
    for (const m of liveTeam) {
      if (m.hidden || m.id === 'unassigned') continue
      seen.add(m.id)
      out.push({ id: m.id, name: m.name, color: m.color, weeklyCapacity: m.weeklyCapacity })
    }
    for (const m of teamData.members) {
      if (seen.has(m.id) || m.id === 'unassigned') continue
      out.push(m)
    }
    return out
  })()
  const yokoMembers = allMembersForHome.filter(m => isYokoCrew(m.id))
  const weekStartTeam = getWeekStart(new Date())
  const memberHoursThisWeek: Record<string, number> = {}
  for (const m of yokoMembers) {
    const contribs = memberContributions(allProjects, m.id, weekStartTeam)
    memberHoursThisWeek[m.id] = Math.round(contribs.reduce((s, c) => s + c.hours, 0) * 10) / 10
  }
  // Geen extra cap-schaling op days_off — weeklyCapacity is al wat de
  // gebruiker daadwerkelijk werkt. Vrije dagen worden al gerespecteerd
  // door de uren-distributie (die geeft 0u op off-days, dus 't totaal
  // dat in de week-cellen verschijnt klopt al). Dubbele schaling zou
  // 32u-cap nóg eens 4/5 maken = 25.6u, wat klopt niet.
  const overloaded = yokoMembers
    .map(m => {
      const cap = profilesById[m.id]?.weekly_capacity ?? m.weeklyCapacity ?? 40
      const hrs = memberHoursThisWeek[m.id] ?? 0
      return { member: m, hours: hrs, cap, pct: cap > 0 ? Math.round((hrs / cap) * 100) : 0 }
    })
    .filter(x => x.hours > x.cap)
    .sort((a, b) => b.pct - a.pct)

  const myLastWeekStart = new Date(weekStartTeam); myLastWeekStart.setDate(myLastWeekStart.getDate() - 7)
  const myNextWeekStart = new Date(weekStartTeam); myNextWeekStart.setDate(myNextWeekStart.getDate() + 7)
  const myThisContribs = memberId
    ? memberContributions(allProjects, memberId, weekStartTeam).slice().sort((a, b) => b.hours - a.hours)
    : []
  const myLastHours = memberId
    ? Math.round(memberContributions(allProjects, memberId, myLastWeekStart).reduce((s, c) => s + c.hours, 0) * 10) / 10
    : 0
  const myNextHours = memberId
    ? Math.round(memberContributions(allProjects, memberId, myNextWeekStart).reduce((s, c) => s + c.hours, 0) * 10) / 10
    : 0
  const myThisHours = Math.round(myThisContribs.reduce((s, c) => s + c.hours, 0) * 10) / 10

  const firstNameOf = (id: string) =>
    liveTeam.find(m => m.id === id)?.name?.split(' ')[0]
    ?? teamData.members.find(m => m.id === id)?.name?.split(' ')[0]
    ?? null
  const r1 = (n: number) => Math.round(n * 10) / 10
  const cat = (c: typeof myThisContribs[number]) => effectiveCategory(
    { name: c.project.name, hours: c.hours, source: c.project.source },
    categoryOverrides[c.project.id],
  )
  const makenContribs = myThisContribs.filter(c => cat(c) === 'maken')

  // ── Day-aware partition: where are we in the week? ─────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayDay  = (today.getDay() + 6) % 7  // Mon=0..Sun=6
  const isWeekend = todayDay >= 5

  type GroupedProj = {
    name: string
    hours: number
    ownerIds: Set<string>
    startDay: number | null
  }

  // Combine contribs that share a project name (subitems / split bars) into
  // one entry. Track the earliest start day so we can place the project in
  // the past / today / future bucket.
  const grouped = new Map<string, GroupedProj>()
  for (const c of makenContribs) {
    const key = c.project.name.trim().toLowerCase()
    const sd  = c.project.startDate ? new Date(c.project.startDate) : null
    const day = sd && !isNaN(sd.getTime()) ? (sd.getDay() + 6) % 7 : null
    const cur = grouped.get(key)
    if (cur) {
      cur.hours += c.hours
      for (const id of c.project.ownerIds || []) cur.ownerIds.add(id)
      if (day !== null && (cur.startDay === null || day < cur.startDay)) cur.startDay = day
    } else {
      grouped.set(key, { name: c.project.name, hours: c.hours,
        ownerIds: new Set(c.project.ownerIds || []), startDay: day })
    }
  }
  const groupedArr = [...grouped.values()].sort((a, b) => b.hours - a.hours)

  const withNamesOf = (p: GroupedProj) => [...p.ownerIds]
    .filter(id => id !== memberId)
    .map(firstNameOf)
    .filter((n): n is string => Boolean(n))

  const pastProjects   = groupedArr.filter(p => p.startDay !== null && p.startDay <  todayDay).slice(0, 2)
  const todayProjects  = groupedArr.filter(p => p.startDay === todayDay).slice(0, 2)
  const futureProjects = groupedArr.filter(p => p.startDay !== null && p.startDay >  todayDay).slice(0, 2)
  const weekendProjects = isWeekend ? groupedArr.slice(0, 3) : []

  // Items that should have been wrapped up by today but are still active.
  // Limited to the past 14 days so we don't surface ancient projects.
  const fortnightAgoMs = today.getTime() - 14 * 86400000
  const behindSchedule = memberId
    ? allProjects
        .filter(p => p.status !== 'done' && (p.ownerIds || []).includes(memberId))
        .filter(p => {
          if (!p.endDate) return false
          const e = new Date(p.endDate); e.setHours(23, 59, 59, 999)
          return e.getTime() < today.getTime() && e.getTime() >= fortnightAgoMs
        })
        .slice(0, 2)
    : []

  const meetingHours  = r1(myThisContribs.filter(c => cat(c) === 'meeting').reduce((s, c) => s + c.hours, 0))
  const overheadHours = r1(myThisContribs.filter(c => cat(c) === 'overhead').reduce((s, c) => s + c.hours, 0))

  const otherSegments: string[] = []
  if (meetingHours  >= 0.5) otherSegments.push(`${meetingHours}u aan meetings`)
  if (overheadHours >= 0.5) otherSegments.push(`${overheadHours}u overhead`)
  const otherInfo = otherSegments.length > 0 ? joinAnd(otherSegments) : ''

  const hasAnyWeekProject = pastProjects.length + todayProjects.length + futureProjects.length + weekendProjects.length > 0
  const showSummary = !!memberId && (hasAnyWeekProject || weekCapacity > 0 || behindSchedule.length > 0)
  const tonePast    = weekCapacity > 0 ? pastTone(myLastHours, weekCapacity) : ''
  const toneNext    = weekCapacity > 0 ? nextTone(myNextHours, weekCapacity) : ''
  const tonePastCap = tonePast ? tonePast[0].toUpperCase() + tonePast.slice(1) : ''
  const help        = memberId
    ? helpHint({ slack: weekCapacity - myThisHours, others: overloaded.filter(o => o.member.id !== memberId) })
    : null

  // Render a comma/and-joined list of bold project names with collaborator hints.
  const renderProjects = (items: GroupedProj[], showCollabs = true) => items.map((p, i) => {
    const wn = showCollabs ? withNamesOf(p) : []
    return (
      <span key={p.name}>
        {i > 0 && (i === items.length - 1 ? ' en ' : ', ')}
        <strong style={{ color: '#000' }}>{p.name}</strong>
        {wn.length > 0 && <> (met {joinAnd(wn)})</>}
      </span>
    )
  })

  const sections: Record<SectionId, React.ReactNode> = {
    taken: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconCheckList size={isMobile ? 17 : 15} />Jouw taken</h2>
          <Link href="/todos" style={cardLink}>Alle →</Link>
        </div>
        {memberId ? (
          <div style={{ padding: '6px 0 10px' }}>
            {openTodos.length === 0 ? (
              <p style={{ padding: '10px 20px', fontSize: 13, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Geen open taken 🎉</p>
            ) : openTodos.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 20px' }}>
                <div style={{ width: 14, height: 14, borderRadius: 4, border: '2px solid var(--border)', flexShrink: 0, marginTop: 3 }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{t.text}</span>
                {/* Bron-agenda badge: zelfde stijl als op /todos zodat in
                    één oogopslag duidelijk is uit welk bord deze todo
                    komt (Yoko / PNP / Nederland / etc.). */}
                {t.projectRef && (
                  <Link href={`/projects/${t.projectRef.board}`}
                    title={`Open ${t.projectRef.board}-agenda`}
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      flexShrink: 0, fontSize: 9.5, fontWeight: 700,
                      letterSpacing: '0.05em', textTransform: 'uppercase',
                      padding: '2px 6px', borderRadius: 10,
                      background: (BOARD_COLORS[t.projectRef.board] ?? '#888') + '22',
                      border: `1px solid ${BOARD_COLORS[t.projectRef.board] ?? '#888'}55`,
                      color: BOARD_COLORS[t.projectRef.board] ?? 'var(--text-muted)',
                      textDecoration: 'none', marginTop: 1,
                    }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: BOARD_COLORS[t.projectRef.board] ?? '#888' }} />
                    {t.projectRef.board}
                  </Link>
                )}
              </div>
            ))}
            {doneTodos.length > 0 && <div style={{ padding: '4px 20px', fontSize: 12, color: 'var(--text-muted)' }}>✓ {doneTodos.length} afgerond</div>}
            {/* Snelle invoer — direct vanuit home een taak aan jezelf
                toewijzen, zelfde bron als /todos pagina. */}
            <form onSubmit={e => { e.preventDefault(); addHomeTodo(newTodoText) }}
              style={{ padding: '8px 20px 0', display: 'flex', gap: 8 }}>
              <input value={newTodoText} onChange={e => setNewTodoText(e.target.value)}
                placeholder="+ Voeg toe of typ /…"
                style={{ flex: 1, fontSize: 13, padding: '6px 10px', borderRadius: 6,
                  border: '1px solid var(--border-light)', background: 'var(--bg-base)',
                  color: 'var(--text-primary)', outline: 'none' }} />
              {newTodoText.trim() && (
                <button type="submit"
                  style={{ padding: '6px 12px', borderRadius: 6, border: 'none',
                    background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700,
                    cursor: 'pointer' }}>
                  Toevoegen
                </button>
              )}
            </form>
          </div>
        ) : (
          <p style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Stel je profiel in om taken te zien.</p>
        )}
      </div>
    ),
    werkdruk: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <IconHourglass size={isMobile ? 17 : 15} />
              Werkdruk
            </span>
            {/* Kleine datumlabel zodat je in één oogopslag ziet om welke week
                het gaat — vooral handig na een paar klikken op </>. */}
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', letterSpacing: 0 }}>
              {(() => {
                const base = getWeekStart(new Date())
                const monday = new Date(base); monday.setDate(monday.getDate() + weekOffset * 7)
                const friday = new Date(monday); friday.setDate(friday.getDate() + 4)
                const sameMonth = monday.getMonth() === friday.getMonth()
                const monStr = monday.toLocaleDateString('nl-NL', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
                const friStr = friday.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
                return `${monStr} – ${friStr}`
              })()}
            </span>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setWeekOffset(o => o - 1)}
              title="Vorige week"
              style={{ background: 'none', border: '1px solid var(--border-light)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', width: 24, height: 24, padding: 0, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>‹</button>
            <button onClick={() => setWeekOffset(0)}
              title="Naar deze week"
              style={{ background: weekOffset === 0 ? 'var(--accent-light)' : 'transparent', border: weekOffset === 0 ? '1px solid var(--accent)' : '1px solid var(--border-light)', borderRadius: 6, color: weekOffset === 0 ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', padding: '3px 9px', fontSize: 11, fontWeight: 600, minWidth: 90, textAlign: 'center' }}>
              {weekOffset === 0 ? 'Deze week' : weekOffset === -1 ? 'Vorige week' : weekOffset === 1 ? 'Volgende week' : `${weekOffset > 0 ? '+' : ''}${weekOffset} weken`}
            </button>
            <button onClick={() => setWeekOffset(o => o + 1)}
              title="Volgende week"
              style={{ background: 'none', border: '1px solid var(--border-light)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', width: 24, height: 24, padding: 0, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>›</button>
            <Link href="/planning" style={{ ...cardLink, marginLeft: 4 }}>Planning →</Link>
          </div>
        </div>
        <div style={{ padding: '16px 20px 14px' }}>
          {memberId ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 10 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>{weekHours}</span>
                <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>/ {weekCapacity} uur</span>
                {weekCapacity > 0 && weekHours > weekCapacity && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#C4453A', background: 'rgba(196,69,58,0.15)', padding: '2px 8px', borderRadius: 10, marginLeft: 'auto' }}>
                    ⚠ Overbelast
                  </span>
                )}
              </div>
              {weekItems.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Geen gepland werk</p>
              ) : (() => {
                const catOf = (i: WorkloadItem) => effectiveCategory(i, categoryOverrides[i.id])
                const meetingHours  = weekItems.filter(i => catOf(i) === 'meeting').reduce((s, i) => s + i.hours, 0)
                const overheadHours = weekItems.filter(i => catOf(i) === 'overhead').reduce((s, i) => s + i.hours, 0)
                const makenHours    = weekItems.filter(i => catOf(i) === 'maken').reduce((s, i) => s + i.hours, 0)
                const total = meetingHours + overheadHours + makenHours
                const r = (n: number) => Math.round(n * 10) / 10
                const cap = Math.max(weekCapacity, total)  // bar is at least the total so overflow stays visible
                return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* One bar: segments per category, relative to capacity */}
                  <div>
                    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--border)', marginBottom: 8 }}>
                      <div style={{ width: cap > 0 ? `${(makenHours/cap)*100}%` : 0, background: '#5fa06e', transition: 'width 0.4s ease' }} />
                      <div style={{ width: cap > 0 ? `${(overheadHours/cap)*100}%` : 0, background: '#9aadbd', transition: 'width 0.4s ease' }} />
                      <div style={{ width: cap > 0 ? `${(meetingHours/cap)*100}%` : 0, background: '#D8B62E', transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#5fa06e' }} />
                        <strong style={{ color: 'var(--text-primary)' }}>{r(makenHours)}u</strong> maken
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9aadbd' }} />
                        <strong style={{ color: 'var(--text-primary)' }}>{r(overheadHours)}u</strong> overhead
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D8B62E' }} />
                        <strong style={{ color: 'var(--text-primary)' }}>{r(meetingHours)}u</strong> meetings
                      </span>
                    </div>
                  </div>
                  {(['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'] as const).map((dayLabel, dayIdx) => {
                    const dayItems = weekItems.filter(i => i.day === dayIdx).slice().sort((a, b) => {
                      const aT = a.startTime ?? null
                      const bT = b.startTime ?? null
                      if (aT && !bT) return -1
                      if (!aT && bT) return 1
                      if (aT && bT) return aT.localeCompare(bT)
                      return a.name.localeCompare(b.name)
                    })
                    if (dayItems.length === 0) return null
                    const dayTotal = Math.round(dayItems.reduce((s, i) => s + i.hours, 0) * 10) / 10
                    // Verleden-dagen in de huidige week subtiel uitfaden
                    // zodat duidelijk is dat 't gepasseerd is — items
                    // blijven nuttig voor terugkijken.
                    const isPast = weekOffset === 0 && dayIdx < todayDay
                    return (
                      <div key={dayIdx} style={{ opacity: isPast ? 0.5 : 1, transition: 'opacity 0.15s' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>{dayLabel}{isPast ? ' · geweest' : ''}</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{dayTotal}u</span>
                        </div>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {dayItems.map((item, i) => (
                            <WorkloadItemRow key={i} item={item}
                              override={categoryOverrides[item.id] ?? null}
                              onSetCategory={setItemCategory}
                              onToggleDone={toggleWorkloadDone} />
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
                )
              })()}
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Stel je profiel in om werkdruk te zien.</p>
          )}
        </div>
      </div>
    ),
    team: (() => {
      // Splits Yoko-team (vaste medewerkers) en freelancers. Freelancers
      // tonen we ALLEEN als ze vandaag werk hebben (eigenaar van een
      // project waarvan today binnen [startDate, endDate] valt). Anders
      // wordt de lijst een onbruikbaar lange waslijst van inactieve
      // freelancers waarmee je nooit hebt gewerkt.
      const todayIso = new Date().toISOString().slice(0, 10)
      const hasWorkToday = (memberId: string) => allProjects.some(p => {
        if (!p.ownerIds.includes(memberId)) return false
        const s = p.startDate; const e = p.endDate ?? s
        if (!s) return false
        return todayIso >= s && todayIso <= (e ?? s)
      })
      const activeFreelancers = allMembersForHome.filter(m =>
        !isYokoCrew(m.id) && m.id !== 'unassigned' && hasWorkToday(m.id)
      )
      const yokoAvail = yokoMembers.filter(m => statusFor(m.id).kind === 'available').length
      const flAvail   = activeFreelancers.filter(m => statusFor(m.id).kind === 'available').length
      const totalCount = yokoMembers.length + activeFreelancers.length
      const totalAvail = yokoAvail + flAvail
      const renderRow = (m: { id: string; name: string; color?: string; email?: string; weeklyCapacity?: number }) => {
        const s = statusFor(m.id)
        const tone = s.kind === 'vacation' ? { bg: 'rgba(255,123,36,0.15)', fg: '#a05400', label: '🏝 ' + (s.detail ?? 'op vakantie') }
                   : s.kind === 'free'     ? { bg: 'rgba(154,149,144,0.18)', fg: 'var(--text-muted)', label: s.detail ?? 'vrij' }
                   :                          { bg: 'rgba(95,160,110,0.15)', fg: '#3b7a4b', label: 'beschikbaar' }
        return (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 18px' }}>
            <UserAvatar memberId={m.id} size={22} />
            <Link href={`/profile/${m.id}`} style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.name}
            </Link>
            <span style={{ fontSize: 11, fontWeight: 600, color: tone.fg, background: tone.bg, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>
              {tone.label}
            </span>
          </div>
        )
      }
      const subHeader = (label: string, count: number, avail: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 18px 2px', marginTop: 2 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {avail}/{count}</span>
        </div>
      )
      return (
        <div style={card}>
          <div style={cardHeader}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconUsers size={isMobile ? 17 : 15} />Team vandaag
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>({totalAvail}/{totalCount})</span>
            </h2>
          </div>
          <div style={{ padding: '6px 0 10px' }}>
            {subHeader('Studio Yoko', yokoMembers.length, yokoAvail)}
            {yokoMembers.map(renderRow)}
            {activeFreelancers.length > 0 && (
              <>
                {subHeader('Freelancers vandaag', activeFreelancers.length, flAvail)}
                {activeFreelancers.map(renderRow)}
              </>
            )}
          </div>
        </div>
      )
    })(),
    deadlines: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconClock size={isMobile ? 17 : 15} />Deadlines deze week</h2>
        </div>
        <div style={{ padding: '6px 0 10px' }}>
          {deadlineItems.length === 0 ? (
            <p style={{ padding: '10px 18px', fontSize: 13, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Geen deadlines de komende 7 dagen.</p>
          ) : deadlineItems.slice(0, 8).map(({ board, item }) => {
            const ms = new Date(item.deadline as string).getTime()
            const days = Math.round((ms - Date.now()) / 86400000)
            const tone = days < 0 ? { bg: 'rgba(196,69,58,0.15)', fg: '#C4453A' }
                       : days <= 1 ? { bg: 'rgba(196,69,58,0.15)', fg: '#C4453A' }
                       : days <= 3 ? { bg: 'rgba(255,123,36,0.15)', fg: '#a05400' }
                       :              { bg: 'transparent', fg: 'var(--text-muted)' }
            const owners = (item.ownerIds ?? []).slice(0, 3)
            return (
              <Link key={`${board}-${item.id}`} href={`/projects/${board}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 18px', textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: BOARD_COLORS[board] ?? 'var(--accent)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                <div style={{ display: 'flex', flexShrink: 0 }}>
                  {owners.map((id, i) => (
                    <span key={id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                      <UserAvatar memberId={id} size={20} style={{ border: '2px solid var(--bg-card)' }} borderless={false} />
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: tone.fg, background: tone.bg, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                  {days < 0 ? `${Math.abs(days)}d te laat` : days === 0 ? 'vandaag' : `${days}d`}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    ),
    overload: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconAlert size={isMobile ? 17 : 15} />Overbelast deze week</h2>
        </div>
        <div style={{ padding: '6px 0 10px' }}>
          {overloaded.length === 0 ? (
            <p style={{ padding: '10px 18px', fontSize: 13, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Iedereen onder cap deze week 👌</p>
          ) : overloaded.map(o => (
            <div key={o.member.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 18px' }}>
              <UserAvatar memberId={o.member.id} size={22} />
              <Link href={`/profile/${o.member.id}`} style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.member.name}
              </Link>
              <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(o.pct, 100)}%`, background: '#C4453A' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#C4453A', background: 'rgba(196,69,58,0.15)', padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                {o.hours}u / {o.cap}u
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    paginas: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>📑 Pagina&apos;s</h2>
        </div>
        <div style={{ padding: '6px 0 12px' }}>
          {QUICK_LINKS.groups.map((g, gi) => (
            <div key={g.name} style={{ marginTop: gi === 0 ? 4 : 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 18px 4px' }}>
                {g.name}
              </div>
              {g.items.map(item => (
                <Link key={item.href} href={item.href}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 18px', textDecoration: 'none', color: 'var(--text-primary)', fontSize: 14 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 16 }}>{item.emoji}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
    ),
    documenten: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconDocument size={isMobile ? 17 : 15} />Meest recente documenten</h2>
          <button onClick={createNewPage} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>+ Nieuw</button>
        </div>
        {recentPages.length === 0 ? (
          <div style={{ padding: '28px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 14px' }}>Nog geen documenten.</p>
            <button onClick={createNewPage} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 800 }}>+ Nieuw document</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 0 }}>
            {recentPages.map(page => (
              <Link key={page.id} href={`/pages/${page.id}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', textDecoration: 'none', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 22 }}>{page.emoji}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title || 'Naamloos'}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtRelative(page.updatedAt)}</span>
              </Link>
            ))}
            <button onClick={createNewPage}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px', background: 'none', border: 'none', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', minHeight: 90 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <span style={{ fontSize: 22 }}>+</span>
              <span style={{ fontSize: 12 }}>Nieuw document</span>
            </button>
          </div>
        )}
      </div>
    ),
  }

  return (
    <div style={{ maxWidth: 1160, padding: isMobile ? '60px 16px 60px' : '48px 40px 100px' }}>

      {/* ── Greeting ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 18,
        marginBottom: showSummary ? (isMobile ? 14 : 22) : (isMobile ? 18 : 40) }}>
        {memberId && (
          <UserAvatar memberId={memberId} size={isMobile ? 44 : 60}
            onClick={e => showMember(memberId, e)} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 34, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 5px', letterSpacing: '-0.04em',
            // Op mobiel forceren we één regel — "Goedemiddag, Menno" mag
            // niet over twee regels lopen, dat oogde rommelig. Bij echt
            // smalle schermen of een lange naam komt er een ellipsis.
            whiteSpace: isMobile ? 'nowrap' : 'normal',
            overflow:   isMobile ? 'hidden' : undefined,
            textOverflow: isMobile ? 'ellipsis' : undefined }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p style={{ margin: 0, fontSize: isMobile ? 13 : 15, color: 'var(--text-muted)' }}>
            {new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {/* Vakantie-chip op mobiel onder de datum (ruimte schaars); op
              desktop verhuist 'ie naar rechts naast de groet zodat 'ie op
              dezelfde hoogte staat als de samenvattings-balk eronder. */}
          {memberId && isMobile && (
            <div style={{ marginTop: 10 }}>
              <VacationButton variant="chip" />
            </div>
          )}
        </div>
        {memberId && !isMobile && (
          <div style={{ flexShrink: 0 }}>
            <VacationButton variant="chip" />
          </div>
        )}
        {isMobile && (
          <button onClick={() => setEditOrder(o => !o)}
            title={editOrder ? 'Klaar met sorteren' : 'Kaarten herordenen'}
            aria-label={editOrder ? 'Klaar met sorteren' : 'Volgorde aanpassen'}
            style={{ padding: editOrder ? '6px 10px' : '6px 9px',
              borderRadius: 8, border: '1px solid var(--border)',
              background: editOrder ? 'var(--accent)' : 'var(--bg-card)',
              color: editOrder ? '#fff' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: 700, lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}>
            {editOrder ? 'Klaar' : '↕'}
          </button>
        )}
      </div>

      {/* ── Yellow week summary card ── */}
      {showSummary && (
        <div style={{
          background: 'var(--yellow)',
          padding: isMobile ? '16px 18px' : '20px 26px',
          borderRadius: 16,
          marginBottom: isMobile ? 18 : 32,
        }}>
          {/* Wat-deze-week + vandaag + rest van de week → één paragraaf.
              Daarnaast / Check even / Capaciteit-tip → elk hun eigen alinea
              zodat het bij langere tekst leesbaar blijft. */}
          <div style={{ fontSize: isMobile ? 14 : 15, color: '#1a1a1a', lineHeight: 1.6, maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0 }}>
              {isWeekend ? (
                <>
                  Lekker weekend!
                  {weekendProjects.length > 0 && (
                    <> Deze week ging het vooral over {renderProjects(weekendProjects)}.</>
                  )}
                </>
              ) : (
                <>
                  {pastProjects.length > 0 && (
                    <>Tot nu toe deze week heb je gewerkt aan {renderProjects(pastProjects)}. </>
                  )}
                  {todayProjects.length > 0 && (
                    <>
                      {pastProjects.length > 0 ? 'Vandaag staat ' : 'Vandaag begint met '}
                      {renderProjects(todayProjects)} op de planning.{' '}
                    </>
                  )}
                  {futureProjects.length > 0 && (
                    <>
                      {(pastProjects.length > 0 || todayProjects.length > 0)
                        ? 'Voor de rest van de week komt nog '
                        : 'Deze week komt nog '}
                      {renderProjects(futureProjects)}.
                    </>
                  )}
                </>
              )}
            </p>
            {otherInfo && (
              <p style={{ margin: 0 }}>Daarnaast staat er {otherInfo} op de planning.</p>
            )}
            {behindSchedule.length > 0 && (
              <p style={{ margin: 0 }}>
                Check even:{' '}
                {behindSchedule.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && (i === behindSchedule.length - 1 ? ' en ' : ', ')}
                    <strong style={{ color: '#000' }}>{p.name}</strong>
                  </span>
                ))}
                {' '}{behindSchedule.length === 1 ? 'staat' : 'staan'} nog op actief terwijl de einddatum al voorbij is — afronden? ⏳
              </p>
            )}
            {(tonePast || help) && (
              <p style={{ margin: 0 }}>
                {tonePast && <>{tonePastCap}, {toneNext}.</>}
                {help && <> {help}</>}
              </p>
            )}
          </div>
        </div>
      )}

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sectionOrder.map((id, i) => (
            <div key={id}>
              {editOrder && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
                  <button onClick={() => moveSection(id, -1)} disabled={i === 0}
                    style={reorderBtn(i === 0)}>↑</button>
                  <button onClick={() => moveSection(id, 1)} disabled={i === sectionOrder.length - 1}
                    style={reorderBtn(i === sectionOrder.length - 1)}>↓</button>
                </div>
              )}
              {sections[id]}
            </div>
          ))}
        </div>
      ) : (
        // Masonry-style two-column flow on desktop. Each card sizes to its
        // own content; the browser fills the left column first, then balances
        // into the right. Single column on mobile.
        <div style={{
          columnCount: isMobile ? 1 : 2,
          columnGap: 18,
        }}>
          {(['taken','werkdruk','team','deadlines','overload','documenten','paginas'] as SectionId[])
            .filter(id => sectionOrder.includes(id))
            .map(id => (
              <div key={id} style={{ breakInside: 'avoid', marginBottom: 18 }}>
                {sections[id]}
              </div>
            ))}
        </div>
      )}

    </div>
  )
}

const reorderBtn = (disabled: boolean): React.CSSProperties => ({
  width: 36, height: 36, borderRadius: 8,
  border: '1px solid var(--border)',
  background: disabled ? 'var(--bg-hover)' : 'var(--bg-card)',
  color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
  fontSize: 16, fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0,
})
