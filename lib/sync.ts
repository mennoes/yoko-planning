'use client'

import { supabase } from './supabase'

let cachedUserId: string | null | undefined  // undefined = not yet checked

export async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null
  if (cachedUserId !== undefined) return cachedUserId
  const { data } = await supabase.auth.getSession()
  cachedUserId = data.session?.user?.id ?? null
  return cachedUserId
}

export function clearAuthCache() { cachedUserId = undefined }

export async function isSyncing(): Promise<boolean> {
  if (!supabase) return false
  const uid = await getCurrentUserId()
  return uid !== null
}

// Subscribe to auth changes — invalidate cached user id and notify listeners.
if (typeof window !== 'undefined' && supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedUserId = session?.user?.id ?? null
    window.dispatchEvent(new CustomEvent('yoko-auth-change'))
  })
}

export function onAuthChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('yoko-auth-change', handler)
  return () => window.removeEventListener('yoko-auth-change', handler)
}
