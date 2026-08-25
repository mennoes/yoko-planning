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
import { usePathname } from 'next/navigation'
import { pullTeam, ensureTeamSeed, subscribeRemoteTeam, fallbackTeam, isTeamMemberStarted, type TeamMember } from '@/lib/teamStore'
import { isDemoPath, DEMO_MEMBERS } from '@/lib/demoFixtures'

const CACHE_KEY = 'yoko-team-members'

type Ctx = {
  members: TeamMember[]
  allMembers: TeamMember[]
  loading: boolean
  refresh: () => Promise<void>
}

const TeamCtx = createContext<Ctx>({ members: [], allMembers: [], loading: true, refresh: async () => {} })

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
  const pathname = usePathname()
  const demo = isDemoPath(pathname)
  const [members, setMembers] = useState<TeamMember[]>(() => demo ? DEMO_MEMBERS : (loadCache() ?? fallbackTeam()))
  const [loading, setLoading] = useState(!demo)
  const [today, setToday] = useState(() => new Date())

  const refresh = useCallback(async () => {
    if (demo) return
    const rows = await pullTeam()
    if (rows) {
      setMembers(rows)
      saveCache(rows)
    }
    setLoading(false)
  }, [demo])

  // Publieke /demo-route: vast nep-team, nooit Supabase raken en nooit de
  // gedeelde 'yoko-team-members'-cache lezen/schrijven — anders zou een
  // demo-bezoek in dezelfde browser als een echte sessie het echte
  // team-overzicht tijdelijk met nep-namen kunnen overschrijven.
  useEffect(() => {
    if (!demo) return
    setMembers(DEMO_MEMBERS)
    setLoading(false)
  }, [demo])

  useEffect(() => {
    if (demo) return
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
  }, [demo, refresh])

  useEffect(() => {
    const timer = window.setInterval(() => setToday(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <TeamCtx.Provider value={{ members: members.filter(member => isTeamMemberStarted(member, today)), allMembers: members, loading, refresh }}>
      {children}
    </TeamCtx.Provider>
  )
}

export function useTeam() {
  return useContext(TeamCtx)
}
