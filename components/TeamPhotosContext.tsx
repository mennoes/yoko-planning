'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { getAllTeamPhotos, setTeamPhoto as storeSetPhoto } from '@/lib/teamPhotos'

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
  const [photos, setPhotos] = useState<Record<string, string>>({})

  useEffect(() => {
    setPhotos(getAllTeamPhotos())
  }, [])

  const getPhoto = useCallback((id: string) => photos[id] ?? null, [photos])

  const setPhoto = useCallback((id: string, dataUrl: string) => {
    storeSetPhoto(id, dataUrl)
    setPhotos(prev => ({ ...prev, [id]: dataUrl }))
  }, [])

  return (
    <TeamPhotosCtx.Provider value={{ photos, getPhoto, setPhoto }}>
      {children}
    </TeamPhotosCtx.Provider>
  )
}

export const useTeamPhotos = () => useContext(TeamPhotosCtx)
