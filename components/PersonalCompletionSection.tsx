'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useProfile } from './ProfileContext'
import { useTeam } from './TeamContext'
import { loadCommentsFor, newCommentId, onCommentsUpdate, saveComment, type CommentThread } from '@/lib/commentsStore'
import { completionContext, completionState, personalTaskStatus, isPersonalTaskStatus, type PersonalTaskStatus, type CompletionTarget } from '@/lib/personalCompletion'
import { updatePersonalCompletion } from '@/lib/personalCompletionClient'
import { createNotification } from '@/lib/notificationsStore'
import { handoffCommentBody } from '@/lib/handoff'

export function PersonalCompletionSection({ target, ownerIds, status, renderStatus, showMessages = false, layout = 'field' }: {
  target: CompletionTarget; ownerIds: string[]; status: string; showMessages?: boolean; layout?: 'field' | 'row'
  renderStatus: (value: string, onChange: (value: string) => void, disabled: boolean) => ReactNode
}) {
  const { profile } = useProfile()
  const demo = usePathname()?.startsWith('/demo')
  const { members } = useTeam()
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [retryNotification, setRetryNotification] = useState<PersonalTaskStatus | null>(null)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [handoffNote, setHandoffNote] = useState('')
  const [nextOwnerId, setNextOwnerId] = useState('')
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
  async function change(value: string) {
    if (!profile?.memberId || pending || allDone || !isPersonalTaskStatus(value)) return
    setPending(true); setError('')
    try {
      const result = await updatePersonalCompletion(target, profile.memberId, value === 'Done', value)
      setRetryNotification(result.notificationError ? value : null)
      if (value === 'Done' && !mine?.done) {
        setHandoffNote('')
        setNextOwnerId('')
        setHandoffOpen(true)
      } else if (value !== 'Done') {
        setHandoffOpen(false)
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Opslaan mislukt.') }
    finally { setPending(false) }
  }
  if (demo || owners.length < 2 || !canChange) return null
  const messages = threads.flatMap(t => t.thread).filter(r => r.personalCompletion).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const ownerSummary = owners.map(id => `${members.find(m => m.id === id)?.name ?? id}: ${personalTaskStatus(completionState(threads, target, id)) || '—'}`).join('\n')
  const completedCount = owners.filter(id => completionState(threads, target, id)?.done).length
  const nextOwners = owners.filter(id => id !== profile?.memberId)
  async function submitHandoff() {
    const note = handoffNote.trim()
    const next = members.find(m => m.id === nextOwnerId)
    if (!profile?.memberId || !note || !next) return
    const createdAt = new Date().toISOString()
    const id = newCommentId()
    const body = handoffCommentBody(next.name, note)
    saveComment({
      id,
      contextId: context,
      quote: 'Overdracht',
      thread: [{ id: newCommentId(), author: profile.name ?? profile.memberId, authorId: profile.memberId, body, createdAt }],
      resolved: false,
      createdAt,
    })
    await createNotification({
      recipientId: next.id,
      actorId: profile.memberId,
      kind: 'mention',
      contextKind: 'board_item',
      contextId: target.subitemId ?? target.parentItemId,
      href: typeof window === 'undefined' ? null : window.location.pathname + window.location.search,
      body: note.length > 90 ? note.slice(0, 90) + '…' : note,
    })
    setHandoffOpen(false)
    setHandoffNote('')
    setNextOwnerId('')
  }
  return <section aria-label="Persoonlijke voortgang" style={layout === 'row'
    ? { display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: 8, alignItems: 'start', marginBottom: 14 }
    : { display: 'flex', flexDirection: 'column', gap: 6 }}>
    <span style={layout === 'row'
      ? { fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, paddingTop: 3 }
      : { fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status mijn taak</span>
    <div style={{ minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 28 }}>
    <div style={{ minHeight: 28, ...(layout === 'field' ? { width: '100%', height: 28 } : {}) }} aria-busy={pending}>
      {renderStatus(personalTaskStatus(mine), change, pending || allDone)}
    </div>
    <span title={ownerSummary} aria-label={ownerSummary} style={{ fontSize: 11, color: 'var(--text-muted)' }}>{completedCount}/{owners.length} klaar</span>
    </div>
    {allDone && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 0 }}>Het hele item staat op Done. Heropen eerst de gezamenlijke status.</p>}
    {error && <p role="alert" style={{ color: 'var(--red, #e2445c)', fontSize: 12 }}>{error}</p>}
    {retryNotification !== null && <p role="alert" style={{ fontSize: 12 }}>Je status is opgeslagen, maar de melding is nog niet verstuurd. <button disabled={pending} onClick={() => change(retryNotification)}>Melding opnieuw versturen</button></p>}
    {handoffOpen && <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-card)' }}>
      <strong style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Klaar. Geef je het werk door?</strong>
      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 9 }}>Optioneel: vertel kort wat af is en wat er nu moet gebeuren.</span>
      <textarea
        autoFocus
        value={handoffNote}
        onChange={e => setHandoffNote(e.target.value)}
        placeholder="Wat heb je afgerond en wat is de volgende stap?"
        rows={3}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text-primary)', padding: '8px 9px', font: 'inherit', fontSize: 13 }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        Wie gaat hiermee verder?
        <select value={nextOwnerId} onChange={e => setNextOwnerId(e.target.value)}
          style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text-primary)', padding: '7px 8px' }}>
          <option value="">Kies iemand…</option>
          {nextOwners.map(id => {
            const member = members.find(m => m.id === id)
            return <option key={id} value={id}>{member?.name ?? id}</option>
          })}
        </select>
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 9 }}>
        <button onClick={() => setHandoffOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: '7px 8px' }}>Overslaan</button>
        <button onClick={submitHandoff} disabled={!handoffNote.trim() || !nextOwnerId}
          style={{ border: 'none', borderRadius: 6, background: handoffNote.trim() && nextOwnerId ? 'var(--accent)' : 'var(--bg-hover)', color: handoffNote.trim() && nextOwnerId ? '#000' : 'var(--text-muted)', cursor: handoffNote.trim() && nextOwnerId ? 'pointer' : 'not-allowed', padding: '7px 11px', fontWeight: 700 }}>
          Plaats overdracht
        </button>
      </div>
    </div>}
    {showMessages && messages.length > 0 && <details style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
      <summary style={{ cursor: 'pointer' }}>Activiteit ({messages.length})</summary>
      {messages.slice(0, 5).map(r => <p key={r.id} style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '10px 0 0' }}>{r.body}</p>)}
    </details>}
    </div>
  </section>
}
