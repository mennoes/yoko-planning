'use client'

import { supabase } from './supabase'

async function authHeaders(): Promise<Record<string, string> | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return null
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export async function startGoogleOAuth(boardId: string | null): Promise<void> {
  const headers = await authHeaders()
  if (!headers) throw new Error('niet ingelogd')
  const res = await fetch('/api/google/auth', {
    method: 'POST', headers, body: JSON.stringify({ boardId }),
  })
  if (!res.ok) throw new Error('OAuth start mislukt')
  const { url } = await res.json() as { url: string }
  window.location.href = url
}

export type GoogleConnection = {
  calendarId:   string
  calendarName: string | null
  boardId:      string | null
  lastSyncAt:   string | null
}
export type GoogleCalAvailable = { id: string; summary: string; primary?: boolean; accessRole: string }

export async function fetchGoogleCalendars(): Promise<{ connections: GoogleConnection[]; available: GoogleCalAvailable[] }> {
  const headers = await authHeaders()
  if (!headers) return { connections: [], available: [] }
  const res = await fetch('/api/google/calendars', { headers })
  if (!res.ok) return { connections: [], available: [] }
  return res.json()
}

export async function updateGoogleCalendar(calendarId: string, patch: { newCalendarId?: string; boardId?: string | null }) {
  const headers = await authHeaders()
  if (!headers) return false
  const res = await fetch('/api/google/calendars', {
    method: 'POST', headers, body: JSON.stringify({ calendarId, ...patch }),
  })
  return res.ok
}

export async function disconnectGoogle(calendarId?: string) {
  const headers = await authHeaders()
  if (!headers) return false
  const res = await fetch('/api/google/disconnect', {
    method: 'POST', headers, body: JSON.stringify({ calendarId }),
  })
  return res.ok
}

export type SyncResult = {
  calendarId: string
  added:      number
  updated:    number
  removed:    number
  error?:     string
}

export async function cleanupGoogleDuplicates(): Promise<{ deleted: number; perBoard: Record<string, number> } | null> {
  const headers = await authHeaders()
  if (!headers) return null
  const res = await fetch('/api/google/cleanup', { method: 'POST', headers })
  if (!res.ok) return null
  return res.json()
}

export async function syncGoogleNow(): Promise<SyncResult[]> {
  const headers = await authHeaders()
  if (!headers) return []
  const res = await fetch('/api/google/sync', { method: 'POST', headers })
  if (!res.ok) return []
  const body = await res.json().catch(() => ({})) as { results?: SyncResult[] }
  return body.results ?? []
}
