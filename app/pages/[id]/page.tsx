'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { loadPage, savePage, type PageDoc } from '@/lib/pagesStore'

const EMOJIS = ['📄','📝','📌','🗒','💡','🔖','📋','🗂','📊','🎨','🚀','⭐']

function toolbar(cmd: string, val?: string) {
  document.execCommand(cmd, false, val)
}

export default function PageEditor() {
  const params = useParams()
  const id     = String(params.id)

  const [doc,     setDoc]     = useState<PageDoc | null>(null)
  const [status,  setStatus]  = useState<'saved' | 'saving' | 'new'>('new')
  const [emoji,   setEmoji]   = useState('📄')
  const [title,   setTitle]   = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const editorRef  = useRef<HTMLDivElement>(null)
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const createdAt = doc?.createdAt ? new Date(doc.createdAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

  return (
    <div style={{ maxWidth: 740, margin: '0 auto', padding: '52px 36px 120px' }}>

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
        data-placeholder="Begin met typen..."
        style={{
          minHeight: 480, outline: 'none', fontSize: 15, lineHeight: 1.75,
          color: 'var(--text-secondary)', padding: '16px 0',
        }}
      />

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
      `}</style>
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
