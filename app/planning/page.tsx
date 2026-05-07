'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useMemberPopup } from '@/components/MemberPopup'
import { useUndo } from '@/components/UndoContext'
import teamData          from '@/data/team.json'
import yokoRaw           from '@/data/boards/yoko.json'
import pnpRaw            from '@/data/boards/pnp.json'
import nederlandRaw      from '@/data/boards/nederland.json'
import vlaanderenRaw     from '@/data/boards/vlaanderen.json'
import dienjaarRaw       from '@/data/boards/dienjaar.json'
import { loadGroups, saveGroups, addDays } from '@/lib/boardStore'
import { getWeekStart, getWeeks, getWeekLabel, BOARD_COLORS, type Project, type TeamMember } from '@/lib/workload'
import { useProfile }    from '@/components/ProfileContext'
import { useTeamPhotos } from '@/components/TeamPhotosContext'
import { useIsMobile }   from '@/lib/useIsMobile'
import { downloadIcs }   from '@/lib/ical'
import { startTimer, stopTimer, getActiveTimer, totalMinutesForProject, onTimerUpdate, fmtMinutes } from '@/lib/timerStore'
import { logActivity }   from '@/lib/activityLog'
import {
  IconMore, IconUsers, IconBoard, IconHourglass, IconRange, IconShare,
  IconDownload, IconSort, IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight,
  IconPlay, IconStop, IconClose,
} from '@/components/Icon'
import type { BoardGroup } from '@/lib/boards'

const RAW: Record<string, { groups: unknown[] }> = {
  yoko: yokoRaw, pnp: pnpRaw, nederland: nederlandRaw,
  vlaanderen: vlaanderenRaw, dienjaar: dienjaarRaw,
}

const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

// ─── Types ────────────────────────────────────────────────────────────────────
type ViewSize  = 'compact' | 'large'
type ZoomLevel = 'dag' | 'week' | 'maand'

type Col = {
  key: string
  rangeStart: Date
  rangeEnd:   Date
  label1:     string
  label2:     string
  widthPx:    number
  isCurrent:  boolean
}

// ─── Static layout constants ──────────────────────────────────────────────────
const NAME_W   = 196
const NAME_PAD = 28
const BAR_H    = 22
const BAR_GAP  = 3
const HANDLE_W = 8

// ─── View-size presets ────────────────────────────────────────────────────────
function vc(vs: ViewSize) {
  return vs === 'large'
    ? { cs: 78, or: 35, hh: 110, av: 46 }
    : { cs: 46, or: 20, hh:  60, av: 32 }
}
// Column widths per zoom
const ZOOM_COL_W: Record<ZoomLevel, number> = { dag: 46, week: 104, maand: 120 }
// Column counts per zoom
const ZOOM_COUNT: Record<ZoomLevel, number> = { dag: 60, week: 56, maand: 18 }
const NL_DAY = ['zo','ma','di','wo','do','vr','za']

// ─── Column generators ────────────────────────────────────────────────────────
function getWeekCols(from: Date, count: number, colW: number): Col[] {
  return getWeeks(from, count).map(ws => {
    const we  = new Date(ws); we.setDate(ws.getDate() + 6); we.setHours(23,59,59,999)
    const lbl = getWeekLabel(ws)
    return { key: ws.toISOString(), rangeStart: ws, rangeEnd: we,
      label1: lbl.weekNum, label2: lbl.range, widthPx: colW, isCurrent: lbl.isCurrentWeek }
  })
}

function getMonthCols(from: Date, count: number, colW: number): Col[] {
  const cols: Col[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const ms = new Date(d)
    const me = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
    cols.push({ key: ms.toISOString(), rangeStart: ms, rangeEnd: me,
      label1: NL_MON[ms.getMonth()].toUpperCase(),
      label2: String(ms.getFullYear()),
      widthPx: colW,
      isCurrent: now >= ms && now <= me })
    d.setMonth(d.getMonth() + 1)
  }
  return cols
}

function getDayCols(from: Date, count: number, colW: number): Col[] {
  const cols: Col[] = []
  const today = new Date(); today.setHours(0,0,0,0)
  for (let i = 0; i < count; i++) {
    const ds = new Date(from); ds.setDate(from.getDate() + i); ds.setHours(0,0,0,0)
    const de = new Date(ds); de.setHours(23,59,59,999)
    cols.push({ key: ds.toISOString(), rangeStart: ds, rangeEnd: de,
      label1: NL_DAY[ds.getDay()],          // 'ma', 'di', ...
      label2: String(ds.getDate()),         // '6', '7', ...
      widthPx: colW,
      isCurrent: ds.getTime() === today.getTime() })
  }
  return cols
}

function buildCols(zoom: ZoomLevel, from: Date, colW: number): Col[] {
  const count = ZOOM_COUNT[zoom]
  if (zoom === 'maand') return getMonthCols(from, count, colW)
  if (zoom === 'dag')   return getDayCols(from, count, colW)
  return getWeekCols(from, count, colW)
}

// ─── Month grouping row (for week/day zoom) ───────────────────────────────────
function getMonthGroupsFromCols(cols: Col[]): { label: string; count: number; widthPx: number }[] {
  const groups: { label: string; count: number; widthPx: number }[] = []
  for (const col of cols) {
    const d     = col.rangeStart
    const label = `${NL_MON[d.getMonth()].toUpperCase()}. ${d.getFullYear()}`
    const last  = groups[groups.length - 1]
    if (last?.label === label) { last.count++; last.widthPx += col.widthPx }
    else groups.push({ label, count: 1, widthPx: col.widthPx })
  }
  return groups
}

// ─── Hours in arbitrary range ─────────────────────────────────────────────────
function hoursInRange(project: Project, memberId: string, rs: Date, re: Date): number {
  if (!project.ownerIds.includes(memberId)) return 0
  if (project.estHours === 0 || !project.startDate || !project.endDate) return 0
  const pS = new Date(project.startDate)
  const pE = new Date(project.endDate); pE.setHours(23,59,59,999)
  if (re < pS || rs > pE) return 0
  const oS = rs > pS ? rs : pS
  const oE = re < pE ? re : pE
  const totalMs   = pE.getTime() - pS.getTime()
  const overlapMs = oE.getTime() - oS.getTime()
  const fraction  = overlapMs / totalMs
  const hpp       = project.estHours / Math.max(project.ownerIds.length, 1)
  return Math.round(fraction * hpp * 10) / 10
}

function memberHoursInCol(projects: Project[], memberId: string, col: Col) {
  return projects
    .map(p => ({ project: p, hours: hoursInRange(p, memberId, col.rangeStart, col.rangeEnd) }))
    .filter(c => c.hours > 0)
}

// ─── Convert board groups → Project list ──────────────────────────────────────
function groupsToProjects(boardName: string, groups: BoardGroup[]): Project[] {
  return groups.flatMap(g =>
    g.items
      .filter(i => Array.isArray(i.ownerIds) && (i.ownerIds as string[]).length > 0)
      .map(i => ({
        id: `${boardName}__${i.id}`, name: i.name, board: boardName, group: g.name,
        ownerIds:  i.ownerIds  as string[],
        startDate: i.startDate as string | null,
        endDate:   i.endDate   as string | null,
        estHours:  (i.estHours as number) ?? 0,
        status:    (i.status as string) === 'Done' ? 'done' : 'active',
      } satisfies Project))
  )
}

function fmtIso(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${NL_MON[d.getMonth()]}.`
}

// ─── Member avatar ────────────────────────────────────────────────────────────
function MemberAvatar({ member, size }: { member: TeamMember; size: number }) {
  const { profile }   = useProfile()
  const { getPhoto }  = useTeamPhotos()
  const { showMember } = useMemberPopup()
  const isMe     = profile?.memberId === member.id
  const photo    = isMe ? (profile?.photo ?? getPhoto(member.id)) : getPhoto(member.id)
  const fallback = `/team/${member.id}.jpg`
  const initials = member.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  const inner = photo ? (
    <img src={photo} alt={member.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  ) : (
    <span style={{ width: size, height: size, borderRadius: '50%', background: member.color + '22',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: member.color, position: 'relative', overflow: 'hidden' }}>
      <img src={fallback} alt={member.name}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
      {initials}
    </span>
  )
  return (
    <span onClick={e => showMember(member.id, e)} title="Klik voor profiel" style={{ cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}>
      {inner}
    </span>
  )
}

// ─── Workload circle ──────────────────────────────────────────────────────────
function WorkloadCircleSvg({ pct, cs, or: outerR }: { pct: number; cs: number; or: number }) {
  const cx    = cs / 2, cy = cs / 2
  const color = pct > 1 ? '#e2445c' : '#579bfc'
  const fillR = pct > 0 ? Math.max(2, Math.min(outerR - 1, (outerR - 1) * Math.sqrt(Math.min(pct, 1)))) : 0
  const aFillR = pct > 1 ? Math.min(outerR - 1, fillR * 1.06) : fillR
  return (
    <svg width={cs} height={cs} viewBox={`0 0 ${cs} ${cs}`} style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={outerR} fill={color + '25'} />
      {pct > 0 && <circle cx={cx} cy={cy} r={aFillR} fill={color} />}
    </svg>
  )
}

// ─── Workload cell ────────────────────────────────────────────────────────────
type Contrib = { project: Project; hours: number }
function WorkloadCell({ contribs, total, capacity, cs, or: outerR, zoom }: {
  contribs: Contrib[]; total: number; capacity: number
  cs: number; or: number; zoom: ZoomLevel
}) {
  const [open, setOpen] = useState(false)
  const pct = capacity > 0 ? total / capacity : 0

  // For day zoom: full-cell tinted block — much more readable than a tiny bar
  if (zoom === 'dag') {
    const baseColor = pct > 1 ? '#e2445c' : pct > 0.85 ? '#ff7b24' : '#579bfc'
    // Opacity scales with workload — 0 invisible, 1.0 = visible, >1 = strong
    const alpha = pct > 0 ? Math.min(0.15 + Math.min(pct, 1) * 0.45, 0.65) : 0
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: pct > 0 ? `${baseColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : 'transparent',
        borderRadius: 4 }}>
        {total > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: pct > 1 ? '#fff' : 'var(--text-primary)', textShadow: pct > 1 ? '0 0 2px rgba(0,0,0,0.4)' : 'none' }}>
            {total >= 1 ? Math.round(total) : total.toFixed(1)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1, position: 'relative' }}
      onMouseLeave={() => setOpen(false)}>
      <button onClick={() => total > 0 && setOpen(o => !o)} style={{
        background: 'none', border: 'none', cursor: total > 0 ? 'pointer' : 'default',
        padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      }}>
        <WorkloadCircleSvg pct={pct} cs={cs} or={outerR} />
        {total > 0 && (
          <span style={{ fontSize: cs > 60 ? 12 : 10, fontWeight: 700, color: pct > 1 ? '#e2445c' : 'var(--text-muted)', lineHeight: 1 }}>
            {total}u
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 200, top: '100%', left: '50%',
          transform: 'translateX(-50%)', marginTop: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 14px', minWidth: 210,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
            {total}u / {capacity}u ({Math.round(pct * 100)}%)
          </div>
          {contribs.map(({ project, hours }) => (
            <div key={project.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: BOARD_COLORS[project.board] ?? '#888', flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{hours}u</span>
            </div>
          ))}
          <button onClick={() => setOpen(false)} style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>sluiten</button>
        </div>
      )}
    </div>
  )
}

// ─── Draggable timeline bar ───────────────────────────────────────────────────
type DragInfo = { mode: 'move' | 'start' | 'end'; startX: number; origStart: string | null; origEnd: string | null }

function DraggableBar({ project, left, width, colW, onDragMove, onDragEnd, onClick }: {
  project: Project; left: number; width: number; colW: number
  onDragMove: (s: string | null, e: string | null) => void
  onDragEnd:  (s: string | null, e: string | null) => void
  onClick:    () => void
}) {
  const color   = BOARD_COLORS[project.board] ?? '#888'
  const dragRef = useRef<DragInfo | null>(null)
  const [ghost, setGhost] = useState<{ left: number; width: number } | null>(null)
  const didDrag = useRef(false)
  const dpx = 7 / colW

  function startDrag(e: React.MouseEvent, mode: DragInfo['mode']) {
    e.preventDefault(); e.stopPropagation()
    didDrag.current = false
    dragRef.current = { mode, startX: e.clientX, origStart: project.startDate, origEnd: project.endDate }
    setGhost({ left, width })

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const ddays = Math.round(dx * dpx)
      if (Math.abs(ddays) > 0) didDrag.current = true
      const { mode, origStart, origEnd } = dragRef.current
      let newL = left, newW = width
      if (mode === 'move')       { newL = left + ddays * (colW / 7) }
      else if (mode === 'start') { const dl = ddays * (colW / 7); newL = left + dl; newW = Math.max(colW / 7, width - dl) }
      else                       { newW = Math.max(colW / 7, width + ddays * (colW / 7)) }
      setGhost({ left: newL, width: newW })
      let ss = origStart, se = origEnd
      if (mode === 'move')       { ss = origStart ? addDays(origStart, ddays) : null; se = origEnd ? addDays(origEnd, ddays) : null }
      else if (mode === 'start') { ss = origStart ? addDays(origStart, ddays) : null; if (ss && se && ss > se) ss = se }
      else                       { se = origEnd ? addDays(origEnd, ddays) : null; if (ss && se && se < ss) se = ss }
      onDragMove(ss, se)
    }

    function onUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragMove(project.startDate, project.endDate)
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const ddays = Math.round(dx * dpx)
      const { mode, origStart, origEnd } = dragRef.current
      dragRef.current = null; setGhost(null)
      let ns = origStart, ne = origEnd
      if (mode === 'move')       { ns = origStart ? addDays(origStart, ddays) : null; ne = origEnd ? addDays(origEnd, ddays) : null }
      else if (mode === 'start') { ns = origStart ? addDays(origStart, ddays) : null; if (ns && ne && ns > ne) ns = ne }
      else                       { ne = origEnd ? addDays(origEnd, ddays) : null; if (ns && ne && ne < ns) ne = ns }
      onDragEnd(ns, ne)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const g = ghost ?? { left, width }
  return (
    <>
      {ghost && <div style={{ position: 'absolute', top: BAR_GAP, left: ghost.left + 2, width: ghost.width, height: BAR_H, background: color + '44', border: `2px dashed ${color}`, borderRadius: 4, pointerEvents: 'none', zIndex: 5 }} />}
      <div
        onMouseDown={e => startDrag(e, 'move')}
        onClick={e => { if (!didDrag.current) { e.stopPropagation(); onClick() } }}
        style={{ position: 'absolute', top: BAR_GAP, left: g.left + 2, width: g.width, height: BAR_H,
          background: color + 'cc', borderRadius: 4, display: 'flex', alignItems: 'center',
          overflow: 'hidden', fontSize: 10.5, fontWeight: 600, color: '#fff',
          cursor: ghost ? 'grabbing' : 'grab', userSelect: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18)',
          zIndex: ghost ? 1 : 'auto' }}>
        <div onMouseDown={e => { e.stopPropagation(); startDrag(e, 'start') }}
          style={{ width: HANDLE_W, height: '100%', cursor: 'ew-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.4)', borderRadius: 1 }} />
        </div>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>
          {project.name}{project.group ? ` | ${project.group}` : ''}
        </span>
        <div onMouseDown={e => { e.stopPropagation(); startDrag(e, 'end') }}
          style={{ width: HANDLE_W, height: '100%', cursor: 'ew-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.4)', borderRadius: 1 }} />
        </div>
      </div>
    </>
  )
}

// ─── Timeline bars row ────────────────────────────────────────────────────────
function TimelineBars({ memberId, projects, cols, colW, onDragMove, onDragEnd, onBarClick }: {
  memberId: string; projects: Project[]; cols: Col[]; colW: number
  onDragMove: (p: Project, s: string | null, e: string | null) => void
  onDragEnd:  (p: Project, s: string | null, e: string | null) => void
  onBarClick: (p: Project) => void
}) {
  const gridStart   = cols[0].rangeStart
  const gridStartMs = gridStart.getTime()
  const gridEndMs   = cols[cols.length - 1].rangeEnd.getTime()
  const totalWidth  = cols.reduce((s, c) => s + c.widthPx, 0)
  const msPerPx     = (gridEndMs - gridStartMs) / totalWidth

  const bars = projects
    .filter(p => p.ownerIds.includes(memberId) && (p.startDate || p.endDate))
    .map(p => {
      const s = p.startDate ? new Date(p.startDate).getTime() : gridStartMs
      const e = p.endDate   ? new Date(p.endDate).getTime() + 86400000 : gridEndMs
      if (e < gridStartMs || s > gridEndMs) return null
      const cs = Math.max(s, gridStartMs)
      const ce = Math.min(e, gridEndMs)
      const left  = (cs - gridStartMs) / msPerPx
      const width = Math.max((ce - cs) / msPerPx - 2, 6)
      return { p, left, width }
    })
    .filter(Boolean) as { p: Project; left: number; width: number }[]

  if (bars.length === 0) return null
  const height = bars.length * (BAR_H + BAR_GAP) + BAR_GAP + 6
  return (
    <div style={{ position: 'relative', height, overflow: 'visible' }}>
      {cols.map((col, i) => (
        <div key={col.key} style={{ position: 'absolute', left: cols.slice(0,i).reduce((s,c)=>s+c.widthPx,0), top: 0, bottom: 0, width: col.widthPx, borderLeft: '1px solid var(--border)', pointerEvents: 'none' }} />
      ))}
      {bars.map(({ p, left, width }, i) => (
        <div key={p.id} style={{ position: 'absolute', top: i * (BAR_H + BAR_GAP), left: 0, right: 0, height: BAR_H + BAR_GAP }}>
          <DraggableBar project={p} left={left} width={width} colW={colW}
            onDragMove={(s, e) => onDragMove(p, s, e)}
            onDragEnd={(s, e) => onDragEnd(p, s, e)}
            onClick={() => onBarClick(p)} />
        </div>
      ))}
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
function DetailPanel({ project, allGroups, onClose, onUpdate }: {
  project: Project
  allGroups: Record<string, BoardGroup[]>
  onClose: () => void
  onUpdate: (p: Project, s: string | null, e: string | null, extra?: Partial<{ estHours: number; notes: string; journal: import('@/lib/boards').JournalEntry[] }>) => void
}) {
  const color   = BOARD_COLORS[project.board] ?? '#888'
  const team    = teamData.members
  const rawItem = allGroups[project.board]?.flatMap(g => g.items).find(i => `${project.board}__${i.id}` === project.id)

  const [startDate, setStartDate] = useState(project.startDate ?? '')
  const [endDate,   setEndDate]   = useState(project.endDate ?? '')
  const [estHours,  setEstHours]  = useState(String(project.estHours ?? 0))
  const [notes,     setNotes]     = useState((rawItem?.notes as string) ?? '')
  const [journal,   setJournal]   = useState<import('@/lib/boards').JournalEntry[]>((rawItem?.journal as import('@/lib/boards').JournalEntry[]) ?? [])
  const [newEntry,  setNewEntry]  = useState('')
  const [timerTick, setTimerTick] = useState(0)
  useEffect(() => onTimerUpdate(() => setTimerTick(t => t + 1)), [])
  const activeTimer = getActiveTimer()
  const isTimingThis = activeTimer?.projectId === project.id
  const workedMin    = totalMinutesForProject(project.id) // re-evaluated each render
  void timerTick // touch state so the value is recomputed

  useEffect(() => {
    setStartDate(project.startDate ?? ''); setEndDate(project.endDate ?? '')
    setEstHours(String(project.estHours ?? 0)); setNotes((rawItem?.notes as string) ?? '')
    setJournal((rawItem?.journal as import('@/lib/boards').JournalEntry[]) ?? [])
    setNewEntry('')
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function save() { onUpdate(project, startDate || null, endDate || null, { estHours: parseFloat(estHours) || 0, notes, journal }) }
  function addEntry() {
    const text = newEntry.trim()
    if (!text) return
    setJournal(j => [...j, { id: Date.now().toString(), ts: new Date().toISOString(), text }])
    setNewEntry('')
  }
  function deleteEntry(id: string) { setJournal(j => j.filter(x => x.id !== id)) }
  const owners = team.filter(m => project.ownerIds.includes(m.id))

  return (
    <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 380, zIndex: 300,
      background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.35)' }}>
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--border)', background: color + '18' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4 }}>{project.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              in → <span style={{ color, fontWeight: 600 }}>{project.board}</span>{project.group ? <> · {project.group}</> : null}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        <Row label="Owner">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {owners.length > 0 ? owners.map(m => (
              <span key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: m.color, background: m.color + '18', borderRadius: 20, padding: '3px 10px', border: `1px solid ${m.color}44` }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: m.color + '30', border: `1.5px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700 }}>{m.name.charAt(0)}</span>
                {m.name}
              </span>
            )) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>}
          </div>
        </Row>
        <Row label="Status"><span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{project.status === 'done' ? '✅ Done' : rawItem?.status as string || '—'}</span></Row>
        <Row label="Timeline">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={dateInput} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>→</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={dateInput} />
          </div>
          {startDate && endDate && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{fmtIso(startDate)} → {fmtIso(endDate)}</div>}
        </Row>
        {rawItem?.deadline && <Row label="Deadline"><span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmtIso(rawItem.deadline as string)}</span></Row>}
        <Row label="Est Time">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" value={estHours} onChange={e => setEstHours(e.target.value)} style={{ ...dateInput, width: 64 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>uur</span>
          </div>
        </Row>
        <Row label="Tijd">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isTimingThis ? (
              <button onClick={() => stopTimer()}
                style={{ ...cancelBtn, background: '#e2445c', color: '#fff', border: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconStop size={13} /> Stop timer
              </button>
            ) : (
              <button onClick={() => startTimer(project.id, project.name)}
                style={{ ...cancelBtn, background: color, color: '#fff', border: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPlay size={13} /> Start timer
              </button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Gewerkt: <strong style={{ color: 'var(--text-secondary)' }}>{fmtMinutes(workedMin)}</strong>
              {' '}van <strong style={{ color: 'var(--text-secondary)' }}>{estHours}u</strong>
            </span>
          </div>
        </Row>
        <Row label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notities…"
            style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
        </Row>
        <Row label="Journaal">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {journal.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Nog geen entries.</span>
            )}
            {journal.slice().reverse().map(e => {
              const d = new Date(e.ts)
              return (
                <div key={e.id} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '6px 8px', position: 'relative' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    {d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} · {d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.text}</div>
                  <button onClick={() => deleteEntry(e.id)}
                    style={{ position: 'absolute', top: 2, right: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', padding: '2px 4px' }}
                    onMouseEnter={ev => (ev.currentTarget.style.color = '#e2445c')}
                    onMouseLeave={ev => (ev.currentTarget.style.color = 'var(--text-muted)')}
                    title="Verwijderen">×</button>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newEntry} onChange={e => setNewEntry(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addEntry() }}
                placeholder="+ Voeg entry toe…"
                style={{ flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              <button onClick={addEntry} disabled={!newEntry.trim()}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
                  background: newEntry.trim() ? color : 'var(--bg-hover)',
                  color: newEntry.trim() ? '#fff' : 'var(--text-muted)',
                  fontSize: 12, fontWeight: 600, cursor: newEntry.trim() ? 'pointer' : 'not-allowed' }}>
                +
              </button>
            </div>
          </div>
        </Row>
      </div>
      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={cancelBtn}>Sluiten</button>
        <button onClick={save} style={{ ...cancelBtn, background: color, color: '#fff', border: 'none', fontWeight: 700 }}>Opslaan</button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'start', marginBottom: 14 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, paddingTop: 3 }}>{label}</span>
      <div>{children}</div>
    </div>
  )
}

// ─── Generic centered popup ───────────────────────────────────────────────────
function Popup({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 251, background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 12,
        padding: '14px 18px', minWidth: 280, maxWidth: '92vw', width: 360,
        maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: 'var(--text-muted)', padding: '0 4px' }}>×</button>
        </div>
        {children}
      </div>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PlanningPage() {
  const { pushUndo }   = useUndo()
  const [allGroups,    setAllGroups]    = useState<Record<string, BoardGroup[]>>({})
  const [team,         setTeam]         = useState<TeamMember[]>(teamData.members)
  // Always start at this week (don't persist colOffset between sessions)
  const [colOffset,    setColOffset]    = useState<number>(0)
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())
  const [detailProject, setDetailProject] = useState<Project | null>(null)
  const [shadowDrag,   setShadowDrag]   = useState<{ projectId: string; start: string | null; end: string | null } | null>(null)
  const [urenOpen,     setUrenOpen]     = useState(false)
  const [agendasOpen,  setAgendasOpen]  = useState(false)
  const [peopleOpen,   setPeopleOpen]   = useState(false)
  const [shiftOpen,    setShiftOpen]    = useState(false)
  const [shiftPicked,  setShiftPicked]  = useState<Set<string>>(new Set())
  const [shiftDays,    setShiftDays]    = useState(7)
  const [shiftFilter,  setShiftFilter]  = useState('')
  const [shareOpen,    setShareOpen]    = useState(false)
  const [copiedBoard,  setCopiedBoard]  = useState<string | null>(null)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [editOrder,    setEditOrder]    = useState(false)
  const [filterMembers, setFilterMembers] = useState<Set<string>>(new Set())
  const isMobile = useIsMobile()
  const [viewSize, setViewSize] = useState<ViewSize>(() => {
    if (typeof window === 'undefined') return 'compact'
    const v = localStorage.getItem('planning-viewSize') as ViewSize
    return (v === 'compact' || v === 'large') ? v : 'compact'
  })
  const [zoom, setZoom] = useState<ZoomLevel>(() => {
    if (typeof window === 'undefined') return 'week'
    const v = localStorage.getItem('planning-zoom') as ZoomLevel
    return (v === 'dag' || v === 'week' || v === 'maand') ? v : 'week'
  })
  const gridRef = useRef<HTMLDivElement>(null)
  const dragScrollRef = useRef<{ startX: number; scrollLeft: number } | null>(null)
  const [isDragScrolling, setIsDragScrolling] = useState(false)

  useEffect(() => {
    function refresh() {
      const loaded: Record<string, BoardGroup[]> = {}
      for (const [name, raw] of Object.entries(RAW)) {
        loaded[name] = loadGroups(name, raw.groups as BoardGroup[])
      }
      setAllGroups(loaded)
    }
    refresh()
    function onBoardUpdate() { refresh() }
    window.addEventListener('yoko-board-update', onBoardUpdate)
    return () => window.removeEventListener('yoko-board-update', onBoardUpdate)
  }, [])

  useEffect(() => {

    // Restore team capacities from localStorage
    let capByMember: Record<string, number> = {}
    try {
      const savedCap = localStorage.getItem('yoko-capacities')
      if (savedCap) capByMember = JSON.parse(savedCap)
    } catch {}

    // Restore team order from localStorage
    try {
      const saved = localStorage.getItem('planning-team-order')
      if (saved) {
        const order = JSON.parse(saved) as string[]
        const byId  = new Map(teamData.members.map(m => [m.id, m]))
        const ordered: TeamMember[] = []
        for (const id of order) { const m = byId.get(id); if (m) { ordered.push(m); byId.delete(id) } }
        for (const m of byId.values()) ordered.push(m)
        if (ordered.length === teamData.members.length) {
          setTeam(ordered.map(m => capByMember[m.id] ? { ...m, weeklyCapacity: capByMember[m.id] } : m))
          return
        }
      }
    } catch {}
    if (Object.keys(capByMember).length > 0) {
      setTeam(teamData.members.map(m => capByMember[m.id] ? { ...m, weeklyCapacity: capByMember[m.id] } : m))
    }
  }, [])

  function applyShift() {
    if (shiftPicked.size === 0 || shiftDays === 0) { setShiftOpen(false); return }
    // Group changes per board for efficient single save per board
    const updates: Record<string, BoardGroup[]> = {}
    const before: Record<string, BoardGroup[]> = {}
    for (const project of projects) {
      if (!shiftPicked.has(project.id)) continue
      if (!project.startDate || !project.endDate) continue
      const board = project.board
      const itemId = project.id.slice(board.length + 2)
      if (!updates[board]) {
        updates[board] = (allGroups[board] ?? []).map(g => ({ ...g, items: g.items.map(i => ({ ...i })) }))
        before[board]  = allGroups[board] ?? []
      }
      for (const g of updates[board]) {
        for (const i of g.items) {
          if (i.id === itemId) {
            if (i.startDate) i.startDate = addDays(i.startDate as string, shiftDays)
            if (i.endDate)   i.endDate   = addDays(i.endDate   as string, shiftDays)
          }
        }
      }
    }
    for (const [board, groups] of Object.entries(updates)) {
      saveGroups(board, groups)
    }
    setAllGroups(prev => ({ ...prev, ...updates }))
    logActivity('Mass-shift toegepast', `${shiftPicked.size} project(en)`, `${shiftDays > 0 ? '+' : ''}${shiftDays} dagen`)
    pushUndo(() => {
      for (const [board, groups] of Object.entries(before)) saveGroups(board, groups)
      setAllGroups(prev => ({ ...prev, ...before }))
    })
    setShiftOpen(false); setShiftPicked(new Set())
  }

  function moveTeamMember(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= team.length) return
    const updated = [...team]
    updated[idx] = updated[next]; updated[next] = team[idx]
    setTeam(updated)
    localStorage.setItem('planning-team-order', JSON.stringify(updated.map(m => m.id)))
  }

  useEffect(() => { localStorage.setItem('planning-viewSize', viewSize) }, [viewSize])
  useEffect(() => { localStorage.setItem('planning-zoom', zoom) }, [zoom])

  // ─── Drag-to-scroll ───────────────────────────────────────────────────────────
  function onGridMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Only plain left click (not on interactive children that handle their own drag)
    const target = e.target as HTMLElement
    if (target.closest('[draggable="true"]') || target.closest('button') || target.closest('input') || target.closest('a')) return
    if (e.button !== 0) return
    e.preventDefault()
    const el = gridRef.current
    if (!el) return
    dragScrollRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft }
    setIsDragScrolling(true)
    function onMove(ev: MouseEvent) {
      if (!dragScrollRef.current || !el) return
      const dx = ev.clientX - dragScrollRef.current.startX
      el.scrollLeft = dragScrollRef.current.scrollLeft - dx
    }
    function onUp() {
      dragScrollRef.current = null
      setIsDragScrolling(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const projects = useMemo(
    () => Object.entries(allGroups).flatMap(([n, g]) => groupsToProjects(n, g)),
    [allGroups]
  )

  const effectiveProjects = useMemo(() => {
    if (!shadowDrag) return projects
    return projects.map(p => p.id === shadowDrag.projectId ? { ...p, startDate: shadowDrag.start, endDate: shadowDrag.end } : p)
  }, [projects, shadowDrag])

  // Compute view constants
  const { cs, or, hh, av } = vc(viewSize)
  const colW = zoom === 'dag' ? ZOOM_COL_W.dag : zoom === 'maand' ? ZOOM_COL_W.maand : (viewSize === 'large' ? 130 : 104)

  // Compute from-date based on zoom and offset.
  // Default (offset 0): today / this week / this month at the LEFT edge.
  // User can scroll back via colOffset (negative) or forward (positive).
  const now   = new Date()
  const baseFrom: Date = useMemo(() => {
    if (zoom === 'dag') {
      const d = new Date(now); d.setDate(d.getDate() + colOffset); d.setHours(0,0,0,0); return d
    }
    if (zoom === 'maand') {
      const d = new Date(now.getFullYear(), now.getMonth() + colOffset, 1); return d
    }
    // week
    const ws = getWeekStart(now)
    const d  = new Date(ws); d.setDate(d.getDate() + colOffset * 7); return d
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, colOffset])

  const cols = useMemo(() => buildCols(zoom, baseFrom, colW), [zoom, baseFrom, colW])

  // Capacity in the right unit per zoom
  function colCapacity(weeklyCapacity: number): number {
    if (zoom === 'dag')   return Math.round((weeklyCapacity / 5) * 10) / 10
    if (zoom === 'maand') return Math.round((weeklyCapacity * 4.33) * 10) / 10
    return weeklyCapacity
  }

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function updateCapacity(memberId: string, capacity: number) {
    setTeam(prev => {
      const next = prev.map(m => m.id === memberId ? { ...m, weeklyCapacity: capacity } : m)
      try {
        const map: Record<string, number> = {}
        for (const m of next) map[m.id] = m.weeklyCapacity
        localStorage.setItem('yoko-capacities', JSON.stringify(map))
      } catch {}
      return next
    })
  }
  function handleDragMove(project: Project, s: string | null, e: string | null) {
    setShadowDrag({ projectId: project.id, start: s, end: e })
  }
  function handleDragEnd(project: Project, newStart: string | null, newEnd: string | null) {
    setShadowDrag(null)
    const boardName  = project.board
    const origItemId = project.id.slice(boardName.length + 2)
    const prevStart  = project.startDate
    const prevEnd    = project.endDate
    const apply = (s: string | null, e: string | null) => {
      const groups = (allGroups[boardName] ?? []).map(g => ({
        ...g, items: g.items.map(i => i.id === origItemId ? { ...i, startDate: s, endDate: e } : i),
      }))
      saveGroups(boardName, groups)
      setAllGroups(prev => ({ ...prev, [boardName]: groups }))
    }
    apply(newStart, newEnd)
    logActivity('Datums bijgewerkt', project.name, `${prevStart ?? '—'} → ${newStart ?? '—'} / ${prevEnd ?? '—'} → ${newEnd ?? '—'}`)
    if (detailProject?.id === project.id) setDetailProject({ ...detailProject, startDate: newStart, endDate: newEnd })
    pushUndo(() => apply(prevStart, prevEnd))
  }
  function handleDetailUpdate(project: Project, newStart: string | null, newEnd: string | null, extra?: Partial<{ estHours: number; notes: string; journal: import('@/lib/boards').JournalEntry[] }>) {
    const boardName  = project.board
    const origItemId = project.id.slice(boardName.length + 2)
    const groups = (allGroups[boardName] ?? []).map(g => ({
      ...g, items: g.items.map(i => i.id === origItemId ? { ...i, startDate: newStart, endDate: newEnd, ...(extra ?? {}) } : i),
    }))
    saveGroups(boardName, groups)
    setAllGroups(prev => ({ ...prev, [boardName]: groups }))
    logActivity('Project opgeslagen', project.name)
    setDetailProject(null)
  }

  const nameW       = isMobile ? 130 : NAME_W
  const namePad     = isMobile ? 14 : NAME_PAD
  const totalWidth  = nameW + namePad + cols.reduce((s, c) => s + c.widthPx, 0)
  const monthGroups = zoom !== 'maand' ? getMonthGroupsFromCols(cols) : null
  const stickyBg    = 'var(--bg-base)'

  // Navigation step
  function stepBack()    { setColOffset(o => o - 1) }
  function stepForward() { setColOffset(o => o + 1) }
  function jumpBack()    { setColOffset(o => o - ZOOM_COUNT[zoom]) }
  function jumpForward() { setColOffset(o => o + ZOOM_COUNT[zoom]) }
  function goToday()     { setColOffset(0) }

  // ─── KPIs (this week) ───────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const weekStart = getWeekStart(new Date())
    const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7); weekEnd.setHours(0,0,0,0)
    let totalHours = 0, totalCap = 0, overbooked = 0, deadlinesThis = 0
    const activeIds = new Set<string>()
    for (const m of team) {
      const cap = m.weeklyCapacity
      totalCap += cap
      let memberHours = 0
      for (const p of projects) {
        if (!p.ownerIds.includes(m.id)) continue
        if (!p.startDate || !p.endDate) continue
        const pS = new Date(p.startDate).getTime()
        const pE = new Date(p.endDate).getTime() + 86400000
        if (pE < weekStart.getTime() || pS > weekEnd.getTime()) continue
        const oS = Math.max(pS, weekStart.getTime())
        const oE = Math.min(pE, weekEnd.getTime())
        const fraction = (oE - oS) / (pE - pS)
        const hpp = p.estHours / Math.max(p.ownerIds.length, 1)
        memberHours += fraction * hpp
        if (p.status !== 'done') activeIds.add(p.id)
      }
      memberHours = Math.round(memberHours * 10) / 10
      totalHours += memberHours
      if (memberHours > cap) overbooked += 1
    }
    // Deadlines this week
    for (const groups of Object.values(allGroups)) {
      for (const g of groups) for (const item of g.items) {
        const dl = item.deadline as string | null
        if (!dl) continue
        const t = new Date(dl).getTime()
        if (t >= weekStart.getTime() && t < weekEnd.getTime()) deadlinesThis += 1
      }
    }
    const pctUsed = totalCap > 0 ? Math.round((totalHours / totalCap) * 100) : 0
    return { totalHours: Math.round(totalHours * 10) / 10, totalCap, pctUsed, overbooked, activeProjects: activeIds.size, deadlinesThis }
  }, [team, projects, allGroups])

  // ─── "Now" indicator position ───────────────────────────────────────────────
  const nowOffset = useMemo(() => {
    const ms = Date.now()
    let acc = nameW + namePad
    for (const col of cols) {
      const start = col.rangeStart.getTime()
      const end   = col.rangeEnd.getTime() + 1
      if (ms < start) return null
      if (ms <= end) {
        const frac = (ms - start) / (end - start)
        return acc + col.widthPx * frac
      }
      acc += col.widthPx
    }
    return null
  }, [cols, nameW, namePad])

  // Formatted current date for header subtitle
  const today = new Date()
  const todayLabel = today.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── Fixed header (never scrolls) ── */}
      <header style={{ flexShrink: 0, padding: isMobile ? '14px 14px 0' : '24px 32px 0' }}>

        {/* Title + nav */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: isMobile ? 10 : 16 }}>
          <div style={{ minWidth: 0, flex: 1, paddingRight: isMobile ? 90 : 0 }}>
            <h1 style={{ fontSize: isMobile ? 22 : 30, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', lineHeight: 1 }}>
              Planning
            </h1>
            <div style={{ marginTop: 4, fontSize: isMobile ? 11 : 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {todayLabel}
            </div>
          </div>
          {!isMobile && (
            <div style={segGroup}>
              <button onClick={jumpBack} style={segBtn(false)} title="Sprong terug"><IconChevronsLeft size={14} /></button>
              <button onClick={stepBack} style={segBtn(false)}><IconChevronLeft size={14} /></button>
              <button onClick={goToday}  style={segBtn(false, 'var(--accent)', 700)}>Vandaag</button>
              <button onClick={stepForward} style={segBtn(false)}><IconChevronRight size={14} /></button>
              <button onClick={jumpForward} style={segBtn(false)} title="Sprong vooruit"><IconChevronsRight size={14} /></button>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10, flexWrap: 'wrap', marginBottom: isMobile ? 10 : 16 }}>
          {/* Zoom */}
          <div style={segGroup}>
            {(['dag', 'week', 'maand'] as ZoomLevel[]).map(z => (
              <button key={z} onClick={() => { setZoom(z); setColOffset(0) }}
                style={segBtn(zoom === z)}>
                {z === 'dag' ? 'Dag' : z === 'week' ? 'Week' : 'Maand'}
              </button>
            ))}
          </div>

          {/* Mobile: nav + overflow */}
          {isMobile ? (
            <>
              <div style={{ ...segGroup, marginLeft: 'auto' }}>
                <button onClick={stepBack} style={segBtn(false)}><IconChevronLeft size={14} /></button>
                <button onClick={goToday}  style={segBtn(false, 'var(--accent)', 700)}>Nu</button>
                <button onClick={stepForward} style={segBtn(false)}><IconChevronRight size={14} /></button>
              </div>
              <button onClick={() => setOverflowOpen(true)} aria-label="Meer acties"
                style={{ ...ghostBtn(false), padding: '6px 10px' }}>
                <IconMore size={18} />
              </button>
            </>
          ) : (
            <>
              <span style={separator} />
              <button onClick={() => setPeopleOpen(true)} style={ghostBtn(filterMembers.size > 0)}>
                <IconUsers size={14} style={{ marginRight: 6 }} />Mensen{filterMembers.size > 0 ? ` · ${filterMembers.size}` : ''}
              </button>
              <button onClick={() => setAgendasOpen(true)} style={ghostBtn(false)}>
                <IconBoard size={14} style={{ marginRight: 6 }} />Agenda&apos;s
              </button>
              <span style={separator} />
              <button onClick={() => setUrenOpen(true)} style={ghostBtn(false)}>
                <IconHourglass size={14} style={{ marginRight: 6 }} />Capaciteit
              </button>
              <button onClick={() => setShiftOpen(true)} style={ghostBtn(false)} title="Meerdere projecten verschuiven">
                <IconRange size={14} style={{ marginRight: 6 }} />Verschuif
              </button>
              <button onClick={() => downloadIcs(projects)} title="Exporteer als iCal" style={ghostBtn(false)}>
                <IconDownload size={14} style={{ marginRight: 6 }} />Exporteer
              </button>
              <button onClick={() => setShareOpen(true)} title="Deelbare links per agenda" style={ghostBtn(false)}>
                <IconShare size={14} style={{ marginRight: 6 }} />Deel
              </button>
              <button onClick={() => setEditOrder(o => !o)} title="Volgorde teamleden" style={ghostBtn(editOrder)}>
                <IconSort size={14} style={{ marginRight: 6 }} />{editOrder ? 'Klaar' : 'Sorteren'}
              </button>
            </>
          )}
        </div>

        {/* KPI strip — horizontally scrollable on mobile */}
        {isMobile ? (
          <div style={{
            display: 'flex', gap: 8,
            overflowX: 'auto', overflowY: 'hidden',
            paddingBottom: 12,
            marginBottom: 4,
            borderBottom: '1px solid var(--border-light)',
            scrollbarWidth: 'none',
          }}>
            <KpiCard label="Capaciteit" value={`${kpis.pctUsed}%`}
              sub={`${kpis.totalHours} / ${kpis.totalCap} uur`}
              tone={kpis.pctUsed > 100 ? 'red' : kpis.pctUsed > 85 ? 'amber' : 'normal'} compact />
            <KpiCard label="Overbelast" value={String(kpis.overbooked)}
              sub={kpis.overbooked === 1 ? 'persoon' : 'personen'}
              tone={kpis.overbooked > 0 ? 'red' : 'normal'} compact />
            <KpiCard label="Actief" value={String(kpis.activeProjects)} sub="deze week" compact />
            <KpiCard label="Deadlines" value={String(kpis.deadlinesThis)} sub="deze week"
              tone={kpis.deadlinesThis > 0 ? 'amber' : 'normal'} compact />
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
            paddingBottom: 18, borderBottom: '1px solid var(--border-light)',
          }}>
            <KpiCard label="Capaciteit deze week" value={`${kpis.pctUsed}%`}
              sub={`${kpis.totalHours} / ${kpis.totalCap} uur`}
              tone={kpis.pctUsed > 100 ? 'red' : kpis.pctUsed > 85 ? 'amber' : 'normal'} />
            <KpiCard label="Overbelast" value={String(kpis.overbooked)}
              sub={kpis.overbooked === 0 ? 'iedereen onder cap' : kpis.overbooked === 1 ? 'persoon' : 'personen'}
              tone={kpis.overbooked > 0 ? 'red' : 'normal'} />
            <KpiCard label="Actieve projecten" value={String(kpis.activeProjects)} sub="lopen deze week" />
            <KpiCard label="Deadlines" value={String(kpis.deadlinesThis)} sub="deze week"
              tone={kpis.deadlinesThis > 0 ? 'amber' : 'normal'} />
          </div>
        )}
      </header>

      {/* ── Mobile overflow menu ── */}
      {overflowOpen && (
        <Popup title="Acties" onClose={() => setOverflowOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { icon: IconUsers,     label: filterMembers.size > 0 ? `Mensen · ${filterMembers.size}` : 'Mensen', active: filterMembers.size > 0, onClick: () => { setOverflowOpen(false); setPeopleOpen(true) } },
              { icon: IconBoard,     label: "Agenda's", active: false, onClick: () => { setOverflowOpen(false); setAgendasOpen(true) } },
              { icon: IconHourglass, label: 'Capaciteit',                 active: false, onClick: () => { setOverflowOpen(false); setUrenOpen(true) } },
              { icon: IconRange,     label: 'Verschuif projecten',        active: false, onClick: () => { setOverflowOpen(false); setShiftOpen(true) } },
              { icon: IconDownload,  label: 'Exporteer als iCal',         active: false, onClick: () => { setOverflowOpen(false); downloadIcs(projects) } },
              { icon: IconShare,     label: 'Deelbare link maken',        active: false, onClick: () => { setOverflowOpen(false); setShareOpen(true) } },
              { icon: IconSort,      label: editOrder ? 'Stop sorteren'   : 'Sorteer teamleden', active: editOrder, onClick: () => { setOverflowOpen(false); setEditOrder(o => !o) } },
            ].map(({ icon: Ic, label, active, onClick }) => (
              <button key={label} onClick={onClick}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 8,
                  border: '1px solid transparent',
                  background: active ? 'var(--accent-light)' : 'var(--bg-hover)',
                  color: active ? 'var(--accent)' : 'var(--text-primary)',
                  cursor: 'pointer', fontSize: 14, fontWeight: 500, textAlign: 'left' }}>
                <Ic size={18} />{label}
              </button>
            ))}
          </div>
        </Popup>
      )}

      {/* ── Uren popup ── */}
      {urenOpen && (
        <Popup title="Capaciteit per persoon" onClose={() => setUrenOpen(false)}>
          {team.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{m.name}</span>
              <input type="number" value={m.weeklyCapacity} min={0}
                onChange={e => updateCapacity(m.id, parseInt(e.target.value) || 0)}
                style={{ width: 60, background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', textAlign: 'right' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>u/w</span>
            </div>
          ))}
        </Popup>
      )}

      {/* ── Agenda's popup ── */}
      {agendasOpen && (
        <Popup title="Agenda's" onClose={() => setAgendasOpen(false)}>
          {Object.entries(BOARD_COLORS).map(([b, c]) => (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: c, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500, textTransform: 'capitalize' }}>{b}</span>
            </div>
          ))}
        </Popup>
      )}

      {/* ── Share popup ── */}
      {shareOpen && (
        <Popup title="Deelbare read-only links" onClose={() => setShareOpen(false)}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
            Deel een agenda met klanten of partners. Geen login nodig om te bekijken.
          </p>
          {Object.entries(BOARD_COLORS).map(([b, c]) => {
            const url = typeof window !== 'undefined' ? `${window.location.origin}/share/${b}` : `/share/${b}`
            const copied = copiedBoard === b
            return (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: c, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, textTransform: 'capitalize', minWidth: 80 }}>{b}</span>
                <input readOnly value={url}
                  onClick={e => e.currentTarget.select()}
                  style={{ flex: 1, minWidth: 0, background: 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-secondary)', fontSize: 11, outline: 'none', fontFamily: 'monospace' }} />
                <button onClick={async () => {
                    try { await navigator.clipboard.writeText(url); setCopiedBoard(b); setTimeout(() => setCopiedBoard(null), 1500) } catch {}
                  }}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-light)',
                    background: copied ? 'var(--accent-light)' : 'var(--bg-card)',
                    color: copied ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                  {copied ? '✓ Gekopieerd' : 'Kopieer'}
                </button>
                <a href={url} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-light)',
                    background: 'var(--bg-card)', color: 'var(--text-secondary)',
                    fontSize: 11, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
                  Open
                </a>
              </div>
            )
          })}
        </Popup>
      )}

      {/* ── Mass-shift popup ── */}
      {shiftOpen && (
        <Popup title="Verschuif projecten" onClose={() => setShiftOpen(false)}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Aantal dagen</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {[-7, -1, 1, 7, 14].map(d => (
                <button key={d} onClick={() => setShiftDays(d)}
                  style={{ padding: '6px 12px', borderRadius: 7,
                    border: `1px solid ${shiftDays === d ? 'var(--accent)' : 'var(--border-light)'}`,
                    background: shiftDays === d ? 'var(--accent-light)' : 'var(--bg-card)',
                    color: shiftDays === d ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
              <input type="number" value={shiftDays}
                onChange={e => setShiftDays(parseInt(e.target.value) || 0)}
                style={{ width: 70, background: 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>dagen</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Projecten ({shiftPicked.size})</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShiftPicked(new Set(projects.filter(p => p.startDate && p.endDate).map(p => p.id)))}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>Alles</button>
              <button onClick={() => setShiftPicked(new Set())}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>Wis</button>
            </div>
          </div>

          <input value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}
            placeholder="Zoek project…"
            style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />

          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: 8 }}>
            {projects
              .filter(p => p.startDate && p.endDate)
              .filter(p => !shiftFilter || p.name.toLowerCase().includes(shiftFilter.toLowerCase()))
              .map(p => {
                const checked = shiftPicked.has(p.id)
                return (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }}>
                    <input type="checkbox" checked={checked}
                      onChange={() => setShiftPicked(prev => {
                        const next = new Set(prev)
                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
                        return next
                      })}
                      style={{ accentColor: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: BOARD_COLORS[p.board] ?? '#888', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{p.board}</span>
                  </label>
                )
              })}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button onClick={() => setShiftOpen(false)} style={cancelBtn}>Annuleer</button>
            <button onClick={applyShift} disabled={shiftPicked.size === 0 || shiftDays === 0}
              style={{ ...cancelBtn,
                background: shiftPicked.size > 0 && shiftDays !== 0 ? 'var(--accent)' : 'var(--bg-hover)',
                color: shiftPicked.size > 0 && shiftDays !== 0 ? '#fff' : 'var(--text-muted)',
                border: 'none', fontWeight: 700,
                cursor: shiftPicked.size > 0 && shiftDays !== 0 ? 'pointer' : 'not-allowed' }}>
              Verschuif {shiftPicked.size} project(en)
            </button>
          </div>
        </Popup>
      )}

      {/* ── Mensen filter popup ── */}
      {peopleOpen && (
        <Popup title="Filter op mensen" onClose={() => setPeopleOpen(false)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {filterMembers.size === 0 ? 'Iedereen zichtbaar' : `${filterMembers.size} geselecteerd`}
            </span>
            {filterMembers.size > 0 && (
              <button onClick={() => setFilterMembers(new Set())}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>
                Reset
              </button>
            )}
          </div>
          {team.map(m => {
            const checked = filterMembers.size === 0 || filterMembers.has(m.id)
            return (
              <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked}
                  onChange={() => {
                    setFilterMembers(prev => {
                      const next = new Set(prev)
                      // first interaction with empty set = start picking
                      if (next.size === 0) { team.forEach(t => next.add(t.id)) }
                      if (next.has(m.id)) next.delete(m.id); else next.add(m.id)
                      // if all selected, treat as "no filter"
                      if (next.size === team.length) return new Set()
                      return next
                    })
                  }}
                  style={{ width: 18, height: 18, accentColor: m.color, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{m.name}</span>
              </label>
            )
          })}
        </Popup>
      )}

      {/* ── Grid — only this scrolls (both axes) ── */}
      <div ref={gridRef} onMouseDown={onGridMouseDown}
        style={{ flex: 1, overflow: 'auto', minHeight: 0, cursor: isDragScrolling ? 'grabbing' : 'grab', userSelect: isDragScrolling ? 'none' : 'auto' }}>
        <div style={{ minWidth: totalWidth, position: 'relative' }}>

          {/* "Now" indicator: vertical accent line at today's exact position */}
          {nowOffset !== null && (
            <div aria-hidden style={{
              position: 'absolute', top: 0, bottom: 0,
              left: nowOffset, width: 0,
              borderLeft: '2px solid var(--accent)',
              opacity: 0.55, pointerEvents: 'none', zIndex: 6,
            }}>
              <div style={{
                position: 'absolute', top: 0, left: -4,
                width: 10, height: 10, borderRadius: '50%',
                background: 'var(--accent)',
              }} />
            </div>
          )}

          {/* Month grouping row (only for week/day zoom) */}
          {monthGroups && (
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 12, background: stickyBg }}>
              <div style={{ width: nameW + namePad, flexShrink: 0, position: 'sticky', left: 0, zIndex: 13, background: stickyBg }} />
              {monthGroups.map(({ label, widthPx }) => (
                <div key={label} style={{ width: widthPx, flexShrink: 0, padding: '6px 12px', fontSize: 10.5, fontWeight: 600,
                  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em',
                  borderLeft: '1px solid var(--border-light)', background: stickyBg }}>
                  {label}
                </div>
              ))}
            </div>
          )}

          {/* Column header row */}
          <div style={{ display: 'flex', position: 'sticky', top: monthGroups ? 28 : 0, zIndex: 11, background: stickyBg, borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ width: nameW + namePad, flexShrink: 0, position: 'sticky', left: 0, zIndex: 12, background: stickyBg, borderRight: '1px solid var(--border-light)' }} />
            {cols.map(col => {
              const dow = zoom === 'dag' ? col.rangeStart.getDay() : -1
              const weekend = dow === 0 || dow === 6
              const headerBg = col.isCurrent ? 'var(--accent-light)' : weekend ? 'var(--overlay-faint)' : stickyBg
              return (
              <div key={col.key} style={{ width: col.widthPx, flexShrink: 0, padding: '8px 2px', textAlign: 'center',
                borderLeft: '1px solid var(--border-light)',
                background: headerBg }}>
                <div style={{ fontSize: zoom === 'dag' ? 10 : 11.5, fontWeight: col.isCurrent ? 700 : 600, color: col.isCurrent ? 'var(--accent)' : weekend ? 'var(--text-muted)' : 'var(--text-muted)', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>{col.label1}</div>
                <div style={{ fontSize: zoom === 'dag' ? 14 : 9.5, fontWeight: zoom === 'dag' ? (col.isCurrent ? 700 : 600) : 400, color: col.isCurrent ? 'var(--accent)' : zoom === 'dag' ? (weekend ? 'var(--text-muted)' : 'var(--text-primary)') : 'var(--text-muted)', marginTop: 2, letterSpacing: '0.02em' }}>{col.label2}</div>
              </div>
              )
            })}
          </div>

          {/* Member rows (filtered by people-picker if active) */}
          {team
            .filter(m => filterMembers.size === 0 || filterMembers.has(m.id))
            .map((member, mIdx) => {
            const isExp = expanded.has(member.id)
            const cap   = colCapacity(member.weeklyCapacity)
            const memberProjects = effectiveProjects.filter(p => p.ownerIds.includes(member.id) && (p.startDate || p.endDate))

            return (
              <div key={member.id} style={{ borderBottom: '1px solid var(--border-light)', background: 'transparent' }}>
                {/* Capacity row */}
                <div style={{ display: 'flex' }}>
                  {/* Sticky name cell */}
                  <div style={{ width: nameW + namePad, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3,
                    background: stickyBg,
                    display: 'flex', alignItems: 'center',
                    padding: `0 12px 0 ${namePad}px`, height: hh, borderRight: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, width: '100%' }}>
                      {!editOrder && (
                        <button onClick={() => toggleExpand(member.id)} title={isExp ? 'Inklappen' : 'Uitvouwen'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 7, color: isExp ? 'var(--text-secondary)' : 'var(--text-muted)', padding: '2px', flexShrink: 0, transition: 'transform 0.15s', transform: isExp ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</button>
                      )}
                      <MemberAvatar member={member} size={av} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: viewSize === 'large' ? 14 : 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.name}</div>
                      </div>
                      {editOrder && (() => {
                        const realIdx  = team.findIndex(t => t.id === member.id)
                        const isFirst  = realIdx === 0
                        const isLast   = realIdx === team.length - 1
                        return (
                          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                            <button onClick={() => moveTeamMember(realIdx, -1)} disabled={isFirst} title="Omhoog"
                              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)',
                                color: isFirst ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: isFirst ? 'not-allowed' : 'pointer',
                                fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                opacity: isFirst ? 0.4 : 1, minHeight: 24, minWidth: 24 }}>↑</button>
                            <button onClick={() => moveTeamMember(realIdx, 1)} disabled={isLast} title="Omlaag"
                              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)',
                                color: isLast ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: isLast ? 'not-allowed' : 'pointer',
                                fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                opacity: isLast ? 0.4 : 1, minHeight: 24, minWidth: 24 }}>↓</button>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Week/day/month cells */}
                  {cols.map(col => {
                    const contribs = memberHoursInCol(effectiveProjects, member.id, col)
                    const total    = Math.round(contribs.reduce((s, c) => s + c.hours, 0) * 10) / 10
                    const dow      = zoom === 'dag' ? col.rangeStart.getDay() : -1
                    const weekend  = dow === 0 || dow === 6
                    return (
                      <div key={col.key} style={{ width: col.widthPx, height: hh, flexShrink: 0, borderLeft: '1px solid var(--border-light)', padding: 2,
                        background: col.isCurrent ? 'var(--accent-light)' : weekend ? 'var(--overlay-faint)' : 'transparent', position: 'relative' }}>
                        <WorkloadCell contribs={contribs} total={total} capacity={cap} cs={cs} or={or} zoom={zoom} />
                      </div>
                    )
                  })}
                </div>

                {/* Timeline bars (expanded) */}
                {isExp && memberProjects.length > 0 && (
                  <div style={{ display: 'flex' }}>
                    <div style={{ width: nameW + namePad, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: stickyBg, borderRight: '1px solid var(--border)' }} />
                    <div style={{ width: cols.reduce((s, c) => s + c.widthPx, 0), overflow: 'visible', flexShrink: 0 }}>
                      <TimelineBars memberId={member.id} projects={effectiveProjects} cols={cols} colW={colW}
                        onDragMove={handleDragMove} onDragEnd={handleDragEnd} onBarClick={p => setDetailProject(p)} />
                    </div>
                  </div>
                )}
                {isExp && memberProjects.length === 0 && (
                  <div style={{ display: 'flex' }}>
                    <div style={{ width: nameW + namePad, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: stickyBg, borderRight: '1px solid var(--border)' }} />
                    <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Geen items met datums gevonden</div>
                  </div>
                )}
              </div>
            )
          })}

        </div>

        {/* Footer info */}
        <div style={{ padding: isMobile ? '10px 14px 24px' : '12px 32px 24px', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
          {projects.length} items · {team.length} teamleden · {Object.keys(BOARD_COLORS).length} agenda&apos;s
          {!isMobile && <> · sleep een balk om datums te verschuiven · klik voor details</>}
        </div>
      </div>

      {detailProject && (
        <DetailPanel project={detailProject} allGroups={allGroups}
          onClose={() => setDetailProject(null)} onUpdate={handleDetailUpdate} />
      )}
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const navBtn: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
  padding: '5px 10px', fontSize: 13,
}

// ─── Refined toolbar primitives ───────────────────────────────────────────────
const segGroup: React.CSSProperties = {
  display: 'inline-flex',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-light)',
  borderRadius: 8, overflow: 'hidden',
}
function segBtn(active: boolean, color?: string, weight?: number): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 12.5, fontWeight: weight ?? (active ? 600 : 500),
    border: 'none', cursor: 'pointer',
    background: active ? 'var(--text-primary)' : 'transparent',
    color: active ? 'var(--bg-base)' : (color ?? 'var(--text-secondary)'),
    transition: 'background 0.15s, color 0.15s',
  }
}
function ghostBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 11px',
    fontSize: 12.5, fontWeight: 500,
    borderRadius: 7,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-light)'}`,
    background: active ? 'var(--accent-light)' : 'var(--bg-card)',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  }
}
const separator: React.CSSProperties = {
  width: 1, height: 22, background: 'var(--border-light)', display: 'inline-block', margin: '0 2px',
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, tone = 'normal', compact = false }: {
  label: string; value: string; sub?: string; tone?: 'normal' | 'amber' | 'red'; compact?: boolean
}) {
  const valueColor = tone === 'red' ? '#C4453A' : tone === 'amber' ? '#B27500' : 'var(--text-primary)'
  return (
    <div style={{
      padding: compact ? '8px 12px' : '10px 14px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-light)',
      borderRadius: 10,
      flexShrink: 0,
      minWidth: compact ? 120 : undefined,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: compact ? 18 : 22, fontWeight: 700, color: valueColor, marginTop: 4, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  )
}
const dateInput: React.CSSProperties = {
  background: 'var(--bg-hover)', border: '1px solid var(--border)',
  borderRadius: 5, padding: '5px 8px', color: 'var(--text-primary)',
  fontSize: 12, outline: 'none', boxSizing: 'border-box',
}
const cancelBtn: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-hover)', color: 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 13,
}
