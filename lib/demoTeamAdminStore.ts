// Lokale (localStorage-backed) team-lijst voor de publieke /demo-omgeving.
// Laat een demo-bezoeker leden toevoegen/bewerken/verwijderen/herordenen
// via app/demo/team-admin/page.tsx zonder ooit Supabase te raken — alles
// blijft in de browser van de bezoeker. TeamContext.tsx leest dezelfde
// key zodat wijzigingen hier ook in Planning/Todo's/de 'Bekijk als'-lijst
// (voor zover die via useTeam() werkt) meteen zichtbaar zijn.
//
// Losstaand van de ECHTE team-store (lib/teamStore.ts, Supabase) — bewust
// een apart, klein bestand zodat de demo-tak nooit per ongeluk een import
// van de echte upsert/delete-functies binnenhaalt.
import type { TeamMember } from './teamStore'
import { DEMO_MEMBERS } from './demoFixtures'

export const DEMO_TEAM_STORAGE_KEY = 'yoko-demo-team-members-fantasy-v1'

function cloneSeed(): TeamMember[] {
  return DEMO_MEMBERS.map(m => ({ ...m }))
}

/** Leest de demo-team-lijst uit localStorage; zaait 'm bij een eerste
 *  bezoek (of na een reset) met de vaste DEMO_MEMBERS-fixtures. */
export function loadDemoTeamMembers(): TeamMember[] {
  if (typeof window === 'undefined') return cloneSeed()
  try {
    const raw = window.localStorage.getItem(DEMO_TEAM_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as TeamMember[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  const seed = cloneSeed()
  saveDemoTeamMembers(seed)
  return seed
}

export function saveDemoTeamMembers(members: TeamMember[]): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(DEMO_TEAM_STORAGE_KEY, JSON.stringify(members)) } catch {}
}

/** Gebruikt door DemoShell's 'Reset'-knop zodat een volledige demo-reset
 *  ook zelf-toegevoegde/-bewerkte teamleden weer terugzet naar de vaste
 *  fixtures. */
export function resetDemoTeamMembers(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(DEMO_TEAM_STORAGE_KEY) } catch {}
}
