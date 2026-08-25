'use client'

// Uitgebreide profielvelden (functie, contact, verjaardag, etc.) voor de
// /demo/profile/[memberId]-pagina — puur lokaal, per teamlid, nooit
// Supabase. Aparte namespace per member zodat 'bewerk het profiel van
// Robin' en 'bewerk je eigen profiel' elkaar niet overschrijven.
const PREFIX = 'yoko-demo-profile-ext-'

export function loadDemoExtendedProfile(memberId: string): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null
  try {
    const s = window.localStorage.getItem(PREFIX + memberId)
    return s ? JSON.parse(s) as Record<string, unknown> : null
  } catch { return null }
}

export function saveDemoExtendedProfile(memberId: string, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...(loadDemoExtendedProfile(memberId) ?? {}), ...patch }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(PREFIX + memberId, JSON.stringify(next)) } catch {}
  }
  return next
}
