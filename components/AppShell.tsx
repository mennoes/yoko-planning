'use client'

import { ReactNode, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ProfileProvider, useProfile } from './ProfileContext'
import { TeamPhotosProvider } from './TeamPhotosContext'
import { MemberPopupProvider } from './MemberPopup'
import { UndoProvider } from './UndoContext'
import Sidebar from './Sidebar'
import ProfileSetup from './ProfileSetup'
import SearchPalette from './SearchPalette'
import TimerIndicator from './TimerIndicator'
import ThemeApply from './ThemeApply'
import { IconMenu, IconSearch } from './Icon'
import { NotificationBell } from './NotificationBell'
import { requiresAuth } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'
import { pullPagesFromRemote, subscribeRemotePages } from '@/lib/pagesStore'
import { pullBoardFromRemote, subscribeRemoteBoard, BOARD_NAMES, pushBoardToRemote, loadGroups } from '@/lib/boardStore'
import { pullCategoryOverrides, subscribeRemoteCategories } from '@/lib/workloadCategory'
// (BOARD_NAMES re-used by the auto-sync tick below)
import { onAuthChange, isSyncing } from '@/lib/sync'
import { syncGoogleNow } from '@/lib/googleClient'
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
  const { needsSetup, editOpen, isAuthenticated, authChecked } = useProfile()
  const pathname = usePathname()
  const router   = useRouter()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
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
      // Pages
      pullPagesFromRemote()
      unsubs.push(subscribeRemotePages())
      // Workload category overrides
      pullCategoryOverrides()
      unsubs.push(subscribeRemoteCategories())
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
      <Sidebar isMobile={isMobile} open={!isMobile || drawerOpen} onClose={() => setDrawerOpen(false)} />

      {isMobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 55 }} />
      )}

      {isMobile && !drawerOpen && (
        <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 70, display: 'flex', gap: 6, alignItems: 'center' }}>
          <NotificationBell />
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
        </div>
      )}
      {!isMobile && (
        <div style={{ position: 'fixed', top: 14, right: 18, zIndex: 50 }}>
          <NotificationBell />
        </div>
      )}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <TimerIndicator />

      <main style={{
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
        <TeamPhotosProvider>
          <MemberPopupProvider>
            <Inner>{children}</Inner>
          </MemberPopupProvider>
        </TeamPhotosProvider>
      </ProfileProvider>
    </UndoProvider>
  )
}
