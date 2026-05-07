// Server-only: pulls events from connected Google calendars and upserts them
// as board_items rows. Triggered by /api/google/sync.

import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAccessToken, listEvents, type GoogleEvent } from './googleOAuth'

const WINDOW_DAYS_FUTURE = 56  // ~8 weeks ahead
const WINDOW_DAYS_PAST   = 14  // 2 weeks back

type GoogleCalRow = {
  id:             string
  user_id:        string
  calendar_id:    string
  calendar_name:  string | null
  board_id:       string | null
  refresh_token:  string
  access_token:   string | null
  expires_at:     string | null
}

type GroupRow = { id: string; board_id: string; name: string; color: string; collapsed: boolean; position: number }
type ItemRow  = { id: string; group_id: string; external_id: string | null }

function eventDates(ev: GoogleEvent): { start: string | null; end: string | null } {
  const s = ev.start.date ?? ev.start.dateTime?.slice(0, 10) ?? null
  const e = ev.end.date   ?? ev.end.dateTime?.slice(0, 10)   ?? null
  return { start: s, end: e }
}

async function ensureGoogleGroup(
  admin:   SupabaseClient,
  boardId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('board_groups').select('*')
    .eq('board_id', boardId).eq('name', 'Google Agenda').limit(1)
  const found = (existing as GroupRow[] | null)?.[0]
  if (found) return found.id

  const { data: countRows } = await admin
    .from('board_groups').select('position').eq('board_id', boardId)
  const nextPos = (countRows as { position: number }[] | null ?? []).length

  const newId = `g_google_${boardId}_${Date.now()}`
  await admin.from('board_groups').insert({
    id:        newId,
    board_id:  boardId,
    name:      'Google Agenda',
    color:     '#B0C6EB',
    collapsed: false,
    position:  nextPos,
  })
  return newId
}

async function ensureFreshAccessToken(
  admin: SupabaseClient,
  cal:   GoogleCalRow,
): Promise<string> {
  const expiresMs = cal.expires_at ? new Date(cal.expires_at).getTime() : 0
  if (cal.access_token && expiresMs > Date.now() + 60_000) return cal.access_token

  const fresh    = await refreshAccessToken(cal.refresh_token)
  const newExp   = new Date(Date.now() + fresh.expires_in * 1000).toISOString()
  await admin.from('google_calendars').update({
    access_token: fresh.access_token,
    expires_at:   newExp,
  }).eq('id', cal.id)
  return fresh.access_token
}

async function syncOneCalendar(admin: SupabaseClient, cal: GoogleCalRow): Promise<{ added: number; updated: number; removed: number }> {
  if (!cal.board_id) return { added: 0, updated: 0, removed: 0 }
  const accessToken = await ensureFreshAccessToken(admin, cal)
  const groupId     = await ensureGoogleGroup(admin, cal.board_id)

  // Look up the connecting user's member_id so synced events show up in their
  // planning timeline.
  const { data: profileRow } = await admin
    .from('profiles').select('member_id').eq('user_id', cal.user_id).single()
  const memberId = (profileRow as { member_id: string } | null)?.member_id
  const ownerIds = memberId ? [memberId] : []

  const now     = new Date()
  const timeMin = new Date(now.getTime() - WINDOW_DAYS_PAST   * 86400000).toISOString()
  const timeMax = new Date(now.getTime() + WINDOW_DAYS_FUTURE * 86400000).toISOString()
  const events  = await listEvents(accessToken, cal.calendar_id, timeMin, timeMax)

  const { data: existingRows } = await admin
    .from('board_items')
    .select('id, group_id, external_id')
    .eq('board_id',         cal.board_id)
    .eq('source',           'google')
    .eq('external_user_id', cal.user_id)

  const existing = (existingRows as ItemRow[] | null) ?? []
  const byExt    = new Map(existing.map(r => [r.external_id, r.id]))

  const seenExt: Set<string> = new Set()
  let added = 0, updated = 0
  const upserts: Record<string, unknown>[] = []

  for (const ev of events) {
    if (ev.status === 'cancelled') continue
    const { start, end } = eventDates(ev)
    if (!start) continue
    seenExt.add(ev.id)

    const existingId = byExt.get(ev.id)
    const id         = existingId ?? `it_g_${ev.id}_${cal.user_id.slice(0, 8)}`
    if (existingId) updated++; else added++

    upserts.push({
      id,
      group_id:           groupId,
      board_id:           cal.board_id,
      name:               ev.summary ?? '(geen titel)',
      owner_ids:          ownerIds,
      status:             '',
      start_date:         start,
      end_date:           end ?? start,
      deadline:           null,
      est_hours:          0,
      dagen:              0,
      notes:              ev.description ?? null,
      contactpersoon:     null,
      uitzenddag:         null,
      framelink:          null,
      nummers:            null,
      subitems:           [],
      journal:            [],
      extra:              {},
      position:            0,
      source:              'google',
      external_id:         ev.id,
      external_link:       ev.htmlLink ?? null,
      external_synced_at:  new Date().toISOString(),
      external_user_id:    cal.user_id,
      updated_at:          new Date().toISOString(),
    })
  }

  if (upserts.length > 0) {
    await admin.from('board_items').upsert(upserts, { onConflict: 'id' })
  }

  // Remove events that no longer exist (or were cancelled) remotely
  const toRemove = existing.filter(r => r.external_id && !seenExt.has(r.external_id)).map(r => r.id)
  let removed = 0
  if (toRemove.length > 0) {
    await admin.from('board_items').delete().in('id', toRemove)
    removed = toRemove.length
  }

  await admin.from('google_calendars').update({ last_sync_at: new Date().toISOString() }).eq('id', cal.id)
  return { added, updated, removed }
}

export async function syncCalendarsForUser(admin: SupabaseClient, userId: string) {
  const { data: cals } = await admin
    .from('google_calendars').select('*').eq('user_id', userId)
  const list = (cals as GoogleCalRow[] | null) ?? []

  const results: Array<{ calendarId: string; added: number; updated: number; removed: number; error?: string }> = []
  for (const c of list) {
    try {
      const r = await syncOneCalendar(admin, c)
      results.push({ calendarId: c.calendar_id, ...r })
    } catch (e) {
      results.push({ calendarId: c.calendar_id, added: 0, updated: 0, removed: 0, error: String(e).slice(0, 200) })
    }
  }
  return results
}
