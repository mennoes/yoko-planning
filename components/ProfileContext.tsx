'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { UserProfile } from '@/lib/profile'
import { loadProfile, saveProfile } from '@/lib/profile'
import { supabase, hasSupabase, type DbProfile } from '@/lib/supabase'

type Ctx = {
  profile:    UserProfile | null
  setProfile: (p: UserProfile) => void
  needsSetup: boolean
  openEdit:   () => void
  editOpen:   boolean
  closeEdit:  () => void
  signOut:    () => void
  isAuthenticated: boolean
}

const ProfileCtx = createContext<Ctx>({
  profile: null, setProfile: () => {}, needsSetup: false,
  openEdit: () => {}, editOpen: false, closeEdit: () => {},
  signOut: () => {}, isAuthenticated: false,
})

function dbToProfile(db: DbProfile): UserProfile {
  return { memberId: db.member_id, name: db.name, color: db.color, photo: db.photo }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile,         setProfileState] = useState<UserProfile | null>(null)
  const [loaded,          setLoaded]       = useState(false)
  const [editOpen,        setEditOpen]     = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(!hasSupabase)

  // ── Without Supabase: use localStorage ──────────────────────────────────────
  useEffect(() => {
    if (hasSupabase) return
    setProfileState(loadProfile())
    setLoaded(true)
  }, [])

  // ── With Supabase: sync with auth session ────────────────────────────────────
  useEffect(() => {
    if (!hasSupabase || !supabase) return

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
        setIsAuthenticated(true)
        loadFromSupabase(session.user.id)
      } else {
        setIsAuthenticated(false)
        setLoaded(true)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setIsAuthenticated(true)
        loadFromSupabase(session.user.id)
      }
      if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false)
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
    }}>
      {children}
    </ProfileCtx.Provider>
  )
}

export const useProfile = () => useContext(ProfileCtx)
