// Per-item owner-exclude overrides. Voor Google-gesynchroniseerde items
// kun je niet via /planning de attendees aanpassen — dat gaat via Google
// Calendar zelf. Maar soms staat er een Yoko-collega op een event waar
// 'ie niets aan hoeft te doen (bv. Marieke is uitgenodigd voor info maar
// werkt niet aan 't betreffende item). Dan kun je 'm hier per-item
// uitsluiten zonder de Google-event aan te raken.
//
// Werkt voor alle items (Google én handmatig), maar UI biedt 'm vooral
// voor Google-items omdat handmatige items al een echte remove-button
// hebben.

const STORAGE_KEY  = 'yoko-owner-excludes'
const UPDATE_EVENT = 'yoko-owner-excludes-update'

export type OwnerExcludesMap = Record<string, string[]>  // projectId → memberIds

function read(): OwnerExcludesMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as OwnerExcludesMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function write(map: OwnerExcludesMap) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function loadOwnerExcludes(): OwnerExcludesMap {
  return read()
}

export function isOwnerExcluded(projectId: string, memberId: string): boolean {
  const map = read()
  return Array.isArray(map[projectId]) && map[projectId].includes(memberId)
}

export function excludeOwner(projectId: string, memberId: string): void {
  const map = read()
  const cur = Array.isArray(map[projectId]) ? map[projectId] : []
  if (cur.includes(memberId)) return
  map[projectId] = [...cur, memberId]
  write(map)
}

export function unexcludeOwner(projectId: string, memberId: string): void {
  const map = read()
  const cur = Array.isArray(map[projectId]) ? map[projectId] : []
  const next = cur.filter(id => id !== memberId)
  if (next.length === cur.length) return
  if (next.length === 0) delete map[projectId]
  else                   map[projectId] = next
  write(map)
}

export function onOwnerExcludesChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  // Cross-tab via storage event
  function onStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY) handler()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(UPDATE_EVENT, handler)
    window.removeEventListener('storage', onStorage)
  }
}
