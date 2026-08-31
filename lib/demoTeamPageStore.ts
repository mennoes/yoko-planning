// DEMO-VARIANT van lib/teamPageStore.ts + de lokale (niet-Supabase) delen
// van lib/profileDaysOff.ts, voor gebruik door app/demo/team/page.tsx.
//
// Waarom een eigen bestand i.p.v. de echte stores hergebruiken: de echte
// stores schrijven naar GEDEELDE localStorage-keys ('yoko-capacities',
// 'yoko-contacts-overrides', 'yoko-profile-days-off'). Een demo-bezoeker
// die op dezelfde machine ook een echte, ingelogde sessie heeft zou anders
// per ongeluk diens capaciteit/contacten/werkdagen kunnen overschrijven.
// Alles hier leeft daarom onder eigen 'yoko-demo-team-*' keys, puur
// localStorage, nooit Supabase.

export type Contact = { id: string; name: string; role: string; email: string; phone: string }
export type ContactGroup = { id: string; name: string; color: string; contacts: Contact[] }

const CAP_KEY      = 'yoko-demo-team-capacities'
const CONTACTS_KEY = 'yoko-demo-team-contacts-fantasy-v1'
const DAYSOFF_KEY  = 'yoko-demo-team-daysoff'
const CAP_EVENT     = 'yoko-demo-team-capacities-update'
const CONTACTS_EVENT = 'yoko-demo-team-contacts-update'
const DAYSOFF_EVENT  = 'yoko-demo-team-daysoff-update'

// ─── Capaciteiten (uren/week per lid) ──────────────────────────────────────
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

// ─── Contacten ──────────────────────────────────────────────────────────────
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
  window.dispatchEvent(new CustomEvent(CONTACTS_EVENT))
}

export function onContactsChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CONTACTS_EVENT, cb)
  return () => window.removeEventListener(CONTACTS_EVENT, cb)
}

// ─── Werkdagen (per lid: welke dagkeys 'mon'..'fri' zijn vrij) ────────────
export function getDaysOff(): Record<string, string[]> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(DAYSOFF_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function setDaysOff(memberId: string, days: string[]): void {
  if (typeof window === 'undefined') return
  const map = getDaysOff()
  if (days.length === 0) delete map[memberId]
  else map[memberId] = days
  try { window.localStorage.setItem(DAYSOFF_KEY, JSON.stringify(map)) } catch {}
  window.dispatchEvent(new CustomEvent(DAYSOFF_EVENT))
}

export function onDaysOffChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(DAYSOFF_EVENT, cb)
  return () => window.removeEventListener(DAYSOFF_EVENT, cb)
}

// ─── Verzonnen seed-contacten ───────────────────────────────────────────────
// Puur fictief, verwijst naar de nep-klanten uit lib/demoFixtures.ts
// (Noorderlicht Media / Kaap Studio) zodat de contactenlijst logisch
// aansluit bij de rest van de demo. .example-domeinen zijn bewust niet-
// resolvable placeholders.
export const DEMO_CONTACT_GROUPS: ContactGroup[] = [
  {
    id: 'gouw-bree', name: 'De Gouw & Bree', color: '#B0C6EB',
    contacts: [
      { id: 'barliman', name: 'Barliman Boterbloem', role: 'Herbergier', email: 'boterbloem@steigerendepony.example', phone: '' },
      { id: 'merry',    name: 'Meriadoc Brandebok',  role: 'Tweede ontbijt', email: '', phone: '' },
    ],
  },
  {
    id: 'rivendel-rohan', name: 'Rivendel & Rohan', color: '#D8935B',
    contacts: [
      { id: 'elrond', name: 'Elrond', role: 'Vergaderbaas', email: 'elrond@rivendel.example', phone: '' },
      { id: 'eomer',  name: 'Éomer',  role: 'Paardenplanning', email: 'eomer@rohan.example', phone: '' },
    ],
  },
  {
    id: 'gondor-mordor', name: 'Gondor & Mordor', color: '#5FA8A0',
    contacts: [
      { id: 'faramir', name: 'Faramir', role: 'Rangerplanning', email: 'faramir@gondor.example', phone: '' },
      { id: 'sauron',  name: 'Sauron',  role: 'Enig aanspreekpunt', email: 'oog@mordor.example', phone: '' },
    ],
  },
]
