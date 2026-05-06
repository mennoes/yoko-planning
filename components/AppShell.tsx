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
    if (hasSupabase && !isAuthenticated && pathname !== '/login') {
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

  // Login page: geen sidebar, geen ProfileSetup
  if (pathname === '/login') {
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
        <>
          <button onClick={() => setDrawerOpen(true)} aria-label="Menu openen"
            style={{
              position: 'fixed', top: 12, left: 12, zIndex: 70,
              width: 40, height: 40, borderRadius: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              color: 'var(--text-primary)', fontSize: 18, padding: 0,
            }}>
            ☰
          </button>
          <button onClick={() => setSearchOpen(true)} aria-label="Zoeken"
            style={{
              position: 'fixed', top: 12, right: 12, zIndex: 70,
              width: 40, height: 40, borderRadius: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              color: 'var(--text-primary)', fontSize: 16, padding: 0,
            }}>
            🔍
          </button>
        </>
      )}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      <main style={{
        flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0,
        paddingTop: isMobile ? 56 : 0,
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
