// Live team-leden uit Supabase (tabel team_members). Cache in localStorage
// zodat een refresh meteen iets toont; daarna pullen we de actuele lijst en
// abonneren we op realtime updates. Componenten consumeren via useTeam().
//
// Bestaande hardcoded teamData.members imports blijven werken — die zijn de
// fallback voor onge-authenticeerde / Supabase-loze contexten. Plekken die
// admin-wijzigingen MOETEN tonen (Team-pagina, member-pickers, planning)
// switchen naar useTeam().

'use client'
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { pullTeam, ensureTeamSeed, subscribeRemoteTeam, fallbackTeam, type TeamMember } from '@/lib/teamStore'

const CACHE_KEY = 'yoko-team-members'

type Ctx = {
  members: TeamMember[]
  loading: boolean
  refresh: () => Promise<void>
}

const TeamCtx = createContext<Ctx>({ members: [], loading: true, refresh: async () => {} })

function loadCache(): TeamMember[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TeamMember[]
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}
function saveCache(members: TeamMember[]): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(members)) } catch {}
}

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<TeamMember[]>(() => loadCache() ?? fallbackTeam())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const rows = await pullTeam()
    if (rows) {
      setMembers(rows)
      saveCache(rows)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      // Seed-check: lege Supabase-tabel krijgt eenmalig de team.json-set
      // gepushed, zodat bestaande installaties geen leeg team-overzicht
      // zien zodra de admin-UI live komt.
      try { await ensureTeamSeed() } catch {}
      if (cancelled) return
      await refresh()
    }
    init()
    const off = subscribeRemoteTeam(() => { refresh() })
    return () => { cancelled = true; off() }
  }, [refresh])

  return (
    <TeamCtx.Provider value={{ members, loading, refresh }}>
      {children}
    </TeamCtx.Provider>
  )
}

export function useTeam() {
  return useContext(TeamCtx)
}
