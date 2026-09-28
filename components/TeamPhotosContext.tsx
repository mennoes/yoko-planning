'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { getAllTeamPhotos, setTeamPhoto as storeSetPhoto } from '@/lib/teamPhotos'
import { isDemoPath, DEMO_PHOTOS } from '@/lib/demoFixtures'
import { supabase } from '@/lib/supabase'

type Ctx = {
  photos:   Record<string, string>
  getPhoto: (memberId: string) => string | null
  setPhoto: (memberId: string, dataUrl: string) => void
}

const TeamPhotosCtx = createContext<Ctx>({
  photos:   {},
  getPhoto: () => null,
  setPhoto: () => {},
})

export function TeamPhotosProvider({ children }: { children: ReactNode }) {
  const demo = isDemoPath(usePathname())
  const [photos, setPhotos] = useState<Record<string, string>>(demo ? DEMO_PHOTOS : {})

  useEffect(() => {
    if (demo) { setPhotos(DEMO_PHOTOS); return }
    setPhotos(getAllTeamPhotos())

    let alive = true
    let pullTimer: ReturnType<typeof setTimeout> | undefined
    async function pullRemotePhotos() {
      if (!supabase) return
      const { data, error } = await supabase
        .from('profiles')
        .select('member_id, photo')
        .not('member_id', 'is', null)
        .not('photo', 'is', null)
      if (!alive || error || !data) return
      const remote: Record<string, string> = {}
      for (const row of data as { member_id: string | null; photo: string | null }[]) {
        if (row.member_id && row.photo) remote[row.member_id] = row.photo
      }
      // Supabase is de gedeelde bron; lokale foto's blijven alleen als
      // offline/legacy fallback bestaan voor leden zonder remote foto.
      setPhotos(local => ({ ...local, ...remote }))
    }
    function schedulePull() {
      if (pullTimer) clearTimeout(pullTimer)
      pullTimer = setTimeout(() => { pullTimer = undefined; void pullRemotePhotos() }, 150)
    }

    void pullRemotePhotos()
    const channel = supabase?.channel('team-photos:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, schedulePull)
      .subscribe()
    window.addEventListener('focus', schedulePull)
    return () => {
      alive = false
      if (pullTimer) clearTimeout(pullTimer)
      window.removeEventListener('focus', schedulePull)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [demo])

  const getPhoto = useCallback((id: string) => photos[id] ?? null, [photos])

  const setPhoto = useCallback((id: string, dataUrl: string) => {
    // /demo: alleen lokale state bijwerken, nooit de echte foto-store
    // raken (localStorage/Supabase gedeeld met echte sessies).
    if (demo) { setPhotos(prev => ({ ...prev, [id]: dataUrl })); return }
    storeSetPhoto(id, dataUrl)
    setPhotos(prev => ({ ...prev, [id]: dataUrl }))
    // Houd dezelfde foto op ieder apparaat en elk scherm. De update is
    // beperkt tot het profiel met dit member_id; profiel-RLS bepaalt wie
    // daadwerkelijk mag schrijven.
    if (supabase) void supabase.from('profiles').update({ photo: dataUrl }).eq('member_id', id)
  }, [demo])

  return (
    <TeamPhotosCtx.Provider value={{ photos, getPhoto, setPhoto }}>
      {children}
    </TeamPhotosCtx.Provider>
  )
}

export const useTeamPhotos = () => useContext(TeamPhotosCtx)
