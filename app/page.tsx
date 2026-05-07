'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/components/ProfileContext'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { useMemberPopup } from '@/components/MemberPopup'
import { useIsMobile } from '@/lib/useIsMobile'
import { IconCheckList, IconHourglass, IconDocument, IconRocket, IconBuilding, IconUsers, IconKey } from '@/components/Icon'
import { loadRecentPages, type PageDoc } from '@/lib/pagesStore'
import { saveDocs, loadDocs } from '@/lib/navStore'
import todosData from '@/data/todos.json'
import teamData  from '@/data/team.json'
import yokoRaw        from '@/data/boards/yoko.json'
import pnpRaw         from '@/data/boards/pnp.json'
import nederlandRaw   from '@/data/boards/nederland.json'
import vlaanderenRaw  from '@/data/boards/vlaanderen.json'
import dienjaarRaw    from '@/data/boards/dienjaar.json'
import { loadGroups } from '@/lib/boardStore'
import { getWeekStart, memberContributions, BOARD_COLORS, type Project } from '@/lib/workload'
import type { BoardGroup } from '@/lib/boards'

const RAW: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw, vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
}

type TodoItem = { id: string; text: string; done: boolean }

type SectionId = 'taken' | 'werkdruk' | 'documenten' | 'lopend' | 'algemeen' | 'paginas'
const DEFAULT_SECTION_ORDER: SectionId[] = ['taken', 'werkdruk', 'paginas', 'documenten', 'lopend', 'algemeen']

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

function groupsToProjects(board: string, groups: BoardGroup[]): Project[] {
  return groups.flatMap(g =>
    g.items.filter(i => Array.isArray(i.ownerIds) && (i.ownerIds as string[]).length > 0).map(i => ({
      id: `${board}__${i.id}`, name: i.name, board, group: g.name,
      ownerIds: i.ownerIds as string[], startDate: i.startDate as string | null,
      endDate: i.endDate as string | null, estHours: (i.estHours as number) ?? 0,
      status: (i.status as string) === 'Done' ? 'done' : 'active',
    } satisfies Project))
  )
}

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

const card: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 14,
  border: '1px solid var(--border)', overflow: 'hidden',
}
const cardHeader: React.CSSProperties = {
  padding: '14px 20px 12px', borderBottom: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}

export default function HomePage() {
  const { profile }    = useProfile()
  const { getPhoto }   = useTeamPhotos()
  const { showMember } = useMemberPopup()
  const router         = useRouter()
  const isMobile       = useIsMobile()

  const [recentPages,  setRecentPages]  = useState<PageDoc[]>([])
  const [myTodos,      setMyTodos]      = useState<TodoItem[]>([])
  const [weekHours,    setWeekHours]    = useState(0)
  const [weekCapacity, setWeekCapacity] = useState(40)
  const [weekItems,    setWeekItems]    = useState<{ name: string; board: string; hours: number }[]>([])
  const [lopendItems,  setLopendItems]  = useState<{ name: string; board: string; endDate: string | null }[]>([])
  const [algemeenTodos, setAlgemeenTodos] = useState<TodoItem[]>([])
  const [hydrated,     setHydrated]     = useState(false)
  const [editOrder,    setEditOrder]    = useState(false)
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(DEFAULT_SECTION_ORDER)

  const memberId = profile?.memberId ?? ''
  const member   = teamData.members.find(m => m.id === memberId)

  useEffect(() => {
    setRecentPages(loadRecentPages().slice(0, 9))

    // My todos
    const section = todosData.sections.find(s => s.id === memberId)
    if (section) setMyTodos(section.items as TodoItem[])

    // Algemeen todos (non-member sections)
    const memberIds = new Set(teamData.members.map(m => m.id))
    const algSections = todosData.sections.filter(s => !memberIds.has(s.id))
    const algItems = algSections.flatMap(s => s.items as TodoItem[]).filter(t => !t.done).slice(0, 5)
    setAlgemeenTodos(algItems)

    // Board projects
    const allProjects: Project[] = []
    for (const [name, raw] of Object.entries(RAW)) {
      const groups = loadGroups(name, raw.groups as BoardGroup[])
      allProjects.push(...groupsToProjects(name, groups))
    }

    // Workload this week
    if (memberId) {
      const week    = getWeekStart(new Date())
      const contribs = memberContributions(allProjects, memberId, week)
      setWeekHours(Math.round(contribs.reduce((s, c) => s + c.hours, 0) * 10) / 10)
      setWeekItems(contribs.map(c => ({ name: c.project.name, board: c.project.board, hours: c.hours })))
    }
    const cap = teamData.members.find(m => m.id === memberId)?.weeklyCapacity ?? 40
    setWeekCapacity(cap)

    // Lopend: active projects spanning today
    const today = new Date(); today.setHours(0,0,0,0)
    const todayMs = today.getTime()
    const lopend = allProjects
      .filter(p => p.status !== 'done' && p.startDate && p.endDate)
      .filter(p => {
        const s = new Date(p.startDate!).getTime()
        const e = new Date(p.endDate!).getTime() + 86400000
        return s <= todayMs + 14 * 86400000 && e >= todayMs
      })
      .slice(0, 6)
      .map(p => ({ name: p.name, board: p.board, endDate: p.endDate }))
    setLopendItems(lopend)

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
  }, [memberId])

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
  const photo     = memberId ? (profile?.photo ?? getPhoto(memberId) ?? null) : null

  if (!hydrated) return null

  const sections: Record<SectionId, React.ReactNode> = {
    taken: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconCheckList size={isMobile ? 17 : 15} />Jouw taken</h2>
          <Link href="/todos" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Alle →</Link>
        </div>
        {memberId ? (
          <div style={{ padding: '6px 0' }}>
            {openTodos.length === 0 ? (
              <p style={{ padding: '10px 20px', fontSize: 13, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Geen open taken 🎉</p>
            ) : openTodos.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 20px' }}>
                <div style={{ width: 14, height: 14, borderRadius: 4, border: '2px solid var(--border)', flexShrink: 0, marginTop: 3 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{t.text}</span>
              </div>
            ))}
            {doneTodos.length > 0 && <div style={{ padding: '4px 20px', fontSize: 12, color: 'var(--text-muted)' }}>✓ {doneTodos.length} afgerond</div>}
          </div>
        ) : (
          <p style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Stel je profiel in om taken te zien.</p>
        )}
      </div>
    ),
    werkdruk: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconHourglass size={isMobile ? 17 : 15} />Werkdruk deze week</h2>
          <Link href="/planning" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Planning →</Link>
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
              <div style={{ height: 7, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${pct * 100}%`, background: barColor, borderRadius: 4, transition: 'width 0.4s ease' }} />
              </div>
              {weekItems.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Geen gepland werk</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {weekItems.map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: BOARD_COLORS[item.board] ?? 'var(--accent)', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{item.hours}u</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Stel je profiel in om werkdruk te zien.</p>
          )}
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
          <button onClick={createNewPage} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Nieuw</button>
        </div>
        {recentPages.length === 0 ? (
          <div style={{ padding: '28px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 14px' }}>Nog geen documenten.</p>
            <button onClick={createNewPage} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>📄 Nieuw document</button>
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
    lopend: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconRocket size={isMobile ? 17 : 15} />Lopend</h2>
          <Link href="/planning" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Planning →</Link>
        </div>
        <div style={{ padding: '6px 0 8px' }}>
          {lopendItems.length === 0 ? (
            <p style={{ padding: '10px 18px', fontSize: 13, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Geen lopende projecten</p>
          ) : lopendItems.map((item, i) => {
            const dc = deadlineColor(item.endDate)
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 18px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: BOARD_COLORS[item.board] ?? 'var(--accent)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                {item.endDate && (
                  <span style={{ fontSize: 11, fontWeight: dc ? 700 : 400,
                    color: dc?.fg ?? 'var(--text-muted)',
                    background: dc?.bg ?? 'transparent',
                    padding: dc ? '2px 7px' : 0, borderRadius: 6, flexShrink: 0 }}>
                    {fmtDate(item.endDate)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    ),
    algemeen: (
      <div style={card}>
        <div style={cardHeader}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}><IconCheckList size={isMobile ? 17 : 15} />Algemeen</h2>
          <Link href="/todos" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Alle →</Link>
        </div>
        <div style={{ padding: '6px 0 8px' }}>
          {algemeenTodos.length === 0 ? (
            <p style={{ padding: '10px 18px', fontSize: 13, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Geen open algemene taken</p>
          ) : algemeenTodos.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '5px 18px' }}>
              <div style={{ width: 13, height: 13, borderRadius: 3, border: '2px solid var(--border)', flexShrink: 0, marginTop: 3 }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  }

  return (
    <div style={{ maxWidth: 1160, padding: isMobile ? '20px 16px 60px' : '48px 40px 100px' }}>

      {/* ── Greeting ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 18, marginBottom: isMobile ? 18 : 40 }}>
        {memberId && (
          photo ? (
            <img src={photo} alt="" onClick={e => showMember(memberId, e)}
              style={{ width: isMobile ? 48 : 60, height: isMobile ? 48 : 60, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer', flexShrink: 0 }} />
          ) : (
            <div onClick={e => showMember(memberId, e)}
              style={{ width: isMobile ? 48 : 60, height: isMobile ? 48 : 60, borderRadius: '50%', background: (member?.color ?? '#888') + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? 18 : 22, fontWeight: 700, color: member?.color ?? '#888', cursor: 'pointer', flexShrink: 0 }}>
              {firstName.charAt(0)}
            </div>
          )
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: isMobile ? 24 : 34, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 5px', letterSpacing: '-0.04em' }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p style={{ margin: 0, fontSize: isMobile ? 13 : 15, color: 'var(--text-muted)' }}>
            {new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {isMobile && (
          <button onClick={() => setEditOrder(o => !o)}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: editOrder ? 'var(--accent)' : 'var(--bg-card)',
              color: editOrder ? '#fff' : 'var(--text-secondary)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            {editOrder ? 'Klaar' : 'Volgorde'}
          </button>
        )}
      </div>

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
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
            {sections.taken}
            {sections.werkdruk}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18, alignItems: 'start', marginBottom: 18 }}>
            {sections.documenten}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {sections.lopend}
              {sections.algemeen}
            </div>
          </div>
          {sections.paginas}
        </>
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
