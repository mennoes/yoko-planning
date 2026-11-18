import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTeamAdmin } from '@/lib/teamAdminServer'
import {
  MASTER_PLANNING_CSV_URL,
  canonicalTopic,
  episodeKeyFromItemName,
  parseMasterPlanningCsv,
  todayInAmsterdam,
  topicFromItemName,
} from '@/lib/masterPlanningSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ExistingItem = {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  deadline: string | null
  contactpersoon: string | null
  est_hours: number | null
  dagen: number | null
  position: number | null
  extra: Record<string, unknown> | null
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })
  const denied = await requireTeamAdmin(req)
  if (denied) return denied

  let csv = ''
  try {
    const response = await fetch(MASTER_PLANNING_CSV_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'Yoko Planner masterplanning sync' },
    })
    if (!response.ok) throw new Error(`Google Sheet gaf status ${response.status}.`)
    csv = await response.text()
    if (!csv.includes('ANIMEREN')) throw new Error('De verwachte planningstekst ontbreekt in het Sheet.')
  } catch (error) {
    return Response.json({ ok: false, error: `Masterplanning ophalen mislukt: ${String(error)}` }, { status: 502 })
  }

  let episodes
  try {
    episodes = parseMasterPlanningCsv(csv, 2026)
  } catch (error) {
    return Response.json({ ok: false, error: `Masterplanning lezen mislukt: ${String(error)}` }, { status: 422 })
  }

  const { data: group, error: groupError } = await supabaseAdmin
    .from('board_groups').select('id').eq('board_id', 'nederland').eq('name', 'Producties')
    .is('deleted_at', null).maybeSingle()
  if (groupError || !group) {
    return Response.json({ ok: false, error: 'De groep Producties is niet gevonden in Agenda Nederland.' }, { status: 500 })
  }

  const { data: itemData, error: itemError } = await supabaseAdmin
    .from('board_items')
    .select('id, name, start_date, end_date, deadline, contactpersoon, est_hours, dagen, position, extra')
    .eq('board_id', 'nederland').is('deleted_at', null)
  if (itemError || !itemData) {
    return Response.json({ ok: false, error: `Bestaande planning lezen mislukt: ${itemError?.message ?? 'onbekend'}` }, { status: 500 })
  }

  const existingByKey = new Map<string, ExistingItem>()
  for (const item of itemData as ExistingItem[]) {
    const key = typeof item.extra?.masterPlanningKey === 'string'
      ? item.extra.masterPlanningKey
      : episodeKeyFromItemName(item.name)
    if (key && !existingByKey.has(key)) existingByKey.set(key, item)
  }

  const today = todayInAmsterdam()
  const now = new Date().toISOString()
  const added: string[] = []
  const updated: Array<{ name: string; fields: string[] }> = []
  const skipped: string[] = []
  const newRows: Record<string, unknown>[] = []
  let nextPosition = Math.max(-1, ...(itemData as ExistingItem[]).map(item => Number(item.position ?? -1))) + 1

  for (const episode of episodes) {
    const existing = existingByKey.get(episode.key)
    const sourceMeta = {
      masterPlanningKey: episode.key,
      masterPlanningSyncedAt: now,
      masterPlanningSource: MASTER_PLANNING_CSV_URL,
    }
    if (existing) {
      const patch: Record<string, unknown> = {}
      const fields: string[] = []
      if (episode.topic) {
        const oldTopic = topicFromItemName(existing.name)
        const shouldRename = /onderwerp volgt/i.test(existing.name) || canonicalTopic(oldTopic) !== canonicalTopic(episode.topic)
        if (shouldRename && existing.name !== episode.name) { patch.name = episode.name; fields.push('naam') }
      }
      if (episode.startDate && episode.endDate && (!same(existing.start_date, episode.startDate) || !same(existing.end_date, episode.endDate))) {
        patch.start_date = episode.startDate; patch.end_date = episode.endDate; fields.push('timeline')
      }
      if (episode.deadline && !same(existing.deadline, episode.deadline)) { patch.deadline = episode.deadline; fields.push('deadline') }
      if (episode.contactpersoon && !same(existing.contactpersoon, episode.contactpersoon)) {
        patch.contactpersoon = episode.contactpersoon; fields.push('contactpersoon')
      }
      if (Number(existing.est_hours ?? 0) !== episode.estHours) {
        patch.est_hours = episode.estHours; patch.dagen = episode.estHours / 8; fields.push('uren')
      }
      const needsSourceMeta = existing.extra?.masterPlanningKey !== episode.key || existing.extra?.masterPlanningSource !== MASTER_PLANNING_CSV_URL
      if (fields.length > 0 || needsSourceMeta) {
        patch.extra = { ...(existing.extra ?? {}), ...sourceMeta }
        patch.updated_at = now
        const { error } = await supabaseAdmin.from('board_items').update(patch).eq('id', existing.id).eq('board_id', 'nederland')
        if (error) return Response.json({ ok: false, error: `Bijwerken van '${existing.name}' mislukt: ${error.message}` }, { status: 500 })
      }
      if (fields.length > 0) updated.push({ name: (patch.name as string | undefined) ?? existing.name, fields })
      continue
    }

    const relevantDate = episode.deadline ?? episode.endDate
    if (!episode.startDate || !episode.endDate || !episode.deadline || !relevantDate || relevantDate < today) {
      skipped.push(episode.name)
      continue
    }
    newRows.push({
      id: `master_${episode.key}`,
      group_id: group.id,
      board_id: 'nederland',
      name: episode.name,
      owner_ids: [],
      status: '',
      start_date: episode.startDate,
      end_date: episode.endDate,
      deadline: episode.deadline,
      est_hours: episode.estHours,
      dagen: episode.estHours / 8,
      notes: null,
      contactpersoon: episode.contactpersoon,
      subitems: [],
      journal: [],
      extra: sourceMeta,
      position: nextPosition++,
      source: 'manual',
      updated_at: now,
    })
    added.push(episode.name)
  }

  if (newRows.length > 0) {
    const { error } = await supabaseAdmin.from('board_items').insert(newRows)
    if (error) return Response.json({ ok: false, error: `Nieuwe afleveringen toevoegen mislukt: ${error.message}` }, { status: 500 })
  }

  return Response.json({
    ok: true,
    added,
    updated,
    unchanged: episodes.length - added.length - updated.length - skipped.length,
    skipped: skipped.length,
    sourceRows: episodes.length,
  })
}
