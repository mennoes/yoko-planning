'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { loadPage, savePage, type PageDoc } from '@/lib/pagesStore'
import {
  loadComment, saveComment, deleteComment, newCommentId,
  type CommentThread, type CommentReply,
} from '@/lib/commentsStore'
import { useProfile } from '@/components/ProfileContext'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { IconClose, IconCheck } from '@/components/Icon'
import { createNotification } from '@/lib/notificationsStore'
import { MentionTextarea } from '@/components/MentionTextarea'
import { ReactionRow } from '@/components/ReactionRow'
import { toggleReaction } from '@/lib/commentsStore'

const EMOJIS = ['📄','📝','📌','🗒','💡','🔖','📋','🗂','📊','🎨','🚀','⭐']

function toolbar(cmd: string, val?: string) {
  document.execCommand(cmd, false, val)
}

export default function PageEditor() {
  const params = useParams()
  const id     = String(params.id)
  const { profile } = useProfile()
  const { getPhoto } = useTeamPhotos()

  const [doc,     setDoc]     = useState<PageDoc | null>(null)
  const [status,  setStatus]  = useState<'saved' | 'saving' | 'new'>('new')
  const [emoji,   setEmoji]   = useState('📄')
  const [title,   setTitle]   = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const editorRef  = useRef<HTMLDivElement>(null)
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Comments state ─────────────────────────────────────────────────────────
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number } | null>(null)
  const savedRange   = useRef<Range | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeQuote, setComposeQuote] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeMentions, setComposeMentions] = useState<string[]>([])
  const [replyMentions, setReplyMentions] = useState<string[]>([])
  const [openCommentId, setOpenCommentId] = useState<string | null>(null)
  const [openCommentPos, setOpenCommentPos] = useState<{ x: number; y: number } | null>(null)
  const [activeComment, setActiveComment] = useState<CommentThread | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  // Load or create
  useEffect(() => {
    const existing = loadPage(id)
    if (existing) {
      setDoc(existing)
      setEmoji(existing.emoji || '📄')
      setTitle(existing.title || '')
      if (editorRef.current) editorRef.current.innerHTML = existing.content || ''
      setStatus('saved')
    } else {
      const now = new Date().toISOString()
      const fresh: PageDoc = { id, title: '', content: '', emoji: '📄', createdAt: now, updatedAt: now }
      setDoc(fresh)
      setStatus('new')
    }
  }, [id])

  const save = useCallback((titleVal: string, emojiVal: string, contentHtml: string) => {
    if (!id) return
    const now = new Date().toISOString()
    const updated: PageDoc = {
      id, title: titleVal, content: contentHtml, emoji: emojiVal,
      createdAt: doc?.createdAt ?? now, updatedAt: now,
      folderId: doc?.folderId ?? null,
    }
    savePage(updated)
    setDoc(updated)
    setStatus('saved')
  }, [id, doc])

  function scheduleSave(titleVal: string, emojiVal: string) {
    setStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      save(titleVal, emojiVal, editorRef.current?.innerHTML ?? '')
    }, 800)
  }

  function onTitleChange(v: string) {
    setTitle(v)
    scheduleSave(v, emoji)
  }
  function onEmojiPick(e: string) {
    setEmoji(e)
    setEmojiOpen(false)
    scheduleSave(title, e)
  }
  function onInput() {
    scheduleSave(title, emoji)
  }

  // ─── Selection toolbar ──────────────────────────────────────────────────────
  function updateSelectionToolbar() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setSelToolbar(null); return }
    const range = sel.getRangeAt(0)
    if (!editorRef.current?.contains(range.commonAncestorContainer)) { setSelToolbar(null); return }
    const text = sel.toString().trim()
    if (!text) { setSelToolbar(null); return }
    const rect = range.getBoundingClientRect()
    setSelToolbar({ x: rect.left + rect.width / 2, y: rect.top - 8 })
    savedRange.current = range.cloneRange()
  }
  useEffect(() => {
    function onSel() { updateSelectionToolbar() }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  function startComposeFromSelection() {
    if (!savedRange.current) return
    const text = savedRange.current.toString().trim()
    if (!text) return
    setComposeQuote(text)
    setComposeBody('')
    setComposeOpen(true)
    setSelToolbar(null)
  }

  function submitComment() {
    if (!savedRange.current || !composeBody.trim()) return
    const cmtId = newCommentId()
    const author = profile?.name ?? 'Onbekend'
    const reply: CommentReply = {
      id: 'r-' + Date.now().toString(36),
      author, authorId: profile?.memberId,
      body: composeBody.trim(),
      createdAt: new Date().toISOString(),
    }
    const thread: CommentThread = {
      id: cmtId, contextId: id, quote: composeQuote,
      thread: [reply], resolved: false,
      createdAt: new Date().toISOString(),
    }
    saveComment(thread)
    // Notify mentioned members
    for (const rid of composeMentions) {
      createNotification({
        recipientId: rid,
        actorId:     profile?.memberId ?? null,
        kind:        'mention',
        contextKind: 'page',
        contextId:   id,
        href:        `/pages/${id}`,
        body:        composeBody.trim().length > 90 ? composeBody.trim().slice(0, 90) + '…' : composeBody.trim(),
      }).catch(() => {})
    }
    setComposeMentions([])

    // Wrap selection in a <mark> element
    try {
      const range = savedRange.current
      const mark = document.createElement('mark')
      mark.setAttribute('data-cmt', cmtId)
      mark.className = 'cm'
      // If the range crosses elements, surroundContents may fail; fall back to extract+insert
      try { range.surroundContents(mark) }
      catch {
        const frag = range.extractContents()
        mark.appendChild(frag)
        range.insertNode(mark)
      }
    } catch (err) {
      console.warn('Could not wrap selection', err)
    }
    save(title, emoji, editorRef.current?.innerHTML ?? '')
    setComposeOpen(false); setComposeBody(''); setComposeQuote('')
    window.getSelection()?.removeAllRanges()
  }

  function openCommentAt(cmtId: string, target: HTMLElement) {
    const t = loadComment(cmtId)
    if (!t) return
    const rect = target.getBoundingClientRect()
    setActiveComment(t)
    setOpenCommentId(cmtId)
    setOpenCommentPos({ x: rect.left + rect.width / 2, y: rect.bottom + 6 })
  }
  function closeComment() { setOpenCommentId(null); setActiveComment(null); setOpenCommentPos(null); setReplyDraft('') }

  function addReply() {
    if (!activeComment || !replyDraft.trim()) return
    const author = profile?.name ?? 'Onbekend'
    const reply: CommentReply = {
      id: 'r-' + Date.now().toString(36),
      author, authorId: profile?.memberId,
      body: replyDraft.trim(),
      createdAt: new Date().toISOString(),
    }
    const updated = { ...activeComment, thread: [...activeComment.thread, reply] }
    saveComment(updated)
    for (const rid of replyMentions) {
      createNotification({
        recipientId: rid,
        actorId:     profile?.memberId ?? null,
        kind:        'mention',
        contextKind: 'page',
        contextId:   id,
        href:        `/pages/${id}`,
        body:        reply.body.length > 90 ? reply.body.slice(0, 90) + '…' : reply.body,
      }).catch(() => {})
    }
    setActiveComment(updated); setReplyDraft(''); setReplyMentions([])
  }

  function resolveComment() {
    if (!activeComment || !editorRef.current) return
    const id = activeComment.id
    deleteComment(id)
    // Unwrap matching mark elements
    const marks = editorRef.current.querySelectorAll(`mark[data-cmt="${id}"]`)
    marks.forEach(m => {
      const parent = m.parentNode
      while (m.firstChild) parent?.insertBefore(m.firstChild, m)
      parent?.removeChild(m)
    })
    save(title, emoji, editorRef.current.innerHTML)
    closeComment()
  }

  // Click handler for marks in the editor
  function onEditorClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    const mark = target.closest<HTMLElement>('mark.cm[data-cmt]')
    if (mark) {
      e.preventDefault()
      const cmtId = mark.getAttribute('data-cmt')!
      openCommentAt(cmtId, mark)
    }
  }

  const createdAt = doc?.createdAt ? new Date(doc.createdAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

  return (
    <div style={{ maxWidth: 740, margin: '0 auto', padding: '52px 36px 120px', position: 'relative' }}>

      {/* Emoji + title */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 12 }}>
          <button
            onClick={() => setEmojiOpen(o => !o)}
            style={{ fontSize: 44, background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, borderRadius: 8 }}
          >{emoji}</button>
          {emojiOpen && (
            <div style={{
              position: 'absolute', top: '110%', left: 0, zIndex: 100,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 10,
              display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => onEmojiPick(e)}
                  style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, padding: 4 }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
                >{e}</button>
              ))}
            </div>
          )}
        </div>

        <input
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="Naamloos document"
          style={{
            display: 'block', width: '100%', fontSize: 36, fontWeight: 900,
            color: 'var(--text-primary)', background: 'transparent', border: 'none',
            outline: 'none', letterSpacing: '-0.04em', lineHeight: 1.2,
            padding: 0, marginBottom: 6,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          {createdAt && <span>Aangemaakt {createdAt}</span>}
          <span style={{ color: status === 'saving' ? 'var(--accent)' : status === 'saved' ? 'var(--green, #5A8A6A)' : 'var(--text-muted)' }}>
            {status === 'saving' ? 'Opslaan…' : status === 'saved' ? 'Opgeslagen' : 'Nieuw document'}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
        padding: '6px 8px', marginBottom: 4,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
      }}>
        {[
          { label: 'B', cmd: 'bold',      style: { fontWeight: 700 } },
          { label: 'I', cmd: 'italic',    style: { fontStyle: 'italic' } },
          { label: 'U', cmd: 'underline', style: { textDecoration: 'underline' } },
        ].map(b => (
          <button key={b.cmd} onMouseDown={e => { e.preventDefault(); toolbar(b.cmd) }}
            style={{ ...btnStyle, ...b.style }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >{b.label}</button>
        ))}
        <Sep />
        {(['h1','h2','h3'] as const).map(h => (
          <button key={h} onMouseDown={e => { e.preventDefault(); toolbar('formatBlock', `<${h}>`) }}
            style={{ ...btnStyle, fontSize: h === 'h1' ? 14 : h === 'h2' ? 12.5 : 11 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >{h.toUpperCase()}</button>
        ))}
        <Sep />
        <button onMouseDown={e => { e.preventDefault(); toolbar('insertOrderedList') }} style={btnStyle}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >1.</button>
        <button onMouseDown={e => { e.preventDefault(); toolbar('insertUnorderedList') }} style={btnStyle}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >•—</button>
        <Sep />
        <button onMouseDown={e => { e.preventDefault(); toolbar('formatBlock', '<p>') }} style={btnStyle}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >¶</button>
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onClick={onEditorClick}
        data-placeholder="Begin met typen..."
        style={{
          minHeight: 480, outline: 'none', fontSize: 15, lineHeight: 1.75,
          color: 'var(--text-secondary)', padding: '16px 0',
        }}
      />

      {/* Floating selection toolbar */}
      {selToolbar && !composeOpen && (
        <button onMouseDown={e => e.preventDefault()} onClick={startComposeFromSelection}
          style={{
            position: 'fixed', top: selToolbar.y, left: selToolbar.x,
            transform: 'translate(-50%, -100%)',
            background: 'var(--text-primary)', color: 'var(--bg-base)',
            border: 'none', borderRadius: 8,
            padding: '6px 12px', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', zIndex: 200,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            display: 'flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap',
          }}>
          + Comment
        </button>
      )}

      {/* Compose popup */}
      {composeOpen && (
        <>
          <div onClick={() => setComposeOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(0,0,0,0.35)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 251, background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 12,
            padding: 16, width: 400, maxWidth: '92vw',
            boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Nieuwe opmerking</h3>
              <button onClick={() => setComposeOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                <IconClose size={16} />
              </button>
            </div>
            <div style={{ background: 'rgba(255,230,100,0.25)', borderLeft: '3px solid var(--sup-yellow)', padding: '8px 10px', borderRadius: 4, marginBottom: 10, fontSize: 13, color: 'var(--text-secondary)', maxHeight: 80, overflowY: 'auto' }}>
              {composeQuote}
            </div>
            <MentionTextarea autoFocus value={composeBody}
              onChange={setComposeBody}
              onMentionsChange={setComposeMentions}
              onSubmit={submitComment}
              placeholder="Schrijf een opmerking… (typ @ om iemand te taggen, ⌘+Enter om te plaatsen)"
              rows={3} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setComposeOpen(false)}
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Annuleer
              </button>
              <button onClick={submitComment} disabled={!composeBody.trim()}
                style={{ padding: '7px 14px', borderRadius: 7, border: 'none',
                  background: composeBody.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                  color: composeBody.trim() ? '#fff' : 'var(--text-muted)',
                  fontSize: 13, fontWeight: 700,
                  cursor: composeBody.trim() ? 'pointer' : 'not-allowed' }}>
                Plaats opmerking
              </button>
            </div>
          </div>
        </>
      )}

      {/* Comment popup */}
      {openCommentId && activeComment && openCommentPos && (
        <>
          <div onClick={closeComment}
            style={{ position: 'fixed', inset: 0, zIndex: 240 }} />
          <div style={{
            position: 'fixed', top: openCommentPos.y, left: openCommentPos.x,
            transform: 'translateX(-50%)',
            zIndex: 241, background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 10,
            padding: 14, width: 320, maxWidth: '92vw',
            boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {activeComment.thread.length} opmerking{activeComment.thread.length === 1 ? '' : 'en'}
              </span>
              <button onClick={resolveComment} title="Afgehandeld"
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 8px', color: 'var(--green)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <IconCheck size={12} /> Afhandelen
              </button>
            </div>
            <div style={{ background: 'rgba(255,230,100,0.25)', borderLeft: '3px solid var(--sup-yellow)', padding: '6px 9px', borderRadius: 4, marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)', maxHeight: 60, overflowY: 'auto' }}>
              {activeComment.quote}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10, maxHeight: 240, overflowY: 'auto' }}>
              {activeComment.thread.map(r => (
                <CommentReplyView key={r.id} reply={r} getPhoto={getPhoto}
                  currentMemberId={profile?.memberId}
                  onToggleReaction={emoji => {
                    if (!profile?.memberId) return
                    const updated = {
                      ...activeComment,
                      thread: activeComment.thread.map(x => x.id === r.id ? toggleReaction(x, emoji, profile.memberId!) : x),
                    }
                    saveComment(updated)
                    setActiveComment(updated)
                  }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <MentionTextarea value={replyDraft}
                onChange={setReplyDraft}
                onMentionsChange={setReplyMentions}
                onSubmit={addReply}
                placeholder="Reageer… (typ @ om te taggen)"
                rows={1} />
              <button onClick={addReply} disabled={!replyDraft.trim()}
                style={{ padding: '6px 11px', borderRadius: 6, border: 'none',
                  background: replyDraft.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                  color: replyDraft.trim() ? '#fff' : 'var(--text-muted)',
                  fontSize: 12, fontWeight: 600,
                  cursor: replyDraft.trim() ? 'pointer' : 'not-allowed' }}>
                Plaats
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          pointer-events: none;
        }
        [contenteditable] h1 { font-size: 28px; font-weight: 900; margin: 24px 0 8px; letter-spacing: -0.04em; color: var(--text-primary); }
        [contenteditable] h2 { font-size: 22px; font-weight: 700; margin: 20px 0 6px; letter-spacing: -0.03em; color: var(--text-primary); }
        [contenteditable] h3 { font-size: 17px; font-weight: 700; margin: 16px 0 4px; color: var(--text-primary); }
        [contenteditable] p  { margin: 0 0 10px; }
        [contenteditable] ul, [contenteditable] ol { padding-left: 24px; margin: 0 0 10px; }
        [contenteditable] li { margin-bottom: 4px; }
        [contenteditable] hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
        [contenteditable] mark.cm {
          background: rgba(255, 230, 100, 0.45);
          color: inherit;
          padding: 1px 0;
          border-radius: 2px;
          cursor: pointer;
          transition: background 0.15s;
        }
        [contenteditable] mark.cm:hover {
          background: rgba(255, 230, 100, 0.75);
        }
      `}</style>
    </div>
  )
}

// ─── Comment reply view ───────────────────────────────────────────────────────
function CommentReplyView({ reply, getPhoto, currentMemberId, onToggleReaction }: {
  reply: CommentReply
  getPhoto: (id: string) => string | null
  currentMemberId?: string
  onToggleReaction?: (emoji: string) => void
}) {
  const photo = reply.authorId ? getPhoto(reply.authorId) : null
  const initials = reply.author.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const dt = new Date(reply.createdAt)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
      {photo ? (
        <img src={photo} alt="" style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
      ) : (
        <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: 'var(--accent-light)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700 }}>
          {initials || '?'}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{reply.author}</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            {dt.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} · {dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {reply.body}
        </div>
        {onToggleReaction && (
          <ReactionRow reactions={reply.reactions} currentMemberId={currentMemberId} onToggle={onToggleReaction} />
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
  borderRadius: 5, color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'inherit',
}
function Sep() {
  return <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
}
