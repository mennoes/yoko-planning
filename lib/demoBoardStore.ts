// Reset-helper voor de publieke /demo-omgeving — herschrijft de lokale
// (localStorage-only) demo-borden terug naar een verse seed met actuele
// relatieve datums. Gebruikt saveGroups zodat de write via hetzelfde pad
// loopt als een echte edit (veilig: een demo-bezoeker is nooit
// ingelogd, dus de fire-and-forget remote-push in saveGroups is een
// no-op — zie lib/boardStore.ts pushBoardToRemote).
import { saveGroups } from './boardStore'
import { buildDemoBoards, DEMO_BOARD_IDS } from './demoFixtures'

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
      window.localStorage.removeItem('yoko-demo-profile')
      window.localStorage.removeItem('yoko-demo-comments')
      window.localStorage.removeItem('home-demo-sections-order')
    } catch {}
  }
}
