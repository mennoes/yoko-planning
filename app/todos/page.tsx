'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { useProfile } from '@/components/ProfileContext'
import { useMemberPopup } from '@/components/MemberPopup'
import { useUndo } from '@/components/UndoContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { IconCheckList, IconComment } from '@/components/Icon'
import initialData from '@/data/todos.json'
import teamData    from '@/data/team.json'
import yokoRaw       from '@/data/boards/yoko.json'
import pnpRaw        from '@/data/boards/pnp.json'
import nederlandRaw  from '@/data/boards/nederland.json'
import vlaanderenRaw from '@/data/boards/vlaanderen.json'
import dienjaarRaw   from '@/data/boards/dienjaar.json'
import { loadGroups } from '@/lib/boardStore'
import { BOARD_COLORS } from '@/lib/workload'
import { TextWithItemRefs } from '@/components/ItemRefChip'
import type { BoardGroup } from '@/lib/boards'
import {
  loadCommentsFor, saveComment, onCommentsUpdate,
  newCommentId, toggleReaction, type CommentThread,
} from '@/lib/commentsStore'
import { createNotification } from '@/lib/notificationsStore'
import { MentionTextarea } from '@/components/MentionTextarea'
import { ReactionRow } from '@/components/ReactionRow'

import {
  loadSections as loadTodoSections,
  saveSections as saveTodoSections,
  onTodosUpdate,
  pullFromRemote as pullTodos,
  pushToRemote   as pushTodos,
  subscribeRemoteTodos,
  type Section, type TodoItem, type ProjectLink,
} from '@/lib/todosStore'

const RAW: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw,
  vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
}

const MEMBER_IDS = new Set(teamData.members.map(m => m.id))

function loadAllProjects(): ProjectLink[] {
  if (typeof window === 'undefined') return []
  const out: ProjectLink[] = []
  for (const [board, raw] of Object.entries(RAW)) {
    const groups = loadGroups(board, raw.groups as BoardGroup[])
    for (const g of groups) for (const item of g.items) {
      if (!item.name) continue
      out.push({ board, itemId: item.id, name: item.name })
    }
  }
  return out
}

// Verzamel de open Monday-projecten waar `memberId` eigenaar van is:
// niet-Google items met status ≠ 'Done'. Wordt gebruikt door de
// auto-seed van de eigen to-do-sectie zodat nieuwe projecten meteen
// als te-doen item verschijnen zonder dat de gebruiker ze handmatig
// hoeft te koppelen.
function loadMyOpenProjects(memberId: string): ProjectLink[] {
  if (typeof window === 'undefined' || !memberId) return []
  const today = new Date().toISOString().slice(0, 10)
  const out: ProjectLink[] = []
  for (const [board, raw] of Object.entries(RAW)) {
    const groups = loadGroups(board, raw.groups as BoardGroup[])
    for (const g of groups) {
      if ((g.name ?? '').toLowerCase() === 'done') continue  // Done-groep skippen
      for (const item of g.items) {
        if (!item.name) continue
        if (item.source === 'google') continue
        if ((item.status ?? '').toLowerCase() === 'done') continue
        if (!item.ownerIds?.includes(memberId)) continue
        // Past-due items skippen — niet meer toevoegen als auto-todo.
        const end = item.endDate ?? item.startDate
        if (end && end < today) continue
        out.push({ board, itemId: item.id, name: item.name })
      }
    }
  }
  return out
}

// Verzamel alle project-items die "voorbij" zijn voor de to-do-lijst:
//   - status = 'Done', of
//   - de eind-datum ligt al in het verleden (en het item heeft tenminste
//     een datum), of
//   - de groep waar 't in zit heet 'Done' (sommige imports gebruiken een
//     vertaalde status zoals 'Klaar', maar de groep is wel Done).
// Zo verdwijnen oude items vanzelf uit Menno's persoonlijke kaart zonder
// dat hij ze allemaal moet aanvinken.
function loadDoneProjectKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const out = new Set<string>()
  const today = new Date().toISOString().slice(0, 10)
  for (const [board, raw] of Object.entries(RAW)) {
    const groups = loadGroups(board, raw.groups as BoardGroup[])
    for (const g of groups) {
      const groupIsDone = (g.name ?? '').toLowerCase() === 'done'
      for (const item of g.items) {
        if (groupIsDone) { out.add(`${board}:${item.id}`); continue }
        if ((item.status ?? '').trim() === 'Done') { out.add(`${board}:${item.id}`); continue }
        const end = (item.endDate ?? item.startDate) as string | null | undefined
        if (end && end < today) out.add(`${board}:${item.id}`)
      }
    }
  }
  return out
}

// Onthoud welke project-id's we al een keer als auto-todo hebben
// toegevoegd, zodat een eenmaal door de gebruiker verwijderde todo
// niet bij elke pageload terugkeert. Per-device (localStorage) is hier
// genoeg — als je 'm op telefoon weghaalt en op laptop wilt terugzien,
// kun je 'm daar handmatig toevoegen via '+ Voeg toe'.
const SEEDED_KEY = 'yoko-todos-seeded-projects'
function loadSeededProjectIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(SEEDED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}
function saveSeededProjectIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(SEEDED_KEY, JSON.stringify([...ids])) } catch {}
}
function fmtRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)    return 'zojuist'
  if (diff < 60)   return `${diff}m geleden`
  if (diff < 1440) return `${Math.floor(diff / 60)}u geleden`
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

const INITIAL_SECTIONS: Section[] = initialData.sections as Section[]
const loadSections = () => loadTodoSections(INITIAL_SECTIONS)
const saveSections = (s: Section[]) => saveTodoSections(s)

// ─── Member avatar ─────────────────────────────────────────────────────────────
function MemberAvatar({ memberId, size = 28 }: { memberId: string; size?: number }) {
  const { getPhoto }  = useTeamPhotos()
  const { profile }   = useProfile()
  const { showMember } = useMemberPopup()
  const member        = teamData.members.find(m => m.id === memberId)
  const isMe          = profile?.memberId === memberId
  const photo         = isMe ? (profile?.photo ?? getPhoto(memberId)) : getPhoto(memberId)
  const [staticFailed, setStaticFailed] = useState(false)
  const staticSrc     = `/team/${memberId}.jpg`
  const initials      = member?.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '?'
  const color         = member?.color ?? '#888'
  const style: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%',
    objectFit: 'cover', flexShrink: 0, cursor: 'pointer',
  }

  if (photo)          return <img src={photo} alt={member?.name} style={style} onClick={e => showMember(memberId, e)} title="Klik voor profiel" />
  if (!staticFailed)  return <img src={staticSrc} alt={member?.name} style={style} onError={() => setStaticFailed(true)} onClick={e => showMember(memberId, e)} title="Klik voor profiel" />
  return (
    <span
      style={{ ...style, border: `1px solid var(--border)`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: color + '22', fontSize: size * 0.36, fontWeight: 700, color }}
      onClick={e => showMember(memberId, e)} title="Klik voor profiel"
    >
      {initials}
    </span>
  )
}

// ─── Reorder arrow button style ───────────────────────────────────────────────
function reorderArrowBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'var(--bg-hover)', border: '1px solid var(--border)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12, fontWeight: 700, lineHeight: 1,
    padding: '4px 9px', borderRadius: 5, flexShrink: 0,
    opacity: disabled ? 0.4 : 1,
    minHeight: 28, minWidth: 28,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
}

// ─── Todo card ─────────────────────────────────────────────────────────────────
function TodoCard({
  section, isMember, onUpdate, allProjects, doneProjectKeys,
  editOrder, isFirstCard, isLastCard, onMoveCard,
}: {
  section: Section
  isMember: boolean
  onUpdate: (s: Section, prev?: Section) => void
  allProjects: ProjectLink[]
  doneProjectKeys: Set<string>
  editOrder: boolean
  isFirstCard: boolean
  isLastCard: boolean
  onMoveCard: (dir: -1 | 1) => void
}) {
  const [newText, setNewText] = useState('')
  const [editId,  setEditId]  = useState<string | null>(null)
  const [editTxt, setEditTxt] = useState('')
  const [pickerIdx, setPickerIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Onthouden welk item we slepen — gevuld door TodoRow.onDragStart en
  // door TodoRow.onDropOnIdx weer leeggemaakt. We gebruiken een ref omdat
  // dataTransfer in sommige browsers (Firefox) tijdens dragover de
  // payload nog niet leesbaar maakt; een ref blijft binnen 't tabblad.
  const dragFromRef = useRef<number | null>(null)
  const [popPos, setPopPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const member = teamData.members.find(m => m.id === section.id)
  const { showMember } = useMemberPopup()

  // Slash-picker: when the user types "/", the input becomes a project search.
  // The text after the slash filters the list. Selecting a project adds a
  // todo that's linked to it (visible as a chip on the row).
  const isSearchMode  = newText.startsWith('/')
  const searchTerm    = isSearchMode ? newText.slice(1).trim().toLowerCase() : ''
  const matches       = isSearchMode
    ? allProjects.filter(p => !searchTerm || p.name.toLowerCase().includes(searchTerm)).slice(0, 8)
    : []
  useEffect(() => { setPickerIdx(0) }, [newText])

  // Bereken popup-positie op basis van het input-veld zodat de dropdown
  // niet door overflow:hidden van de kaart wordt geclipt.
  useEffect(() => {
    if (!isSearchMode || !inputRef.current) { setPopPos(null); return }
    const compute = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      setPopPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [isSearchMode])

  function moveItem(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= section.items.length) return
    const items = [...section.items]
    items[idx] = items[next]; items[next] = section.items[idx]
    onUpdate({ ...section, items })
  }
  // Splice-based reorder voor drag-and-drop — verplaats item van fromIdx
  // naar toIdx, alle items ertussen schuiven netjes op. Geen swap zoals
  // bij de up/down-knoppen, dus je kunt een item meerdere posities ineens
  // verschuiven.
  function moveItemTo(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= section.items.length) return
    if (toIdx   < 0 || toIdx   >  section.items.length) return
    const items = [...section.items]
    const [picked] = items.splice(fromIdx, 1)
    items.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, picked)
    onUpdate({ ...section, items })
  }

  function toggle(id: string) {
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: section.items.map(i => i.id === id ? { ...i, done: !i.done } : i) }, prev)
  }
  function add() {
    if (!newText.trim()) return
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: [...section.items, { id: Date.now().toString(), text: newText.trim(), done: false }] }, prev)
    setNewText('')
  }
  function addLinked(p: ProjectLink) {
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: [...section.items, {
      id: Date.now().toString(), text: p.name, done: false,
      projectRef: { board: p.board, itemId: p.itemId, name: p.name },
    }]}, prev)
    setNewText('')
  }
  function remove(id: string) {
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: section.items.filter(i => i.id !== id) }, prev)
  }
  function saveEdit(id: string) {
    if (!editTxt.trim()) return
    const prev = { ...section, items: [...section.items] }
    onUpdate({ ...section, items: section.items.map(i => i.id === id ? { ...i, text: editTxt } : i) }, prev)
    setEditId(null)
  }

  // Gekoppelde todo's waarvan het project op Done staat (of voorbij is)
  // halen we VOLLEDIG uit de lijst — niet in open én niet in 'afgerond',
  // gewoon weg. Handmatig afgevinkte todo-notes blijven wel in 'afgerond'.
  const isAutoDone = (i: TodoItem) => !!i.projectRef && doneProjectKeys.has(`${i.projectRef.board}:${i.projectRef.itemId}`)
  const visible = section.items.filter(i => !isAutoDone(i))
  const open    = visible.filter(i => !i.done)
  const done    = visible.filter(i =>  i.done)

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 9 }}>
        {isMember && member ? (
          <MemberAvatar memberId={section.id} size={28} />
        ) : (
          <span style={{ fontSize: 17 }}>{section.emoji}</span>
        )}
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0, flex: 1, letterSpacing: '-0.01em' }}>
          {isMember && member ? (
            <span onClick={e => showMember(section.id, e)}
              title="Klik voor profiel"
              style={{ cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-primary)')}>
              {section.title}
            </span>
          ) : section.title}
        </h2>
        {editOrder ? (
          <>
            <button onClick={() => onMoveCard(-1)} disabled={isFirstCard} title="Omhoog"
              style={reorderArrowBtn(isFirstCard)}>↑</button>
            <button onClick={() => onMoveCard(1)} disabled={isLastCard} title="Omlaag"
              style={reorderArrowBtn(isLastCard)}>↓</button>
          </>
        ) : open.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderRadius: 10, padding: '1px 7px' }}>{open.length}</span>
        )}
      </div>

      {/* Open items */}
      <ul style={{ listStyle: 'none', padding: '6px 0 0', margin: 0 }}>
        {open.map((item, openIdx) => {
          const itemIdx = section.items.findIndex(i => i.id === item.id)
          return (
            <TodoRow key={item.id} item={item} memberId={section.id} isMember={isMember}
              editing={editId === item.id} editTxt={editTxt}
              editOrder={editOrder}
              isFirstItem={openIdx === 0}
              isLastItem={openIdx === open.length - 1}
              onMoveUp={() => moveItem(itemIdx, -1)}
              onMoveDown={() => moveItem(itemIdx, 1)}
              onToggle={() => toggle(item.id)}
              onRemove={() => remove(item.id)}
              onEditStart={() => { setEditId(item.id); setEditTxt(item.text) }}
              onEditChange={setEditTxt}
              onEditSave={() => saveEdit(item.id)}
              onEditCancel={() => setEditId(null)}
              dragIdx={itemIdx}
              onDragStart={(from) => { dragFromRef.current = from }}
              onDropOnIdx={(target) => {
                const from = dragFromRef.current
                if (from == null) return
                dragFromRef.current = null
                moveItemTo(from, target)
              }}
              onDragEnd={() => { dragFromRef.current = null }}
            />
          )
        })}
      </ul>

      {/* Done items (collapsed) */}
      {done.length > 0 && (
        <details style={{ padding: '0 0 4px' }}>
          <summary style={{ listStyle: 'none', padding: '5px 16px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            ✓ {done.length} afgerond
          </summary>
          <ul style={{ listStyle: 'none', padding: '2px 0', margin: 0 }}>
            {done.map(item => (
              <TodoRow key={item.id} item={item} memberId={section.id} isMember={isMember}
                editing={false} editTxt=""
                editOrder={false} isFirstItem={true} isLastItem={true}
                onMoveUp={() => {}} onMoveDown={() => {}}
                onToggle={() => toggle(item.id)} onRemove={() => remove(item.id)}
                onEditStart={() => {}} onEditChange={() => {}} onEditSave={() => {}} onEditCancel={() => {}}
              />
            ))}
          </ul>
        </details>
      )}

      {/* Add — type "/" to pick an existing project from any agenda */}
      <div style={{ padding: '6px 16px 12px', position: 'relative' }}>
        <input ref={inputRef}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => {
            if (isSearchMode) {
              if (e.key === 'Enter')      { const p = matches[pickerIdx]; if (p) addLinked(p) }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIdx(i => Math.min(matches.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp')   { e.preventDefault(); setPickerIdx(i => Math.max(0, i - 1)) }
              else if (e.key === 'Escape')    setNewText('')
            } else if (e.key === 'Enter') {
              add()
            }
          }}
          placeholder="+ Voeg toe of typ / om een project te koppelen"
          style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid transparent', color: 'var(--text-muted)', fontSize: 14.3, padding: '4px 0', outline: 'none', boxSizing: 'border-box' }}
          onFocus={e => { e.currentTarget.style.borderBottomColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          onBlur={e => { e.currentTarget.style.borderBottomColor = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
        />
        {isSearchMode && popPos && typeof document !== 'undefined' && createPortal(
          <div style={{
            position: 'fixed', top: popPos.top, left: popPos.left, width: popPos.width,
            zIndex: 9100,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.08)',
            maxHeight: 280, overflowY: 'auto', padding: 4,
          }}>
            {matches.length === 0 ? (
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Geen matches</div>
            ) : matches.map((p, i) => (
              <button key={`${p.board}__${p.itemId}`}
                onMouseDown={e => { e.preventDefault(); addLinked(p) }}
                onMouseEnter={() => setPickerIdx(i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 5, textAlign: 'left',
                  background: i === pickerIdx ? 'var(--bg-hover)' : 'transparent',
                  border: 'none', cursor: 'pointer', fontSize: 13,
                  color: 'var(--text-primary)',
                }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: BOARD_COLORS[p.board] ?? '#888', flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>{p.board}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}

function TodoRow({ item, isMember, memberId, editing, editTxt, editOrder, isFirstItem, isLastItem, onMoveUp, onMoveDown, onToggle, onRemove, onEditStart, onEditChange, onEditSave, onEditCancel, dragIdx, onDragStart, onDropOnIdx, onDragEnd }: {
  item: TodoItem; isMember: boolean; memberId: string
  editing: boolean; editTxt: string
  editOrder: boolean
  isFirstItem: boolean
  isLastItem: boolean
  onMoveUp: () => void; onMoveDown: () => void
  onToggle: () => void; onRemove: () => void
  onEditStart: () => void; onEditChange: (v: string) => void; onEditSave: () => void; onEditCancel: () => void
  // Drag-and-drop reorder (optioneel — alleen open items binnen één
  // sectie gebruiken dit; voor afgeronde items blijven de props weg).
  dragIdx?: number          // de globale item-index op de sectie
  onDragStart?: (idx: number) => void
  onDropOnIdx?: (targetIdx: number) => void
  onDragEnd?:   () => void
}) {
  const member = teamData.members.find(m => m.id === memberId)
  const color  = member?.color ?? 'var(--accent)'
  const [dropHover, setDropHover] = useState(false)
  const draggable = isMember && !editing && !editOrder && typeof dragIdx === 'number' && !!onDragStart

  // Comment count badge — refreshes when the threads change.
  const [commentCount, setCommentCount] = useState(0)
  const [showComments, setShowComments] = useState(false)
  useEffect(() => {
    const refresh = () => {
      const threads = loadCommentsFor('todo:' + item.id)
      setCommentCount(threads.reduce((s, t) => s + t.thread.length, 0))
    }
    refresh()
    return onCommentsUpdate(refresh)
  }, [item.id])

  return (
    <li
      draggable={draggable}
      onDragStart={e => {
        if (!draggable || typeof dragIdx !== 'number') return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-yoko-todo', String(dragIdx))
        onDragStart?.(dragIdx)
      }}
      onDragEnter={e => {
        if (!onDropOnIdx) return
        if (!e.dataTransfer.types.includes('application/x-yoko-todo')) return
        setDropHover(true)
      }}
      onDragOver={e => {
        if (!onDropOnIdx) return
        if (!e.dataTransfer.types.includes('application/x-yoko-todo')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={e => {
        setDropHover(false)
        if (!onDropOnIdx || typeof dragIdx !== 'number') return
        const raw = e.dataTransfer.getData('application/x-yoko-todo')
        if (!raw) return
        e.preventDefault()
        onDropOnIdx(dragIdx)
      }}
      onDragEnd={() => { setDropHover(false); onDragEnd?.() }}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 14px', position: 'relative',
        cursor: draggable ? 'grab' : undefined,
        borderTop: dropHover ? '2px solid var(--accent)' : '2px solid transparent',
        background: dropHover ? 'var(--accent-light)' : 'transparent',
        transition: 'background 0.1s' }}
      onMouseEnter={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (btn) btn.style.opacity = '1' }}
      onMouseLeave={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (btn) btn.style.opacity = '0' }}
    >
      <button onClick={onToggle} style={{ width: 16, height: 16, minWidth: 16, borderRadius: 4, border: item.done ? 'none' : '2px solid var(--border)', background: item.done ? color : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2, padding: 0, flexShrink: 0 }}>
        {item.done && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {editing ? (
          <input autoFocus value={editTxt} onChange={e => onEditChange(e.target.value)}
            onBlur={onEditSave}
            onKeyDown={e => { if (e.key === 'Enter') onEditSave(); if (e.key === 'Escape') onEditCancel() }}
            style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-primary)', fontSize: 16, outline: 'none' }} />
        ) : (
          <span onDoubleClick={editOrder ? undefined : onEditStart} style={{ fontSize: 16, color: item.done ? 'var(--text-muted)' : 'var(--text-secondary)', textDecoration: item.done ? 'line-through' : 'none', cursor: editOrder ? 'default' : 'text', lineHeight: 1.4, flex: '1 1 auto', minWidth: 0 }}>
            <TextWithItemRefs text={item.text} compact />
          </span>
        )}
        {item.projectRef && (
          <Link href={`/projects/${item.projectRef.board}`}
            title={`Open ${item.projectRef.board}-agenda`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '1px 7px', borderRadius: 10,
              background: (BOARD_COLORS[item.projectRef.board] ?? '#888') + '22',
              border: `1px solid ${BOARD_COLORS[item.projectRef.board] ?? '#888'}55`,
              fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
              textDecoration: 'none', flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: BOARD_COLORS[item.projectRef.board] ?? '#888' }} />
            {item.projectRef.board}
          </Link>
        )}
      </div>
      {!editOrder && (
        <button onClick={() => setShowComments(true)}
          title={commentCount > 0 ? `${commentCount} opmerking${commentCount === 1 ? '' : 'en'}` : 'Plaats opmerking'}
          style={commentCount > 0 ? {
            // Met opmerkingen → felle 'pill' zodat je 'm in de lijst herkent
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 9px', borderRadius: 999,
            background: 'var(--accent-light)',
            border: '1px solid var(--accent)',
            color: 'var(--text-primary)',
            fontSize: 11.5, fontWeight: 700,
            cursor: 'pointer', flexShrink: 0, lineHeight: 1,
          } : {
            // Geen opmerkingen → discrete iconen-knop alleen op hover prominent
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 12, padding: '2px 5px', borderRadius: 6, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 3,
            opacity: 0.45,
          }}>
          <IconComment size={commentCount > 0 ? 14 : 16} strokeWidth={1.7} />
          {commentCount > 0 && <span style={{ minWidth: 8, textAlign: 'center' }}>{commentCount}</span>}
        </button>
      )}
      {editOrder ? (
        <>
          <button onClick={onMoveUp} disabled={isFirstItem} title="Omhoog" style={reorderArrowBtn(isFirstItem)}>↑</button>
          <button onClick={onMoveDown} disabled={isLastItem} title="Omlaag" style={reorderArrowBtn(isLastItem)}>↓</button>
        </>
      ) : (
        <button className="del-btn" onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', opacity: 0, flexShrink: 0 }}>×</button>
      )}
      {showComments && <TodoCommentModal todoId={item.id} todoText={item.text} onClose={() => setShowComments(false)} />}
    </li>
  )
}

// ─── Comment thread modal ─────────────────────────────────────────────────────
function TodoCommentModal({ todoId, todoText, onClose }: {
  todoId: string; todoText: string; onClose: () => void
}) {
  const { profile } = useProfile()
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [newReply, setNewReply] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])

  useEffect(() => {
    const refresh = () => setThreads(loadCommentsFor('todo:' + todoId))
    refresh()
    return onCommentsUpdate(refresh)
  }, [todoId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const thread = threads[0]
  const replies = thread?.thread ?? []

  function addReply() {
    const body = newReply.trim()
    if (!body) return
    const reply = {
      id:        newCommentId(),
      author:    profile?.name ?? 'Iemand',
      authorId:  profile?.memberId,
      body,
      createdAt: new Date().toISOString(),
    }
    if (thread) {
      saveComment({ ...thread, thread: [...thread.thread, reply] })
    } else {
      saveComment({
        id:        newCommentId(),
        contextId: 'todo:' + todoId,
        quote:     todoText,
        thread:    [reply],
        resolved:  false,
        createdAt: new Date().toISOString(),
      })
    }
    // Notificatie per @mention. We sturen 'm naar elke unieke member_id
    // die in de tekst voorkwam (de afzender wordt automatisch overgeslagen
    // in createNotification).
    for (const rid of mentionIds) {
      createNotification({
        recipientId: rid,
        actorId:     profile?.memberId ?? null,
        kind:        'mention',
        contextKind: 'todo',
        contextId:   todoId,
        href:        '/todos',
        body:        body.length > 90 ? body.slice(0, 90) + '…' : body,
      }).catch(() => {})
    }
    setNewReply('')
    setMentionIds([])
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, backdropFilter: 'blur(4px)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(440px, 92vw)', maxHeight: '80vh', zIndex: 9001,
        background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Opmerkingen</div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.3 }}>{todoText}</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px' }}>
          {replies.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', margin: '8px 0' }}>Nog geen opmerkingen.</p>
          ) : replies.map(r => (
            <div key={r.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{r.author}</strong>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{fmtRelative(r.createdAt)}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45 }}>
                <TextWithItemRefs text={r.body} compact />
              </div>
              {profile?.memberId && thread && (
                <ReactionRow
                  reactions={r.reactions}
                  currentMemberId={profile.memberId}
                  onToggle={emoji => {
                    const updatedReply = toggleReaction(r, emoji, profile.memberId!)
                    saveComment({
                      ...thread,
                      thread: thread.thread.map(x => x.id === r.id ? updatedReply : x),
                    })
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <MentionTextarea
            value={newReply}
            onChange={setNewReply}
            onMentionsChange={setMentionIds}
            onSubmit={addReply}
            placeholder="Schrijf een opmerking… (typ @ om iemand te taggen, Cmd+Enter om te plaatsen)"
            rows={2}
          />
          <button onClick={addReply} disabled={!newReply.trim()}
            style={{ padding: '8px 14px', borderRadius: 6, border: 'none',
              background: newReply.trim() ? 'var(--accent)' : 'var(--bg-hover)',
              color: newReply.trim() ? '#000' : 'var(--text-muted)',
              fontSize: 12.5, fontWeight: 700, cursor: newReply.trim() ? 'pointer' : 'not-allowed',
              alignSelf: 'flex-end' }}>
            Plaats
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function TodosPage() {
  const { pushUndo } = useUndo()
  const isMobile     = useIsMobile()
  const { profile: currentProfile } = useProfile()
  const [sections, setSections] = useState<Section[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [editOrder, setEditOrder] = useState(false)
  const [allProjects, setAllProjects] = useState<ProjectLink[]>([])
  const [doneProjectKeys, setDoneProjectKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSections(loadSections())
    setAllProjects(loadAllProjects())
    setDoneProjectKeys(loadDoneProjectKeys())
    setHydrated(true)

    // Sync met Supabase: pull, en als er nog niks staat seed met de lokale
    // cache; subscribe op realtime mutaties zodat een vinkje in browser A
    // direct in browser B verschijnt.
    pullTodos().then(remote => {
      if (remote) {
        setSections(remote)
        saveTodoSections(remote)  // ververst localStorage zonder push-loop
      } else {
        // Remote empty → upload de huidige (localStorage) staat
        const local = loadSections()
        if (local.length > 0) pushTodos(local).catch(() => {})
      }
    }).catch(() => {})

    const offRemote = subscribeRemoteTodos()
    const offEvent  = onTodosUpdate(() => setSections(loadSections()))
    const onBoardUpdate = () => {
      setAllProjects(loadAllProjects())
      setDoneProjectKeys(loadDoneProjectKeys())
    }
    window.addEventListener('yoko-board-update', onBoardUpdate)
    return () => {
      offRemote(); offEvent()
      window.removeEventListener('yoko-board-update', onBoardUpdate)
    }
  }, [])

  // ── Seed Socials/Reminders/Kansen secties + missende items ────────────────
  // Twee stappen in één migratie:
  //  1. Bestaat een sectie nog niet? Insert 'm met al z'n initiële items.
  //  2. Bestaat-ie wel, maar mist 'r items uit de seed? Voeg de ontbrekende
  //     items achteraan toe, met behoud van wat er al stond (en de
  //     done-state van bestaande items). Vergelijking case-insensitive op
  //     tekst zodat we geen duplicates maken als de gebruiker handmatig
  //     'Flinders' had toegevoegd. Idempotent.
  useEffect(() => {
    if (!hydrated || sections.length === 0) return
    const seedSections = initialData.sections as Section[]
    const wantedIds = ['socials', 'reminders', 'kansen']
    let changed = false
    let next = sections.slice()

    for (const wantedId of wantedIds) {
      const seed = seedSections.find(s => s.id === wantedId)
      if (!seed) continue
      const existing = next.find(s => s.id === wantedId)
      if (!existing) {
        // Hele sectie ontbreekt → toevoegen na 'ideeen' (of aan het eind).
        const ideeenIdx = next.findIndex(s => s.id === 'ideeen')
        const insertAt  = ideeenIdx >= 0 ? ideeenIdx + 1 : next.length
        next = [...next.slice(0, insertAt), seed, ...next.slice(insertAt)]
        changed = true
        continue
      }
      // Sectie bestaat — voeg missende items toe (vergelijken op normalisatie
      // van tekst zodat 'HEY U' en 'hey u' niet allebei verschijnen).
      const norm = (s: string) => s.trim().toLowerCase()
      const existingTexts = new Set(existing.items.map(i => norm(i.text)))
      const missingItems = seed.items.filter(i => !existingTexts.has(norm(i.text)))
      if (missingItems.length === 0) continue
      next = next.map(s => s.id === wantedId ? { ...s, items: [...s.items, ...missingItems] } : s)
      changed = true
    }

    if (!changed) return
    setSections(next)
    saveTodoSections(next)
  }, [hydrated, sections])

  // ── Auto-seed open Monday-projecten in mijn to-do-sectie ────────────────────
  // Niet-Google items waar ik eigenaar van ben en die nog niet Done zijn,
  // verschijnen automatisch als gekoppelde todo in mijn eigen kaart. De
  // 'seeded'-set in localStorage onthoudt welke ik al een keer heb gezien
  // — zo komt een verwijderde auto-todo niet bij elke pageload terug.
  // Projecten die ik al handmatig had gekoppeld (via '+ Voeg toe') tellen
  // ook als 'gezien'.
  useEffect(() => {
    const me = currentProfile?.memberId
    if (!me || !hydrated || sections.length === 0 || allProjects.length === 0) return
    const mySection = sections.find(s => s.id === me)
    if (!mySection) return

    const seeded = loadSeededProjectIds()
    const mine   = loadMyOpenProjects(me)
    const existingItemIds = new Set(
      mySection.items
        .map(i => i.projectRef?.itemId)
        .filter((x): x is string => !!x)
    )

    // Markeer ook handmatig-gekoppelde projecten als 'gezien', anders
    // zouden ze na verwijdering opnieuw als auto-todo terugkeren.
    const nextSeeded = new Set(seeded)
    for (const p of mine) {
      if (existingItemIds.has(p.itemId)) nextSeeded.add(`${p.board}:${p.itemId}`)
    }

    const toAdd = mine.filter(p => {
      const key = `${p.board}:${p.itemId}`
      if (nextSeeded.has(key))         return false
      if (existingItemIds.has(p.itemId)) return false
      return true
    })
    for (const p of toAdd) nextSeeded.add(`${p.board}:${p.itemId}`)
    if (nextSeeded.size !== seeded.size) saveSeededProjectIds(nextSeeded)
    if (toAdd.length === 0) return

    const newItems: TodoItem[] = toAdd.map((p, idx) => ({
      id: `auto-${Date.now()}-${idx}`,
      text: p.name,
      done: false,
      projectRef: { board: p.board, itemId: p.itemId, name: p.name },
    }))
    const nextSections = sections.map(s =>
      s.id === me ? { ...s, items: [...s.items, ...newItems] } : s
    )
    setSections(nextSections)
    saveTodoSections(nextSections)
  }, [currentProfile?.memberId, hydrated, sections, allProjects])

  function updateSection(updated: Section, prev?: Section) {
    const next = sections.map(s => s.id === updated.id ? updated : s)
    setSections(next)
    saveSections(next)
    if (prev) {
      pushUndo(() => {
        const reverted = sections.map(s => s.id === prev.id ? prev : s)
        setSections(reverted)
        saveSections(reverted)
      })
    }
  }

  function moveCard(sectionId: string, dir: -1 | 1) {
    const idx = sections.findIndex(s => s.id === sectionId)
    if (idx < 0) return
    const target = sections[idx]
    const isMember = MEMBER_IDS.has(target.id)
    // Find neighbour within the same group (general vs personal)
    const groupIndices = sections
      .map((s, i) => ({ i, member: MEMBER_IDS.has(s.id) }))
      .filter(x => x.member === isMember)
      .map(x => x.i)
    const posInGroup = groupIndices.indexOf(idx)
    const nextPos    = posInGroup + dir
    if (nextPos < 0 || nextPos >= groupIndices.length) return
    const swapWith = groupIndices[nextPos]
    const next = [...sections]
    next[idx] = sections[swapWith]; next[swapWith] = target
    setSections(next)
    saveSections(next)
  }

  const general  = sections.filter(s => !MEMBER_IDS.has(s.id))
  // Persoonlijke todo's: jouw eigen kaart komt altijd vooraan zodat je hem
  // direct ziet zonder te scrollen. Daarna volgt de vaste team-volgorde
  // (Odette, Vincent, Menno, Anne-Fleur, Kars, …) ipv de json-volgorde.
  const PERSONAL_ORDER = ['odette', 'vincent', 'menno', 'anne-fleur', 'kars', 'take-lijzenga']
  const orderIdx = (id: string) => {
    const i = PERSONAL_ORDER.indexOf(id)
    return i >= 0 ? i : 999
  }
  const personal = sections.filter(s => MEMBER_IDS.has(s.id))
    .sort((a, b) => {
      const me = currentProfile?.memberId
      if (a.id === me) return -1
      if (b.id === me) return 1
      return orderIdx(a.id) - orderIdx(b.id)
    })

  if (!hydrated) return null

  return (
    <div style={{ maxWidth: 1900, padding: isMobile ? '60px 16px 60px' : '44px 36px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isMobile ? 20 : 32 }}>
        <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.03em', flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconCheckList size={isMobile ? 22 : 28} />
          To do&apos;s
        </h1>
        <button onClick={() => setEditOrder(o => !o)}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: editOrder ? 'var(--accent)' : 'var(--bg-card)',
            color: editOrder ? '#fff' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
          {editOrder ? 'Klaar' : 'Volgorde'}
        </button>
      </div>

      {isMobile ? (() => {
        // Op mobiel: alle persoonlijke kaarten stacken we volledig onder
        // elkaar (eigen kaart bovenaan). De horizontale scroll-rij die
        // hier eerder stond werkte averechts — Odette's kaart viel af aan
        // de rechterkant, gebruikers moesten extra swipen om collega's
        // te zien. Stacking is voorspelbaarder en matched het desktop-
        // gedrag dichter.
        const me     = personal[0]
        const others = personal.slice(1)
        return (
          <>
            {me && (
              <div style={{ marginBottom: 14 }}>
                <TodoCard section={me} isMember={true} onUpdate={updateSection}
                  allProjects={allProjects}
                  doneProjectKeys={doneProjectKeys}
                  editOrder={editOrder}
                  isFirstCard={true}
                  isLastCard={others.length === 0 && general.length === 0}
                  onMoveCard={dir => moveCard(me.id, dir)} />
              </div>
            )}

            {others.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 24 }}>
                {others.map((s, i) => (
                  <TodoCard key={s.id} section={s} isMember={true} onUpdate={updateSection}
                    allProjects={allProjects}
                    doneProjectKeys={doneProjectKeys}
                    editOrder={editOrder}
                    isFirstCard={i === 0}
                    isLastCard={i === others.length - 1 && general.length === 0}
                    onMoveCard={dir => moveCard(s.id, dir)} />
                ))}
              </div>
            )}

            {general.length > 0 && personal.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Algemeen</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              {general.map((s, i) => (
                <TodoCard key={s.id} section={s} isMember={false} onUpdate={updateSection}
                  allProjects={allProjects}
                  doneProjectKeys={doneProjectKeys}
                  editOrder={editOrder}
                  isFirstCard={i === 0}
                  isLastCard={i === general.length - 1}
                  onMoveCard={dir => moveCard(s.id, dir)} />
              ))}
            </div>
          </>
        )
      })() : (() => {
        // Desktop: ALLE algemene kaarten samen in één grid boven personal,
        // zodat Socials/Reminders/Kansen direct naast Komend/Ideeën staan.
        // Wat niet in de eerste regel past wrapt vanzelf naar de tweede.
        const cols = Math.max(1, personal.length)
        return (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: 12, alignItems: 'start', marginBottom: 28,
            }}>
              {general.map((s, i) => (
                <TodoCard key={s.id} section={s} isMember={false} onUpdate={updateSection}
                  allProjects={allProjects}
                  doneProjectKeys={doneProjectKeys}
                  editOrder={editOrder}
                  isFirstCard={i === 0}
                  isLastCard={i === general.length - 1}
                  onMoveCard={dir => moveCard(s.id, dir)} />
              ))}
            </div>

            {general.length > 0 && personal.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Persoonlijk</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
            )}

            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: 12, alignItems: 'start',
            }}>
              {personal.map((s, i) => (
                <TodoCard key={s.id} section={s} isMember={true} onUpdate={updateSection}
                  allProjects={allProjects}
                  doneProjectKeys={doneProjectKeys}
                  editOrder={editOrder}
                  isFirstCard={i === 0}
                  isLastCard={i === personal.length - 1}
                  onMoveCard={dir => moveCard(s.id, dir)} />
              ))}
            </div>
          </>
        )
      })()}
    </div>
  )
}
