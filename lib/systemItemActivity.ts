import type { SupabaseClient } from '@supabase/supabase-js'

export type SystemActivityActor = 'chatgpt' | 'google' | 'yoko'

export type SystemItemActivity = {
  itemId: string
  boardId: string
  itemName: string
  action: string
  detail?: string
  field?: string
  before?: unknown
  after?: unknown
  actor?: SystemActivityActor
  source?: string
}

const ACTORS: Record<SystemActivityActor, { name: string; type: string }> = {
  chatgpt: { name: 'ChatGPT', type: 'ai' },
  google:  { name: 'Google Agenda', type: 'integration' },
  yoko:    { name: 'Yoko automatisch', type: 'automation' },
}

/**
 * Server-side wijzigingen hebben geen ingelogde browsergebruiker. Zonder
 * expliciete actor verschenen ze daarom als “Iemand”, of helemaal niet.
 * Deze helper schrijft ze naar hetzelfde append-only itemlog als menselijke
 * wijzigingen, met een herkenbare actor en gestructureerde vóór/na-waarden.
 */
export async function logSystemItemActivity(
  admin: SupabaseClient,
  entry: SystemItemActivity,
): Promise<string | null> {
  const actor = ACTORS[entry.actor ?? 'yoko']
  const { error } = await admin.from('activity').insert({
    user_id: null,
    action: entry.action,
    target: `board_item:${entry.itemId}`,
    detail: entry.detail ?? null,
    meta: {
      boardId: entry.boardId,
      itemName: entry.itemName,
      field: entry.field,
      before: entry.before,
      after: entry.after,
      actorName: actor.name,
      actorType: actor.type,
      source: entry.source ?? null,
    },
  })
  return error?.message ?? null
}

export async function logSystemItemActivities(
  admin: SupabaseClient,
  entries: SystemItemActivity[],
): Promise<string | null> {
  for (const entry of entries) {
    const error = await logSystemItemActivity(admin, entry)
    if (error) return error
  }
  return null
}
