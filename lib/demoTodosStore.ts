'use client'

// Demo-variant van lib/todosStore.ts — zelfde functienamen/signatures
// zodat de demo-pagina's 'm als drop-in import kunnen gebruiken, maar
// een EIGEN localStorage-key en GEEN Supabase-push. Voorkomt dat een
// demo-bezoek in dezelfde browser als een echte sessie de echte
// 'yoko-todos'-cache aanraakt.
import { mergeSections } from './todosStore'
import type { Section } from './todosStore'

const KEY   = 'yoko-demo-todos-sections-fantasy-v1'
const EVENT = 'yoko-demo-todos-update'

export function loadSections(fallback: Section[]): Section[] {
  if (typeof window === 'undefined') return fallback
  try {
    const s = window.localStorage.getItem(KEY)
    return s ? JSON.parse(s) as Section[] : fallback
  } catch { return fallback }
}

export function saveSections(sections: Section[]): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(KEY, JSON.stringify(sections)) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function onTodosUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

// Geen remote in de demo — altijd null/no-op, zodat callers die op een
// 'remote'-resultaat wachten of een subscription opzetten simpelweg
// niets extra's doen.
export async function pullFromRemote(): Promise<Section[] | null> { return null }
export async function pushToRemote(_sections: Section[]): Promise<boolean> { return true }
export function subscribeRemoteTodos(): () => void { return () => {} }
export function markItemDeleted(_id: string): void {}

export { mergeSections }
export type { Section, TodoItem, ProjectLink } from './todosStore'
