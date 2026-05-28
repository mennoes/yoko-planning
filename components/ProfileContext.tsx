'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { UserProfile } from '@/lib/profile'
import { loadProfile, saveProfile } from '@/lib/profile'
import { supabase, hasSupabase, requiresAuth, type DbProfile } from '@/lib/supabase'
import { clearAuthCache } from '@/lib/sync'

type Ctx = {
  profile:    UserProfile | null
  setProfile: (p: UserProfile) => void
  needsSetup: boolean
  openEdit:   () => void
  editOpen:   boolean
  closeEdit:  () => void
  signOut:    () => void
  isAuthenticated: boolean
  authChecked: boolean
}

const ProfileCtx = createContext<Ctx>({
  profile: null, setProfile: () => {}, needsSetup: false,
  openEdit: () => {}, editOpen: false, closeEdit: () => {},
  signOut: () => {}, isAuthenticated: false, authChecked: false,
})

function dbToProfile(db: DbProfile): UserProfile {
  return { memberId: db.member_id, name: db.name, color: db.color, photo: db.photo }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile,         setProfileState] = useState<UserProfile | null>(null)
  const [loaded,          setLoaded]       = useState(false)
  const [editOpen,        setEditOpen]     = useState(false)
  // When auth is not required (bypass on), we're auto-authenticated.
  // When auth IS required and we have a supabase client, we wait for session.
  const [isAuthenticated, setIsAuthenticated] = useState(!requiresAuth)

  // ── Without supabase client (no config): use localStorage ──────────────────
  useEffect(() => {
    if (supabase) return
    setProfileState(loadProfile())
    setLoaded(true)
  }, [])

  // ── With Supabase: keep auth state and load profile if signed in ───────────
  useEffect(() => {
    if (!supabase) return
    // Always start by loading local profile so the UI has something
    const local = loadProfile(); if (local) setProfileState(local)

    async function loadFromSupabase(userId: string) {
      const { data } = await supabase!.from('profiles').select('*').eq('user_id', userId).single()
      if (data) {
        const p = dbToProfile(data as DbProfile)
        setProfileState(p)
        saveProfile(p) // local backup
      }
      setLoaded(true)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // Cache in getCurrentUserId leeggooien — die had eerder mogelijk
        // een 'null' resultaat opgeslagen toen de sessie nog niet binnen
        // was, en zou anders alle daaropvolgende RLS-queries laten falen
        // alsof we niet ingelogd zijn.
        clearAuthCache()
        setIsAuthenticated(true)
        loadFromSupabase(session.user.id)
      } else {
        // No session: only flip to "not authenticated" if auth is required.
        if (requiresAuth) setIsAuthenticated(false)
        setLoaded(true)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        clearAuthCache()
        setIsAuthenticated(true)
        loadFromSupabase(session.user.id)
      }
      if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Token refresh kan op een nieuw user-id wijzen (zeldzaam) en in
        // elk geval willen we de cache opnieuw vullen vanuit de verse
        // sessie.
        clearAuthCache()
      }
      if (event === 'SIGNED_OUT') {
        clearAuthCache()
        if (requiresAuth) setIsAuthenticated(false)
        setProfileState(null)
        setLoaded(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function setProfile(p: UserProfile) {
    saveProfile(p)
    setProfileState(p)
    setEditOpen(false)

    if (hasSupabase && supabase) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        await supabase.from('profiles').upsert({
          user_id:         session.user.id,
          member_id:       p.memberId,
          name:            p.name,
          color:           p.color,
          photo:           p.photo,
          weekly_capacity: 40,
        }, { onConflict: 'user_id' })

        // Google-events die eerder met lege owner_ids zijn binnengekomen
        // (omdat profiel toen nog niet gemapt was) krijgen nu de juiste
        // member_id. Kick een sync af zodat upserts opnieuw langskomen.
        try {
          const { syncGoogleNow } = await import('@/lib/googleClient')
          syncGoogleNow().catch(() => {})
        } catch { /* sync optional */ }
      }
    }
  }

  async function signOut() {
    if (hasSupabase && supabase) {
      await supabase.auth.signOut()
    } else {
      setProfileState(null)
      saveProfile(null as unknown as UserProfile)
    }
  }

  return (
    <ProfileCtx.Provider value={{
      profile,
      setProfile,
      needsSetup: loaded && (!profile || !profile.memberId),
      openEdit:   () => setEditOpen(true),
      editOpen,
      closeEdit:  () => setEditOpen(false),
      signOut,
      isAuthenticated,
      authChecked: loaded,
    }}>
      {children}
    </ProfileCtx.Provider>
  )
}

export const useProfile = () => useContext(ProfileCtx)
