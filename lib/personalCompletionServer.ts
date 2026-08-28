import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommentThread } from './commentsStore'
import { completionContext, completionReply, completionState, type CompletionTarget } from './personalCompletion'

export class CompletionError extends Error {
  constructor(message: string, public status = 500) { super(message) }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function notificationId(event: string, recipient: string): string {
  const h = hash([event, recipient])
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
type Row = { id: string; context_id: string; quote: string; thread: CommentThread['thread']; created_at: string; resolved: boolean }
const fromRow = (r: Row): CommentThread => ({ id: r.id, contextId: r.context_id, quote: r.quote, thread: r.thread, createdAt: r.created_at, resolved: r.resolved })

export async function setPersonalCompletion(admin: SupabaseClient, userId: string, target: CompletionTarget, done: boolean, expectedEventId: string | null) {
  const { data: profile, error: profileError } = await admin.from('profiles').select('member_id,name').eq('user_id', userId).single()
  if (profileError || !profile?.member_id) throw new CompletionError('Je profiel kon niet worden gecontroleerd.', 403)
  const memberId = String(profile.member_id)
  const { data: item, error: itemError } = await admin.from('board_items')
    .select('id,name,board_id,group_id,owner_ids,status,subitems,deleted_at').eq('id', target.parentItemId).single()
  if (itemError || !item || item.deleted_at) throw new CompletionError('Dit item bestaat niet meer.', 404)
  const group = await admin.from('board_groups').select('id').eq('id', item.group_id).is('deleted_at', null).maybeSingle()
  if (group.error) throw new CompletionError('De agendagroep kon niet worden gecontroleerd.')
  if (!group.data) throw new CompletionError('Deze agendagroep bestaat niet meer.', 404)
  const sub = target.subitemId ? (item.subitems ?? []).find((s: { id: string }) => s.id === target.subitemId) : null
  if (target.subitemId && !sub) throw new CompletionError('Dit subitem bestaat niet meer.', 404)
  const parentOwners: string[] = (item.owner_ids ?? []).filter((id: string) => id && id !== 'unassigned')
  const subOwners: string[] = (sub?.ownerIds ?? []).filter((id: string) => id && id !== 'unassigned')
  const owners = subOwners.length ? subOwners : parentOwners
  if (!owners.includes(memberId)) throw new CompletionError('Je kunt alleen je eigen toegewezen taak afronden.', 403)
  if (item.status === 'Done' || sub?.status === 'Done') throw new CompletionError('Het hele item staat al op Done. Heropen eerst de gezamenlijke status.', 409)

  const context = completionContext(target)
  const rows: Row[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await admin.from('comments').select('*').eq('context_id', context).order('id').range(offset, offset + 499)
    if (page.error) throw new CompletionError('Persoonlijke voortgang kon niet worden geladen.')
    rows.push(...(page.data ?? []) as Row[])
    if ((page.data?.length ?? 0) < 500) break
  }
  const previous = completionState(rows.map(fromRow), target, memberId)
  let saved = previous?.done === done ? rows.find(r => r.id === previous.eventId) : undefined
  if (!saved) {
    if ((previous?.eventId ?? null) !== expectedEventId) throw new CompletionError('Je voortgang is intussen gewijzigd. Ververs het item en probeer opnieuw.', 409)
    const id = 'pc-' + hash([target.parentItemId, target.subitemId ?? null, memberId, previous?.eventId ?? null, done])
    const recipientIds = [...new Set([...owners, ...(sub ? parentOwners : [])])].filter(id => id !== memberId)
    const names = recipientIds.length
      ? await admin.from('team_members').select('id,name').in('id', recipientIds)
      : { data: [], error: null }
    if (names.error) throw new CompletionError('Betrokken teamleden konden niet worden geladen.')
    const recipients = recipientIds.map(id => ({ id, name: names.data?.find(p => p.id === id)?.name ?? id }))
    const time = new Date(Math.max(Date.now(), Date.parse(previous?.createdAt ?? '') + 1 || 0)).toISOString()
    const taskName = sub ? `${sub.name} (bij ${item.name})` : item.name
    const reply = completionReply(id, { memberId, name: profile.name || memberId }, target, done, taskName, recipients, time)
    const row = { id, context_kind: 'board_item', context_id: context, quote: taskName, thread: [reply], resolved: false, author_id: userId, created_at: time }
    const insert = await admin.from('comments').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
    if (insert.error) throw new CompletionError('Je persoonlijke voortgang kon niet worden opgeslagen.')
    // A simultaneous identical click has the SAME id. Read the winner so
    // timestamps, text and recipient list are consistent on every device.
    const stored = await admin.from('comments').select('*').eq('id', id).single()
    if (stored.error || !stored.data) throw new CompletionError('Opslaan kon niet worden bevestigd. Probeer opnieuw.')
    saved = stored.data as Row
  }
  const reply = saved.thread[0]
  const notifications = (reply.personalCompletion?.mentions ?? []).map(recipient => ({
    id: notificationId(saved.id, recipient), recipient_id: recipient, actor_id: memberId,
    kind: 'mention', context_kind: 'board_item', context_id: target.subitemId ?? item.id,
    href: `/projects/${encodeURIComponent(item.board_id)}?drawer=${encodeURIComponent(item.id)}` + (target.subitemId ? `&subitem=${encodeURIComponent(target.subitemId)}` : ''),
    body: reply.body.split('\n')[0],
  }))
  let notificationError = false
  if (notifications.length) {
    // Stable IDs prevent duplicate notifications and preserve read state on retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await admin.from('notifications').upsert(notifications, { onConflict: 'id', ignoreDuplicates: true })
      notificationError = !!result.error
      if (!notificationError) break
    }
  }
  return { comment: fromRow(saved), notificationError }
}
