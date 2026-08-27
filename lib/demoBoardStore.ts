// Reset-helper voor de publieke /demo-omgeving — herschrijft de lokale
// (localStorage-only) demo-borden terug naar een verse seed met actuele
// relatieve datums. Gebruikt saveGroups zodat de write via hetzelfde pad
// loopt als een echte edit (veilig: een demo-bezoeker is nooit
// ingelogd, dus de fire-and-forget remote-push in saveGroups is een
// no-op — zie lib/boardStore.ts pushBoardToRemote).
import { saveGroups } from './boardStore'
import { buildDemoBoards, DEMO_BOARD_IDS } from './demoFixtures'

const DEMO_SEED_VERSION = '2'
const DEMO_SEED_VERSION_KEY = 'yoko-demo-seed-version'

// Een nieuwe demo-release mag de fictieve planning één keer verversen,
// anders blijven terugkerende bezoekers voor altijd de oude localStorage-
// seed zien. Alleen demo-borden worden vervangen; overige demo-instellingen
// en de echte planner blijven onaangeraakt.
export function refreshDemoBoardsIfNeeded(): void {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(DEMO_SEED_VERSION_KEY) === DEMO_SEED_VERSION) return
    const fresh = buildDemoBoards()
    for (const id of DEMO_BOARD_IDS) saveGroups(id, fresh[id]?.groups ?? [])
    window.localStorage.setItem(DEMO_SEED_VERSION_KEY, DEMO_SEED_VERSION)
  } catch {}
}

export function resetDemoBoards(): void {
  const fresh = buildDemoBoards()
  for (const id of DEMO_BOARD_IDS) {
    saveGroups(id, fresh[id]?.groups ?? [])
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('yoko-demo-todos')
      window.localStorage.removeItem('yoko-demo-todos-sections')
      window.localStorage.removeItem('yoko-demo-todos-removed-projects')
      window.localStorage.setItem(DEMO_SEED_VERSION_KEY, DEMO_SEED_VERSION)
      window.localStorage.removeItem('yoko-demo-profile')
      window.localStorage.removeItem('yoko-demo-comments')
      window.localStorage.removeItem('home-demo-sections-order')
      window.localStorage.removeItem('yoko-demo-recent-pages')
      window.localStorage.removeItem('yoko-demo-doc-folders')
      // Pagina's-secties (Team/Team beheren/Kantoor/Budget/Accounts/
      // Geschiedenis) — elk hun eigen, volledig lokale demo-store.
      window.localStorage.removeItem('yoko-demo-team-members')
      window.localStorage.removeItem('yoko-demo-team-capacities')
      window.localStorage.removeItem('yoko-demo-team-contacts')
      window.localStorage.removeItem('yoko-demo-team-daysoff')
      window.localStorage.removeItem('yoko-kantoor-demo')
      window.localStorage.removeItem('yoko-demo-budget-entries')
      window.localStorage.removeItem('yoko-demo-project-revenue')
      window.localStorage.removeItem('yoko-demo-revenue-templates')
      window.localStorage.removeItem('yoko-demo-accounts')
      // Losse pagina's staan elk onder een eigen 'yoko-demo-page-{id}'-key
      // (geen vaste lijst) — die vind je alleen door de hele localStorage
      // langs te lopen en op prefix te matchen.
      const pageKeys: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k?.startsWith('yoko-demo-page-')) pageKeys.push(k)
      }
      for (const k of pageKeys) window.localStorage.removeItem(k)
    } catch {}
  }
}
