'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type NotificationKind = 'mention' | 'assigned' | 'comment'
export type NotificationContextKind = 'todo' | 'page' | 'board_item'

export type Notification = {
  id:           string
  recipient_id: string
  actor_id:     string | null
  kind:         NotificationKind
  context_kind: NotificationContextKind | null
  context_id:   string | null
  href:         string | null
  body:         string | null
  read:         boolean
  created_at:   string
}

const EVENT = 'yoko-notifications-update'

export async function loadNotifications(recipientId: string): Promise<Notification[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', recipientId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data as Notification[] | null) ?? []
}

export async function createNotification(n: {
  recipientId:  string
  actorId?:     string | null
  kind:         NotificationKind
  contextKind?: NotificationContextKind | null
  contextId?:   string | null
  href?:        string | null
  body?:        string | null
}): Promise<void> {
  if (!supabase) return
  if (!await getCurrentUserId()) return
  if (n.recipientId === n.actorId) return  // don't notify yourself
  await supabase.from('notifications').insert({
    recipient_id: n.recipientId,
    actor_id:     n.actorId ?? null,
    kind:         n.kind,
    context_kind: n.contextKind ?? null,
    context_id:   n.contextId ?? null,
    href:         n.href ?? null,
    body:         n.body ?? null,
  })
}

export async function markRead(id: string): Promise<void> {
  if (!supabase) return
  await supabase.from('notifications').update({ read: true }).eq('id', id)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export async function markAllRead(recipientId: string): Promise<void> {
  if (!supabase) return
  await supabase.from('notifications').update({ read: true })
    .eq('recipient_id', recipientId).eq('read', false)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export async function deleteAll(recipientId: string): Promise<void> {
  if (!supabase) return
  await supabase.from('notifications').delete().eq('recipient_id', recipientId)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export function onNotificationsChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

// Realtime subscribe: any insert/update/delete on notifications for this
// recipient pings the handler so the bell badge stays live.
export function subscribeRemoteNotifications(recipientId: string): () => void {
  if (!supabase) return () => {}
  const ch = supabase.channel(`notif:${recipientId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
      () => {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
      })
    .subscribe()
  return () => { if (supabase) supabase.removeChannel(ch) }
}

// Extract @member-id mentions from a body. We keep both the human-readable
// "@Naam" form in the text AND a parallel `mentions: string[]` list of
// member_ids — call sites pass the IDs around so we don't have to fuzzy-
// match names back later.
export function extractMentions(body: string, knownMembers: Array<{ id: string; name: string }>): string[] {
  const found = new Set<string>()
  for (const m of knownMembers) {
    const re = new RegExp(`(^|\\s)@${escapeRegex(m.name.split(' ')[0])}\\b`, 'i')
    if (re.test(body)) found.add(m.id)
  }
  return [...found]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
