'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useProfile } from './ProfileContext'
import { useTeam } from './TeamContext'
import { loadCommentsFor, onCommentsUpdate, type CommentThread } from '@/lib/commentsStore'
import { completionContext, completionState, type CompletionTarget } from '@/lib/personalCompletion'
import { updatePersonalCompletion } from '@/lib/personalCompletionClient'

export function PersonalCompletionSection({ target, ownerIds, status, showMessages = false }: {
  target: CompletionTarget; ownerIds: string[]; status: string; showMessages?: boolean
}) {
  const { profile } = useProfile()
  const demo = usePathname()?.startsWith('/demo')
  const { members } = useTeam()
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [retryNotification, setRetryNotification] = useState<boolean | null>(null)
  const context = completionContext(target)
  useEffect(() => {
    if (demo) return
    const refresh = () => setThreads(loadCommentsFor(context))
    refresh()
    return onCommentsUpdate(refresh)
  }, [context, demo])
  const owners = [...new Set(ownerIds.filter(id => id && id !== 'unassigned'))]
  const mine = profile?.memberId ? completionState(threads, target, profile.memberId) : undefined
  const canChange = !!profile?.memberId && owners.includes(profile.memberId)
  const allDone = status.toLowerCase() === 'done'
  async function change(done: boolean) {
    if (!profile?.memberId || pending) return
    setPending(true); setError('')
    try {
      const result = await updatePersonalCompletion(target, profile.memberId, done)
      setRetryNotification(result.notificationError ? done : null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Opslaan mislukt.') }
    finally { setPending(false) }
  }
  if (demo || !owners.length) return null
  const messages = threads.flatMap(t => t.thread).filter(r => r.personalCompletion).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return <section aria-label="Persoonlijke voortgang" style={{ marginBottom: 20, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)' }}>
    <strong style={{ fontSize: 13 }}>Persoonlijke voortgang</strong>
    <p style={{ margin: '5px 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>Alleen jouw taak afronden. De gezamenlijke status en uren blijven ongewijzigd.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {owners.map(id => {
        const done = completionState(threads, target, id)?.done
        return <span key={id} style={{ padding: '5px 9px', borderRadius: 6, fontSize: 12, background: done ? 'rgba(0,200,117,0.12)' : 'var(--bg-hover)', color: done ? 'var(--green, #00a860)' : 'var(--text-secondary)' }}>
          {done ? '✓ ' : ''}{members.find(m => m.id === id)?.name ?? id} · {done ? 'klaar' : 'open'}
        </span>
      })}
    </div>
    {canChange && <button disabled={pending || allDone} onClick={() => change(!mine?.done)}
      aria-pressed={!!mine?.done}
      style={{ padding: '9px 13px', borderRadius: 7, border: '1px solid var(--border)', background: mine?.done ? 'var(--bg-hover)' : 'var(--accent)', color: mine?.done ? 'var(--text-primary)' : '#fff', fontWeight: 700, cursor: pending || allDone ? 'default' : 'pointer', opacity: pending || allDone ? 0.6 : 1 }}>
      {pending ? 'Opslaan…' : mine?.done ? 'Mijn taak heropenen' : '✓ Mijn taak klaar'}
    </button>}
    {canChange && mine && retryNotification === null && !allDone && <button disabled={pending}
      title="Controleert of de andere betrokkenen hun melding hebben; maakt geen dubbele meldingen"
      onClick={() => change(mine.done)} style={{ marginLeft: 10, padding: 4, border: 0, background: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>
      Melding opnieuw versturen
    </button>}
    {allDone && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 0 }}>Het hele item staat op Done. Heropen eerst de gezamenlijke status.</p>}
    {error && <p role="alert" style={{ color: 'var(--red, #e2445c)', fontSize: 12 }}>{error}</p>}
    {retryNotification !== null && <p role="alert" style={{ fontSize: 12 }}>Je status is opgeslagen, maar de melding is nog niet verstuurd. <button disabled={pending} onClick={() => change(retryNotification)}>Melding opnieuw versturen</button></p>}
    {showMessages && messages.length > 0 && <div style={{ marginTop: 14, borderTop: '1px solid var(--border)' }}>
      {messages.slice(0, 5).map(r => <p key={r.id} style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '10px 0 0' }}>{r.body}</p>)}
    </div>}
  </section>
}
