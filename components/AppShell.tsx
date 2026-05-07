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
import { IconMenu, IconSearch } from './Icon'
import { hasSupabase } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'

function Inner({ children }: { children: ReactNode }) {
  const { needsSetup, editOpen, isAuthenticated } = useProfile()
  const pathname = usePathname()
  const router   = useRouter()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    if (hasSupabase && !isAuthenticated && pathname !== '/login' && !pathname.startsWith('/share')) {
      router.replace('/login')
    }
  }, [isAuthenticated, pathname, router])

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

  // Login + share routes: geen sidebar, geen ProfileSetup, geen auth-redirect
  if (pathname === '/login' || pathname.startsWith('/share')) {
    return <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0 }}>{children}</main>
  }

  // Wacht op auth redirect
  if (hasSupabase && !isAuthenticated) return null

  return (
    <>
      <Sidebar isMobile={isMobile} open={!isMobile || drawerOpen} onClose={() => setDrawerOpen(false)} />

      {isMobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 55 }} />
      )}

      {isMobile && !drawerOpen && (
        <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 70, display: 'flex', gap: 6 }}>
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

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <TimerIndicator />

      <main style={{
        flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0,
        width: isMobile ? '100%' : undefined,
      }}>
        {children}
      </main>
      {(needsSetup || editOpen) && <ProfileSetup />}
    </>
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
