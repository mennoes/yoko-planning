// Server-only helpers for Google OAuth + Calendar API.
// Imported by /api/google/* route handlers.

import crypto from 'crypto'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'openid', 'email',
]

const STATE_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'dev-fallback-secret'

export type GoogleEvent = {
  id:                 string
  status?:            string                       // 'confirmed' | 'tentative' | 'cancelled'
  summary?:           string
  description?:       string
  htmlLink?:          string
  start:              { dateTime?: string; date?: string; timeZone?: string }
  end:                { dateTime?: string; date?: string; timeZone?: string }
  updated?:           string
  recurringEventId?:  string                       // master ID for recurring instances
  transparency?:      'opaque' | 'transparent'     // 'transparent' = "Free" (doesn't take time)
  attendees?: Array<{
    email?:          string
    self?:           boolean
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted'
  }>
}

export type CalendarSummary = {
  id:         string
  summary:    string
  primary?:   boolean
  accessRole: string
}

// ── HMAC state ────────────────────────────────────────────────────────────────
export function signState(payload: object): string {
  const json = JSON.stringify(payload)
  const data = Buffer.from(json).toString('base64url')
  const sig  = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyState<T = unknown>(state: string): T | null {
  const [data, sig] = state.split('.')
  if (!data || !sig) return null
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url')
  if (sig !== expected) return null
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString()) as T
  } catch { return null }
}

// ── OAuth URL + token exchange ────────────────────────────────────────────────
export function getAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri:  redirectUri,
    response_type: 'code',
    access_type:   'offline',
    prompt:        'consent',                    // force refresh_token return
    include_granted_scopes: 'true',
    scope:         SCOPES.join(' '),
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
    }),
  })
  if (!res.ok) throw new Error('exchange failed: ' + await res.text())
  return res.json() as Promise<{
    access_token:  string
    refresh_token: string
    expires_in:    number
    scope:         string
    token_type:    string
  }>
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error('refresh failed: ' + await res.text())
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

// ── Calendar API ──────────────────────────────────────────────────────────────
export async function listCalendars(accessToken: string): Promise<CalendarSummary[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('list calendars failed: ' + await res.text())
  const data = await res.json() as { items?: CalendarSummary[] }
  return data.items ?? []
}

export async function listEvents(
  accessToken: string,
  calendarId:  string,
  timeMin:     string,
  timeMax:     string,
): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin, timeMax,
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '250',
    showDeleted:  'true',
  })
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error('list events failed: ' + await res.text())
  const data = await res.json() as { items?: GoogleEvent[] }
  return data.items ?? []
}
