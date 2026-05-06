'use client'

import { ReactNode, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ProfileProvider, useProfile } from './ProfileContext'
import { TeamPhotosProvider } from './TeamPhotosContext'
import { MemberPopupProvider } from './MemberPopup'
import { UndoProvider } from './UndoContext'
import Sidebar from './Sidebar'
import ProfileSetup from './ProfileSetup'
import { hasSupabase } from '@/lib/supabase'

function Inner({ children }: { children: ReactNode }) {
  const { needsSetup, editOpen, isAuthenticated } = useProfile()
  const pathname = usePathname()
  const router   = useRouter()

  useEffect(() => {
    if (hasSupabase && !isAuthenticated && pathname !== '/login') {
      router.replace('/login')
    }
  }, [isAuthenticated, pathname, router])

  // Login page: geen sidebar, geen ProfileSetup
  if (pathname === '/login') {
    return <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0 }}>{children}</main>
  }

  // Wacht op auth redirect
  if (hasSupabase && !isAuthenticated) return null

  return (
    <>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0 }}>
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
