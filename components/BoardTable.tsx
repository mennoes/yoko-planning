'use client'

import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
// Note: bewust GEEN useSearchParams uit next/navigation — die zet de hele
// pagina in CSR-bailout en breekt `next build` voor de dynamische
// /projects/[slug] route. We zijn 'use client', dus window.location is
// veilig.
import teamData from '@/data/team.json'
import type { BoardItem, BoardGroup, ColumnDef, SubItem } from '@/lib/boards'
import { setBoardColumns } from '@/lib/boardsRegistry'
import { useProfile }     from './ProfileContext'
import { useTeamPhotos }  from './TeamPhotosContext'
import { useTeam }        from './TeamContext'
import { useUndo }        from './UndoContext'
import Link from 'next/link'
import { GoogleBadge }    from './GoogleBadge'
import { IconComment, IconSearch, IconActivity, IconHistory } from './Icon'
import { BoardTrashDrawer } from './BoardTrashDrawer'
import { createNotification } from '@/lib/notificationsStore'
import { logItemActivity }    from '@/lib/itemActivity'
import {
  loadCommentsFor, saveComment, newCommentId, onCommentsUpdate,
  toggleReaction, type CommentThread,
} from '@/lib/commentsStore'
import { addRule as addSubitemRule } from '@/lib/subitemRules'
import { softDeleteItem, pullBoardFromRemote } from '@/lib/boardStore'
import { supabase } from '@/lib/supabase'
import { MentionTextarea } from './MentionTextarea'
import { ReactionRow }     from './ReactionRow'
import { useIsMobile }     from '@/lib/useIsMobile'
import { DistributionPie } from './DistributionPie'
import { autoMoveDoneItems } from '@/lib/doneAutoMove'
import { BoardActivityDrawer } from './BoardActivityDrawer'
import { BoardRecoveryDrawer } from './BoardRecoveryDrawer'

// Cache van het lopende profiel zodat helpers buiten een hook ook de
// actor-id kunnen meegeven aan een notification.
let currentActorId: string | null = null
function setCurrentActor(id: string | null) { currentActorId = id }

// Notificeer alle owners (behalve de actor zelf) wanneer de status van
// een item verandert + log in de item-geschiedenis.
function notifyOwnersOfStatusChange(item: BoardItem, fromStatus: string, toStatus: string, boardOverride?: string) {
  if (fromStatus === toStatus) return
  logItemActivity(item.id, 'zette status', `${fromStatus || '—'} → ${toStatus || '—'}`,
    { field: 'status', before: fromStatus, after: toStatus, boardId: boardOverride, itemName: item.name }).catch(() => {})
  const owners = (item.ownerIds ?? []).filter(id => id && id !== 'unassigned')
  for (const rid of owners) {
    if (rid === currentActorId) continue
    createNotification({
      recipientId: rid,
      actorId:     currentActorId,
      kind:        'comment',
      contextKind: 'board_item',
      contextId:   item.id,
      href:        boardOverride ? `/projects/${boardOverride}` : undefined,
      body:        `Status: ${toStatus || '—'} (was ${fromStatus || '—'}) · ${item.name}`,
    }).catch(() => {})
  }
}

// ─── Status opties ────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { label: '',              color: ''        },
  { label: 'Working on...', color: '#ff7b24' },
  { label: 'Done',          color: '#00c875' },
  { label: 'Stuck',         color: '#e2445c' },
  { label: 'Not started',   color: '#808080' },
  { label: 'Doorlopend',    color: '#579bfc' },
]

// ─── Groep kleurenpalet ───────────────────────────────────────────────────────
const PALETTE = [
  '#579bfc','#0086c0','#9c7ee8','#784bd1','#e2445c','#bb3354','#ff642e',
  '#ff7a00','#ffcb00','#cab641','#00c875','#037f4c','#ff5ac4','#9aadbd',
]

// ─── Groep context (kleur) ────────────────────────────────────────────────────
const GroupCtx = createContext<{ color: string }>({ color: '#579bfc' })

// ─── Datum helpers ────────────────────────────────────────────────────────────
const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getDate()} ${NL_MON[dt.getMonth()]}.`
}

function fmtRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return ''
  if (!start) return `→ ${fmtDate(end)}`
  if (!end)   return fmtDate(start)
  const d1 = new Date(start), d2 = new Date(end)
  if (d1.getMonth() === d2.getMonth())
    return `${NL_MON[d1.getMonth()]}. ${d1.getDate()} – ${d2.getDate()}`
  return `${d1.getDate()} ${NL_MON[d1.getMonth()]}. – ${d2.getDate()} ${NL_MON[d2.getMonth()]}.`
}

// ─── Portal-dropdown (ontsnapt aan overflow: hidden van de tabel) ─────────────
function PortalDropdown({ anchor, onClose, children }: {
  anchor:  React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const [pos, setPos]           = useState({ top: 0, left: 0 })
  const [ready, setReady]       = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function place() {
      if (!anchor.current || !dropRef.current) return
      const r = anchor.current.getBoundingClientRect()
      const d = dropRef.current.getBoundingClientRect()
      const margin = 8
      // Bij voorkeur ONDER de anchor; als 't niet past flippen we erboven.
      // Als 't ook erboven niet past, kleven we tegen de bovenrand met margin.
      let top = r.bottom + 3
      const wouldOverflowBottom = top + d.height + margin > window.innerHeight
      if (wouldOverflowBottom) {
        const flipped = r.top - d.height - 3
        top = flipped >= margin ? flipped : Math.max(margin, window.innerHeight - d.height - margin)
      }
      // Horizontaal: standaard links uitgelijnd; als rechts overflowt, schuif
      // naar links zodat het volledige paneel zichtbaar is.
      let left = r.left
      if (left + d.width + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - d.width - margin)
      }
      if (left < margin) left = margin
      setPos({ top, left })
      setReady(true)
    }
    // Eerst hidden renderen om de échte grootte te meten, dan plaatsen.
    place()
    // Herplaatsen bij resize / scroll zodat 't zichtbaar blijft als de
    // viewport verandert terwijl de popup open is.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    function onDown(e: MouseEvent) {
      if (!dropRef.current?.contains(e.target as Node) &&
          !anchor.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (typeof window === 'undefined') return null
  return createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
      visibility: ready ? 'visible' : 'hidden',
      maxHeight: `calc(100vh - 16px)`, overflowY: 'auto',
    }}>
      {children}
    </div>,
    document.body
  )
}

// ─── Generieke bewerkbare cel (single-click) ──────────────────────────────────
// Custom est-cel voor items met subitems (of pro-rated). Toont 't
// totaal (own + subs) in displaymodus, opent een input met alléén de
// 'own'-waarde in editmodus zodat de gebruiker z'n extra-uren los van
// de rollup kan invullen. Geen tekstuele hint — de display IS de som.
function EstHoursSummedCell({ own, ownEdit, subsSum, isProrated, onChange }: {
  own:        number    // huidige display-waarde van item.estHours (kan pro-rated zijn)
  ownEdit?:   number    // waarde die in de input verschijnt (= origineel)
  subsSum:    number    // som van subitem.estHours (kan pro-rated zijn)
  isProrated?: boolean
  onChange: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const editV = ownEdit ?? own
  function start() { setDraft(editV ? String(editV) : ''); setEditing(true) }
  function save()  { onChange(parseFloat(draft) || 0); setEditing(false) }
  const round = (n: number) => Math.round(n * 10) / 10
  const total = round(own + subsSum)
  if (editing) return (
    <input autoFocus type="number" value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
      style={editInput} />
  )
  return (
    <div onClick={start}
      title={isProrated
        ? `Periode-fractie · klik om de echte item-uren te wijzigen (${editV}u)`
        : (own > 0 ? `Eigen ${own}u + ${subsSum}u uit subs = ${total}u` : `${subsSum}u uit subs`)}
      style={{
        padding: '0 4px', cursor: 'pointer', fontSize: 13,
        color: total > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
        fontStyle: isProrated ? 'italic' : 'normal',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        userSelect: 'none', width: '100%',
      }}>
      {total > 0 ? total : '—'}
    </div>
  )
}

// Cell die in pro-rated mode 't eerlijk-verdeelde display-getal toont,
// maar bij klik de ECHTE (originele) waarde in de input zet zodat de
// gebruiker tegen z'n eigen invoer schrijft en niet tegen de
// pro-rated-fractie. Buiten pro-rated mode = gewone numeric cell.
function ProRatableNumberCell({ displayValue, editValue, isProrated, onChange }: {
  displayValue: number
  editValue:    number
  isProrated:   boolean
  onChange: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  function start() { setDraft(editValue ? String(editValue) : ''); setEditing(true) }
  function save()  { onChange(parseFloat(draft) || 0); setEditing(false) }
  const round = (n: number) => Math.round(n * 10) / 10
  if (editing) return (
    <input autoFocus type="number" value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
      style={editInput} />
  )
  return (
    <div onClick={start}
      title={isProrated ? `Periode-fractie van ${editValue}u — klik om de echte uren te wijzigen` : undefined}
      style={{ padding: '0 4px', cursor: 'pointer', fontSize: 13,
        color: displayValue ? 'var(--text-secondary)' : 'var(--text-muted)',
        fontStyle: isProrated ? 'italic' : 'normal',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        userSelect: 'none', width: '100%' }}>
      {displayValue ? round(displayValue) : '—'}
    </div>
  )
}

function EditableCell({
  value, inputType, onChange,
}: {
  value:     string | number | null | undefined
  inputType: 'text' | 'number' | 'date' | 'url'
  onChange:  (v: string | number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')

  function start() { setDraft(value?.toString() ?? ''); setEditing(true) }
  function save()  {
    if (inputType === 'number') onChange(parseFloat(draft) || 0)
    else if (inputType === 'date') onChange(draft || null)
    else onChange(draft)
    setEditing(false)
  }

  const display = inputType === 'date' ? fmtDate(value as string) : value

  if (editing) return (
    <input autoFocus
      type={inputType === 'url' ? 'text' : inputType}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
      style={editInput}
    />
  )

  return (
    <div onClick={start} style={{
      padding: '0 4px', cursor: 'pointer', fontSize: 13,
      color: display ? 'var(--text-secondary)' : 'var(--text-muted)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      userSelect: 'none', width: '100%',
    }} title={display?.toString() ?? ''}>
      {display?.toString() || '—'}
    </div>
  )
}

// ─── Status cel ───────────────────────────────────────────────────────────────
function StatusCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const opt = STATUS_OPTIONS.find(s => s.label === value) ?? STATUS_OPTIONS[0]

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* Vol-cel status-tag: vult de hele rij-cel met de status-kleur
          zodat de kolom in één oogopslag visueel scant. Geen rond pilletje
          meer met witruimte eromheen. */}
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative',
          width: '100%', height: '100%',
          padding: '0 10px', borderRadius: 0, cursor: 'pointer', border: 'none',
          background: opt.color || 'var(--overlay-medium)',
          color: opt.color ? '#fff' : 'var(--text-muted)',
          fontSize: 12.5, fontWeight: opt.color ? 600 : 400, lineHeight: 1.15,
          whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
        {value || '—'}
        {/* Monday-stijl hover-driehoekje in de rechterbovenhoek: signaleert
            'klikbaar — verander mij'. CSS-driehoek via transparente borders. */}
        {hover && (
          <span aria-hidden style={{
            position: 'absolute', top: 0, right: 0,
            width: 0, height: 0, pointerEvents: 'none',
            borderTop: '10px solid rgba(255,255,255,0.55)',
            borderLeft: '10px solid transparent',
          }} />
        )}
      </button>

      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 4, minWidth: 168,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}>
            {STATUS_OPTIONS.map(o => (
              <button key={o.label || '_'} onClick={() => { onChange(o.label); setOpen(false) }} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '7px 10px', borderRadius: 4,
                background: 'transparent', border: 'none',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
              }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: o.color || 'var(--border)' }} />
                {o.label || '(geen status)'}
              </button>
            ))}
          </div>
        </PortalDropdown>
      )}
    </div>
  )
}

// ─── Share-knop ───────────────────────────────────────────────────────────────
// Toggle-button die een PortalDropdown opent met de publieke share-URL en
// een copy-knop. Alleen op borden waar de server `/api/share/[board]` data
// voor teruggeeft (whitelist daar parallel). De popup legt ook uit wat
// een externe lezer NIET ziet — zo weet de gebruiker waar 'ie tegenover
// staat voordat-ie de link verstuurt.
function ShareButton({ boardId, isMobile }: { boardId: string; isMobile: boolean }) {
  const [open, setOpen]     = useState(false)
  const [copied, setCopied] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/share/${boardId}` : `/share/${boardId}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        title="Deel: genereer een publieke read-only link"
        aria-label="Deel"
        style={{ padding: '7px 9px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: open ? 'var(--accent-light)' : 'var(--bg-card)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          color: open ? 'var(--accent)' : 'var(--text-secondary)',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Standaard share-icoon: box met pijl-omhoog uit de bovenkant. */}
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>
      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 14, width: 340,
            boxShadow: '0 12px 32px rgba(0,0,0,0.32)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Deelbare read-only link
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
              Iedereen met deze URL kan dit bord zonder login bekijken.
              Notities, contactgegevens, uren-inschattingen en deadlines
              worden niet getoond.
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input readOnly value={url}
                onFocus={e => e.currentTarget.select()}
                style={{ flex: 1, padding: '6px 10px', borderRadius: 6,
                  border: '1px solid var(--border-light)', background: 'var(--bg-base)',
                  color: 'var(--text-primary)', fontSize: 11.5, outline: 'none', fontFamily: 'inherit' }} />
              <button onClick={copy}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none',
                  background: copied ? 'var(--accent)' : 'var(--bg-hover)',
                  color: copied ? '#fff' : 'var(--text-primary)',
                  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                  transition: 'background 0.15s' }}>
                {copied ? '✓ Gekopieerd' : 'Kopieer'}
              </button>
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer' }}>
              Open in nieuwe tab →
            </a>
          </div>
        </PortalDropdown>
      )}
    </>
  )
}

// ─── Owners cel ───────────────────────────────────────────────────────────────
function MemberAvatar({ id, size = 24 }: { id: string; size?: number }) {
  const { profile }    = useProfile()
  const { getPhoto }   = useTeamPhotos()
  const { members: liveTeam } = useTeam()
  // Eerst kijken in live team_members (Supabase), valt terug op
  // data/team.json voor pre-migratie / legacy ids. Zonder deze
  // dual-lookup verscheen 'r geen avatar voor leden die alleen via
  // /team-admin zijn toegevoegd (zoals Manuel).
  const liveMember = liveTeam.find(t => t.id === id)
  const seedMember = teamData.members.find(t => t.id === id)
  const m = liveMember
    ? { id: liveMember.id, name: liveMember.name, color: liveMember.color }
    : seedMember
  if (!m) return null
  const isMe    = profile?.memberId === id
  const photo   = isMe ? (profile?.photo ?? getPhoto(id)) : getPhoto(id)
  const fallback = `/team/${id}.jpg`
  const initials = m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  if (photo) {
    return (
      <img src={photo} alt={m.name} title={m.name} style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${m.color}`, objectFit: 'cover',
      }} />
    )
  }
  return (
    <span title={m.name} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: m.color + '30', border: `2px solid ${m.color}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: m.color,
      position: 'relative', overflow: 'hidden',
    }}>
      <img src={fallback} alt={m.name}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
      {initials}
    </span>
  )
}

function OwnersCell({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const trigRef = useRef<HTMLDivElement>(null)
  const { profile } = useProfile()
  const { members: liveTeam } = useTeam()
  // Bron-lijst: live team_members uit Supabase aangevuld met data/team.json
  // voor leden die nog niet in de DB staan. Zo verschijnen Manuel + andere
  // via /team-admin toegevoegde leden direct als owner-optie zonder dat
  // de hardcoded teamData.json hoeft te worden bijgewerkt.
  const team = (() => {
    const seen = new Set<string>()
    const out: Array<{ id: string; name: string; color?: string }> = []
    for (const m of liveTeam) {
      if (m.hidden) continue
      seen.add(m.id)
      out.push({ id: m.id, name: m.name, color: m.color })
    }
    for (const m of teamData.members) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      out.push({ id: m.id, name: m.name, color: m.color })
    }
    return out
  })()
  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter(x => x !== id))
      return
    }
    // Bij assignen automatisch 'unassigned' eruit gooien — anders blijft een
    // item zowel een echte owner als 'niemand toegewezen' tegelijk dragen,
    // wat de werkdruk-distributie en filter-chips door de war stuurt.
    const next = id === 'unassigned'
      ? [...value, id]
      : [...value.filter(x => x !== 'unassigned'), id]
    onChange(next)
  }

  // Yoko-collega's altijd bovenaan met grotere foto's zodat aanwijzen makkelijk
  // is. Freelancers / externe contactpersonen verschijnen pas wanneer je
  // begint te typen in het zoekveld eronder. Yoko-classificatie loopt nu
  // via team_members.kind (met fallback op de hardcoded set).
  const HARDCODED_YOKO = new Set(['menno','vincent','odette','anne-fleur','kars'])
  function isYokoCrew(id: string): boolean {
    const fromDb = liveTeam.find(m => m.id === id)?.kind
    if (fromDb) return fromDb === 'yoko'
    return HARDCODED_YOKO.has(id)
  }
  const yokoMembers   = team.filter(m => isYokoCrew(m.id))
  const otherMembers  = team.filter(m => !isYokoCrew(m.id))
  const q             = query.trim().toLowerCase()
  const matchedOthers = q
    ? otherMembers.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    : []

  return (
    <div>
      <div ref={trigRef} onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{ display: 'flex', gap: 2, cursor: 'pointer', flexWrap: 'nowrap', minWidth: 24 }}>
        {value.length === 0
          ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</span>
          : value.map(id => <MemberAvatar key={id} id={id} size={34} />)
        }
      </div>

      {open && (
        <PortalDropdown anchor={trigRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 6, minWidth: 240,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}>
            {yokoMembers.map(m => {
              const active = value.includes(m.id)
              const isMe   = profile?.memberId === m.id
              return (
                <button key={m.id} onClick={() => toggle(m.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '7px 8px', borderRadius: 6,
                  background: active ? m.color + '22' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, textAlign: 'left',
                }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                  <MemberAvatar id={m.id} size={32} />
                  <span style={{ fontWeight: active ? 700 : 500 }}>
                    {m.name}{isMe ? ' (jij)' : ''}
                  </span>
                  {active && <span style={{ marginLeft: 'auto', color: m.color, fontSize: 13, fontWeight: 700 }}>✓</span>}
                </button>
              )
            })}

            <div style={{ height: 1, background: 'var(--border-light)', margin: '6px 4px 6px' }} />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Zoek freelancer of contact…"
              style={{ width: '100%', boxSizing: 'border-box',
                padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border-light)', background: 'var(--bg-base)',
                color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />

            {/* Externe leden: alleen tonen bij actieve match, of toon
                geselecteerde externen altijd zodat je 'm kunt deselecteren. */}
            {(() => {
              const showSelected = otherMembers.filter(m => value.includes(m.id) && !matchedOthers.find(o => o.id === m.id))
              const list = [...matchedOthers, ...showSelected]
              if (list.length === 0) {
                if (q) return <div style={{ padding: '8px 8px 4px', fontSize: 12, color: 'var(--text-muted)' }}>Geen match.</div>
                return null
              }
              return (
                <div style={{ marginTop: 4 }}>
                  {list.map(m => {
                    const active = value.includes(m.id)
                    return (
                      <button key={m.id} onClick={() => toggle(m.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '6px 8px', borderRadius: 6,
                        background: active ? m.color + '22' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
                      }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                        <MemberAvatar id={m.id} size={24} />
                        <span style={{ fontWeight: active ? 600 : 400 }}>{m.name}</span>
                        {active && <span style={{ marginLeft: 'auto', color: m.color, fontSize: 12 }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </PortalDropdown>
      )}
    </div>
  )
}

// ─── Kalender helpers ─────────────────────────────────────────────────────────
const NL_MONTHS_LONG = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']
const NL_DAYS_SHORT  = ['ma','di','wo','do','vr','za','zo']

function buildCalGrid(year: number, month: number): (string | null)[] {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // ma = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function diffDays(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

const navBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', fontSize: 11, padding: '3px 8px',
  borderRadius: 4,
}

// ─── Kalender range picker ────────────────────────────────────────────────────
// Recent gekozen periodes (max 6) blijven persistent in localStorage zodat
// 'n gebruiker met één klik een vaak gebruikte range terug kan halen.
const RECENT_PERIODS_KEY = 'yoko:recentPeriods'
type RecentPeriod = { from: string; until: string; at: number }
function loadRecentPeriods(): RecentPeriod[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_PERIODS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as RecentPeriod[]
  } catch { return [] }
}
function pushRecentPeriod(from: string, until: string) {
  if (typeof window === 'undefined') return
  if (!from || !until) return
  const list = loadRecentPeriods().filter(r => !(r.from === from && r.until === until))
  list.unshift({ from, until, at: Date.now() })
  window.localStorage.setItem(RECENT_PERIODS_KEY, JSON.stringify(list.slice(0, 6)))
  window.dispatchEvent(new CustomEvent('yoko-recent-periods-update'))
}
function RecentPeriodsRow({ color, onPick }: { color: string; onPick: (from: string, until: string) => void }) {
  const [recents, setRecents] = useState<RecentPeriod[]>([])
  useEffect(() => {
    const refresh = () => setRecents(loadRecentPeriods())
    refresh()
    window.addEventListener('yoko-recent-periods-update', refresh)
    return () => window.removeEventListener('yoko-recent-periods-update', refresh)
  }, [])
  if (recents.length === 0) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
        Recent
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {recents.map(r => (
          <button key={`${r.from}_${r.until}`} onClick={() => onPick(r.from, r.until)}
            style={{ padding: '4px 9px', borderRadius: 999,
              border: '1px solid var(--border-light)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
            {fmtRange(r.from, r.until)}
          </button>
        ))}
      </div>
    </div>
  )
}

function RangeCalendar({
  startDate, endDate, color, onChange,
}: {
  startDate: string | null; endDate: string | null; color: string
  onChange: (s: string | null, e: string | null) => void
}) {
  const initD   = startDate ? new Date(startDate) : new Date()
  const [vy, setVy] = useState(initD.getFullYear())
  const [vm, setVm] = useState(initD.getMonth())
  const [selA, setSelA] = useState<string | null>(startDate)
  const [selB, setSelB] = useState<string | null>(endDate)
  const [phase, setPhase] = useState<'A' | 'B'>('A')
  const [hov,   setHov]   = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]

  const ordA = selA && selB ? (selA <= selB ? selA : selB) : selA
  const ordB = selA && selB ? (selA <= selB ? selB : selA) : selB

  const prevA = phase === 'B' && selA && hov ? (selA <= hov ? selA : hov) : null
  const prevB = phase === 'B' && selA && hov ? (selA <= hov ? hov : selA) : null
  const effA = prevA ?? ordA
  const effB = prevB ?? ordB

  const days = selA && selB ? diffDays(ordA!, ordB!) + 1 : null

  function clickDay(d: string) {
    if (phase === 'A') {
      setSelA(d); setSelB(null); setPhase('B')
    } else {
      const [s, e] = selA! <= d ? [selA!, d] : [d, selA!]
      setSelA(s); setSelB(e); setPhase('A')
      onChange(s, e)
    }
  }

  function prevMonth() { vm === 0 ? (setVm(11), setVy(y => y - 1)) : setVm(m => m - 1) }
  function nextMonth() { vm === 11 ? (setVm(0), setVy(y => y + 1)) : setVm(m => m + 1) }

  const cells = buildCalGrid(vy, vm)

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 16, minWidth: 290,
      boxShadow: '0 10px 36px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Datums instellen</span>
        {days !== null && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--overlay-medium)', padding: '2px 7px', borderRadius: 10 }}>
            {days} dag{days !== 1 ? 'en' : ''}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
        <input type="date" value={selA ?? ''}
          onChange={e => { setSelA(e.target.value || null); if (selB) onChange(e.target.value || null, selB) }}
          style={{ ...editInput, flex: 1 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>→</span>
        <input type="date" value={selB ?? ''}
          onChange={e => { setSelB(e.target.value || null); if (selA) onChange(selA, e.target.value || null) }}
          style={{ ...editInput, flex: 1 }} />
      </div>

      {/* Snelkeuzes: hele maand selecteren met één klik. Vorige/Deze/
          Volgende dekt de meeste planning-vragen ('wat staat er deze
          maand?'). Stelt 1ste t/m laatste dag in, scrollt kalender mee. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([
          { label: 'Vorige maand', offset: -1 },
          { label: 'Deze maand',   offset:  0 },
          { label: 'Volgende maand', offset: 1 },
        ] as const).map(({ label, offset }) => (
          <button key={label} onClick={() => {
            const ref = new Date()
            ref.setDate(1)
            ref.setMonth(ref.getMonth() + offset)
            const y = ref.getFullYear(), m = ref.getMonth()
            const first = `${y}-${String(m + 1).padStart(2, '0')}-01`
            const lastDay = new Date(y, m + 1, 0).getDate()
            const last  = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
            setSelA(first); setSelB(last); setPhase('A')
            setVy(y); setVm(m)
            onChange(first, last)
          }}
            style={{ flex: 1, padding: '5px 8px', borderRadius: 6,
              border: '1px solid var(--border-light)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              transition: 'all 0.1s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Recent gebruikte periodes — bewaard in localStorage onder
          yoko:recentPeriods. Tot 4 chips zodat 'n veelgebruikte range
          met 1 klik herstelbaar is zonder opnieuw te kiezen. */}
      <RecentPeriodsRow color={color} onPick={(s, e) => {
        setSelA(s); setSelB(e); setPhase('A')
        const d = new Date(s); setVy(d.getFullYear()); setVm(d.getMonth())
        onChange(s, e)
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={prevMonth} style={navBtnStyle}>◀</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {NL_MONTHS_LONG[vm]} {vy}
        </span>
        <button onClick={nextMonth} style={navBtnStyle}>▶</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 3 }}>
        {NL_DAYS_SHORT.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e-${i}`} style={{ height: 30 }} />
          const day    = parseInt(cell.split('-')[2])
          const isS    = cell === effA
          const isE    = cell === effB
          const inRng  = effA && effB && cell > effA && cell < effB
          const isTdy  = cell === today
          const isEdge = isS || isE
          return (
            <div key={cell}
              onClick={() => clickDay(cell)}
              onMouseEnter={() => setHov(cell)}
              onMouseLeave={() => setHov(null)}
              style={{
                height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, cursor: 'pointer', userSelect: 'none',
                borderRadius: isEdge ? 6 : 0,
                background: isEdge ? color : inRng ? color + '28' : 'transparent',
                color: isEdge ? '#fff' : isTdy ? color : inRng ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isEdge || isTdy ? 700 : 400,
                outline: isTdy && !isEdge ? `1px solid ${color}55` : undefined,
                outlineOffset: '-2px',
                transition: 'background 0.08s',
              }}>
              {day}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => { setSelA(null); setSelB(null); setPhase('A'); onChange(null, null) }}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
          Wissen
        </button>
        {phase === 'B' && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Klik einddatum</span>
        )}
      </div>
    </div>
  )
}

// ─── DateRange cel — pill + calendar picker ───────────────────────────────────
function DateRangeCell({
  startDate, endDate, onChange,
}: {
  startDate: string | null; endDate: string | null
  onChange: (s: string | null, e: string | null) => void
}) {
  const { color } = useContext(GroupCtx)
  const [open, setOpen]   = useState(false)
  const [hover, setHover] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const today   = new Date().toISOString().split('T')[0]
  const isLate  = !!endDate && endDate < today
  const hasAny  = startDate || endDate
  const pillClr = isLate ? '#e2445c' : color

  // Inclusieve dagen tussen start en eind. Monday-stijl toont 'Xd' bij
  // hover. Voor week+ groeperen we naar 'Yw Zd' zodat lange ranges
  // niet als '83d' verschijnen.
  function durationLabel(): string | null {
    if (!startDate) return null
    const s = new Date(startDate).getTime()
    const e = new Date(endDate ?? startDate).getTime()
    const days = Math.round((e - s) / 86400000) + 1
    if (days <= 0) return null
    if (days < 7)   return `${days}d`
    const w = Math.floor(days / 7)
    const d = days - w * 7
    return d === 0 ? `${w}w` : `${w}w ${d}d`
  }

  // Progress bar: how far we are through the project's timeline.
  // 0% = before start, 100% = at/past end. Late items fill 100% in red.
  let progress = 1
  if (startDate && endDate && !isLate) {
    const s = new Date(startDate).getTime()
    const e = new Date(endDate).getTime() + 86400000  // include the end day
    const n = Date.now()
    if (n < s) progress = 0
    else if (n >= e) progress = 1
    else progress = (n - s) / (e - s)
  }
  const progressPct = Math.round(progress * 100)

  const dur = durationLabel()
  const showDuration = hover && hasAny && !!dur

  return (
    <div style={{ width: '100%' }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative', overflow: 'hidden',
          width: '100%', textAlign: 'left', cursor: 'pointer',
          border: hasAny ? `1px solid ${pillClr}55` : 'none',
          borderRadius: 999, padding: '5px 14px',
          background: hasAny ? pillClr + '22' : 'transparent',
          display: 'flex', alignItems: 'center', gap: 5, minHeight: 30,
        }}>
        {hasAny && (
          <span style={{
            position: 'absolute', inset: 0, width: `${progressPct}%`,
            background: pillClr + 'cc', borderRadius: 999,
            transition: 'width 0.4s ease', pointerEvents: 'none', zIndex: 0,
          }} />
        )}
        {hasAny ? (
          <>
            {isLate && !showDuration && (
              <span style={{
                position: 'relative', zIndex: 1,
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                background: 'rgba(0,0,0,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 900, color: '#fff',
              }}>!</span>
            )}
            <span title={`${progressPct}% verstreken · ${dur ?? ''}`}
              style={{ position: 'relative', zIndex: 1, fontSize: 13, fontWeight: 600,
                color: progressPct > 35 ? '#fff' : 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1, textAlign: 'center',
                textShadow: progressPct > 35 ? '0 1px 1px rgba(0,0,0,0.2)' : 'none' }}>
              {showDuration ? dur : fmtRange(startDate, endDate)}
            </span>
            {showDuration && (
              <span onClick={ev => { ev.stopPropagation(); onChange(null, null) }}
                title="Datums wissen"
                style={{ position: 'relative', zIndex: 2,
                  width: 18, height: 18, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.35)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                  marginLeft: 2 }}>
                ×
              </span>
            )}
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
        )}
      </button>

      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <RangeCalendar
            startDate={startDate} endDate={endDate} color={color}
            onChange={(s, e) => onChange(s, e)}
          />
        </PortalDropdown>
      )}
    </div>
  )
}

// ─── URL cel ──────────────────────────────────────────────────────────────────
function UrlCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')

  if (editing) return (
    <input autoFocus type="text" value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onChange(draft); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
      style={editInput} />
  )

  if (!value) return (
    <span onClick={() => { setDraft(''); setEditing(true) }}
      style={{ fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>—</span>
  )

  return (
    <a href={value} target="_blank" rel="noopener noreferrer"
      style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none', whiteSpace: 'nowrap' }}
      onDoubleClick={e => { e.preventDefault(); setDraft(value); setEditing(true) }}>
      {value.replace(/^https?:\/\//, '')}
    </a>
  )
}

// ─── Effective hours/days helpers ─────────────────────────────────────────────
// When subitems exist they are the source of truth; the parent's stored
// estHours is ignored. Days are always derived from hours at 8h/day.
export function effectiveHours(item: BoardItem): number {
  // Totaal van 't item = de eigen ingevulde uren PLUS de som van alle
  // subitem-uren. Het item zelf kan dus extra werk hebben naast wat 'r
  // in de subs is opgesplitst. Bij geen subs (subs.length=0) telt
  // alleen item.estHours.
  const own  = Number(item.estHours) || 0
  const subs = (item.subitems ?? []).reduce((s, si) => s + (Number(si.estHours) || 0), 0)
  return own + subs
}
export function effectiveDays(item: BoardItem): number {
  return Math.round((effectiveHours(item) / 8) * 10) / 10
}

// ─── Pro-rated hours/days in een datum-window ────────────────────────────────
// Wanneer de gebruiker een periode-filter zet, wil het totaal alléén de uren
// optellen die binnen dat window vallen — niet de volledige itemduur. We
// pro-raten lineair: als een item 28 mrt – 24 mei (58 dagen, 20u) loopt en
// het filter is 1–31 mei, dan tellen we 24/58 × 20 ≈ 8.3u mee.
//
// Items met subitems behandelen we per subitem (zelfde pro-ratie). Items
// zonder timeline (geen startDate/endDate) tellen volledig mee — daar kunnen
// we geen window-overlap berekenen, maar ze horen wel bij het filter
// (anders waren ze niet in de result-set beland).
function daysInclusive(startISO: string | null | undefined, endISO: string | null | undefined): number {
  if (!startISO) return 0
  const start = Date.parse(startISO)
  const end   = endISO ? Date.parse(endISO) : start
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(1, Math.round((end - start) / 86400000) + 1)
}
function overlapDays(
  startISO: string | null | undefined, endISO: string | null | undefined,
  fromTs: number | null, untilTs: number | null,
): number {
  if (!startISO) return 0
  const start = Date.parse(startISO)
  const end   = endISO ? Date.parse(endISO) : start
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  const lo = fromTs  != null ? Math.max(start, fromTs)  : start
  const hi = untilTs != null ? Math.min(end,   untilTs) : end
  if (hi < lo) return 0
  return Math.round((hi - lo) / 86400000) + 1
}
// ─── Cel dispatcher ───────────────────────────────────────────────────────────
function Cell({ item, col, onUpdate }: {
  item: BoardItem; col: ColumnDef; onUpdate: (u: Partial<BoardItem>) => void
}) {
  if (col.type === 'owners')    return <OwnersCell    value={item.ownerIds} onChange={v => {
    // ownerIds én ownerHours samen consistent houden: verwijderde owner
    // mag geen stale uren-entry achterlaten (anders telt ie zomaar weer
    // mee zodra je 'm later opnieuw toevoegt of bij periode-pro-rate).
    if (item.ownerHours && Object.keys(item.ownerHours).length > 0) {
      const active = new Set(v)
      const cleaned: Record<string, number> = {}
      for (const [oid, hrs] of Object.entries(item.ownerHours)) {
        if (active.has(oid)) cleaned[oid] = hrs
      }
      const hasAny = Object.keys(cleaned).length > 0
      onUpdate({ ownerIds: v, ownerHours: hasAny ? cleaned : undefined })
    } else {
      onUpdate({ ownerIds: v })
    }
  }} />
  if (col.type === 'status')    return <StatusCell    value={item.status}   onChange={v => {
    onUpdate({ status: v })
    notifyOwnersOfStatusChange(item, item.status, v)
  }} />
  if (col.type === 'daterange') return <DateRangeCell startDate={item.startDate} endDate={item.endDate} onChange={(s,e) => onUpdate({ startDate: s, endDate: e })} />
  if (col.type === 'url')       return <UrlCell       value={(item[col.key] as string) ?? ''} onChange={v => onUpdate({ [col.key]: v })} />

  const hasSubs = (item.subitems?.length ?? 0) > 0

  // estHours: ook bij subitems én bij actief periode-filter is 't veld
  // bewerkbaar. We tonen 't TOTAAL = item.estHours + som-van-subs.
  // Bij klik op de cel komt de eigen waarde van item.estHours in een
  // input zodat de gebruiker die kan aanpassen — totaal beweegt mee.
  if (col.key === 'estHours' && hasSubs) {
    // Bij actief periode-filter zijn item.estHours en subitem.estHours
    // pro-rated. We tonen 't pro-rated totaal in de cel maar geven de
    // edit-input de ECHTE eigen waarde uit __originalEstHours zodat
    // typen tegen de echte uren werkt, niet tegen de fractie.
    const ownOrig = (item as { __originalEstHours?: number }).__originalEstHours
    const isProrated = typeof ownOrig === 'number'
    const ownEditValue = isProrated ? ownOrig! : (Number(item.estHours) || 0)
    const subsDisplaySum = (item.subitems ?? []).reduce((s, si) => s + (Number(si.estHours) || 0), 0)
    const ownDisplay = Number(item.estHours) || 0
    return (
      <EstHoursSummedCell
        own={ownDisplay}
        ownEdit={ownEditValue}
        subsSum={subsDisplaySum}
        isProrated={isProrated}
        onChange={v => onUpdate({ estHours: v })}
      />
    )
  }
  // dagen: always computed from estHours (or sum of subs), read-only.
  if (col.key === 'dagen') {
    const days = effectiveDays(item)
    return <span title="Auto: uren ÷ 8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{days || ''}</span>
  }

  return (
    <EditableCell
      value={item[col.key] as string | number | null}
      inputType={col.type === 'currency' ? 'number' : col.type as 'text' | 'number' | 'date'}
      onChange={v => onUpdate({ [col.key]: col.type === 'currency' ? (v as number) : v })}
    />
  )
}

// ─── Subitem grid template ────────────────────────────────────────────────────

// Converteer een SubItem naar een BoardItem-shape zodat we ItemDetailDrawer
// kunnen hergebruiken voor subitem-details. Velden die SubItem niet heeft
// (deadline, dagen, notes) blijven leeg.
function subitemAsItem(s: SubItem): BoardItem {
  return {
    id:           s.id,
    name:         s.name,
    ownerIds:     s.ownerIds ?? [],
    status:       s.status ?? '',
    startDate:    s.startDate ?? null,
    endDate:      s.endDate ?? null,
    deadline:     null,
    estHours:     s.estHours ?? 0,
    dagen:        0,
    source:       s.source,
    externalLink: s.externalLink ?? null,
    echtGewerkt:  s.echtGewerkt,
  } as BoardItem
}

// ─── Subitem rij ──────────────────────────────────────────────────────────────
function SubItemRow({ subitem, cols, gridTemplate, rail, selected, onToggleSelect, isLast, parentItemId, fromGroupId, parentExternalLink, onOpenDetail, defaultEditName, colWidths, onResizeCol, onUpdate, onDelete }: {
  subitem: SubItem; cols: ColumnDef[]; gridTemplate: string
  rail?: string
  selected?: boolean
  onToggleSelect?: () => void
  isLast?: boolean
  // Voor drag-to-unnest: we slepen de subitem naar een andere groep waar
  // 'ie als top-level item belandt. Bewaar parent + bron-groep in
  // dataTransfer zodat de drop-handler de juiste oudere kan strippen.
  parentItemId?: string
  fromGroupId?: string
  // Master-link van de recurring parent — fallback wanneer de subitem
  // zelf nog geen per-instance externalLink heeft (oude data).
  parentExternalLink?: string | null
  // Klik op naam → open detail-drawer met alle info, comments etc. De G-knop
  // links blijft naar Google leiden voor wie alleen het event wil openen.
  onOpenDetail?: () => void
  // Net-aangemaakt subitem? Start dan meteen in edit-mode voor de naam.
  defaultEditName?: boolean
  // Column-resize: gebruiker kan vanuit subitem-rijen kolommen verbreden/
  // versmallen, niet alleen vanaf de sticky header bovenaan.
  colWidths?: Record<string, number>
  onResizeCol?: (key: string, width: number) => void
  onUpdate: (u: Partial<SubItem>) => void; onDelete: () => void
}) {
  const [hover,     setHover]     = useState(false)
  const [editName,  setEditName]  = useState(!!defaultEditName)
  const [nameDraft, setNameDraft] = useState(defaultEditName ? '' : subitem.name)

  const cellBorder: React.CSSProperties = {
    borderLeft: '1px solid var(--border)', height: '100%', flex: 1, minWidth: 0,
    display: 'flex', alignItems: 'center', padding: '3px 8px', overflow: 'hidden',
  }

  // Render one subitem cell per parent column key. Columns the subitem
  // doesn't carry data for (deadline, dagen, custom fields) stay empty so
  // the row stays visually aligned with the parent grid.
  function renderCol(c: ColumnDef) {
    switch (c.key) {
      case 'owner':
      case 'ownerIds':
        return <div style={cellBorder}><OwnersCell value={subitem.ownerIds} onChange={v => onUpdate({ ownerIds: v })} /></div>
      case 'status':
        // Status: cell-border zonder padding/center zodat de status-tag
        // de volledige rij-hoogte van het subitem vult (visueel hetzelfde
        // gedrag als bij top-level items). alignSelf:stretch overruled
        // de alignItems:center van de grid-row zodat de pill écht uitvult.
        return <div style={{ borderLeft: '1px solid var(--border)', display: 'flex', alignItems: 'stretch', alignSelf: 'stretch', overflow: 'hidden', flex: 1, minWidth: 0 }}>
          <StatusCell value={subitem.status} onChange={v => onUpdate({ status: v })} />
        </div>
      case 'timeline':
        return <div style={cellBorder}><DateRangeCell startDate={subitem.startDate} endDate={subitem.endDate} onChange={(s,e) => onUpdate({ startDate: s, endDate: e })} /></div>
      case 'estHours': {
        // Pro-rated mode: cel toont eerlijk-verdeelde uren (subitem.estHours
        // is dan al pro-rated door de filter-map). Bij klik krijgt de
        // gebruiker een input met de ECHTE waarde (__originalEstHours)
        // zodat 'r ie die kan aanpassen — geen pro-rated overschrijf-bug.
        const orig = (subitem as { __originalEstHours?: number }).__originalEstHours
        const isProrated = typeof orig === 'number'
        return (
          <div style={cellBorder}>
            <ProRatableNumberCell
              displayValue={subitem.estHours ?? 0}
              editValue={isProrated ? orig! : (subitem.estHours ?? 0)}
              isProrated={isProrated}
              onChange={v => onUpdate({ estHours: Number(v) || 0 })}
            />
          </div>
        )
      }
      case 'echtGewerkt':
        return <div style={cellBorder}><EditableCell value={subitem.echtGewerkt ?? null} inputType="number" onChange={v => onUpdate({ echtGewerkt: v != null ? (v as number) : undefined })} /></div>
      default:
        return <div style={cellBorder} />
    }
  }

  const [isDraggingMe, setIsDraggingMe] = useState(false)
  return (
    <div
      onDragEnd={() => {
        setIsDraggingMe(false)
        window.dispatchEvent(new CustomEvent('yoko-subitem-drag-end'))
      }}
      style={{
      position: 'relative',
      display: 'grid', gridTemplateColumns: gridTemplate,
      alignItems: 'center', minHeight: 44,
      borderBottom: '1px solid var(--border)',
      background: isDraggingMe ? 'var(--accent-light)' : (selected ? 'var(--accent-light)' : (hover ? 'var(--overlay-hover)' : 'transparent')),
      opacity:    isDraggingMe ? 0.5 : 1,
      transform:  isDraggingMe ? 'scale(0.985)' : 'none',
      transition: 'background 0.1s, opacity 0.1s, transform 0.1s',
      cursor: 'default',
    }}
      onMouseEnter={e => {
        setHover(true)
        const h = e.currentTarget.querySelector<HTMLElement>('.subitem-grip')
        if (h) h.style.opacity = '1'
      }}
      onMouseLeave={e => {
        setHover(false)
        const h = e.currentTarget.querySelector<HTMLElement>('.subitem-grip')
        if (h) h.style.opacity = '0'
      }}>
      {!editName && parentItemId && fromGroupId && (
        <span draggable
          className="subitem-grip"
          title="Sleep om subitem te verplaatsen"
          onDragStart={e => {
            e.stopPropagation()
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('application/x-yoko-subitem', JSON.stringify({
              subitemId: subitem.id, parentItemId, fromGroupId,
            }))
            setIsDraggingMe(true)
            window.dispatchEvent(new CustomEvent('yoko-subitem-drag-start', { detail: { subitemId: subitem.id, name: subitem.name } }))
          }}
          style={{
            position: 'absolute', left: -22, top: '50%', transform: 'translateY(-50%)',
            width: 18, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'grab', userSelect: 'none',
            color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, lineHeight: 1,
            opacity: 0, transition: 'opacity 0.12s',
            zIndex: 5,
          }}>⠿</span>
      )}
      {/* Eerste kolom: checkbox links, daarna ruimte, dan de tree-connector
          (verticale lijn + horizontale elbow) helemaal rechts. Eerder zat de
          checkbox tegen de lijn aan; nu staan ze duidelijk gescheiden. */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', position: 'relative', padding: '0 0 0 10px' }}>
        {onToggleSelect && (
          <input type="checkbox" checked={!!selected} onChange={onToggleSelect}
            onClick={e => e.stopPropagation()}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 13, height: 13,
              opacity: selected || hover ? 1 : 0.4, transition: 'opacity 0.15s', flexShrink: 0, zIndex: 1 }} />
        )}
        {/* Boom-connector: verticale lijn helemaal rechts, niet over de
            checkbox heen. Top-half altijd zichtbaar; bottom-half verbergen
            op laatste rij. */}
        <div aria-hidden style={{ position: 'absolute', right: 4, top: 0, bottom: isLast ? '50%' : 0, width: 2, background: rail ?? 'var(--accent)' }} />
        <div aria-hidden style={{ position: 'absolute', right: 0, top: '50%', width: 6, height: 2, background: rail ?? 'var(--accent)' }} />
      </div>
      <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {/* Google-link badge. Drie bronnen om het te detecteren:
            - subitem.source === 'google' (set bij handmatige nesting)
            - subitem.externalLink aanwezig (zelfde)
            - id-prefix 'si_g_' (gegenereerd door de googleSync voor
              recurring instances). Die laatste vangt oude rijen op
              die nog geen source/externalLink-veld hebben gekregen.
            Fallback wanneer externalLink ontbreekt: bouw een day-jump
            URL met de startDate zodat de badge altijd klikbaar is — open
            Google Calendar op de juiste datum, ook al weten we 't
            specifieke event-id niet. */}
        {(subitem.source === 'google' || subitem.externalLink || subitem.id?.startsWith('si_g_')) && (() => {
          const fallback = subitem.startDate
            ? (() => {
                const d = new Date(subitem.startDate)
                if (Number.isNaN(d.getTime())) return undefined
                return `https://calendar.google.com/calendar/u/0/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
              })()
            : undefined
          return <GoogleBadge href={subitem.externalLink ?? fallback} size={13} />
        })()}
        {editName ? (
          <input autoFocus value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => { onUpdate({ name: nameDraft }); setEditName(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onUpdate({ name: nameDraft }); setEditName(false) }
              if (e.key === 'Escape') setEditName(false)
            }}
            style={{ ...editInput, flex: 1 }} />
        ) : (
          <>
            {/* Monday-stijl: klik op de naam start direct rename voor
                handmatige subitems. Google-subitems openen in Google
                Calendar via dezelfde klik (de instance-link). Detail-
                drawer blijft bereikbaar via de ↗-knop die op hover
                rechts verschijnt. */}
            {(() => {
              const isGoogleSub = !!subitem.externalLink || subitem.id?.startsWith('si_g_')
              return (
                <span
                  onClick={() => {
                    if (isGoogleSub) {
                      if (subitem.externalLink) window.open(subitem.externalLink, '_blank', 'noopener,noreferrer')
                      return
                    }
                    setNameDraft(subitem.name); setEditName(true)
                  }}
                  title={isGoogleSub ? 'Open in Google Calendar' : 'Klik om naam aan te passen'}
                  style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500,
                    cursor: isGoogleSub ? 'pointer' : 'text',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {subitem.name}
                </span>
              )
            })()}
            {hover && onOpenDetail && (
              <button onClick={e => { e.stopPropagation(); onOpenDetail() }}
                title="Details openen"
                aria-label="Details openen"
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: '2px 6px', fontSize: 13, lineHeight: 1,
                  borderRadius: 4, flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                ↗
              </button>
            )}
            {subitem.meetLink && (
              <a href={subitem.meetLink} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title={subitem.startTime ? `Open Google Meet (${subitem.startTime})` : 'Open Google Meet voor deze meeting'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '2px 7px 2px 6px', borderRadius: 5,
                  background: '#00ac47', color: '#fff',
                  fontSize: 11, fontWeight: 500, lineHeight: 1.3,
                  flexShrink: 0, textDecoration: 'none', marginLeft: 6,
                  boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
                }}>
                Meet
                {subitem.startTime && (
                  <span style={{ fontSize: 10.5, opacity: 0.9, fontWeight: 600 }}>
                    @ {subitem.startTime}
                  </span>
                )}
                <span style={{ fontSize: 10, opacity: 0.85 }}>↗</span>
              </a>
            )}
          </>
        )}
      </div>
      {cols.map(c => (
        <div key={c.key} style={{ alignSelf: 'stretch', display: 'flex', minWidth: 0, position: 'relative' }}>
          {renderCol(c)}
          {onResizeCol && (
            <div
              title="Kolom breder/smaller slepen"
              style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 3 }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => {
                e.preventDefault(); e.stopPropagation()
                const startX = e.clientX
                const startW = (colWidths && colWidths[c.key]) ?? c.width
                function onMove(ev: MouseEvent) { onResizeCol!(c.key, startW + ev.clientX - startX) }
                function onUp() {
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
            />
          )}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border)', height: '100%' }}>
        {hover && (
          <button onClick={onDelete} title="Verwijderen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px', borderRadius: 3 }}>×</button>
        )}
      </div>
    </div>
  )
}

// ─── Subitems sectie ──────────────────────────────────────────────────────────
function SubItemsSection({ subitems, cols, gridTemplate, accentColor, selectedIds, onToggleSelect, parentItemId, fromGroupId, parentExternalLink, onOpenDetail, colWidths, onResizeCol, onUpdate }: {
  subitems: SubItem[]; cols: ColumnDef[]; gridTemplate: string
  accentColor?: string
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  parentItemId?: string
  fromGroupId?: string
  parentExternalLink?: string | null
  onOpenDetail?: (sub: SubItem) => void
  colWidths?: Record<string, number>
  onResizeCol?: (key: string, width: number) => void
  onUpdate: (u: SubItem[]) => void
}) {
  function updateOne(id: string, u: Partial<SubItem>) {
    // Bulk-bewustzijn: als deze subitem in een grotere selectie zit, pas de
    // wijziging op alle geselecteerde subitems binnen dit item toe. Zo kun
    // je alle subitems aanvinken en met één klik op 'Done' alles meenemen.
    const bulk = !!selectedIds && selectedIds.size > 1 && selectedIds.has(id)
    onUpdate(subitems.map(s => {
      if (bulk ? selectedIds!.has(s.id) : s.id === id) return { ...s, ...u }
      return s
    }))
  }
  function deleteOne(id: string) { onUpdate(subitems.filter(s => s.id !== id)) }
  const [justCreatedSubId, setJustCreatedSubId] = useState<string | null>(null)
  function addOne() {
    const id = Date.now().toString()
    onUpdate([...subitems, { id, name: 'Nieuw subitem', ownerIds: [], status: '', startDate: null, endDate: null, estHours: 0 }])
    // Onthoud de net-aangemaakte id zodat de rij meteen in edit-mode
    // staat en de gebruiker direct kan typen i.p.v. de placeholder
    // 'Nieuw subitem' apart te moeten aanklikken.
    setJustCreatedSubId(id)
    setTimeout(() => setJustCreatedSubId(prev => prev === id ? null : prev), 5000)
  }
  const rail = accentColor ?? 'var(--accent)'
  const hdrCell: React.CSSProperties = { padding: '6px 8px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--border)' }

  // Subitem-only header labels per known column key. Falls back to the
  // parent column label so custom columns get something sensible.
  const headerLabelFor = (key: string, fallback: string) => {
    if (key === 'owner')       return 'Owner'
    if (key === 'status')      return 'Status'
    if (key === 'timeline')    return 'Timeline'
    if (key === 'estHours')    return 'Est.'
    if (key === 'echtGewerkt') return 'Echt gewerkt'
    return fallback
  }

  // Monday-stijl: subitems leven in een eigen 'sub-card' met ruimte aan
  // de linkerkant voor de connector-lijn, witruimte boven en onder, en
  // een eigen lichte achtergrond. Eindigt onder met de '+ subitem' actie.
  return (
    <div style={{ background: 'var(--bg-base)', padding: '14px 24px 14px 48px', position: 'relative' }}>
      {/* Connector-lijn van de parent-rij naar de subitem-block — zacht
          gekleurde verticale lijn, gevolgd door een ronde 'turn' rechts. */}
      <div aria-hidden style={{ position: 'absolute', left: 32, top: 0, bottom: 14, width: 2, background: rail, opacity: 0.55 }} />
      <div style={{
        background: 'var(--bg-card)', borderRadius: 10,
        border: '1px solid var(--border-strong)', overflow: 'hidden',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: 'transparent', borderBottom: '1px solid var(--border)' }}>
          <div />
          <div style={{ padding: '8px 12px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subitem</div>
          {cols.map(c => (
            <div key={c.key} style={{ ...hdrCell, position: 'relative' }}>
              {headerLabelFor(c.key, c.label)}
              {onResizeCol && (
                <div
                  title="Kolom breder/smaller slepen"
                  style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 3 }}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => {
                    e.preventDefault(); e.stopPropagation()
                    const startX = e.clientX
                    const startW = (colWidths && colWidths[c.key]) ?? c.width
                    function onMove(ev: MouseEvent) { onResizeCol!(c.key, startW + ev.clientX - startX) }
                    function onUp() {
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }}
                />
              )}
            </div>
          ))}
          <div style={{ borderLeft: '1px solid var(--border)' }} />
        </div>
        <SubitemRows subitems={subitems} cols={cols} gridTemplate={gridTemplate}
          rail={rail}
          selectedIds={selectedIds} onToggleSelect={onToggleSelect}
          parentItemId={parentItemId} fromGroupId={fromGroupId} parentExternalLink={parentExternalLink}
          onOpenDetail={onOpenDetail}
          justCreatedSubId={justCreatedSubId}
          colWidths={colWidths} onResizeCol={onResizeCol}
          updateOne={updateOne} deleteOne={deleteOne} />
        {/* Som-rij voor de subitems van dit item — dezelfde stijl als de
            groep-som onderaan de hoofdtabel. Toont alleen wanneer 'r
            ten minste 1 subitem is. */}
        {subitems.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, borderTop: '1px solid var(--border)', background: 'var(--overlay-faint)' }}>
            <div />
            <div style={{ padding: '5px 14px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Som</div>
            {cols.map(col => {
              const sumHours = subitems.reduce((s, si) => s + (Number(si.estHours) || 0), 0)
              const sumDagen = Math.round(sumHours / 8 * 10) / 10
              return (
                <div key={col.key} style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderLeft: '1px solid var(--border)', fontWeight: 600 }}>
                  {col.key === 'estHours' ? `${sumHours}u` : col.key === 'dagen' ? sumDagen : ''}
                </div>
              )
            })}
            <div style={{ borderLeft: '1px solid var(--border)' }} />
          </div>
        )}
        <div style={{ padding: '8px 12px 8px 56px' }}>
          <button onClick={addOne} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12.5, padding: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
            + Voeg subitem toe
          </button>
        </div>
      </div>
    </div>
  )
}

// Subitem-rijen met Done-subgroep collapse. Active eerst (vroegste datum
// bovenaan), daarna een inklapbare "Done (N)" sectie.
function SubitemRows({ subitems, cols, gridTemplate, rail, selectedIds, onToggleSelect, parentItemId, fromGroupId, parentExternalLink, onOpenDetail, justCreatedSubId, colWidths, onResizeCol, updateOne, deleteOne }: {
  subitems: SubItem[]; cols: ColumnDef[]; gridTemplate: string; rail: string
  selectedIds?: Set<string>; onToggleSelect?: (id: string) => void
  parentItemId?: string
  fromGroupId?: string
  // Master-link van de recurring parent — gebruiken we als fallback voor
  // subitems die nog geen eigen externalLink hebben (oude rows van vóór
  // de per-instance link werd opgeslagen).
  parentExternalLink?: string | null
  onOpenDetail?: (sub: SubItem) => void
  // Id van een net-aangemaakte subitem — die rij start meteen in edit-mode.
  justCreatedSubId?: string | null
  // Column-resize doorgegeven van BoardGroupSection zodat subitem-rijen
  // ook een drag-handle per cel kunnen renderen.
  colWidths?: Record<string, number>
  onResizeCol?: (key: string, width: number) => void
  updateOne: (id: string, u: Partial<SubItem>) => void
  deleteOne: (id: string) => void
}) {
  const [doneOpen, setDoneOpen] = useState(false)
  const sortByStart = (a: SubItem, b: SubItem) => {
    const av = a.startDate ?? ''
    const bv = b.startDate ?? ''
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return av.localeCompare(bv)
  }
  const active = subitems.filter(s => s.status !== 'Done').sort(sortByStart)
  const done   = subitems.filter(s => s.status === 'Done').sort(sortByStart)
  // 'Laatste' = bepaalt of de verticale connector na deze rij doorloopt.
  // Wanneer Done bestaat is de Done-header de laatste; anders de laatste
  // actieve rij. Bij geopende Done is de laatste done-rij de finale.
  const lastActiveIdx = active.length - 1
  const hasDone = done.length > 0
  const lastDoneIdx  = done.length - 1
  return (
    <>
      {active.map((sub, idx) => (
        <SubItemRow key={sub.id} subitem={sub} cols={cols} gridTemplate={gridTemplate}
          rail={rail}
          selected={selectedIds?.has(`sub:${sub.id}`) ?? false}
          onToggleSelect={onToggleSelect ? () => onToggleSelect(`sub:${sub.id}`) : undefined}
          isLast={!hasDone && idx === lastActiveIdx}
          parentItemId={parentItemId} fromGroupId={fromGroupId} parentExternalLink={parentExternalLink}
          onOpenDetail={onOpenDetail ? () => onOpenDetail(sub) : undefined}
          defaultEditName={sub.id === justCreatedSubId}
          colWidths={colWidths} onResizeCol={onResizeCol}
          onUpdate={u => updateOne(sub.id, u)} onDelete={() => deleteOne(sub.id)} />
      ))}
      {hasDone && (
        <>
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); setDoneOpen(o => !o) }}
            onPointerDown={e => e.stopPropagation()}
            style={{
              width: '100%', textAlign: 'left',
              background: 'var(--overlay-faint)', border: 'none',
              borderBottom: '1px solid var(--border)',
              padding: '7px 14px 7px 56px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              position: 'relative',
            }}>
            {/* Tree-connector voor de Done-header: verticale lijn + elbow.
                Eindigt hier wanneer Done dicht is, loopt door wanneer open. */}
            <span aria-hidden style={{ position: 'absolute', left: 36 - 4 - 2, top: 0, bottom: doneOpen ? 0 : '50%', width: 2, background: rail }} />
            <span aria-hidden style={{ position: 'absolute', left: 36 - 4, top: '50%', width: 6, height: 2, background: rail }} />
            <span style={{ fontSize: 9, lineHeight: 1, display: 'inline-block', width: 10 }}>{doneOpen ? '▼' : '▶'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: '#00c875' }} />
              Done ({done.length})
            </span>
          </button>
          {doneOpen && done.map((sub, idx) => (
            <SubItemRow key={sub.id} subitem={sub} cols={cols} gridTemplate={gridTemplate}
              rail={rail}
              selected={selectedIds?.has(`sub:${sub.id}`) ?? false}
              onToggleSelect={onToggleSelect ? () => onToggleSelect(`sub:${sub.id}`) : undefined}
              isLast={idx === lastDoneIdx}
              parentItemId={parentItemId} fromGroupId={fromGroupId} parentExternalLink={parentExternalLink}
              onOpenDetail={onOpenDetail ? () => onOpenDetail(sub) : undefined}
              colWidths={colWidths} onResizeCol={onResizeCol}
              onUpdate={u => updateOne(sub.id, u)} onDelete={() => deleteOne(sub.id)} />
          ))}
        </>
      )}
    </>
  )
}

// ─── Notes preview cel ──────────────────────────────────────────────────────
// Klik opent het item-detail-drawer met een echt textarea. Strippen we de
// HTML-tags die uit oudere imports (Google-beschrijvingen) kunnen komen,
// anders zie je <p>…</p> letterlijk in de cel.
function NotesPreview({ value, onOpen }: { value: string; onOpen: () => void }) {
  const plain = (value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    <div onClick={e => { e.stopPropagation(); onOpen() }}
      title={plain || 'Klik om notitie toe te voegen'}
      style={{
        cursor: 'pointer', fontSize: 13, padding: '0 4px',
        color: plain ? 'var(--text-secondary)' : 'var(--text-muted)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        width: '100%', userSelect: 'none',
      }}>
      {plain || '—'}
    </div>
  )
}

// ─── Item rij ─────────────────────────────────────────────────────────────────
function BoardRow({ item, cols, gridTemplate, selected, accentColor, onToggleSelect, selectedIds, onToggleSubitem, groupId, reorderMode, isFirst, isLast, onMoveUp, onMoveDown, colWidths, onResizeCol, onUpdate, onDelete, defaultEditName }: {
  item: BoardItem; cols: ColumnDef[]; gridTemplate: string
  selected: boolean
  accentColor?: string
  selectedIds?: Set<string>
  onToggleSubitem?: (id: string) => void
  // Voor subitem-drag-to-unnest: subitems moeten weten welke parent + groep
  // ze verlaten zodat de drop-handler kan opruimen.
  groupId?: string
  onToggleSelect: () => void
  reorderMode: boolean
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  // Column-resize via subitem-cellen — geven we door zodat de gebruiker
  // niet hoeft te scrollen naar de sticky header bovenin.
  colWidths?: Record<string, number>
  onResizeCol?: (key: string, width: number) => void
  onUpdate: (u: Partial<BoardItem>) => void; onDelete: () => void
  // Wanneer true initialiseert de rij in name-edit-modus. Wordt door
  // 'Voeg item toe' gezet zodat de gebruiker direct kan typen zonder
  // eerst nog eens op de naam te hoeven klikken.
  defaultEditName?: boolean
}) {
  const [hover,     setHover]     = useState(false)
  const [editName,  setEditName]  = useState(!!defaultEditName)
  const [nameDraft, setNameDraft] = useState(item.name)
  const [expanded,  setExpanded]  = useState(false)
  const subitems    = item.subitems ?? []
  const hasSubitems = subitems.length > 0

  // Voor recurring Google-events: bereken de link naar de éérstvolgende
  // instance (of de laatste als alles voorbij is). We gebruiken 'm zowel
  // voor 't Google-badge naast de naam als voor de naam-klik zelf op
  // Google-parents, zodat één klik op de hoofd-rij direct in Google
  // Calendar opent op het juiste moment.
  const googleHref: string | undefined = (() => {
    if (item.source !== 'google') return undefined
    const today = new Date().toISOString().slice(0, 10)
    const upcoming = (item.subitems ?? [])
      .filter(s => s.externalLink)
      .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
    const next = upcoming.find(s => (s.startDate ?? '') >= today) ?? upcoming[upcoming.length - 1]
    return next?.externalLink ?? item.externalLink ?? undefined
  })()

  // Tijdstip naast de Meet-knop. Voor recurring meetings: tijd van de
  // EERSTVOLGENDE instance (of de laatste als alles voorbij is). Voor
  // single-events: het eigen item.startTime. Format: HH:MM zonder seconden.
  const nextMeetingTime: string | null = (() => {
    if (item.source !== 'google') return null
    const today = new Date().toISOString().slice(0, 10)
    const subs = (item.subitems ?? [])
      .filter(s => s.startTime)
      .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
    if (subs.length > 0) {
      const next = subs.find(s => (s.startDate ?? '') >= today) ?? subs[subs.length - 1]
      return next?.startTime ?? null
    }
    return (item as { startTime?: string | null }).startTime ?? null
  })()

  // Comments per board-item — leeft naast 'journal' in de DetailPanel,
  // maar bereikbaar via een knop direct op de rij.
  const [commentCount, setCommentCount] = useState(0)
  const [showDetail, setShowDetail] = useState(false)
  // Subitem-detail: zelfde drawer als parent items, maar voor één subitem.
  const [openSub, setOpenSub] = useState<SubItem | null>(null)
  useEffect(() => {
    const refresh = () => {
      const threads = loadCommentsFor('board-item:' + item.id)
      setCommentCount(threads.reduce((s, t) => s + t.thread.length, 0))
    }
    refresh()
    return onCommentsUpdate(refresh)
  }, [item.id])

  // ?drawer=<itemId> in de URL = deeplink vanuit een andere view (bv. de
  // werkdruk-widget op de homepage) die direct het detail wil openen
  // wanneer deze rij rendert. Lees één keer op mount en wis de param uit
  // de URL zodat ie niet bij elke pageload opnieuw triggert.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const wantId = params.get('drawer')
    if (wantId && wantId === item.id) {
      setShowDetail(true)
      params.delete('drawer')
      const qs = params.toString()
      const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
      window.history.replaceState(null, '', next)
    }
  }, [item.id])

  // Auto-rollup: als parent een veld leeg laat én er zijn subitems, dan
  // afleiden uit subitems. Hours doen we al verderop in de Cell-dispatcher
  // (read-only sum). Hier: timeline + owners. Schrijf-actie van de gebruiker
  // overschrijft de derived waarde — om weer auto te krijgen moet je 't
  // veld op de parent leegmaken.
  let effectiveItem: BoardItem = item
  if (hasSubitems) {
    const updates: Partial<BoardItem> = {}
    // Parent-timeline volgt altijd de ACTIEVE (niet-Done) subitems. Een
    // Done-instance moet 't bereik niet meer beïnvloeden — anders blijft
    // de parent op 20 mei staan terwijl alle resterende subitems pas op
    // 17 juni beginnen. Zijn alle subitems Done, val terug op de complete
    // set zodat de range nog ergens op slaat (anders zou de parent leeg
    // ogen).
    const activeSubs = subitems.filter(s => s.status !== 'Done')
    const dateSubs   = activeSubs.length > 0 ? activeSubs : subitems
    const subStarts = dateSubs.map(s => s.startDate).filter(Boolean) as string[]
    const subEnds   = dateSubs.map(s => s.endDate).filter(Boolean) as string[]
    // Override de stored parent-datums altijd zodra subitems datums hebben.
    // De parent eigen startDate/endDate zijn dan slechts een fallback.
    if (subStarts.length > 0) updates.startDate = [...subStarts].sort()[0]
    if (subEnds.length   > 0) updates.endDate   = [...subEnds].sort().slice(-1)[0]
    // Owner-rollup: alle eigenaren over subitems verzamelen en samenvoegen
    // met de parent eigen ownerIds. Voorheen vulden we alleen aan wanneer
    // de parent helemaal leeg was; daardoor zag je niet de Yoko-collega's
    // die aan bv. instances van een Google recurring-meeting waren
    // toegevoegd. Display-only: een klik op de owner-cel schrijft alleen
    // naar de parent's ownerIds, subitem-owners blijven onaangeraakt.
    const ownerSet = new Set<string>()
    for (const oid of (item.ownerIds ?? [])) if (oid && oid !== 'unassigned') ownerSet.add(oid)
    for (const s of subitems) for (const oid of (s.ownerIds ?? [])) if (oid && oid !== 'unassigned') ownerSet.add(oid)
    if (ownerSet.size > 0) updates.ownerIds = [...ownerSet]
    // Owner-hours rollup: wanneer de parent zelf geen verdeling heeft
    // (item.ownerHours leeg) leiden we 'm af uit de subitems. Elke
    // subitem-uren worden gelijk verdeeld over zijn eigen owners; die
    // shares sommeren we per persoon. Display-only — wanneer de
    // gebruiker zelf een verdeling instelt overruled die deze rollup.
    if (!item.ownerHours || Object.keys(item.ownerHours).length === 0) {
      const rolled: Record<string, number> = {}
      for (const s of subitems) {
        const subOwners = (s.ownerIds ?? []).filter(o => o && o !== 'unassigned')
        const hrs = Number(s.estHours) || 0
        if (subOwners.length === 0 || hrs <= 0) continue
        const share = hrs / subOwners.length
        for (const oid of subOwners) {
          rolled[oid] = (rolled[oid] ?? 0) + share
        }
      }
      // Rond af op 0.1u zodat de pie geen 7.34782u toont.
      for (const k of Object.keys(rolled)) rolled[k] = Math.round(rolled[k] * 10) / 10
      if (Object.keys(rolled).length > 0) updates.ownerHours = rolled
    }
    // Status NIET auto-rollen. Done subitems blijven gewoon in het
    // parent-item zichtbaar; pas wanneer jij het item zelf op Done zet
    // verhuist 't naar de Done-groep. Voorkomt dat een item ongewenst
    // wegspringt zodra de laatste subitem klaar is.
    if (Object.keys(updates).length > 0) effectiveItem = { ...item, ...updates }
  }

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: gridTemplate,
        alignItems: 'center', minHeight: 44,
        // Rij-onderlijn iets prominenter dan border-light maar nog steeds
        // zachter dan de groep-rand zelf.
        borderBottom: expanded ? 'none' : '1px solid var(--border)',
        background: selected ? 'var(--accent-light)' : (hover ? 'var(--overlay-hover)' : 'transparent'),
        transition: 'background 0.1s',
      }}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>

        {/* Selection checkbox */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect}
            onClick={e => e.stopPropagation()}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 15, height: 15,
              opacity: selected || hover ? 1 : 0.5, transition: 'opacity 0.15s' }} />
        </div>

        <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, cursor: 'pointer' }}
          onClick={e => {
            // Klik op een 'leeg' deel van de title-cel (tussen checkbox en
            // titel of net naast de pill-knoppen) opent 't detail-drawer.
            // Inner buttons en de naam-span doen stopPropagation, dus daar
            // bubbelt 't niet naartoe.
            if (editName) return
            const tgt = e.target as HTMLElement
            if (tgt.closest('button, a, input, [data-no-detail]')) return
            setShowDetail(true)
          }}>
          <button onClick={e => { e.stopPropagation(); setExpanded(x => !x) }}
            title={hasSubitems ? `${subitems.length} subitems` : 'Subitems toevoegen'}
            style={{
              background: 'none', border: 'none', padding: '3px 4px', cursor: 'pointer',
              fontSize: 13, lineHeight: 1,
              color: hasSubitems ? (expanded ? 'var(--text-primary)' : 'var(--text-secondary)') : hover ? 'rgba(122,132,160,0.4)' : 'transparent',
              flexShrink: 0, width: 22, textAlign: 'center', transition: 'color 0.1s',
            }}>{expanded ? '▼' : '▶'}</button>

          {/* Subitem-count badge weggehaald — de '5'-pill voegde visuele
              ruis toe. Het chevron-icoon laat al genoeg zien dat er
              subitems onder zitten. */}

          {item.source === 'google' && <GoogleBadge href={googleHref} />}
          {typeof item.meetLink === 'string' && item.meetLink && (
            <a href={item.meetLink} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title={nextMeetingTime ? `Open Google Meet (${nextMeetingTime})` : 'Open Google Meet'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px 2px 6px', borderRadius: 5,
                background: '#00ac47', color: '#fff',
                fontSize: 11, fontWeight: 500, lineHeight: 1.3,
                flexShrink: 0, textDecoration: 'none',
                boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
              }}>
              Meet
              {nextMeetingTime && (
                <span style={{ fontSize: 10.5, opacity: 0.9, fontWeight: 600 }}>
                  @ {nextMeetingTime}
                </span>
              )}
              <span style={{ fontSize: 10, opacity: 0.85 }}>↗</span>
            </a>
          )}

          {editName && item.source !== 'google' ? (
            <input autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              onBlur={() => { onUpdate({ name: nameDraft }); setEditName(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { onUpdate({ name: nameDraft }); setEditName(false) }
                if (e.key === 'Escape') setEditName(false)
              }}
              style={{ ...editInput, flex: 1 }} />
          ) : (
            <>
              <span
                onClick={e => {
                  e.stopPropagation()
                  // Monday-stijl: klik op de naam start rename direct voor
                  // handmatige items. Voor Google-items openen we de eerst-
                  // volgende instance rechtstreeks in Google Calendar —
                  // recurring meetings hebben dan vaak verborgen subitems
                  // die je anders niet snel kon openen. Detail-drawer
                  // blijft bereikbaar via de ↗-knop of de comments-pill.
                  if (item.source === 'google') {
                    if (googleHref) window.open(googleHref, '_blank', 'noopener,noreferrer')
                    return
                  }
                  setNameDraft(item.name); setEditName(true)
                }}
                onDoubleClick={e => {
                  if (item.source === 'google') return
                  e.stopPropagation()
                  setNameDraft(item.name); setEditName(true)
                }}
                title={item.source === 'google'
                  ? (googleHref ? 'Open eerstvolgende in Google Calendar' : 'Google Calendar item')
                  : 'Klik om naam te bewerken'}
                // I-beam cursor voor handmatige items zodat 'rename-baar'
                // visueel duidelijk is — net als in Monday. Google-items
                // krijgen een gewone pointer omdat ze read-only zijn qua naam.
                style={{ fontSize: 14.5, color: 'var(--text-primary)', fontWeight: 500,
                  cursor: item.source === 'google' ? 'pointer' : 'text',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {item.name}
              </span>
              {hover && (
                <button
                  onClick={e => { e.stopPropagation(); setShowDetail(true) }}
                  title="Details openen"
                  aria-label="Details openen"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', padding: '2px 6px', fontSize: 14, lineHeight: 1,
                    borderRadius: 4, flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  ↗
                </button>
              )}
            </>
          )}

          {/* Comments-knop — opent het detail-drawer en scrolt naar opmerkingen.
              Felle pill bij ≥1 opmerking, anders een subtiele outline-icon. */}
          <button onClick={(e) => { e.stopPropagation(); setShowDetail(true) }}
            title={commentCount > 0 ? `${commentCount} opmerking${commentCount === 1 ? '' : 'en'}` : 'Plaats opmerking'}
            style={commentCount > 0 ? {
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 11px', borderRadius: 999,
              background: 'var(--accent)',
              border: '1px solid var(--accent)',
              color: '#000',
              fontSize: 13, fontWeight: 700,
              cursor: 'pointer', flexShrink: 0, lineHeight: 1,
            } : {
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              color: 'var(--accent)',
              padding: '4px 8px', borderRadius: 999, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              opacity: 1, transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              if (commentCount === 0) {
                e.currentTarget.style.background = 'var(--accent-light)'
              }
            }}
            onMouseLeave={e => {
              if (commentCount === 0) {
                e.currentTarget.style.background = 'var(--bg-card)'
              }
            }}>
            <IconComment size={22} strokeWidth={1.8} />
            {commentCount > 0 && <span style={{ minWidth: 8, textAlign: 'center' }}>{commentCount}</span>}
          </button>
        </div>

        {cols.map(col => (
          <div key={col.key} style={{ padding: '4px 8px', borderLeft: '1px solid var(--border-strong)', height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
            {col.key === 'notes' ? (
              // Notes is een vrije-tekst-veld dat al snel niet meer in één
              // cel past. Klikken opent het detail-drawer met een groot
              // textarea + eventuele opmerkingen ernaast.
              <NotesPreview value={item.notes ?? ''} onOpen={() => setShowDetail(true)} />
            ) : (
              <Cell item={effectiveItem} col={col} onUpdate={onUpdate} />
            )}
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-strong)', height: '100%', gap: 2 }}>
          {reorderMode ? (
            <>
              <button onClick={onMoveUp} disabled={isFirst} title="Omhoog"
                style={{ background: isFirst ? 'transparent' : 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 4, color: isFirst ? 'var(--text-muted)' : 'var(--text-primary)', cursor: isFirst ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, padding: '1px 4px', opacity: isFirst ? 0.4 : 1 }}>↑</button>
              <button onClick={onMoveDown} disabled={isLast} title="Omlaag"
                style={{ background: isLast ? 'transparent' : 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 4, color: isLast ? 'var(--text-muted)' : 'var(--text-primary)', cursor: isLast ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, padding: '1px 4px', opacity: isLast ? 0.4 : 1 }}>↓</button>
            </>
          ) : hover && item.source !== 'google' ? (
            <button onClick={onDelete} title="Verwijderen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '2px 6px', borderRadius: 3 }}>×</button>
          ) : null}
        </div>
      </div>

      {expanded && (
        <SubItemsSection subitems={subitems} cols={cols} gridTemplate={gridTemplate}
          accentColor={accentColor}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSubitem}
          parentItemId={item.id} fromGroupId={groupId}
          parentExternalLink={item.externalLink ?? null}
          onOpenDetail={sub => setOpenSub(sub)}
          colWidths={colWidths} onResizeCol={onResizeCol}
          onUpdate={updated => onUpdate({ subitems: updated })} />
      )}
      {showDetail && (
        <ItemDetailDrawer item={item} cols={cols} accentColor={accentColor}
          onUpdate={onUpdate} onClose={() => setShowDetail(false)} />
      )}
      {openSub && (
        <ItemDetailDrawer
          item={subitemAsItem(openSub)}
          cols={cols}
          accentColor={accentColor}
          onUpdate={u => {
            // Vertaal BoardItem-update terug naar SubItem-update; alleen
            // velden die SubItem ook kent landen in de array.
            const subFields: Partial<SubItem> = {}
            if ('name'        in u) subFields.name        = u.name as string
            if ('ownerIds'    in u) subFields.ownerIds    = u.ownerIds as string[]
            if ('status'      in u) subFields.status      = u.status as string
            if ('startDate'   in u) subFields.startDate   = u.startDate as string | null
            if ('endDate'     in u) subFields.endDate     = u.endDate as string | null
            if ('estHours'    in u) subFields.estHours    = u.estHours as number
            if ('echtGewerkt' in u) subFields.echtGewerkt = u.echtGewerkt as number | undefined
            const nextSubs = (item.subitems ?? []).map(s => s.id === openSub.id ? { ...s, ...subFields } : s)
            onUpdate({ subitems: nextSubs })
            setOpenSub(prev => prev ? { ...prev, ...subFields } : prev)
          }}
          onClose={() => setOpenSub(null)} />
      )}
    </>
  )
}

// ─── Dedup modal: dubbele items opsporen + opruimen ──────────────────────────
function DedupModal({ groups, onClose, onDelete }: {
  groups: BoardGroup[]
  onClose: () => void
  onDelete: (idsToDelete: Set<string>) => void
}) {
  // Groepeer alle items op naam (case-insensitive, trimmed). Sets met
  // meer dan 1 entry = potentiële duplicaten.
  const dupGroups = useMemo(() => {
    const byName = new Map<string, BoardItem[]>()
    for (const g of groups) for (const i of g.items) {
      const key = (i.name ?? '').trim().toLowerCase()
      if (!key) continue
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(i)
    }
    return [...byName.values()].filter(arr => arr.length > 1)
  }, [groups])

  // Per duplicate-set: welk item houden we? Default = eerste (meestal de
  // oudste, of de Google-versie als er een is).
  const [keep, setKeep] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const arr of dupGroups) {
      // Voorkeur: Google-item houden als er één bij zit, anders het eerste
      const preferred = arr.find(i => i.source === 'google') ?? arr[0]
      out[(arr[0].name ?? '').trim().toLowerCase()] = preferred.id
    }
    return out
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toDelete = new Set<string>()
  for (const arr of dupGroups) {
    const key = (arr[0].name ?? '').trim().toLowerCase()
    const keepId = keep[key]
    for (const i of arr) if (i.id !== keepId) toDelete.add(i.id)
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 9000 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(620px, 92vw)', maxHeight: '85vh', zIndex: 9001,
        background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>🧹 Schoonmaken</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              {dupGroups.length === 0
                ? 'Geen duplicaten gevonden — alles is uniek.'
                : `${dupGroups.length} naam${dupGroups.length === 1 ? '' : 'en'} komen meerdere keren voor. Kies per groep welk item je wil houden, de rest wordt verwijderd.`}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {dupGroups.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>👌 Niks te doen.</p>
          ) : dupGroups.map((arr) => {
            const key = (arr[0].name ?? '').trim().toLowerCase()
            return (
              <div key={key} style={{ marginBottom: 16, border: '1px solid var(--border-light)', borderRadius: 8 }}>
                <div style={{ padding: '8px 12px', background: 'var(--overlay-faint)', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  &ldquo;{arr[0].name}&rdquo; <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {arr.length}× gevonden</span>
                </div>
                {arr.map(i => {
                  const isKept = keep[key] === i.id
                  return (
                    <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: '1px solid var(--border-light)', cursor: 'pointer',
                      background: isKept ? 'var(--accent-light)' : 'transparent' }}>
                      <input type="radio" name={`dup-${key}`} checked={isKept}
                        onChange={() => setKeep(prev => ({ ...prev, [key]: i.id }))}
                        style={{ accentColor: 'var(--accent)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {i.source === 'google' && <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>G</span>}
                          {i.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {i.startDate ? `${i.startDate} → ${i.endDate ?? i.startDate}` : 'geen datums'} · {i.estHours ?? 0}u
                          {i.ownerIds && i.ownerIds.length > 0 && ` · ${i.ownerIds.filter(o => o !== 'unassigned').map(o => teamData.members.find(m => m.id === o)?.name?.split(' ')[0] ?? o).join(', ')}`}
                        </div>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: isKept ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {isKept ? 'BEHOUDEN' : 'verwijderen'}
                      </span>
                    </label>
                  )
                })}
              </div>
            )
          })}
        </div>

        {dupGroups.length > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {toDelete.size} item{toDelete.size === 1 ? '' : 's'} worden verwijderd.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Annuleer</button>
              <button onClick={() => onDelete(toDelete)} disabled={toDelete.size === 0}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: toDelete.size > 0 ? '#e2445c' : 'var(--bg-hover)',
                  color: toDelete.size > 0 ? '#fff' : 'var(--text-muted)',
                  fontSize: 12.5, fontWeight: 700, cursor: toDelete.size > 0 ? 'pointer' : 'not-allowed' }}>
                Verwijder {toDelete.size}
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}

// ─── Item-detail drawer ─ rechts-uitschuivend paneel met info + groot ──────
// commentaar-veld, zoals Monday's item-modal. Klik op item-naam = open.
// Verdeel-pie voor de detail-drawer. Toont per eigenaar 'n segment in de
// kleur van die persoon en laat je via drag de uren-verdeling tussen
// aangrenzende segmenten verschuiven. Lokale 'live'-state tijdens 't slepen,
// DB-write pas op release.
function OwnerDistributionSection({ item, owners, total, onUpdate }: {
  item: BoardItem; owners: string[]; total: number
  onUpdate: (u: Partial<BoardItem>) => void
}) {
  const { getPhoto } = useTeamPhotos()
  const defaultPer = owners.length > 0 ? total / owners.length : 0
  const ownersKey  = owners.join(',')
  const valuesKey  = JSON.stringify(item.ownerHours ?? {})
  const [live, setLive] = useState<Record<string, number>>(() => {
    const next: Record<string, number> = {}
    for (const o of owners) next[o] = item.ownerHours?.[o] ?? defaultPer
    return next
  })
  useEffect(() => {
    const next: Record<string, number> = {}
    for (const o of owners) next[o] = item.ownerHours?.[o] ?? defaultPer
    setLive(next)
  }, [item.id, ownersKey, total, valuesKey, defaultPer])

  const round1 = (n: number) => Math.round(n * 10) / 10

  const segments = owners.map(oid => {
    const m = teamData.members.find(x => x.id === oid)
    return {
      id:        oid,
      value:     live[oid] ?? 0,
      color:     m?.color ?? '#9aa3ad',
      label:     m?.name ?? oid,
      avatarUrl: m ? getPhoto(m.id) : null,
      initials:  m?.name?.slice(0, 1).toUpperCase() ?? '?',
    }
  })

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Verdeling
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 16px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <DistributionPie
          segments={segments}
          total={total}
          size={120}
          interactive
          showAvatars
          innerLabel={`${round1(total)}u`}
          onChange={setLive}
          onCommit={(next) => {
            // Filter: alleen huidige owners. De pie kan in een
            // raceconditie nog een stale owner-key meeleveren als de
            // ownerIds-prop net wisselde — die mag NIET naar de DB.
            const active = new Set(owners)
            const cleaned: Record<string, number> = {}
            for (const [oid, hrs] of Object.entries(next)) {
              if (active.has(oid)) cleaned[oid] = hrs
            }
            onUpdate({ ownerHours: Object.keys(cleaned).length > 0 ? cleaned : undefined })
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
          {owners.map(oid => {
            const m = teamData.members.find(x => x.id === oid)
            if (!m) return null
            const val = live[oid] ?? 0
            const pct = total > 0 ? Math.round((val / total) * 100) : 0
            return (
              <div key={oid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: m.color ?? '#9aa3ad', flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{round1(val)}u · {pct}%</span>
              </div>
            )
          })}
        </div>
      </div>
      <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
        Sleep de witte bolletjes op de taart om uren tussen mensen te verdelen.
      </p>
    </div>
  )
}

function ItemDetailDrawer({ item, cols, accentColor, onUpdate, onClose }: {
  item: BoardItem; cols: ColumnDef[]; accentColor?: string
  onUpdate: (u: Partial<BoardItem>) => void
  onClose: () => void
}) {
  const itemId   = item.id
  const itemText = item.name
  const { profile } = useProfile()
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [newReply, setNewReply] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [editName, setEditName] = useState(false)
  const [nameDraft, setNameDraft] = useState(item.name)

  useEffect(() => {
    const refresh = () => setThreads(loadCommentsFor('board-item:' + itemId))
    refresh()
    return onCommentsUpdate(refresh)
  }, [itemId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !editName) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editName])

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
        contextId: 'board-item:' + itemId,
        quote:     itemText,
        thread:    [reply],
        resolved:  false,
        createdAt: new Date().toISOString(),
      })
    }
    for (const rid of mentionIds) {
      createNotification({
        recipientId: rid,
        actorId:     profile?.memberId ?? null,
        kind:        'mention',
        contextKind: 'board_item',
        contextId:   itemId,
        href:        undefined,
        body:        body.length > 90 ? body.slice(0, 90) + '…' : body,
      }).catch(() => {})
    }
    setNewReply('')
    setMentionIds([])
  }

  function deleteReply(replyId: string) {
    if (!thread) return
    const next = thread.thread.filter(r => r.id !== replyId)
    saveComment({ ...thread, thread: next })
  }

  const accent = accentColor ?? '#579bfc'
  const isGoogle = item.source === 'google'

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 9000 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(760px, 96vw)', zIndex: 9001,
        background: 'var(--bg-base)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 22px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
          background: 'var(--bg-card)',
        }}>
          <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 3, background: accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Item</span>
              {isGoogle && <span style={{ background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3 }}>GOOGLE</span>}
            </div>
            {editName && !isGoogle ? (
              <input autoFocus value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => { onUpdate({ name: nameDraft }); setEditName(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { onUpdate({ name: nameDraft }); setEditName(false) }
                  if (e.key === 'Escape') { setNameDraft(item.name); setEditName(false) }
                }}
                style={{ ...editInput, fontSize: 20, fontWeight: 700, width: '100%' }} />
            ) : (
              <h2 onClick={() => { if (!isGoogle) { setNameDraft(item.name); setEditName(true) } }}
                title={isGoogle ? 'Bewerk in Google Calendar' : 'Klik om te bewerken'}
                style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)',
                  cursor: isGoogle ? 'default' : 'text', lineHeight: 1.25 }}>
                {item.name}
              </h2>
            )}
          </div>
          <button onClick={onClose} title="Sluiten (Esc)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>

        {/* Body: properties + comments */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 22px' }}>
          {/* Properties grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px 18px', marginBottom: 24 }}>
            {cols.map(col => (
              <div key={col.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {col.label}
                </span>
                <div style={{ minHeight: 28, display: 'flex', alignItems: 'center' }}>
                  <Cell item={item} col={col} onUpdate={onUpdate} />
                </div>
              </div>
            ))}
          </div>

          {/* Verdeling-pie — alleen wanneer meerdere eigenaren EN er uren zijn,
              dan heeft 't visueel iets te zeggen. Anders skip 'm. */}
          {(() => {
            const owners = item.ownerIds.filter(id => id && id !== 'unassigned')
            const total  = effectiveHours(item)
            if (owners.length < 2 || total <= 0) return null
            return <OwnerDistributionSection item={item} owners={owners} total={total} onUpdate={onUpdate} />
          })()}

          {/* Notes */}
          {(typeof item.notes === 'string' || item.notes === undefined) && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Notities
              </div>
              <textarea
                defaultValue={item.notes ?? ''}
                onBlur={e => { if (e.target.value !== (item.notes ?? '')) onUpdate({ notes: e.target.value }) }}
                placeholder="Voeg notities toe…"
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'inherit',
                  resize: 'vertical', outline: 'none',
                }} />
            </div>
          )}

          {/* Comments */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Opmerkingen
              </div>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {replies.length} {replies.length === 1 ? 'reactie' : 'reacties'}
              </span>
            </div>

            {replies.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', margin: '8px 0 14px' }}>Nog geen opmerkingen. Wees de eerste!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
                {[...replies].reverse().map(r => {
                  const mine = !!profile?.memberId && r.authorId === profile.memberId
                  return (
                    <div key={r.id} style={{
                      position: 'relative',
                      background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                      borderRadius: 10, padding: '12px 14px',
                    }}
                      onMouseEnter={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.cmt-del'); if (btn) btn.style.opacity = '1' }}
                      onMouseLeave={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.cmt-del'); if (btn) btn.style.opacity = '0' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                        <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{r.author}</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(r.createdAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>
                        {r.body}
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
                      {mine && (
                        <button className="cmt-del" onClick={() => deleteReply(r.id)}
                          title="Verwijder opmerking"
                          style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: '2px 6px', borderRadius: 4, opacity: 0, transition: 'opacity 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red, #e2445c)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                          ×
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div>
              <MentionTextarea
                value={newReply}
                onChange={setNewReply}
                onMentionsChange={setMentionIds}
                onSubmit={addReply}
                placeholder="Schrijf een opmerking… (typ @ om iemand te taggen, ⌘+Enter om te plaatsen)"
                rows={3}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button onClick={addReply} disabled={!newReply.trim()}
                  style={{ padding: '8px 16px', borderRadius: 6, border: 'none',
                    background: newReply.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                    color: newReply.trim() ? '#000' : 'var(--text-muted)',
                    fontSize: 13, fontWeight: 700, cursor: newReply.trim() ? 'pointer' : 'not-allowed' }}>
                  Plaats opmerking
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── Groep ────────────────────────────────────────────────────────────────────
function BoardGroupSection({ boardId, group, cols, colWidths, gridTemplate, selectedIds, onToggleSelect, onSelectGroup, sortBy, onToggleSort, reorderMode, onUpdateGroup, onMoveItemHere, onMoveItemsHere, onNestItem, onReparentSubitem, onUnnestSubitemHere, onDeleteGroup, onResizeCol }: {
  boardId: string
  group: BoardGroup; cols: ColumnDef[]; colWidths: Record<string, number>; gridTemplate: string
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectGroup: (groupId: string, allSelected: boolean) => void
  sortBy: { key: string; dir: 'asc' | 'desc' } | null
  onToggleSort: (key: string) => void
  reorderMode: boolean
  onUpdateGroup: (g: BoardGroup) => void
  onMoveItemHere: (itemId: string, fromGroupId: string) => void
  onMoveItemsHere: (itemIds: string[]) => void
  onNestItem:     (sourceId: string, fromGroupId: string, targetId: string) => void
  onReparentSubitem: (subitemId: string, fromParentId: string, fromGroupId: string, toParentId: string) => void
  onUnnestSubitemHere: (subitemId: string, parentItemId: string, fromGroupId: string, toGroupId: string) => void
  onDeleteGroup: () => void
  onResizeCol: (key: string, width: number) => void
}) {
  const [dropHover, setDropHover] = useState(false)
  // 'Ghost mode': zodra ergens op het bord een subitem versleept wordt,
  // krijgt elke groep een opvallende drop-zone-stijl zodat de gebruiker
  // direct ziet WAAR 'ie kan loslaten. Reset bij dragend.
  const [subDragName, setSubDragName] = useState<string | null>(null)
  useEffect(() => {
    function onStart(e: Event) {
      const ce = e as CustomEvent<{ name?: string }>
      setSubDragName(ce.detail?.name ?? 'Subitem')
    }
    function onEnd() { setSubDragName(null); setDropHover(false) }
    window.addEventListener('yoko-subitem-drag-start', onStart)
    window.addEventListener('yoko-subitem-drag-end',   onEnd)
    return () => {
      window.removeEventListener('yoko-subitem-drag-start', onStart)
      window.removeEventListener('yoko-subitem-drag-end',   onEnd)
    }
  }, [])
  const { pushUndo, showToast } = useUndo()
  // Collapsed-state komt rechtstreeks uit de group-data (gestored in
  // localStorage + Supabase via boardStore). Toggle persisteert via
  // onUpdateGroup, dus refresh onthoudt je keuze.
  const collapsed = group.collapsed ?? false
  const toggleCollapsed = () => onUpdateGroup({ ...group, collapsed: !collapsed })
  const [headerHover,  setHeaderHover]  = useState(false)
  const [editName,     setEditName]     = useState(false)
  const [nameDraft,    setNameDraft]    = useState(group.name)
  const [colorPicker,  setColorPicker]  = useState(false)
  const colorBtnRef  = useRef<HTMLButtonElement>(null)
  const dragRowRef   = useRef<number | null>(null)

  function saveName() {
    onUpdateGroup({ ...group, name: nameDraft })
    setEditName(false)
  }

  function updateItem(itemId: string, updates: Partial<BoardItem>) {
    // Multi-select: als het item in een groter selectie zit, pas de
    // wijziging op alle geselecteerde items binnen deze groep toe. Cross-
    // group bulk (zelden gebruikt) blijft per-groep.
    const bulk = selectedIds.size > 1 && selectedIds.has(itemId)
    // Google-items zijn grotendeels read-only: bij elke sync worden naam,
    // timeline, uren, deadline etc. overschreven dus lokale edits daarop
    // verdwijnen toch. Subitem-edits en status zijn wél toegestaan — de
    // sync's resolveStatus respecteert door de gebruiker gezette Done/Stuck/
    // Working etc., en subitem-state bewaren we expliciet.
    const sourceItem = group.items.find(i => i.id === itemId)
    if (sourceItem?.source === 'google') {
      const keys = Object.keys(updates)
      const allowed = keys.every(k => k === 'subitems' || k === 'status')
      if (!allowed) {
        showToast('Bewerk dit item in Google Calendar — wijzigingen hier worden bij de volgende sync overschreven')
        return
      }
    }
    // Snapshot voor undo — alleen bij geen-bulk en als er daadwerkelijk
    // iets verandert. Subitem-edits (onUpdate met subitems-array) doen we
    // ook mee, anders is een uren-correctie niet terug te draaien.
    const snapshot = { ...group, items: group.items.map(i => ({ ...i, subitems: i.subitems ? [...i.subitems] : i.subitems })) }
    onUpdateGroup({
      ...group,
      items: group.items.map(i => {
        if (!(bulk ? selectedIds.has(i.id) : i.id === itemId)) return i
        const merged: BoardItem = { ...i, ...updates }
        // estHours veranderd én item heeft ownerHours? Schaal de
        // verdeling proportioneel zodat de verhoudingen kloppen
        // met de nieuwe totalen — pie + cijfers blijven in sync.
        if ('estHours' in updates && i.ownerHours && Object.keys(i.ownerHours).length > 0) {
          const oldSum = Object.values(i.ownerHours).reduce((s, v) => s + (Number(v) || 0), 0)
          const newTotal = Number(updates.estHours) || 0
          if (oldSum > 0 && newTotal > 0 && Math.abs(oldSum - newTotal) > 0.01) {
            const factor = newTotal / oldSum
            const scaled: Record<string, number> = {}
            for (const [k, v] of Object.entries(i.ownerHours)) {
              scaled[k] = Math.round((Number(v) || 0) * factor * 10) / 10
            }
            // Rounding kan een paar tienden afwijken van newTotal —
            // corrigeer 't restje op de grootste deler zodat de som
            // EXACT klopt en de pie geen drift krijgt.
            const scaledSum = Object.values(scaled).reduce((s, v) => s + v, 0)
            const diff = Math.round((newTotal - scaledSum) * 10) / 10
            if (Math.abs(diff) >= 0.1) {
              const largest = Object.entries(scaled).sort((a, b) => b[1] - a[1])[0]
              if (largest) scaled[largest[0]] = Math.round((largest[1] + diff) * 10) / 10
            }
            merged.ownerHours = scaled
          } else if (newTotal === 0) {
            // Naar 0u: leeg de verdeling, anders blijft de pie
            // verkeerd staan met som > 0.
            merged.ownerHours = undefined
          }
        }
        // ownerIds veranderd → cleanup stale ownerHours-entries (zelfde
        // safeguard als in OwnersCell, voor bulk-updates die rechtstreeks
        // updateItem aanroepen zonder het Cell-pad).
        if ('ownerIds' in updates && i.ownerHours && Object.keys(i.ownerHours).length > 0) {
          const active = new Set(updates.ownerIds ?? [])
          const cleaned: Record<string, number> = {}
          for (const [oid, hrs] of Object.entries(i.ownerHours)) {
            if (active.has(oid)) cleaned[oid] = hrs
          }
          merged.ownerHours = Object.keys(cleaned).length > 0 ? cleaned : undefined
        }
        return merged
      }),
    })
    // Toast + undo. Cell-handlers zelf zijn silent, dus we maken hier per
    // type een leesbare regel.
    const item = group.items.find(i => i.id === itemId)
    const target = bulk
      ? `${group.items.filter(g => selectedIds.has(g.id)).length} items`
      : (item ? `'${item.name}'` : 'Item')
    let label = ''
    if ('status' in updates) {
      label = `${target} → ${updates.status || '(geen status)'}`
      showToast(label)
    } else if ('ownerIds' in updates) {
      const next = (updates.ownerIds ?? []).filter(id => id !== 'unassigned')
      const names = next.map(id => teamData.members.find(m => m.id === id)?.name?.split(' ')[0] ?? id)
      label = names.length === 0 ? `${target} niet meer toegewezen` : `${target} → ${names.join(', ')}`
      showToast(label)
    } else if ('startDate' in updates || 'endDate' in updates) {
      label = `Datums bijgewerkt op ${target}`
      showToast(label)
    } else if ('estHours' in updates) {
      label = `${target} → ${Number(updates.estHours) || 0}u`
    } else if ('dagen' in updates) {
      label = `${target} → ${Number(updates.dagen) || 0} dagen`
    } else if ('name' in updates) {
      label = `${target} hernoemd`
    } else if ('subitems' in updates) {
      label = `Subitem bijgewerkt`
    } else {
      label = `${target} bijgewerkt`
    }
    // Niet bij bulk — daar is undo via BulkActionBar al iets aparts.
    if (!bulk) pushUndo(() => onUpdateGroup(snapshot), label)
  }
  function deleteItem(itemId: string) {
    const removed = group.items.find(i => i.id === itemId)
    const idx = group.items.findIndex(i => i.id === itemId)
    const snapshot = { ...group, items: [...group.items] }
    onUpdateGroup({ ...group, items: group.items.filter(i => i.id !== itemId) })
    // Expliciet soft-deleten in Supabase. pushBoardToRemote upsert
    // alleen items die in de lokale staat staan; zonder deze call
    // blijft de remote-rij hangen en komt het item bij de volgende
    // pull terug. Soft-delete registreert óók deleted_by zodat /papierbak
    // kan tonen wie 't heeft verwijderd.
    softDeleteItem(itemId).catch(() => {})
    pushUndo(() => onUpdateGroup(snapshot), removed ? `'${removed.name}' verwijderd` : 'Item verwijderd')
    void idx
  }
  function moveItem(itemId: string, dir: -1 | 1) {
    const idx = group.items.findIndex(i => i.id === itemId)
    const next = idx + dir
    if (idx < 0 || next < 0 || next >= group.items.length) return
    const items = [...group.items]
    items[idx] = items[next]; items[next] = group.items[idx]
    onUpdateGroup({ ...group, items })
  }

  // Sorted view of items — does not mutate saved order
  function sortValue(item: BoardItem, key: string): string | number | null {
    if (key === 'name')      return item.name?.toLowerCase() ?? ''
    if (key === 'ownerIds') {
      const id = item.ownerIds?.[0]
      const m  = id ? teamData.members.find(t => t.id === id) : null
      return (m?.name ?? '~').toLowerCase()
    }
    if (key === 'status')    return STATUS_OPTIONS.findIndex(o => o.label === item.status)
    if (key === 'estHours' || key === 'dagen' || key === 'nummers') return Number(item[key] ?? 0)
    if (key === 'startDate' || key === 'endDate' || key === 'deadline' || key === 'uitzenddag' || key === 'timeline') {
      const dKey = key === 'timeline' ? 'startDate' : key
      let v = item[dKey] as string | null
      // Auto-rollup voor sortering: parent zonder eigen datum pakt 't
      // vroegste subitem (voor start) of laatste (voor end), zodat 'ie
      // op de juiste plek in de tijdlijn komt te staan.
      if (!v && (dKey === 'startDate' || dKey === 'endDate')) {
        const allSubs = (item.subitems ?? []) as Array<{ status?: string; startDate?: string | null; endDate?: string | null }>
        const activeSubs = allSubs.filter(s => s.status !== 'Done')
        const subs = activeSubs.length > 0 ? activeSubs : allSubs
        const dates = subs.map(s => dKey === 'startDate' ? s.startDate : s.endDate).filter(Boolean) as string[]
        if (dates.length > 0) {
          dates.sort()
          v = dKey === 'startDate' ? dates[0] : dates[dates.length - 1]
        }
      }
      // null laten doorvallen — de outer sort gooit null altijd onderaan,
      // ongeacht asc/desc. (MAX_SAFE_INTEGER zou items zonder datum in DESC
      // bovenaan zetten, wat raar oogt.)
      return v ? new Date(v).getTime() : null
    }
    const v = item[key]
    if (v == null) return ''
    return typeof v === 'number' ? v : String(v).toLowerCase()
  }
  const renderItems = sortBy
    ? [...group.items].sort((a, b) => {
        const av = sortValue(a, sortBy.key)
        const bv = sortValue(b, sortBy.key)
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        if (av < bv) return sortBy.dir === 'asc' ? -1 : 1
        if (av > bv) return sortBy.dir === 'asc' ? 1 : -1
        return 0
      })
    : group.items
  // Onthoud welk item zojuist via 'Voeg item toe' is aangemaakt zodat de
  // bijbehorende rij direct in name-edit-modus opent (autoFocus + select).
  // Wordt na het eerste render geconsumeerd zodat een refresh of nieuwe
  // toevoeging niet stiekem een willekeurig ander item in edit triggert.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null)
  useEffect(() => {
    if (justCreatedId == null) return
    // Defer een tick zodat de nieuwe BoardRow z'n editName-state heeft
    // kunnen initialiseren vanuit defaultEditName=true.
    const t = setTimeout(() => setJustCreatedId(null), 50)
    return () => clearTimeout(t)
  }, [justCreatedId])
  function addItem() {
    const newId = Date.now().toString()
    onUpdateGroup({ ...group, items: [...group.items, {
      id: newId, name: 'Nieuw item', ownerIds: [], status: '',
      startDate: null, endDate: null, deadline: null, estHours: 0, dagen: 0,
    }] })
    setJustCreatedId(newId)
  }

  const totHours = group.items.reduce((s, i) => s + effectiveHours(i), 0)
  const totDagen = Math.round((totHours / 8) * 10) / 10

  // Cross-group drag-and-drop. Een item kan vanuit een andere groep hier
  // gedropt worden — we accepteren alleen onze eigen dataTransfer type
  // zodat externe drags (afbeeldingen e.d.) genegeerd worden.
  function onContainerDragOver(e: React.DragEvent) {
    if (
      !e.dataTransfer.types.includes('application/x-yoko-item') &&
      !e.dataTransfer.types.includes('application/x-yoko-subitem')
    ) return
    e.preventDefault()
    if (!dropHover) setDropHover(true)
  }
  function onContainerDragLeave(e: React.DragEvent) {
    // alleen weghalen als we de container echt verlaten, niet bij child-overgangen
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false)
  }
  function onContainerDrop(e: React.DragEvent) {
    setDropHover(false)
    // Top-level item(s) naar deze groep
    const rawItem = e.dataTransfer.getData('application/x-yoko-item')
    if (rawItem) {
      try {
        const data = JSON.parse(rawItem) as { itemId: string; fromGroupId: string; itemIds?: string[] }
        // Multi-select drag: alle geselecteerde items naar deze groep.
        // Zonder de selectie was ie tegen z'n eigen drop in eerdere versie
        // niks aan 't doen — daar viel ie terug op alleen het gegrepen item.
        if (data.itemIds && data.itemIds.length > 1) {
          e.preventDefault()
          onMoveItemsHere(data.itemIds)
        } else if (data.itemId && data.fromGroupId && data.fromGroupId !== group.id) {
          e.preventDefault()
          onMoveItemHere(data.itemId, data.fromGroupId)
        }
      } catch {}
      return
    }
    // Subitem uit een ander item → un-nesten naar deze groep als top-level item
    const rawSub = e.dataTransfer.getData('application/x-yoko-subitem')
    if (rawSub) {
      try {
        const { subitemId, parentItemId, fromGroupId } = JSON.parse(rawSub) as { subitemId: string; parentItemId: string; fromGroupId: string }
        if (subitemId && parentItemId && fromGroupId) {
          e.preventDefault()
          onUnnestSubitemHere(subitemId, parentItemId, fromGroupId, group.id)
        }
      } catch {}
    }
    setSubDragName(null)
  }

  // Visual states bij subitem-drag:
  //  - subDragName !== null = ergens op het bord wordt iets gesleept
  //    → álle groepen krijgen een subtiele animerende stippel-rand
  //      ("hier kan je loslaten")
  //  - dropHover = je hovert nú boven deze groep → opvallend accent
  const isDropTarget = !!subDragName
  return (
    <GroupCtx.Provider value={{ color: group.color }}>
      <div style={{
        marginBottom: 18, borderRadius: 14, position: 'relative',
        // Eigen rondingen + kader maakt 't visueel minder hoekig en geeft
        // duidelijker een 'card per groep'-gevoel.
        border: `1px solid var(--border)`,
        overflow: 'hidden',
        outline: dropHover
          ? `3px solid ${group.color}`
          : isDropTarget
            ? `2px dashed ${group.color}88`
            : '2px dashed transparent',
        outlineOffset: -2,
        background: dropHover ? group.color + '12' : 'transparent',
        transition: 'outline 0.12s, background 0.12s',
      }}
        onDragOver={onContainerDragOver}
        onDragLeave={onContainerDragLeave}
        onDrop={onContainerDrop}>
        {/* Drop-indicator: 'Laat los om hier te plaatsen' verschijnt prominent
            in het midden zodra je boven deze groep zweeft tijdens een drag. */}
        {dropHover && subDragName && (
          <div style={{
            position: 'absolute', top: 4, right: 4, zIndex: 30,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999,
            background: group.color, color: '#fff',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>↓</span>
            <span>Verplaats &lsquo;{subDragName}&rsquo; naar {group.name}</span>
          </div>
        )}

        {/* Groep header — Monday-stijl: geen balk, geen achtergrond, alleen
            chevron + gekleurde naam + telling. De gekleurde linker-strip
            zit alleen op de inhoud (rijen) eronder. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 6px' }}
          onMouseEnter={() => setHeaderHover(true)} onMouseLeave={() => setHeaderHover(false)}>

          {/* Drag-handle voor group-reorder. Groot, altijd zichtbaar en met
              eigen hover-vlak zodat 't duidelijk is dat je hier kunt grijpen.
              Alleen dit element initieert de drag; klikken op andere header-
              elementen (kleur, naam, ×) blijft gewoon werken. */}
          <span
            draggable
            onDragStart={e => {
              e.stopPropagation()
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-yoko-group', JSON.stringify({ groupId: group.id, fromBoard: boardId }))
              // Broadcast: parent dimt de gesleepte groep zodat duidelijk
              // is welke je vasthoudt.
              window.dispatchEvent(new CustomEvent('yoko-group-drag-start', { detail: { groupId: group.id } }))
            }}
            onDragEnd={() => window.dispatchEvent(new CustomEvent('yoko-group-drag-end'))}
            title="Sleep om groep-volgorde te wijzigen"
            style={{ cursor: 'grab',
              color: 'var(--text-secondary)',
              fontSize: 20, lineHeight: 1, padding: '6px 8px', borderRadius: 6,
              flexShrink: 0, userSelect: 'none',
              background: headerHover ? 'var(--bg-hover)' : 'transparent',
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            ⠿
          </span>

          <button onClick={toggleCollapsed} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            {collapsed ? '▶' : '▼'}
          </button>

          <button ref={colorBtnRef} onClick={e => { e.stopPropagation(); setColorPicker(o => !o) }}
            title="Kleur wijzigen"
            style={{ width: 14, height: 14, borderRadius: 3, background: group.color, border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0 }} />

          {colorPicker && (
            <PortalDropdown anchor={colorBtnRef} onClose={() => setColorPicker(false)}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Groepskleur</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
                  {PALETTE.map(c => (
                    <button key={c} onClick={() => { onUpdateGroup({ ...group, color: c }); setColorPicker(false) }} style={{
                      width: 24, height: 24, borderRadius: 5, background: c,
                      border: group.color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                      cursor: 'pointer', padding: 0,
                    }} />
                  ))}
                </div>
              </div>
            </PortalDropdown>
          )}

          {editName ? (
            <input autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditName(false); setNameDraft(group.name) } }}
              style={{ ...editInput, fontSize: 14, fontWeight: 700, color: group.color, background: 'transparent', border: '1px solid ' + group.color, width: 160 }}
            />
          ) : (
            <span onClick={() => { setNameDraft(group.name); setEditName(true) }}
              style={{ fontSize: 14, fontWeight: 700, color: group.color, cursor: 'text' }}>
              {group.name}
            </span>
          )}

          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {group.items.length} items
          </span>

          {/* Group-level select-all + verwijder. Selectie-checkbox vinkt
              alle items in de groep aan/uit (handig voor bulk-acties of
              bulk-slepen). Verwijder-knop is altijd zichtbaar met label
              zodat 't niet meer raden is. */}
          {!editName && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label title="Alle items in deze groep selecteren"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={group.items.length > 0 && group.items.every(i => selectedIds.has(i.id))}
                  ref={el => { if (el) {
                    const some = group.items.some(i => selectedIds.has(i.id))
                    const all  = group.items.length > 0 && group.items.every(i => selectedIds.has(i.id))
                    el.indeterminate = some && !all
                  }}}
                  onChange={e => onSelectGroup(group.id, e.target.checked)}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                selecteer alles
              </label>
              <button onClick={e => {
                  e.stopPropagation()
                  const count = group.items.length
                  if (count > 0 && !confirm(`Groep '${group.name}' verwijderen met ${count} item${count === 1 ? '' : 's'}?`)) return
                  onDeleteGroup()
                }}
                title="Verwijder groep"
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '3px 9px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                × Verwijder
              </button>
            </div>
          )}
        </div>

        {/* Voortgangsbalk */}
        {group.items.length > 0 && (() => {
          const total   = group.items.length
          const done    = group.items.filter(i => i.status === 'Done').length
          const working = group.items.filter(i => i.status === 'Working on...').length
          const stuck   = group.items.filter(i => i.status === 'Stuck').length
          const pct     = Math.round(done / total * 100)
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 14px 6px' }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--overlay-medium)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${done / total * 100}%`, background: 'var(--green)', transition: 'width 0.3s' }} />
                <div style={{ width: `${working / total * 100}%`, background: '#ff7b24', transition: 'width 0.3s' }} />
                <div style={{ width: `${stuck / total * 100}%`, background: 'var(--red)', transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0, minWidth: 28 }}>{pct}%</span>
            </div>
          )
        })()}

        {!collapsed && (
          <div style={{ borderLeft: `4px solid ${group.color}` }}>
            {/* Kolom headers — sticky bovenaan zodat ze in beeld blijven
                tijdens scroll door lange lijsten (Monday-stijl). */}
            <div style={{ display: 'grid', gridTemplateColumns: gridTemplate,
              background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
              position: 'sticky', top: 0, zIndex: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input type="checkbox"
                  checked={group.items.length > 0 && group.items.every(i => selectedIds.has(i.id))}
                  ref={el => { if (el) el.indeterminate = group.items.some(i => selectedIds.has(i.id)) && !group.items.every(i => selectedIds.has(i.id)) }}
                  onChange={e => onSelectGroup(group.id, e.target.checked)}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 15, height: 15 }} />
              </div>
              <div style={{ position: 'relative', display: 'flex' }}>
                <button onClick={() => onToggleSort('name')}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', fontSize: 12, fontWeight: 600, color: sortBy?.key === 'name' ? 'var(--text-primary)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>
                  Item
                  {sortBy?.key === 'name' && (
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>{sortBy.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </button>
                <div title="Sleep om Item-kolom te verbreden of versmallen"
                  style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => {
                    e.preventDefault(); e.stopPropagation()
                    const startX = e.clientX
                    const startW = colWidths['name'] ?? 200
                    function onMove(ev: MouseEvent) { onResizeCol('name', startW + ev.clientX - startX) }
                    function onUp() {
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }} />
              </div>
              {cols.map(col => (
                <div key={col.key} style={{ position: 'relative', padding: '6px 8px', fontSize: 12, fontWeight: 600, color: sortBy?.key === col.key ? 'var(--text-primary)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--border-strong)', userSelect: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  onClick={() => onToggleSort(col.key)}>
                  {col.label}
                  {sortBy?.key === col.key && (
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>{sortBy.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                  <div
                    title="Kolom breder/smaller slepen"
                    style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => {
                      e.preventDefault(); e.stopPropagation()
                      const startX = e.clientX
                      const startW = colWidths[col.key] ?? col.width
                      function onMove(ev: MouseEvent) { onResizeCol(col.key, startW + ev.clientX - startX) }
                      function onUp() {
                        document.removeEventListener('mousemove', onMove)
                        document.removeEventListener('mouseup', onUp)
                      }
                      document.addEventListener('mousemove', onMove)
                      document.addEventListener('mouseup', onUp)
                    }}
                  />
                </div>
              ))}
              <div style={{ borderLeft: '1px solid var(--border)' }} />
            </div>

            {renderItems.map((item) => {
              const realIdx = group.items.findIndex(i => i.id === item.id)
              return (
              <div key={item.id} data-item-id={item.id}
                style={{ position: 'relative' }}
                onMouseEnter={e => {
                  const h = e.currentTarget.querySelector<HTMLElement>('.row-grip')
                  if (h) h.style.opacity = '1'
                }}
                onMouseLeave={e => {
                  const h = e.currentTarget.querySelector<HTMLElement>('.row-grip')
                  if (h) h.style.opacity = '0'
                }}
                onDragOver={e => {
                  const hasItem    = e.dataTransfer.types.includes('application/x-yoko-item')
                  const hasSubitem = e.dataTransfer.types.includes('application/x-yoko-subitem')
                  // Subitem-drag heeft geen dragRowRef (komt uit een
                  // andere component-context) — voor die drag toch
                  // nest-zone outline tonen zolang muis in 't middelste
                  // gedeelte van de row staat.
                  if (hasSubitem) {
                    const r = e.currentTarget.getBoundingClientRect()
                    const y = e.clientY - r.top
                    const nestZone = y > r.height * 0.25 && y < r.height * 0.75
                    if (nestZone) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      e.currentTarget.style.outline = '2px dashed var(--accent)'
                      e.currentTarget.style.outlineOffset = '-2px'
                    } else {
                      e.currentTarget.style.outline = ''
                    }
                    return
                  }
                  if (hasItem && dragRowRef.current === null) return
                  if (dragRowRef.current === null || dragRowRef.current === realIdx) {
                    e.currentTarget.style.outline = ''
                    return
                  }
                  // Drop-zone-detectie: middelste 50% van de rij = nest;
                  // bovenste/onderste 25% = reorder. Geeft een natuurlijke
                  // "drop on item" vs "drop between items" gesture zonder
                  // dat je een modifier-key hoeft te kennen.
                  const r = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - r.top
                  const nestZone = y > r.height * 0.25 && y < r.height * 0.75
                  if (nestZone) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    e.currentTarget.style.outline = '2px dashed var(--accent)'
                    e.currentTarget.style.outlineOffset = '-2px'
                    return
                  }
                  e.currentTarget.style.outline = ''
                  // Bij actieve sort zou handmatig reorderen toch onzichtbaar
                  // zijn — sla within-group reorder over.
                  if (sortBy) return
                  e.preventDefault()
                  const next = [...group.items]
                  const [moved] = next.splice(dragRowRef.current, 1)
                  next.splice(realIdx, 0, moved)
                  dragRowRef.current = realIdx
                  onUpdateGroup({ ...group, items: next })
                }}
                onDragLeave={e => { e.currentTarget.style.outline = '' }}
                onDrop={e => {
                  e.currentTarget.style.outline = ''
                  const r = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - r.top
                  const nestZone = y > r.height * 0.25 && y < r.height * 0.75
                  if (!nestZone) return
                  // Top-level item gesleept op dit item -> nest 'm hieronder.
                  const rawItem = e.dataTransfer.getData('application/x-yoko-item')
                  if (rawItem) {
                    try {
                      const data = JSON.parse(rawItem) as { itemId: string; fromGroupId: string; fromBoard?: string }
                      if (!data.itemId || data.itemId === item.id) return
                      if (data.fromBoard && data.fromBoard !== boardId) return
                      e.preventDefault()
                      onNestItem(data.itemId, data.fromGroupId, item.id)
                    } catch {}
                    return
                  }
                  // Subitem uit een ander item gesleept op dit item ->
                  // verhuis 'm onder dit item.
                  const rawSub = e.dataTransfer.getData('application/x-yoko-subitem')
                  if (rawSub) {
                    try {
                      const data = JSON.parse(rawSub) as { subitemId: string; parentItemId: string; fromGroupId: string }
                      if (!data.subitemId || !data.parentItemId || data.parentItemId === item.id) return
                      e.preventDefault()
                      onReparentSubitem(data.subitemId, data.parentItemId, data.fromGroupId, item.id)
                    } catch {}
                  }
                }}
                onDragEnd={() => { dragRowRef.current = null }}>
                {/* Drag-handle: alleen via dit puntje kun je een rij verslepen
                    naar een andere groep. Vroeger was de hele rij draggable —
                    daardoor sleepte je per ongeluk uit de groep zodra je een
                    cel wilde aanklikken om te bewerken. */}
                {!reorderMode && (
                  <span draggable
                    className="row-grip"
                    title="Sleep om te verplaatsen tussen groepen"
                    onDragStart={e => {
                      dragRowRef.current = realIdx
                      e.dataTransfer.effectAllowed = 'move'
                      const isMulti = selectedIds.has(item.id) && selectedIds.size > 1
                      const itemIds = isMulti ? Array.from(selectedIds) : [item.id]
                      e.dataTransfer.setData('application/x-yoko-item', JSON.stringify({
                        itemId: item.id, fromGroupId: group.id, fromBoard: boardId,
                        itemIds,
                      }))
                      // Drag-image = hele rij ipv alleen 't grip-icoontje,
                      // anders ziet de gebruiker bij 't slepen alleen een
                      // puntjes-blok zweven.
                      const row = e.currentTarget.parentElement
                      if (row) e.dataTransfer.setDragImage(row, 20, 12)
                    }}
                    style={{
                      position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                      width: 18, height: 32,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'grab', userSelect: 'none',
                      color: 'var(--text-secondary)', fontSize: 18, fontWeight: 700, lineHeight: 1,
                      opacity: 0, transition: 'opacity 0.12s',
                      zIndex: 5,
                      background: 'linear-gradient(to right, var(--bg-card) 70%, transparent)',
                    }}>⠿</span>
                )}
                <BoardRow item={item} cols={cols} gridTemplate={gridTemplate} groupId={group.id}
                  selected={selectedIds.has(item.id)}
                  accentColor={group.color}
                  onToggleSelect={() => onToggleSelect(item.id)}
                  selectedIds={selectedIds}
                  onToggleSubitem={onToggleSelect}
                  reorderMode={reorderMode}
                  isFirst={realIdx === 0}
                  isLast={realIdx === group.items.length - 1}
                  defaultEditName={item.id === justCreatedId}
                  colWidths={colWidths} onResizeCol={onResizeCol}
                  onMoveUp={() => moveItem(item.id, -1)}
                  onMoveDown={() => moveItem(item.id, 1)}
                  onUpdate={u => updateItem(item.id, u)} onDelete={() => deleteItem(item.id)} />
              </div>
              )
            })}

            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
              <button onClick={addItem} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                + Voeg item toe
              </button>
            </div>

            {group.items.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, borderBottom: '2px solid var(--border)', background: 'var(--overlay-faint)' }}>
                <div />
                <div style={{ padding: '5px 14px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Som</div>
                {cols.map(col => (
                  <div key={col.key} style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderLeft: '1px solid var(--border)', fontWeight: 600 }}>
                    {col.key === 'estHours' ? `${totHours}u` : col.key === 'dagen' ? totDagen : ''}
                  </div>
                ))}
                <div style={{ borderLeft: '1px solid var(--border)' }} />
              </div>
            )}
          </div>
        )}
      </div>
    </GroupCtx.Provider>
  )
}

// Auto-move Done items → de helper-functie zit nu in lib/doneAutoMove.ts
// zodat zowel deze UI-laag als de auto-status sweep 'm gebruiken.

// ─── Kolom-manager knop ─ popup om kolommen te (de)activeren, herordenen, toevoegen ──
const AVAILABLE_COLUMNS: ColumnDef[] = [
  { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90  },
  { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
  { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
  { key: 'deadline',       label: 'Deadline',       type: 'date',      width: 105 },
  { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
  { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
  { key: 'notes',          label: 'Notes',          type: 'text',      width: 160 },
  { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
  { key: 'framelink',      label: 'Frame link',     type: 'url',       width: 110 },
  { key: 'uitzenddag',     label: 'Uitzenddag',     type: 'date',      width: 105 },
  { key: 'nummers',        label: 'Nummers',        type: 'currency',  width: 110 },
]

function ColumnManagerButton({ boardId, columns, color }: {
  boardId: string
  columns: ColumnDef[]
  color:   string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Lokale werk-set, gesynchroniseerd met de prop. Mutaties commit'ten
  // direct naar setBoardColumns zodat de tabel meteen meebeweegt en de
  // wijziging via Supabase rondgaat.
  const [list, setList] = useState<ColumnDef[]>(columns)
  useEffect(() => { setList(columns) }, [columns])

  function commit(next: ColumnDef[]) {
    setList(next)
    setBoardColumns(boardId, next)
  }
  function remove(key: string)   { commit(list.filter(c => c.key !== key)) }
  function moveUp(idx: number)   { if (idx <= 0) return; const n = [...list]; [n[idx-1], n[idx]] = [n[idx], n[idx-1]]; commit(n) }
  function moveDown(idx: number) { if (idx >= list.length - 1) return; const n = [...list]; [n[idx], n[idx+1]] = [n[idx+1], n[idx]]; commit(n) }
  function add(col: ColumnDef)   { commit([...list, col]) }

  const usedKeys = new Set(list.map(c => c.key))
  const addable  = AVAILABLE_COLUMNS.filter(c => !usedKeys.has(c.key))

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        title="Kolommen beheren — toevoegen, verwijderen, herordenen"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--bg-card)',
          color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', outline: 'none',
        }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3"  y="4" width="5" height="16" rx="1" />
          <rect x="9.5" y="4" width="5" height="16" rx="1" />
          <rect x="16" y="4" width="5" height="16" rx="1" />
        </svg>
        Kolommen
      </button>
      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 12, minWidth: 280,
            boxShadow: '0 10px 36px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Kolommen
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {list.map((c, idx) => (
                <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: 6, background: 'var(--overlay-faint)' }}>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)' }}>{c.label}</span>
                  <button onClick={() => moveUp(idx)}   disabled={idx === 0}
                    title="Naar links"
                    style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: idx === 0 ? 'var(--text-muted)' : color, padding: '2px 5px', fontSize: 13 }}>◀</button>
                  <button onClick={() => moveDown(idx)} disabled={idx === list.length - 1}
                    title="Naar rechts"
                    style={{ background: 'none', border: 'none', cursor: idx === list.length - 1 ? 'not-allowed' : 'pointer', color: idx === list.length - 1 ? 'var(--text-muted)' : color, padding: '2px 5px', fontSize: 13 }}>▶</button>
                  <button onClick={() => { if (window.confirm(`Kolom '${c.label}' verbergen?`)) remove(c.key) }}
                    title="Verwijderen"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e2445c', padding: '2px 5px', fontSize: 13 }}>×</button>
                </div>
              ))}
            </div>
            {addable.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 5px' }}>
                  Toevoegen
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {addable.map(c => (
                    <button key={c.key} onClick={() => add(c)}
                      style={{ padding: '4px 9px', borderRadius: 999,
                        border: '1px solid var(--border-light)', background: 'var(--bg-card)',
                        color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                      + {c.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </PortalDropdown>
      )}
    </>
  )
}

// ─── Periode-filter knop ─ chic pill die RangeCalendar opent ─────────────────
function PeriodFilterButton({ from, until, color, onChange }: {
  from: string; until: string; color: string
  onChange: (from: string | null, until: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const hasAny = !!(from || until)

  const label = (() => {
    if (!hasAny) return 'Periode'
    if (from && until) return fmtRange(from, until)
    if (from)          return `vanaf ${fmtDate(from)}`
    return `tot ${fmtDate(until)}`
  })()

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        title="Filter op periode (overlap met timeline)"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderRadius: 8,
          border: hasAny ? `1px solid ${color}66` : '1px solid var(--border)',
          background: hasAny ? color + '18' : 'var(--bg-card)',
          color: hasAny ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: 14, cursor: 'pointer', outline: 'none', fontWeight: hasAny ? 600 : 400,
        }}>
        <span aria-hidden style={{ display: 'inline-flex' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <line x1="16" y1="3" x2="16" y2="7" />
            <line x1="8" y1="3" x2="8" y2="7" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <span>{label}</span>
      </button>
      {open && (
        <PortalDropdown anchor={btnRef} onClose={() => setOpen(false)}>
          <RangeCalendar
            startDate={from || null} endDate={until || null} color={color}
            onChange={(s, e) => onChange(s, e)}
          />
        </PortalDropdown>
      )}
    </>
  )
}

// ─── BoardTable (hoofd component) ─────────────────────────────────────────────
type BoardTableProps = {
  boardId: string
  title: string; emoji: string; color: string
  columns: ColumnDef[]; groups: BoardGroup[]
  onChange: (groups: BoardGroup[]) => void
  onRenameTitle?: (label: string) => void
}

export default function BoardTable({ boardId, title, emoji, color, columns, groups, onChange: rawOnChange, onRenameTitle }: BoardTableProps) {
  const storageKey = `board-col-widths-${title}`
  // DEDUPE VERWIJDERD — de name+dates+uren matching was te agressief en
  // gooide rechtmatige top-level items weg (Gerolsteiner etc) wanneer
  // er ergens 'n subitem met dezelfde data bestond. Geen autodedupe meer.
  const onChange = (next: BoardGroup[]) => rawOnChange(autoMoveDoneItems(next))
  const { profile } = useProfile()
  const { pushUndo } = useUndo()
  useEffect(() => { setCurrentActor(profile?.memberId ?? null) }, [profile?.memberId])

  // Focus-from-link: een planning-popup of #item-mention kan linken naar
  // `?focus=<itemId>`. Klap de groep open als-ie dicht zit, scroll naar
  // de rij, en flash 'em zodat je oog er heen wordt getrokken.
  // window.location.search ipv useSearchParams() — zie import-blok hierboven.
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    function read() {
      if (typeof window === 'undefined') return null
      return new URLSearchParams(window.location.search).get('focus')
    }
    setFocusId(read())
    const onNav = () => setFocusId(read())
    window.addEventListener('popstate', onNav)
    return () => window.removeEventListener('popstate', onNav)
  }, [])
  const lastFocusedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusId || lastFocusedRef.current === focusId) return
    const targetGroup = groups.find(g => g.items.some(i => i.id === focusId))
    if (!targetGroup) return  // item bestaat nog niet (of staat in een ander bord)
    lastFocusedRef.current = focusId
    if (targetGroup.collapsed) {
      rawOnChange(groups.map(g => g.id === targetGroup.id ? { ...g, collapsed: false } : g))
    }
    // Wacht twee frames zodat de eventueel-uitgeklapte groep gerenderd is.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(focusId)}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('yoko-focus-flash')
      setTimeout(() => el.classList.remove('yoko-focus-flash'), 2400)
    }))
  // We willen alleen reageren op focusId-wijzigingen, niet op groups-changes
  // die anders een retrigger zouden veroorzaken na het uitklappen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  function initWidths(): Record<string, number> {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return Object.fromEntries(columns.map(c => [c.key, c.width]))
  }

  const [colWidths,     setColWidths]    = useState<Record<string, number>>(initWidths)
  const [search,        setSearch]       = useState('')
  const [filterOwner,   setFilterOwner]  = useState('')
  const [filterStatus,  setFilterStatus] = useState('')
  // Periode-filter blijft persistent per bord in localStorage zodat
  // de gebruiker bij terugkeer niet opnieuw datums hoeft te tikken.
  const periodKey = `yoko:periodFilter:${boardId}`
  const [filterFrom,    setFilterFrom]   = useState('')  // YYYY-MM-DD
  const [filterUntil,   setFilterUntil]  = useState('')
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(periodKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as { from?: string; until?: string }
      if (parsed.from)  setFilterFrom(parsed.from)
      if (parsed.until) setFilterUntil(parsed.until)
    } catch {}
  }, [periodKey])
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (filterFrom || filterUntil) {
        window.localStorage.setItem(periodKey, JSON.stringify({ from: filterFrom, until: filterUntil }))
      } else {
        window.localStorage.removeItem(periodKey)
      }
    } catch {}
    if (filterFrom && filterUntil) pushRecentPeriod(filterFrom, filterUntil)
  }, [periodKey, filterFrom, filterUntil])
  const [editingTitle,  setEditingTitle] = useState(false)
  const [selectedIds,   setSelectedIds]  = useState<Set<string>>(new Set())
  // Default sort: timeline-asc — items met vroegste startdatum komen
  // boven, zodat je in één oogopslag ziet wat eerst aan de beurt is.
  // Klik op een kolom-header overschrijft dit.
  const [sortBy,        setSortBy]       = useState<{ key: string; dir: 'asc' | 'desc' } | null>({ key: 'timeline', dir: 'asc' })
  const [reorderMode,   setReorderMode]  = useState(false)
  // Visuele feedback bij groep-drag: welke groep wordt nu over-gehoverd,
  // en aan welke kant (boven/onder) zou de gesleepte groep landen?
  // Wordt door de drop-handler weer leeggemaakt.
  const [groupDrop,     setGroupDrop]    = useState<{ groupId: string; side: 'before' | 'after' } | null>(null)
  const [groupDragging, setGroupDragging] = useState<string | null>(null)
  useEffect(() => {
    function onStart(e: Event) {
      const detail = (e as CustomEvent<{ groupId: string }>).detail
      setGroupDragging(detail?.groupId ?? null)
    }
    function onEnd() { setGroupDragging(null); setGroupDrop(null) }
    window.addEventListener('yoko-group-drag-start', onStart)
    window.addEventListener('yoko-group-drag-end',   onEnd)
    return () => {
      window.removeEventListener('yoko-group-drag-start', onStart)
      window.removeEventListener('yoko-group-drag-end',   onEnd)
    }
  }, [])
  const [titleDraft,    setTitleDraft]   = useState(title)
  const [dedupOpen,     setDedupOpen]    = useState(false)
  const [activityOpen,  setActivityOpen] = useState(false)
  const [trashOpen,     setTrashOpen]    = useState(false)
  const [recoveryOpen,  setRecoveryOpen] = useState(false)

  function resizeCol(key: string, newWidth: number) {
    const updated = { ...colWidths, [key]: Math.max(60, newWidth) }
    setColWidths(updated)
    try { localStorage.setItem(storageKey, JSON.stringify(updated)) } catch { /* ignore */ }
  }

  function addGroup() {
    // Append aan het einde — saveBoard schrijft position = array-index,
    // dus de nieuwe groep krijgt de hoogste position en verschijnt
    // onderaan na de eerstvolgende pull. Voorkomt dat 'ie bovenaan
    // landt en bestaande groepen overschaduwt.
    onChange([...groups, { id: Date.now().toString(), name: 'Nieuwe groep', color, collapsed: false, items: [] }])
  }

  const hasFilter = !!(search || filterOwner || filterStatus || filterFrom || filterUntil)

  const filteredGroups = useMemo(() => {
    if (!hasFilter) return groups
    const from = filterFrom ? new Date(filterFrom).getTime() : null
    const until = filterUntil ? new Date(filterUntil).getTime() + 86400000 - 1 : null
    const overlapsRange = (s: string | null | undefined, e: string | null | undefined) => {
      if (!s) return false
      const ms = new Date(s).getTime()
      const me = e ? new Date(e).getTime() + 86400000 - 1 : ms + 86400000 - 1
      if (from  !== null && me < from)  return false
      if (until !== null && ms > until) return false
      return true
    }
    // Pro-rate de estHours van een item/subitem naar het deel van zijn span
    // dat binnen [from, until] valt. 20u over 58 dagen, filter 24 dagen
    // overlappend → 8.3u. Bij ontbrekende datums of geen filter blijft het
    // origineel staan.
    const prorate = (hours: number, startISO: string | null | undefined, endISO: string | null | undefined): number => {
      if (from === null && until === null) return hours
      if (!startISO) return hours
      const span = daysInclusive(startISO, endISO)
      if (span === 0) return hours
      const overlap = overlapDays(startISO, endISO, from, until)
      if (overlap === 0) return 0
      return Math.round(hours * (overlap / span) * 10) / 10
    }
    return groups.map(g => ({
      ...g,
      items: g.items
        .filter(item => {
          if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
          if (filterOwner && !item.ownerIds.includes(filterOwner)) return false
          if (filterStatus && item.status !== filterStatus) return false
          // Periode-filter: item moet OVERLAPPEN met de gekozen range.
          // Subitems tellen ook mee — een parent zonder eigen datum maar met
          // subitems in maart hoort óók in het maart-filter te verschijnen.
          if (from !== null || until !== null) {
            const parentOver = overlapsRange(item.startDate, item.endDate)
            const subOver    = (item.subitems ?? []).some(s => overlapsRange(s.startDate, s.endDate))
            if (!parentOver && !subOver) return false
          }
          return true
        })
        .map(item => {
          if (from === null && until === null) return item
          // Pro-rate: bij actief periode-filter schalen we uren naar
          // het deel dat ECHT in de range valt. Display (cel + Som +
          // Totaal) toont de eerlijk-verdeelde uren; bewerken werkt
          // tegen de ECHTE estHours via __originalEstHours.
          if (item.subitems && item.subitems.length > 0) {
            const visible = item.subitems.filter(s => overlapsRange(s.startDate, s.endDate))
            const subs = visible.length > 0 ? visible : item.subitems
            const prorated = subs.map(s => {
              const orig = Number(s.estHours) || 0
              return {
                ...s,
                estHours: prorate(orig, s.startDate, s.endDate),
                __originalEstHours: orig,
              }
            })
            const ownOrig = Number(item.estHours) || 0
            const ownPro  = prorate(ownOrig, item.startDate, item.endDate)
            return {
              ...item,
              subitems: prorated,
              estHours: ownPro,
              __originalEstHours: ownOrig,
              __prorated: true,
            } as BoardItem
          }
          // Top-level zonder subs: zelfde aanpak.
          const newHours = prorate(Number(item.estHours) || 0, item.startDate, item.endDate)
          let proOwnerHours = item.ownerHours
          if (item.ownerHours && Object.keys(item.ownerHours).length > 0) {
            const oldHours = Number(item.estHours) || 0
            if (oldHours > 0) {
              const factor = newHours / oldHours
              const scaled: Record<string, number> = {}
              for (const [k, v] of Object.entries(item.ownerHours)) {
                scaled[k] = Math.round((Number(v) || 0) * factor * 10) / 10
              }
              proOwnerHours = scaled
            }
          }
          return {
            ...item,
            estHours: newHours,
            ownerHours: proOwnerHours,
            __originalEstHours: Number(item.estHours) || 0,
            __prorated: true,
          } as BoardItem
        }),
    })).filter(g => g.items.length > 0)
  }, [groups, search, filterOwner, filterStatus, filterFrom, filterUntil, hasFilter])

  const allOwners = useMemo(() => {
    const ids = new Set<string>()
    groups.forEach(g => g.items.forEach(i => i.ownerIds.forEach(id => ids.add(id))))
    return Array.from(ids)
  }, [groups])

  // Quick-filter chips & dropdown tonen iedereen die in team.json zit —
  // niet alleen @studioyoko.nl-medewerkers. Freelancers (Fokke, Marcus,
  // Marieke etc.) horen er ook bij als ze owner van een item zijn. Wat
  // we wél uitsluiten: 'unassigned' en gcal-contactpersonen die niet in
  // team.json staan (die zouden de chip-rij vol-pollutten).
  const yokoOwners = useMemo(() => {
    return allOwners.filter(id => {
      if (!id || id === 'unassigned') return false
      return teamData.members.some(t => t.id === id)
    })
  }, [allOwners])

  const isMobile = useIsMobile()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreBtnRef = useRef<HTMLButtonElement>(null)

  // Un-nest een subitem terug naar een top-level item in de gekozen groep.
  // Subitem verdwijnt uit z'n parent.subitems en verschijnt als nieuw
  // BoardItem onderaan de doel-groep.
  // Verhuis een subitem van de ene parent naar een andere parent. Beide
  // parents kunnen in verschillende groepen zitten. Geen top-level rij
  // wordt aangeraakt.
  function reparentSubitem(subitemId: string, fromParentId: string, fromGroupId: string, toParentId: string) {
    if (fromParentId === toParentId) return
    const fromGroup = groups.find(g => g.id === fromGroupId)
    const parent    = fromGroup?.items.find(i => i.id === fromParentId)
    const sub       = parent?.subitems?.find(s => s.id === subitemId)
    if (!parent || !sub) return
    onChange(groups.map(g => {
      let items = g.items.map(i => {
        if (i.id === fromParentId) {
          return { ...i, subitems: (i.subitems ?? []).filter(s => s.id !== subitemId) }
        }
        if (i.id === toParentId) {
          const already = (i.subitems ?? []).some(s => s.id === sub.id)
          if (already) return i
          return { ...i, subitems: [...(i.subitems ?? []), sub] }
        }
        return i
      })
      return { ...g, items }
    }))
  }

  function unnestSubitemHere(subitemId: string, parentItemId: string, fromGroupId: string, toGroupId: string) {
    const fromGroup = groups.find(g => g.id === fromGroupId)
    const parent    = fromGroup?.items.find(i => i.id === parentItemId)
    const sub       = parent?.subitems?.find(s => s.id === subitemId)
    if (!fromGroup || !parent || !sub) return
    const promoted: BoardItem = {
      id:         sub.id,
      name:       sub.name,
      ownerIds:   sub.ownerIds ?? [],
      status:     sub.status ?? '',
      startDate:  sub.startDate ?? null,
      endDate:    sub.endDate ?? null,
      deadline:   null,
      estHours:   Number(sub.estHours) || 0,
      dagen:      0,
      startTime:  (sub as { startTime?: string | null }).startTime ?? null,
      endTime:    (sub as { endTime?:   string | null }).endTime   ?? null,
    } as BoardItem
    onChange(groups.map(g => {
      // BELANGRIJK: een groep kan tegelijk de bron-groep én de doel-groep
      // zijn (subitem in dezelfde groep terugplaatsen). Daarom apply'en we
      // beide transformaties cumulatief op dezelfde `next`-kopie ipv te
      // early-returnen — anders verdwijnt 't item bij same-group unnest.
      let next = g
      if (g.id === fromGroupId) {
        next = {
          ...next,
          items: next.items.map(i =>
            i.id === parentItemId
              ? { ...i, subitems: (i.subitems ?? []).filter(s => s.id !== subitemId) }
              : i
          ),
        }
      }
      if (g.id === toGroupId) {
        const exists = next.items.some(i => i.id === promoted.id)
        if (!exists) next = { ...next, items: [...next.items, promoted] }
      }
      return next
    }))
  }

  // Sleep een item van de ene groep naar de andere. Aangeroepen vanuit de
  // drop-handler op de doel-groep zodra een item er overheen wordt gelaten.
  function moveItemBetweenGroups(itemId: string, fromGroupId: string, toGroupId: string) {
    if (fromGroupId === toGroupId) return
    const fromGroup = groups.find(g => g.id === fromGroupId)
    const item = fromGroup?.items.find(i => i.id === itemId)
    if (!item) return
    onChange(groups.map(g => {
      if (g.id === fromGroupId) return { ...g, items: g.items.filter(i => i.id !== itemId) }
      if (g.id === toGroupId)   return { ...g, items: [...g.items, item] }
      return g
    }))
  }

  // Verplaats meerdere items in één keer naar `toGroupId`. We zoeken ze
  // op id over alle groepen heen (sneller dan per item een aparte
  // onChange-pass) en plakken ze in de doel-groep in de oude volgorde.
  function moveItemsBetweenGroups(itemIds: string[], toGroupId: string) {
    if (itemIds.length === 0) return
    const idSet = new Set(itemIds)
    const collected: BoardItem[] = []
    for (const g of groups) {
      for (const it of g.items) if (idSet.has(it.id)) collected.push(it)
    }
    if (collected.length === 0) return
    onChange(groups.map(g => {
      const filtered = g.id === toGroupId ? g.items : g.items.filter(i => !idSet.has(i.id))
      if (g.id !== toGroupId) {
        return filtered.length === g.items.length ? g : { ...g, items: filtered }
      }
      // Doel-groep: voeg alleen items toe die nog niet aanwezig waren.
      const existing = new Set(g.items.map(i => i.id))
      const toAdd = collected.filter(i => !existing.has(i.id))
      if (toAdd.length === 0) return g
      return { ...g, items: [...g.items, ...toAdd] }
    }))
  }

  // Nest source-item ALS subitem van target-item. Source verdwijnt uit z'n
  // groep, target krijgt 'm onderaan z'n subitems-lijst. Alleen relevante
  // velden gaan mee (subitem-schema is een subset van item-schema).
  function nestItemUnder(sourceId: string, fromGroupId: string, targetId: string) {
    if (sourceId === targetId) return
    const fromGroup = groups.find(g => g.id === fromGroupId)
    const source    = fromGroup?.items.find(i => i.id === sourceId)
    if (!source) return
    const sub: SubItem = {
      id:        source.id,
      name:      source.name,
      ownerIds:  source.ownerIds ?? [],
      status:    source.status ?? '',
      startDate: source.startDate ?? null,
      endDate:   source.endDate ?? null,
      // Tijden meenemen — anders vallen Google-events zonder reden in het
      // 'De hele dag'-blok van de Week-view zodra ze als subitem genest zijn.
      startTime: (source as { startTime?: string | null }).startTime ?? null,
      endTime:   (source as { endTime?:   string | null }).endTime   ?? null,
      // Bron-link + Meet-link bewaren zodat 'Open in Google ↗' en de Meet-pill
      // op de subitem-rij ook blijven werken na nesting.
      externalLink: (source as { externalLink?: string | null }).externalLink ?? null,
      meetLink:     (source as { meetLink?:     string | null }).meetLink     ?? null,
      source:       source.source,
      estHours:  Number(source.estHours) || 0,
    }
    // Onthoud de nesting-keuze voor Google-items: een volgende episode met
    // vergelijkbare naam plaatsen we dan automatisch onder dezelfde parent.
    if (source.source === 'google') {
      const target = groups.flatMap(g => g.items).find(i => i.id === targetId)
      if (target) addSubitemRule(source.name, boardId, targetId, target.name)
    }
    onChange(groups.map(g => {
      let items = g.items
      if (g.id === fromGroupId) items = items.filter(i => i.id !== sourceId)
      items = items.map(i => {
        if (i.id !== targetId) return i
        const exists = (i.subitems ?? []).some(s => s.id === sub.id)
        if (exists) return i
        return { ...i, subitems: [...(i.subitems ?? []), sub] }
      })
      return { ...g, items }
    }))
    // Top-level row ook in Supabase wegzetten. pushBoardToRemote upsert
    // alleen items die in de lokale staat staan; zonder expliciete soft-
    // delete blijft de oude top-level rij in DB en komt 'ie bij de
    // volgende pull terug, dus duplicaat (parent met subitem + losse
    // top-level item).
    softDeleteItem(sourceId).catch(() => {})
  }

  function handleUpdateGroup(updatedGroup: BoardGroup) {
    if (!hasFilter) {
      onChange(groups.map(g => g.id === updatedGroup.id ? updatedGroup : g))
      return
    }
    onChange(groups.map(orig => {
      if (orig.id !== updatedGroup.id) return orig
      const filteredItems = filteredGroups.find(fg => fg.id === orig.id)?.items ?? []
      const updatedById   = new Map(updatedGroup.items.map(i => [i.id, i]))
      const removedIds    = new Set(filteredItems.filter(i => !updatedById.has(i.id)).map(i => i.id))
      return {
        ...updatedGroup,
        items: [
          ...orig.items.filter(i => !removedIds.has(i.id)).map(i => updatedById.get(i.id) ?? i),
          ...updatedGroup.items.filter(i => !orig.items.find(o => o.id === i.id)),
        ],
      }
    }))
  }

  function handleDeleteGroup(id: string) {
    onChange(groups.filter(g => g.id !== id))
  }

  function exportCSV() {
    const rows: string[][] = [['Item', ...columns.map(c => c.label)]]
    groups.forEach(g => {
      rows.push([`--- ${g.name} ---`, ...columns.map(() => '')])
      g.items.forEach(i => {
        rows.push([
          i.name,
          ...columns.map(c => {
            if (c.type === 'owners')    return (i.ownerIds as string[]).join(', ')
            if (c.type === 'daterange') return `${i.startDate ?? ''} → ${i.endDate ?? ''}`
            return String(i[c.key] ?? '')
          }),
        ])
      })
    })
    const csv  = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${title}.csv`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const nameW = colWidths['name'] ?? 200
  // Eerste kolom (checkbox) iets breder zodat er meer ademruimte zit
  // tussen het drag-handle (⠿ links) en de checkbox die erin staat.
  const gridTemplate = `48px ${nameW}px ${columns.map(c => `${colWidths[c.key] ?? c.width}px`).join(' ')} 36px`

  const resultCount = filteredGroups.reduce((s, g) => s + g.items.length, 0)

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectGroup(groupId: string, allSelected: boolean) {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    setSelectedIds(prev => {
      const n = new Set(prev)
      for (const i of group.items) {
        if (allSelected) n.add(i.id); else n.delete(i.id)
      }
      return n
    })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  function bulkUpdate(patch: Partial<BoardItem>) {
    if (selectedIds.size === 0) return
    // Notificeer bij bulk-status-wijziging (alleen voor top-level items)
    if (patch.status !== undefined) {
      for (const g of groups) for (const i of g.items) {
        if (selectedIds.has(i.id) && i.status !== patch.status) {
          notifyOwnersOfStatusChange(i, i.status, patch.status)
        }
      }
    }
    // Subitem-velden zijn een subset van BoardItem-velden — alleen de
    // velden die het SubItem-schema kent kopiëren we mee.
    const subPatch: Partial<SubItem> = {}
    if ('status'    in patch) subPatch.status    = patch.status as string
    if ('ownerIds'  in patch) subPatch.ownerIds  = patch.ownerIds as string[]
    if ('startDate' in patch) subPatch.startDate = patch.startDate as string | null
    if ('endDate'   in patch) subPatch.endDate   = patch.endDate as string | null
    if ('estHours'  in patch) subPatch.estHours  = patch.estHours as number
    const hasSubPatch = Object.keys(subPatch).length > 0
    onChange(groups.map(g => ({
      ...g,
      items: g.items.map(i => {
        let nextItem = selectedIds.has(i.id) ? { ...i, ...patch } : i
        // ownerIds/estHours consistency check ook in bulk-pad. Anders
        // raken ownerHours stale wanneer een bulk-owner-wijziging eigenaren
        // wegneemt of een bulk-uren-wijziging totalen verandert.
        if (selectedIds.has(i.id)) {
          if ('ownerIds' in patch && nextItem.ownerHours && Object.keys(nextItem.ownerHours).length > 0) {
            const active = new Set(patch.ownerIds ?? [])
            const cleaned: Record<string, number> = {}
            for (const [oid, hrs] of Object.entries(nextItem.ownerHours)) {
              if (active.has(oid)) cleaned[oid] = hrs
            }
            nextItem = { ...nextItem, ownerHours: Object.keys(cleaned).length > 0 ? cleaned : undefined }
          }
          if ('estHours' in patch && i.ownerHours && Object.keys(i.ownerHours).length > 0) {
            const oldSum = Object.values(i.ownerHours).reduce((s, v) => s + (Number(v) || 0), 0)
            const newTotal = Number(patch.estHours) || 0
            if (oldSum > 0 && newTotal > 0 && Math.abs(oldSum - newTotal) > 0.01) {
              const factor = newTotal / oldSum
              const scaled: Record<string, number> = {}
              for (const [k, v] of Object.entries(i.ownerHours)) {
                scaled[k] = Math.round((Number(v) || 0) * factor * 10) / 10
              }
              nextItem = { ...nextItem, ownerHours: scaled }
            } else if (newTotal === 0) {
              nextItem = { ...nextItem, ownerHours: undefined }
            }
          }
        }
        if (hasSubPatch && nextItem.subitems && nextItem.subitems.length > 0) {
          const subs = nextItem.subitems.map(s => selectedIds.has(s.id) ? { ...s, ...subPatch } : s)
          if (subs.some((s, idx) => s !== nextItem.subitems![idx])) nextItem = { ...nextItem, subitems: subs }
        }
        return nextItem
      }),
    })))
  }
  function bulkDelete() {
    if (selectedIds.size === 0) return
    // Geen confirm-dialog meer — undo-toast vangt vergissingen op.
    const snapshot = groups.map(g => ({ ...g, items: [...g.items.map(i => ({ ...i, subitems: i.subitems ? [...i.subitems] : i.subitems }))] }))
    const count = selectedIds.size
    onChange(groups.map(g => ({
      ...g,
      items: g.items
        .filter(i => !selectedIds.has(i.id))
        .map(i => i.subitems && i.subitems.some(s => selectedIds.has(s.id))
          ? { ...i, subitems: i.subitems.filter(s => !selectedIds.has(s.id)) }
          : i),
    })))
    pushUndo(() => onChange(snapshot), `${count} item${count === 1 ? '' : 's'} verwijderd`)
    clearSelection()
  }
  function toggleSort(key: string) {
    // Tweetallig: nieuwe kolom start op asc (eerstvolgende eerst), volgende
    // klik flipt naar desc, daarna weer asc. Geen 'geen sortering'-stand —
    // de tabel is altijd op iets gesorteerd.
    setSortBy(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  function bulkMoveTo(targetGroupId: string) {
    if (selectedIds.size === 0) return
    const moved: BoardItem[] = []
    const stripped = groups.map(g => ({
      ...g,
      items: g.items.filter(i => {
        if (!selectedIds.has(i.id)) return true
        moved.push(i); return false
      }),
    }))
    onChange(stripped.map(g => g.id === targetGroupId ? { ...g, items: [...g.items, ...moved] } : g))
    clearSelection()
  }

  return (
    <div style={{ padding: '32px 32px 64px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Agenda</span>
          <span style={{ color: 'var(--border)', margin: '0 8px' }}>/</span>
          {editingTitle ? (
            <input autoFocus value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => { const v = titleDraft.trim() || title; onRenameTitle?.(v); setEditingTitle(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = titleDraft.trim() || title; onRenameTitle?.(v); setEditingTitle(false) } if (e.key === 'Escape') setEditingTitle(false) }}
              style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', background: 'transparent', border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none', padding: '0 2px', width: Math.max(120, titleDraft.length * 14) }}
            />
          ) : (
            <span onClick={() => { if (onRenameTitle) { setTitleDraft(title); setEditingTitle(true) } }}
              title={onRenameTitle ? 'Klik om naam te wijzigen' : undefined}
              style={{ cursor: onRenameTitle ? 'text' : 'default' }}>
              {title}
            </span>
          )}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Eén Geschiedenis-knop voor zowel wijzigingen-logboek als
              papierbak. Opent de trash-drawer; binnenin staat een knop
              naar het volledige wijzigingen-logboek voor wie meer
              detail wil. */}
          <button onClick={() => setTrashOpen(true)}
            title={`Geschiedenis van bord '${title}'`}
            style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconHistory size={13} /> {isMobile ? '' : 'Geschiedenis'}
          </button>
          {/* Recovery: haalt verdwenen subitems uit de laatste snapshot terug
              op de HUIDIGE items. Top-level edits blijven staan. Per-bord
              zichtbaar zodat je 'm direct vanuit elke agenda kunt gebruiken. */}
          <button onClick={() => setRecoveryOpen(true)}
            title={`Snapshot-picker voor '${title}' — kies een versie om verdwenen subitems uit te herstellen`}
            style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: 'var(--accent-light, rgba(88,150,255,0.18))',
              border: '1px solid var(--accent)',
              color: 'var(--text-primary)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            ↩︎ {isMobile ? '' : 'Recovery'}
          </button>
          {/* Share-knop: alleen voor borden in de SHAREABLE_BOARDS-whitelist
              op de server (zelfde lijst). Geeft een copy-able URL die
              externen zonder login kunnen openen. Gevoelige velden
              (notes / contactpersoon / journal / uren / deadline) worden
              server-side al gestript in /api/share/[board]. */}
          {(['nederland', 'vlaanderen', 'pnp'].includes(boardId)) && (
            <ShareButton boardId={boardId} isMobile={isMobile} />
          )}
          {!isMobile && (
            <button onClick={exportCSV} title="Exporteer als CSV"
              style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              ↓ CSV
            </button>
          )}
          <button onClick={addGroup}
            style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            + {isMobile ? 'Groep' : 'Nieuwe groep'}
          </button>
          {isMobile && (
            <button ref={moreBtnRef} onClick={() => setMoreOpen(v => !v)}
              title="Meer acties"
              style={{ padding: '7px 10px', borderRadius: 6, fontSize: 16, fontWeight: 700, lineHeight: 1,
                background: moreOpen ? 'var(--accent-light)' : 'var(--bg-card)',
                border: `1px solid ${moreOpen ? 'var(--accent)' : 'var(--border)'}`,
                color: moreOpen ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer' }}>
              ⋯
            </button>
          )}
          {isMobile && moreOpen && (
            <PortalDropdown anchor={moreBtnRef} onClose={() => setMoreOpen(false)}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 220 }}>
                <button onClick={() => { setReorderMode(r => !r); setMoreOpen(false) }}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                    padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
                    color: reorderMode ? 'var(--accent)' : 'var(--text-primary)', fontSize: 14,
                    fontWeight: reorderMode ? 600 : 500, textAlign: 'left', borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  ↕ {reorderMode ? 'Klaar met sorteren' : 'Volgorde aanpassen'}
                </button>
                <button onClick={() => { exportCSV(); setMoreOpen(false) }}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                    padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, textAlign: 'left', borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  ↓ Exporteer CSV
                </button>
                {yokoOwners.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'var(--border-light)', margin: '6px 4px' }} />
                    <div style={{ padding: '4px 12px 6px', fontSize: 11, fontWeight: 600,
                      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Filter op persoon
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px 8px' }}>
                      {filterOwner && (
                        <button onClick={() => { setFilterOwner(''); setMoreOpen(false) }}
                          style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)',
                            background: 'var(--bg-hover)', cursor: 'pointer', fontSize: 12,
                            color: 'var(--text-muted)' }}>
                          × wis
                        </button>
                      )}
                      {yokoOwners.map(id => {
                        const m = teamData.members.find(t => t.id === id)
                        if (!m) return null
                        const active = filterOwner === id
                        return (
                          <button key={id} onClick={() => { setFilterOwner(active ? '' : id); setMoreOpen(false) }}
                            style={{ padding: '4px 10px', borderRadius: 999,
                              border: `1.5px solid ${active ? m.color : 'var(--border-light)'}`,
                              background: active ? m.color + '22' : 'var(--bg-card)',
                              cursor: 'pointer', fontSize: 12,
                              fontWeight: active ? 700 : 500,
                              color: active ? m.color : 'var(--text-secondary)' }}>
                            {m.name.split(' ')[0]}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </PortalDropdown>
          )}
        </div>
      </div>

      {/* Owner avatar strip — quick filter on people in this board.
          Op mobiel zit deze in het ⋯-menu hierboven, dus alleen op desktop tonen. */}
      {!isMobile && yokoOwners.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {yokoOwners.map(id => {
            const m = teamData.members.find(t => t.id === id)
            if (!m) return null
            const active = filterOwner === id
            return (
              <button key={id} onClick={() => setFilterOwner(active ? '' : id)} title={m.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 9px 3px 3px', borderRadius: 999,
                  border: `1.5px solid ${active ? m.color : 'var(--border-light)'}`,
                  background: active ? m.color + '18' : 'var(--bg-card)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}>
                <MemberAvatar id={id} size={24} />
                <span style={{
                  fontSize: 12.5, fontWeight: active ? 700 : 500,
                  color: active ? m.color : 'var(--text-secondary)',
                }}>
                  {m.name.split(' ')[0]}
                </span>
              </button>
            )
          })}
          {filterOwner && (
            <button onClick={() => setFilterOwner('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '4px 8px' }}>
              × wis filter
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', display: 'inline-flex' }}>
            <IconSearch size={16} />
          </span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Zoeken…"
            style={{ padding: '9px 12px 9px 32px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: 220, boxSizing: 'border-box' }} />
        </div>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: filterStatus ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 14, cursor: 'pointer', outline: 'none' }}>
          <option value="">Alle statussen</option>
          {STATUS_OPTIONS.filter(o => o.label).map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
        </select>

        <select value={filterOwner} onChange={e => setFilterOwner(e.target.value)}
          style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: filterOwner ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 14, cursor: 'pointer', outline: 'none' }}>
          <option value="">Alle personen</option>
          {yokoOwners.map(id => {
            const m = teamData.members.find(t => t.id === id)
            return m ? <option key={id} value={id}>{m.name}</option> : null
          })}
        </select>

        {/* Periode-filter: items waarvan de timeline OVERLAPT met
            [van, tot]. Leeg laten = geen ondergrens / bovengrens. */}
        <PeriodFilterButton from={filterFrom} until={filterUntil} color={color}
          onChange={(f, u) => { setFilterFrom(f ?? ''); setFilterUntil(u ?? '') }} />

        <ColumnManagerButton boardId={boardId} columns={columns} color={color} />

        {hasFilter && (
          <>
            <button onClick={() => { setSearch(''); setFilterOwner(''); setFilterStatus(''); setFilterFrom(''); setFilterUntil('') }}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--overlay-medium)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
              × Wissen
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{resultCount} resultaten</span>
            {(filterFrom || filterUntil) && (() => {
              // Items in filteredGroups zijn al pro-rated naar de gekozen
              // periode (zie filteredGroups-useMemo), dus effectiveHours
              // hier geeft direct het binnen-window-deel — geen dubbele
              // pro-ratie meer.
              const totalHours = filteredGroups.reduce((s, g) => s + g.items.reduce((ss, i) => ss + effectiveHours(i), 0), 0)
              const totalDays  = totalHours / 8
              const fmt = (n: number) => Math.round(n * 10) / 10
              return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>· {fmt(totalHours)}u in periode ({fmt(totalDays)} dagen)</span>
            })()}
          </>
        )}

      </div>

      <BoardActivityDrawer
        boardId={boardId}
        boardTitle={title}
        open={activityOpen}
        onClose={() => setActivityOpen(false)} />

      <BoardTrashDrawer
        boardId={boardId}
        boardTitle={title}
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onOpenLog={() => { setTrashOpen(false); setActivityOpen(true) }} />

      <BoardRecoveryDrawer
        boardId={boardId}
        boardTitle={title}
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)} />

      {dedupOpen && (
        <DedupModal groups={groups} onClose={() => setDedupOpen(false)}
          onDelete={(ids: Set<string>) => {
            onChange(groups.map(g => ({ ...g, items: g.items.filter(i => !ids.has(i.id)) })))
            setDedupOpen(false)
          }} />
      )}

      {/* Groepen — wrapped in een dropzone zodat hele groepen via header-
          handle naar een andere positie gesleept kunnen worden. */}
      {/* Op mobile maken we de table-area horizontaal scrollbaar — anders
          scroll je de hele pagina mee (header + sidebar + alles) wanneer
          de kolommen breder zijn dan 't scherm. Op desktop blijft 't
          gewoon overflow: visible zodat popovers er niet door geclipt
          worden. */}
      <div style={isMobile
        ? { overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch' as const, margin: '0 -16px', padding: '0 16px' }
        : { overflow: 'visible' }}>
        <div style={isMobile ? { minWidth: 720 } : undefined}>
        {filteredGroups.map((group, gIdx) => {
          const isDraggingMe = groupDragging === group.id
          const showLineBefore = groupDrop?.groupId === group.id && groupDrop.side === 'before'
          const showLineAfter  = groupDrop?.groupId === group.id && groupDrop.side === 'after'
          return (
          <div key={group.id}
            data-group-id={group.id}
            style={{ position: 'relative', opacity: isDraggingMe ? 0.45 : 1, transition: 'opacity 0.12s' }}
            onDragEnter={e => {
              if (!e.dataTransfer.types.includes('application/x-yoko-group')) return
              const rect = e.currentTarget.getBoundingClientRect()
              const side: 'before' | 'after' = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after'
              setGroupDrop({ groupId: group.id, side })
            }}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes('application/x-yoko-group')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              const side: 'before' | 'after' = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after'
              if (groupDrop?.groupId !== group.id || groupDrop?.side !== side) {
                setGroupDrop({ groupId: group.id, side })
              }
            }}
            onDragLeave={e => {
              // Alleen leegmaken wanneer de cursor de hele wrapper verlaat —
              // niet bij verschuiving over child-elementen.
              const related = e.relatedTarget as Node | null
              if (related && e.currentTarget.contains(related)) return
              setGroupDrop(prev => prev?.groupId === group.id ? null : prev)
            }}
            onDrop={e => {
              const raw = e.dataTransfer.getData('application/x-yoko-group')
              setGroupDrop(null)
              if (!raw) return
              e.preventDefault()
              try {
                const { groupId } = JSON.parse(raw) as { groupId: string }
                if (!groupId || groupId === group.id) return
                const fromIdx = groups.findIndex(g => g.id === groupId)
                if (fromIdx < 0) return
                // Bepaal target-index op basis van waar de drop landde
                // (boven- of onderhelft van de target-groep). Compenseer
                // voor de splice die fromIdx wegtrekt.
                const rect = e.currentTarget.getBoundingClientRect()
                const side: 'before' | 'after' = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after'
                const targetGroup = filteredGroups[gIdx]
                const targetIdx = groups.findIndex(g => g.id === targetGroup.id)
                if (targetIdx < 0) return
                const next = [...groups]
                const [moved] = next.splice(fromIdx, 1)
                let insertAt = targetIdx + (side === 'after' ? 1 : 0)
                if (fromIdx < targetIdx) insertAt -= 1
                next.splice(insertAt, 0, moved)
                onChange(next)
              } catch {}
            }}>
            {showLineBefore && (
              <div aria-hidden style={{
                position: 'absolute', top: -4, left: 8, right: 8, height: 4,
                background: 'var(--accent)', borderRadius: 2, zIndex: 50,
                boxShadow: '0 0 0 1px rgba(88,150,255,0.35), 0 4px 12px rgba(88,150,255,0.35)',
                pointerEvents: 'none',
              }} />
            )}
            {showLineAfter && (
              <div aria-hidden style={{
                position: 'absolute', bottom: -4, left: 8, right: 8, height: 4,
                background: 'var(--accent)', borderRadius: 2, zIndex: 50,
                boxShadow: '0 0 0 1px rgba(88,150,255,0.35), 0 4px 12px rgba(88,150,255,0.35)',
                pointerEvents: 'none',
              }} />
            )}
            <BoardGroupSection boardId={boardId} group={group} cols={columns}
              colWidths={colWidths} gridTemplate={gridTemplate}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onSelectGroup={selectGroup}
              sortBy={sortBy} onToggleSort={toggleSort}
              reorderMode={reorderMode}
              onUpdateGroup={handleUpdateGroup} onResizeCol={resizeCol}
              onMoveItemHere={(itemId, fromGroupId) => moveItemBetweenGroups(itemId, fromGroupId, group.id)}
              onMoveItemsHere={(itemIds) => moveItemsBetweenGroups(itemIds, group.id)}
              onNestItem={nestItemUnder}
              onReparentSubitem={reparentSubitem}
              onUnnestSubitemHere={unnestSubitemHere}
              onDeleteGroup={() => handleDeleteGroup(group.id)} />
          </div>
          )
        })}
        {filteredGroups.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Geen resultaten gevonden
          </div>
        )}
        {filteredGroups.length > 0 && (() => {
          const allItems = filteredGroups.flatMap(g => g.items)
          const totalItems = allItems.length
          const totalHours = allItems.reduce((s, i) => s + effectiveHours(i), 0)
          const totalDays  = allItems.reduce((s, i) => s + effectiveDays(i), 0)
          const fmt = (n: number) => Math.round(n * 10) / 10
          // Uitgelijnd op het tabel-grid (zelfde gridTemplate als de rijen) zodat
          // de cijfers precies onder hun kolomkoppen vallen. Extra contrast via
          // bg-card + 2px top-border en sterkere tekstkleur.
          return (
            <div style={{
              display: 'grid', gridTemplateColumns: gridTemplate,
              border: '1px solid var(--border)',
              borderTop: '2px solid var(--accent)',
              background: 'var(--bg-card)',
              fontSize: 13, color: 'var(--text-primary)', fontWeight: 700,
              borderRadius: 14,
              marginTop: 6,
            }}>
              <div />
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11.5, color: 'var(--text-secondary)' }}>Totaal</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {totalItems} items</span>
              </div>
              {columns.map(col => (
                <div key={col.key} style={{
                  padding: '12px 8px', borderLeft: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center',
                }}>
                  {col.key === 'estHours' ? `${fmt(totalHours)}u`
                    : col.key === 'dagen' ? `${fmt(totalDays)} dagen`
                    : ''}
                </div>
              ))}
              <div style={{ borderLeft: '1px solid var(--border)' }} />
            </div>
          )
        })()}
        </div>
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        Klik op tekst/cijfers om te bewerken · Sleep tussen rijen om te herordenen · Sleep óp een rij maakt 't een subitem · Klik op tijdlijn om datums in te stellen
      </p>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          color={color}
          groups={groups}
          onClear={clearSelection}
          onDelete={bulkDelete}
          onUpdate={bulkUpdate}
          onMoveTo={bulkMoveTo}
        />
      )}
    </div>
  )
}

// ─── Bulk action bar (shown when items selected) ──────────────────────────────
// Toolbar wanneer er meerdere items in een groep aangevinkt zijn. Iedere
// "waarde" die in een rij bewerkt kan worden, kan hier op alle geselecteerde
// items in één keer worden gezet.
function BulkActionBar({ count, color, groups, onClear, onDelete, onUpdate, onMoveTo }: {
  count: number; color: string; groups: BoardGroup[]
  onClear: () => void; onDelete: () => void
  onUpdate: (patch: Partial<BoardItem>) => void
  onMoveTo: (groupId: string) => void
}) {
  type OpenMenu = '' | 'status' | 'owner' | 'move' | 'timeline' | 'deadline' | 'est' | 'echt'
  const [open, setOpen] = useState<OpenMenu>('')
  const toggle = (m: OpenMenu) => setOpen(o => o === m ? '' : m)

  const [tlStart, setTlStart] = useState('')
  const [tlEnd,   setTlEnd]   = useState('')
  const [deadln,  setDeadln]  = useState('')
  const [est,     setEst]     = useState('')
  const [echt,    setEcht]    = useState('')

  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 200,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '8px 10px',
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
      maxWidth: '94vw', flexWrap: 'wrap',
    }}>
      <span style={{ padding: '4px 10px', borderRadius: 8, background: color + '22', color, fontSize: 12.5, fontWeight: 700 }}>
        {count} geselecteerd
      </span>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('status')} style={barBtn}>Status…</button>
        {open === 'status' && (
          <div style={popoverStyle}>
            {STATUS_OPTIONS.filter(o => o.label).map(s => (
              <button key={s.label} onClick={() => { onUpdate({ status: s.label }); setOpen('') }}
                style={{ ...popoverItem, background: s.color + '22', color: s.color }}>
                {s.label}
              </button>
            ))}
            <button onClick={() => { onUpdate({ status: '' }); setOpen('') }}
              style={{ ...popoverItem, color: 'var(--text-muted)' }}>Wis status</button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('owner')} style={barBtn}>Owner…</button>
        {open === 'owner' && (
          <div style={popoverStyle}>
            {teamData.members.map(m => (
              <button key={m.id} onClick={() => { onUpdate({ ownerIds: [m.id] }); setOpen('') }}
                style={{ ...popoverItem, color: m.color }}>
                {m.name}
              </button>
            ))}
            <button onClick={() => { onUpdate({ ownerIds: [] }); setOpen('') }}
              style={{ ...popoverItem, color: 'var(--text-muted)' }}>Wis owner</button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('timeline')} style={barBtn}>Timeline…</button>
        {open === 'timeline' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 220 }}>
            <label style={popoverLabel}>Van
              <input type="date" value={tlStart} onChange={e => setTlStart(e.target.value)} style={popoverInput} />
            </label>
            <label style={popoverLabel}>Tot
              <input type="date" value={tlEnd}   onChange={e => setTlEnd(e.target.value)}   style={popoverInput} />
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => { onUpdate({ startDate: tlStart || null, endDate: tlEnd || null }); setOpen('') }}
                disabled={!tlStart && !tlEnd}
                style={{ ...barBtn, flex: 1, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
                Toepassen
              </button>
              <button onClick={() => { onUpdate({ startDate: null, endDate: null }); setOpen('') }}
                style={{ ...barBtn, color: 'var(--text-muted)', padding: '6px 10px' }}>
                Wis
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('deadline')} style={barBtn}>Deadline…</button>
        {open === 'deadline' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 200 }}>
            <label style={popoverLabel}>Datum
              <input type="date" value={deadln} onChange={e => setDeadln(e.target.value)} style={popoverInput} />
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => { onUpdate({ deadline: deadln || null }); setOpen('') }}
                disabled={!deadln}
                style={{ ...barBtn, flex: 1, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
                Toepassen
              </button>
              <button onClick={() => { onUpdate({ deadline: null }); setOpen('') }}
                style={{ ...barBtn, color: 'var(--text-muted)', padding: '6px 10px' }}>
                Wis
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('est')} style={barBtn}>Est tijd…</button>
        {open === 'est' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 180 }}>
            <label style={popoverLabel}>Uur
              <input type="number" step="0.5" min="0" value={est} onChange={e => setEst(e.target.value)} style={popoverInput} />
            </label>
            <button onClick={() => { const v = parseFloat(est); if (!isNaN(v)) onUpdate({ estHours: v }); setOpen('') }}
              disabled={est === ''}
              style={{ ...barBtn, marginTop: 6, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
              Toepassen
            </button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('echt')} style={barBtn}>Echt gewerkt…</button>
        {open === 'echt' && (
          <div style={{ ...popoverStyle, padding: 10, minWidth: 180 }}>
            <label style={popoverLabel}>Uur
              <input type="number" step="0.5" min="0" value={echt} onChange={e => setEcht(e.target.value)} style={popoverInput} />
            </label>
            <button onClick={() => { const v = parseFloat(echt); if (!isNaN(v)) onUpdate({ echtGewerkt: v } as Partial<BoardItem>); setOpen('') }}
              disabled={echt === ''}
              style={{ ...barBtn, marginTop: 6, padding: '6px 10px', fontWeight: 700, background: 'var(--accent-light)', borderColor: 'var(--accent)' }}>
              Toepassen
            </button>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => toggle('move')} style={barBtn}>Verplaats…</button>
        {open === 'move' && (
          <div style={popoverStyle}>
            {groups.map(g => (
              <button key={g.id} onClick={() => { onMoveTo(g.id); setOpen('') }}
                style={popoverItem}>
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={onDelete} style={{ ...barBtn, color: '#C4453A', fontWeight: 700 }}>Verwijder</button>

      <button onClick={onClear} style={{ ...barBtn, color: 'var(--text-muted)' }} title="Selectie wissen">×</button>
    </div>
  )
}

const popoverLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
  marginBottom: 4,
}
const popoverInput: React.CSSProperties = {
  background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

const barBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-light)',
  borderRadius: 7, padding: '6px 11px', fontSize: 12.5, fontWeight: 600,
  color: 'var(--text-secondary)', cursor: 'pointer',
}
const popoverStyle: React.CSSProperties = {
  position: 'absolute', bottom: '100%', left: 0, marginBottom: 6,
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 8, padding: 4, minWidth: 160,
  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
  display: 'flex', flexDirection: 'column', gap: 2,
}
const popoverItem: React.CSSProperties = {
  background: 'transparent', border: 'none',
  padding: '6px 10px', borderRadius: 5, textAlign: 'left',
  fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer',
}

// ─── Gedeelde stijlen ─────────────────────────────────────────────────────────
const editInput: React.CSSProperties = {
  width: '100%', background: 'var(--bg-base)',
  border: '1px solid var(--accent)', borderRadius: 4,
  padding: '2px 7px', color: 'var(--text-primary)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
