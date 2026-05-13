// Lokale overrides voor team-pagina: capaciteit per Yoko-lid (gedeeld met
// Planning via 'yoko-capacities'), en de hele contacts-lijst (groepen +
// contacten). Beide leven in localStorage; cross-device sync kan later via
// een Supabase-tabel.

const CAP_KEY      = 'yoko-capacities'
const CONTACTS_KEY = 'yoko-contacts-overrides'
const CAP_EVENT    = 'yoko-capacities-update'
const CON_EVENT    = 'yoko-contacts-update'

export type Contact = { id: string; name: string; role: string; email: string; phone: string }
export type ContactGroup = { id: string; name: string; color: string; contacts: Contact[] }

export function getCapacities(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CAP_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function setCapacity(memberId: string, capacity: number): void {
  if (typeof window === 'undefined') return
  const map = getCapacities()
  map[memberId] = capacity
  try { window.localStorage.setItem(CAP_KEY, JSON.stringify(map)) } catch {}
  window.dispatchEvent(new CustomEvent(CAP_EVENT))
}

export function onCapacitiesChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CAP_EVENT, cb)
  return () => window.removeEventListener(CAP_EVENT, cb)
}

export function getContacts(initial: ContactGroup[]): ContactGroup[] {
  if (typeof window === 'undefined') return initial
  try {
    const raw = window.localStorage.getItem(CONTACTS_KEY)
    if (!raw) return initial
    const parsed = JSON.parse(raw) as ContactGroup[]
    return Array.isArray(parsed) ? parsed : initial
  } catch { return initial }
}

export function saveContacts(groups: ContactGroup[]): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(CONTACTS_KEY, JSON.stringify(groups)) } catch {}
  window.dispatchEvent(new CustomEvent(CON_EVENT))
}

export function onContactsChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CON_EVENT, cb)
  return () => window.removeEventListener(CON_EVENT, cb)
}
