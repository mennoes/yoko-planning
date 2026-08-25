'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { getAllTeamPhotos, setTeamPhoto as storeSetPhoto } from '@/lib/teamPhotos'
import { isDemoPath, DEMO_PHOTOS } from '@/lib/demoFixtures'

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
  }, [demo])

  const getPhoto = useCallback((id: string) => photos[id] ?? null, [photos])

  const setPhoto = useCallback((id: string, dataUrl: string) => {
    // /demo: alleen lokale state bijwerken, nooit de echte foto-store
    // raken (localStorage/Supabase gedeeld met echte sessies).
    if (demo) { setPhotos(prev => ({ ...prev, [id]: dataUrl })); return }
    storeSetPhoto(id, dataUrl)
    setPhotos(prev => ({ ...prev, [id]: dataUrl }))
  }, [demo])

  return (
    <TeamPhotosCtx.Provider value={{ photos, getPhoto, setPhoto }}>
      {children}
    </TeamPhotosCtx.Provider>
  )
}

export const useTeamPhotos = () => useContext(TeamPhotosCtx)
