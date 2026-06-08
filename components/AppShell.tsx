'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ProfileProvider, useProfile } from './ProfileContext'
import { TeamPhotosProvider } from './TeamPhotosContext'
import { TeamProvider } from './TeamContext'
import { MemberPopupProvider } from './MemberPopup'
import { UndoProvider } from './UndoContext'
import Sidebar from './Sidebar'
import ProfileSetup from './ProfileSetup'
import SearchPalette from './SearchPalette'
import TimerIndicator from './TimerIndicator'
import ThemeApply from './ThemeApply'
import Link from 'next/link'
import { IconMenu, IconSearch, IconHome, IconHistory } from './Icon'
import { NotificationBell } from './NotificationBell'
import { FeedbackBubble } from './FeedbackBubble'
import { requiresAuth } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'
import { pullPagesFromRemote, subscribeRemotePages } from '@/lib/pagesStore'
import { pullBoardFromRemote, subscribeRemoteBoard, BOARD_NAMES, pushBoardToRemote, loadGroups } from '@/lib/boardStore'
import { pullBoardsFromRemote, subscribeRemoteBoards } from '@/lib/boardsRegistry'
import { loadSections as loadNavSections } from '@/lib/navStore'
import teamData from '@/data/team.json'
import { ensureRewindItems } from '@/lib/rewindScheduler'
import { pullCategoryOverrides, subscribeRemoteCategories } from '@/lib/workloadCategory'
import { pullCapacities, subscribeRemoteCapacities } from '@/lib/capacitiesStore'
import { pullProfileDaysOff, subscribeRemoteProfileDaysOff } from '@/lib/profileDaysOff'
import { pullFeedback, subscribeRemoteFeedback } from '@/lib/feedbackStore'
import { pullCommentsAll, subscribeRemoteComments } from '@/lib/commentsStore'
// (BOARD_NAMES re-used by the auto-sync tick below)
import { onAuthChange, isSyncing } from '@/lib/sync'
import { syncGoogleNow } from '@/lib/googleClient'
import { applySubitemRules } from '@/lib/subitemRules'
import { applyAutoStatus, notifyOverdueItems } from '@/lib/autoStatus'
import { pullExtrasFromRemote, subscribeRemoteExtras } from '@/lib/teamExtras'
import yokoRaw       from '@/data/boards/yoko.json'
import pnpRaw        from '@/data/boards/pnp.json'
import nederlandRaw  from '@/data/boards/nederland.json'
import vlaanderenRaw from '@/data/boards/vlaanderen.json'
import dienjaarRaw   from '@/data/boards/dienjaar.json'
import type { BoardGroup } from '@/lib/boards'

const BOARD_INITIALS: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw,
  vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
}

function Inner({ children }: { children: ReactNode }) {
  const { needsSetup, editOpen, isAuthenticated, authChecked, profile } = useProfile()
  // Profile leeft in een ref zodat de sync-effecten (met empty deps) altijd
  // de laatste memberId zien zonder herstart van pulls/subscriptions.
  const profileRef = useRef(profile)
  useEffect(() => { profileRef.current = profile }, [profile])
  const pathname = usePathname()
  const router   = useRouter()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  // Scroll-positie onthouden per pad. Onze <main> scrolt intern, dus
  // Next's eigen scroll-restore (die alleen documentScroll bewaakt) doet
  // hier niets. We saven elke scroll-positie in sessionStorage en spelen
  // hem terug bij elke pathname-change.
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const key = `yoko-scroll:${pathname}`
    const target = parseInt(sessionStorage.getItem(key) ?? '0', 10) || 0

    // Restore in twee passes: meteen na het eerste frame, en nogmaals na
    // 300ms zodat ook pagina's die data van Supabase laden (en daardoor
    // hoger worden) alsnog op de juiste plek terechtkomen.
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    if (target > 0) {
      requestAnimationFrame(() => { if (mainRef.current) mainRef.current.scrollTop = target })
      retryTimer = setTimeout(() => {
        if (mainRef.current && mainRef.current.scrollTop < target) {
          mainRef.current.scrollTop = target
        }
      }, 320)
    }

    let raf: number | null = null
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        sessionStorage.setItem(key, String(el.scrollTop))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
      if (retryTimer) clearTimeout(retryTimer)
      sessionStorage.setItem(key, String(el.scrollTop))
    }
  }, [pathname])

  useEffect(() => {
    // Wait for the initial session check before redirecting — otherwise a hard
    // refresh on a deep link bounces to /login and back.
    if (!authChecked) return
    if (requiresAuth && !isAuthenticated && pathname !== '/login' && !pathname.startsWith('/share') && !pathname.startsWith('/auth')) {
      const next = pathname + (typeof window !== 'undefined' ? window.location.search : '')
      router.replace(`/login?next=${encodeURIComponent(next)}`)
    }
  }, [authChecked, isAuthenticated, pathname, router])

  useEffect(() => { setDrawerOpen(false); setSearchOpen(false) }, [pathname])

  // Sync de browser-tab-title met de huidige route — makkelijker switchen
  // tussen meerdere Yoko-tabs in dezelfde browser. We mappen vaste routes
  // op een leesbaar label; voor dynamische routes (boards, pages, profielen)
  // proberen we de geregistreerde sidebar-label of een fallback uit het
  // pad-segment. Suffix '· Yoko' helpt om Yoko-tabs visueel te herkennen
  // tussen andere apps.
  useEffect(() => {
    if (typeof document === 'undefined') return
    function titleFor(path: string): string {
      if (!path || path === '/') return 'Home'
      const seg = path.split('/').filter(Boolean)
      const root = seg[0]
      if (root === 'planning')  return 'Planning'
      if (root === 'todos')     return "To do's"
      if (root === 'team')      return 'Team'
      if (root === 'kantoor')   return 'Kantoor'
      if (root === 'activity')  return 'Activiteit'
      if (root === 'accounts')  return 'Accounts'
      if (root === 'login')     return 'Inloggen'
      if (root === 'auth')      return 'Authenticatie'
      if (root === 'share')     return 'Gedeelde weergave'
      if (root === 'projects' && seg[1]) {
        try {
          const sections = loadNavSections()
          const item = sections.flatMap(s => s.items).find(i => i.href === `/projects/${seg[1]}`)
          if (item?.label) return item.label
        } catch {}
        return seg[1].charAt(0).toUpperCase() + seg[1].slice(1)
      }
      if (root === 'pages' && seg[1]) {
        try {
          const sections = loadNavSections()
          const item = sections.flatMap(s => s.items).find(i => i.href === `/pages/${seg[1]}`)
          if (item?.label) return item.label
        } catch {}
        return 'Pagina'
      }
      if (root === 'profile' && seg[1]) {
        const m = teamData.members.find(x => x.id === seg[1])
        if (m) return m.name
        return 'Profiel'
      }
      return root.charAt(0).toUpperCase() + root.slice(1)
    }
    document.title = `${titleFor(pathname)} · Yoko`
  }, [pathname])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘/Ctrl + K én ⌘/Ctrl + Space openen het zoekvenster — Space is
      // makkelijker met één hand.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === ' ' || e.code === 'Space')) {
        e.preventDefault(); setSearchOpen(o => !o)
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen])

  // Remote sync — pulls + subscribes when user is signed in.
  useEffect(() => {
    const unsubs: Array<() => void> = []
    async function start() {
      const syncing = await isSyncing()
      if (!syncing) return
      // Boards registry — eerst pullen zodat BOARD_NAMES gevuld is
      // voordat we per bord gaan pullen.
      await pullBoardsFromRemote()
      unsubs.push(subscribeRemoteBoards())
      // Pages
      pullPagesFromRemote()
      unsubs.push(subscribeRemotePages())
      // Workload category overrides
      pullCategoryOverrides()
      unsubs.push(subscribeRemoteCategories())
      // Team capaciteiten (u/w per persoon)
      pullCapacities()
      unsubs.push(subscribeRemoteCapacities())
      // Vrije dagen per persoon (Ma=1..Zo=7)
      pullProfileDaysOff()
      unsubs.push(subscribeRemoteProfileDaysOff())
      // Runtime-toegevoegde teamleden (via /team UI). Trekt 't merge-werk
      // op localStorage-niveau zelf, deze pull haalt cross-device additions.
      pullExtrasFromRemote()
      unsubs.push(subscribeRemoteExtras())
      // Feedback / ideeën / bugs (floating bubble)
      pullFeedback()
      unsubs.push(subscribeRemoteFeedback())
      // Comments cross-browser sync
      pullCommentsAll()
      unsubs.push(subscribeRemoteComments())
      // Auto-plan Rewind-items voor huidige + volgende maand zodra de
      // boards zijn geladen. Idempotent (skipt bestaande).
      ensureRewindItems(2)
      // Boards: pull + subscribe + first-time migrate from localStorage
      for (const b of BOARD_NAMES) {
        const ok = await pullBoardFromRemote(b)
        if (!ok) {
          // Remote empty — push current local snapshot so other devices can pull it
          const local = loadGroups(b, (BOARD_INITIALS[b]?.groups ?? []) as BoardGroup[])
          if (local.length > 0) await pushBoardToRemote(b, local)
        }
        unsubs.push(subscribeRemoteBoard(b))
      }
      // Eén keer na de initiële pull: items waarvan de timeline zojuist
      // 'live' is geworden krijgen status 'Working on...'. Loopt ook zonder
      // Google-sync (de tweede useEffect-tick) zodat een nieuwe dag direct
      // het juiste status-beeld geeft.
      try { await applyAutoStatus() } catch {}
      try { await notifyOverdueItems(profileRef.current?.memberId) } catch {}
    }
    start()
    const offAuth = onAuthChange(() => {
      while (unsubs.length) unsubs.pop()?.()
      start()
    })
    return () => { offAuth(); while (unsubs.length) unsubs.pop()?.() }
  }, [])

  // Google Calendar sync — pull on mount + every 5 min while signed in.
  useEffect(() => {
    let cancelled = false
    async function tick() {
      if (cancelled) return
      const syncing = await isSyncing()
      if (!syncing) return
      await syncGoogleNow()
      // Defensive force-pull — realtime can drop events, this guarantees the
      // local cache reflects whatever the sync just wrote.
      await Promise.all(BOARD_NAMES.map(b => pullBoardFromRemote(b)))
      // Past geleerde nesting-regels toe: nieuwe Google-events die lijken op
      // een eerder handmatig genest item belanden direct onder dezelfde parent.
      try { await applySubitemRules() } catch {}
      // Items waarvan de timeline 'nu' is en die nog geen status hebben
      // krijgen automatisch 'Working on...'. Manuele statussen blijven staan.
      try { await applyAutoStatus() } catch {}
      // Niet-Google items waarvan de eind-datum voorbij is sturen één keer
      // een 'klaar?'-notificatie aan de eigenaar (de huidige user). Google-
      // items handelen we via auto-Done in de server-sync af.
      try { await notifyOverdueItems(profileRef.current?.memberId) } catch {}
      // Daily snapshot per bord — server-route is idempotent: maakt geen
      // tweede snapshot aan op dezelfde dag. Eerste user die de app vandaag
      // opent triggert effectief de cron. localStorage-flag voorkomt dat
      // tabs binnen dezelfde sessie 't N keer proberen.
      try {
        const todayKey = `yoko-snapshot-attempt:${new Date().toISOString().slice(0,10)}`
        if (typeof window !== 'undefined' && !window.localStorage.getItem(todayKey)) {
          window.localStorage.setItem(todayKey, '1')
          const { supabase: sb } = await import('@/lib/supabase')
          const sess = await sb?.auth.getSession()
          const token = sess?.data.session?.access_token
          if (token) {
            for (const board of BOARD_NAMES) {
              fetch('/api/snapshots/create', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ boardId: board }),
              }).catch(() => {})
            }
          }
        }
      } catch {}
    }
    tick()
    const id = setInterval(tick, 5 * 60 * 1000)
    const offAuth = onAuthChange(() => { tick() })
    return () => { cancelled = true; clearInterval(id); offAuth() }
  }, [])

  // Login + share + auth routes: geen sidebar, geen ProfileSetup, geen auth-redirect
  if (pathname === '/login' || pathname.startsWith('/share') || pathname.startsWith('/auth')) {
    return (
      <>
        <ThemeApply />
        <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0 }}>{children}</main>
      </>
    )
  }

  // Wacht op auth check — voorkomt flash van /login op refresh
  if (requiresAuth && (!authChecked || !isAuthenticated)) return null

  return (
    <>
      <Sidebar isMobile={isMobile} open={!isMobile || drawerOpen} onClose={() => setDrawerOpen(false)}
        onOpenSearch={!isMobile ? () => setSearchOpen(true) : undefined} />

      {isMobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 55 }} />
      )}

      {isMobile && !drawerOpen && (
        <>
          {/* Menu + home linksboven — meest gebruikte knoppen, sluit aan op
              standaard mobile-conventie (hamburger linksboven). */}
          <div style={{ position: 'fixed', top: 10, left: 10, zIndex: 70, display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setDrawerOpen(true)} aria-label="Menu openen"
              style={{
                width: 38, height: 38, borderRadius: 9,
                background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                color: 'var(--text-primary)', padding: 0,
              }}>
              <IconMenu size={20} />
            </button>
            <Link href="/" aria-label="Home"
              style={{
                width: 38, height: 38, borderRadius: 9,
                background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                color: 'var(--text-primary)', textDecoration: 'none',
              }}>
              <IconHome size={20} />
            </Link>
          </div>
          {/* Notificaties + papierbak + zoeken rechtsboven. */}
          <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 70, display: 'flex', gap: 6, alignItems: 'center' }}>
            <NotificationBell />
            <Link href="/papierbak" aria-label="Papierbak"
              title="Papierbak — verwijderde items herstellen"
              style={{
                width: 38, height: 38, borderRadius: 9,
                background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none',
              }}><IconHistory size={18} /></Link>
            <button onClick={() => setSearchOpen(true)} aria-label="Zoeken"
              style={{
                width: 38, height: 38, borderRadius: 9,
                background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                color: 'var(--text-primary)', padding: 0,
              }}>
              <IconSearch size={18} />
            </button>
          </div>
        </>
      )}
      {/* Desktop bell zit nu in de sidebar-header (naast het logo).
          Op mobile blijft 'm rechtsboven naast de hamburger. */}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <TimerIndicator />
      <FeedbackBubble />

      <main ref={mainRef} style={{
        flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0,
        width: isMobile ? '100%' : undefined, position: 'relative',
      }}>
        {!isMobile && <BackButton pathname={pathname} />}
        {children}
      </main>
      {(needsSetup || editOpen) && <ProfileSetup />}
    </>
  )
}

// Top-level routes have their own sidebar entry — no back button needed.
const TOP_LEVEL_ROUTES = new Set(['/', '/planning', '/todos', '/team', '/accounts', '/activity', '/kantoor'])

function BackButton({ pathname }: { pathname: string }) {
  const router = useRouter()
  const isDeep =
    !TOP_LEVEL_ROUTES.has(pathname) &&
    !pathname.startsWith('/projects') &&  // projects appear in sidebar
    pathname !== '/'
  if (!isDeep) return null
  return (
    <button onClick={() => router.back()} title="Terug"
      style={{
        position: 'absolute', top: 14, left: 14, zIndex: 30,
        width: 36, height: 36, borderRadius: 9,
        background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        color: 'var(--text-primary)', padding: 0,
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    </button>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <UndoProvider>
      <ProfileProvider>
        <TeamProvider>
          <TeamPhotosProvider>
            <MemberPopupProvider>
              <Inner>{children}</Inner>
            </MemberPopupProvider>
          </TeamPhotosProvider>
        </TeamProvider>
      </ProfileProvider>
    </UndoProvider>
  )
}
