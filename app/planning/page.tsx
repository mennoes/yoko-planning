'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useMemberPopup } from '@/components/MemberPopup'
import { useUndo } from '@/components/UndoContext'
import teamData          from '@/data/team.json'
import yokoRaw           from '@/data/boards/yoko.json'
import pnpRaw            from '@/data/boards/pnp.json'
import nederlandRaw      from '@/data/boards/nederland.json'
import vlaanderenRaw     from '@/data/boards/vlaanderen.json'
import dienjaarRaw       from '@/data/boards/dienjaar.json'
import { loadGroups, saveGroups, addDays, BOARD_NAMES, moveItemToBoard } from '@/lib/boardStore'
import { BOARD_CONFIGS, type BoardItem } from '@/lib/boards'
import { getWeekStart, getWeeks, getWeekLabel, BOARD_COLORS, type Project, type TeamMember } from '@/lib/workload'
import {
  CAT_COLOR, CAT_LABEL, ALL_CATEGORIES,
  effectiveCategory,
  loadCategoryOverrides, setCategoryOverride, onCategoryOverridesChange,
  type WorkloadCategory,
} from '@/lib/workloadCategory'
import { openExclusivePopover, closeExclusivePopover, onExclusivePopoverChange } from '@/lib/popoverState'
import { createNotification } from '@/lib/notificationsStore'
import { logItemActivity } from '@/lib/itemActivity'
import { MentionTextarea } from '@/components/MentionTextarea'
import { TextWithItemRefs } from '@/components/ItemRefChip'
import { ReactionRow } from '@/components/ReactionRow'
import { LinksRow } from '@/components/LinksRow'
import { ItemHistory } from '@/components/ItemHistory'
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
import { GoogleBadge } from '@/components/GoogleBadge'
import { UserAvatar } from '@/components/UserAvatar'
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
  if (vs === 'large') return { cs: 78, or: 35, hh: 110, av: 58 }
  return                     { cs: 46, or: 20, hh:  72, av: 44 }
}
// Column widths per zoom
const ZOOM_COL_W: Record<ZoomLevel, number> = { dag: 46, week: 104, maand: 120 }
// How many columns of history to render before today on first load.
const HISTORY_BACK: Record<ZoomLevel, number> = { dag: 14, week: 4, maand: 2 }
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
      .flatMap((i): Project[] => {
        const subs = (i.subitems as Array<{ id?: string; name?: string; estHours?: number; startDate?: string | null; endDate?: string | null; ownerIds?: string[] }> | undefined) ?? []
        // Subitems with their own dates → render each one as a separate bar
        // so the planner shows when each piece actually happens. Parent bar
        // is suppressed to avoid double-counting hours.
        const subsWithDates = subs.filter(si => si.startDate || si.endDate)
        if (subsWithDates.length > 0) {
          return subsWithDates.map((si, idx): Project => ({
            id:        `${boardName}__${i.id}__si${idx}`,
            name:      `${i.name}${si.name ? ' · ' + si.name : ''}`,
            board:     boardName,
            group:     g.name,
            ownerIds:  (si.ownerIds && si.ownerIds.length ? si.ownerIds : (i.ownerIds as string[])),
            startDate: si.startDate ?? null,
            endDate:   si.endDate ?? si.startDate ?? null,
            estHours:  Number(si.estHours) || 0,
            status:    (i.status as string) === 'Done' ? 'done' : 'active',
            source:    (i.source as 'manual' | 'google' | undefined),
            externalLink: (i.externalLink as string | undefined),
          }))
        }
        // Subitems without their own dates: keep parent bar with summed hours.
        const hours = subs.length > 0
          ? subs.reduce((s, si) => s + (Number(si.estHours) || 0), 0)
          : (Number(i.estHours) || 0)
        return [{
          id: `${boardName}__${i.id}`,
          name: i.name as string,
          board: boardName,
          group: g.name,
          ownerIds:  i.ownerIds  as string[],
          startDate: i.startDate as string | null,
          endDate:   i.endDate   as string | null,
          estHours:  hours,
          ownerHours: (i.ownerHours as Record<string, number> | undefined),
          status:    (i.status as string) === 'Done' ? 'done' : 'active',
          source:        (i.source as 'manual' | 'google' | undefined),
          externalLink:  (i.externalLink as string | undefined),
        }]
      })
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
// Simpel: blauw als alles goed gaat, rood bij overload. Geen regenboog.
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

const NL_DAY_FULL = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag']

function WorkloadCell({ contribs, total, capacity, cs, or: outerR, zoom, onOpenDetails }: {
  contribs: Contrib[]; total: number; capacity: number
  cs: number; or: number; zoom: ZoomLevel
  onOpenDetails?: (p: Project) => void
}) {
  const [open, setOpen] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, WorkloadCategory>>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  const popoverId = useRef(`wc:${Math.random().toString(36).slice(2)}`).current
  const pct = capacity > 0 ? total / capacity : 0

  function setOpenExclusive(next: boolean) {
    setOpen(next)
    if (next) openExclusivePopover(popoverId)
    else      closeExclusivePopover(popoverId)
  }

  // Always keep overrides in sync — the tiny category breakdown bar shows
  // even when the popover is closed, so it needs to react to changes from
  // the home page or other cells.
  useEffect(() => {
    setOverrides(loadCategoryOverrides())
    return onCategoryOverridesChange(() => setOverrides(loadCategoryOverrides()))
  }, [])

  // Close when another popover opens.
  useEffect(() => {
    if (!open) return
    return onExclusivePopoverChange(activeId => {
      if (activeId !== popoverId) setOpen(false)
    })
  }, [open, popoverId])

  // Close on outside click / tap
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      const root = wrapRef.current
      if (!root) return
      if (!root.contains(e.target as Node)) setOpenExclusive(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open])

  function setCat(id: string, cat: WorkloadCategory | null) {
    setOverrides(setCategoryOverride(id, cat))
  }

  const popover = open && total > 0 && (
    <WorkloadPopover
      contribs={contribs} total={total} capacity={capacity}
      overrides={overrides} setCat={setCat}
      groupByDay={zoom !== 'dag'}
      onClose={() => setOpenExclusive(false)}
      onOpenDetails={onOpenDetails}
    />
  )

  // Day zoom: full-cell tinted block, click → popover with the day's items.
  if (zoom === 'dag') {
    const baseColor = pct > 1 ? '#e2445c' : pct > 0.85 ? '#ff7b24' : '#579bfc'
    const alpha = pct > 0 ? Math.min(0.15 + Math.min(pct, 1) * 0.45, 0.65) : 0
    return (
      <div ref={wrapRef} style={{ position: 'relative', height: '100%' }}>
        <button onClick={() => total > 0 && setOpenExclusive(!open)} disabled={total === 0}
          style={{ width: '100%', height: '100%', padding: 0, border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: pct > 0 ? `${baseColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : 'transparent',
            borderRadius: 4,
            cursor: total > 0 ? 'pointer' : 'default' }}>
          {total > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: pct > 1 ? '#fff' : 'var(--text-primary)', textShadow: pct > 1 ? '0 0 2px rgba(0,0,0,0.4)' : 'none' }}>
              {total >= 1 ? Math.round(total) : total.toFixed(1)}
            </span>
          )}
        </button>
        {popover}
      </div>
    )
  }

  // Week / month zoom: circle + total label
  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1, position: 'relative' }}>
      <button onClick={() => total > 0 && setOpenExclusive(!open)} style={{
        background: 'none', border: 'none', cursor: total > 0 ? 'pointer' : 'default',
        padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      }}>
        <WorkloadCircleSvg pct={pct} cs={cs} or={outerR} />
        {total > 0 && (
          <span style={{ fontSize: cs > 60 ? 12 : 10, fontWeight: 700, color: pct > 1 ? '#e2445c' : 'var(--text-muted)', lineHeight: 1,
            position: 'relative', zIndex: 15,
            background: 'var(--bg-base)', padding: '0 3px', borderRadius: 3 }}>
            {total}u
          </span>
        )}
      </button>
      {popover}
    </div>
  )
}

// Floating detail popover: items grouped by start-day, each with a category
// (Maken / Overhead / Meeting) picker. Layout matches the home page workload
// rows so the experience is the same across views.
function WorkloadPopover({ contribs, total, capacity, overrides, setCat, groupByDay, onClose, onOpenDetails }: {
  contribs: Contrib[]; total: number; capacity: number
  overrides: Record<string, WorkloadCategory>
  setCat: (id: string, cat: WorkloadCategory | null) => void
  groupByDay: boolean
  onClose: () => void
  onOpenDetails?: (p: Project) => void
}) {
  const pct = capacity > 0 ? total / capacity : 0
  const r   = (n: number) => Math.round(n * 10) / 10

  type Group = { key: string; label: string; items: Contrib[]; total: number }
  const groups: Group[] = (() => {
    if (!groupByDay) return [{ key: 'all', label: '', items: contribs, total }]
    const byDay: Record<number, Contrib[]> = {}
    const undated: Contrib[] = []
    for (const c of contribs) {
      const sd = c.project.startDate ? new Date(c.project.startDate) : null
      if (!sd || isNaN(sd.getTime())) { undated.push(c); continue }
      const day = (sd.getDay() + 6) % 7  // Mon=0..Sun=6
      ;(byDay[day] ??= []).push(c)
    }
    const out: Group[] = []
    for (let d = 0; d < 7; d++) {
      const items = byDay[d]
      if (!items?.length) continue
      out.push({ key: String(d), label: NL_DAY_FULL[d], items,
        total: r(items.reduce((s, i) => s + i.hours, 0)) })
    }
    if (undated.length) out.push({ key: 'undated', label: 'Geen datum', items: undated,
      total: r(undated.reduce((s, i) => s + i.hours, 0)) })
    return out
  })()

  const catTotal: Record<WorkloadCategory, number> = { maken: 0, overhead: 0, meeting: 0, vrij: 0 }
  for (const c of contribs) {
    const cat = effectiveCategory({ name: c.project.name, hours: c.hours, source: c.project.source }, overrides[c.project.id])
    catTotal[cat] += c.hours
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      position: 'absolute', zIndex: 200, top: '100%', left: '50%',
      transform: 'translateX(-50%)', marginTop: 4,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px',
      width: 'max-content', minWidth: 280, maxWidth: 360,
      boxShadow: '0 12px 32px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.08)',
      fontSize: 12, lineHeight: 1.45, color: 'var(--text-primary)',
      textAlign: 'left',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <strong style={{ fontSize: 14, fontWeight: 800 }}>{r(total)}u</strong>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {capacity}u · {Math.round(pct * 100)}%</span>
      </div>

      {/* Category breakdown bar */}
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--border)', marginBottom: 6 }}>
        {ALL_CATEGORIES.map(c => {
          const w = total > 0 ? (catTotal[c] / total) * 100 : 0
          return <div key={c} style={{ width: `${w}%`, background: CAT_COLOR[c], transition: 'width 0.3s' }} />
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {ALL_CATEGORIES.map(c => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: CAT_COLOR[c] }} />
            <strong style={{ color: 'var(--text-primary)' }}>{r(catTotal[c])}u</strong> {CAT_LABEL[c].toLowerCase()}
          </span>
        ))}
      </div>

      {groups.map(g => (
        <div key={g.key} style={{ marginTop: g.label ? 6 : 0 }}>
          {g.label && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
              <span>{g.label}</span>
              <span style={{ fontWeight: 600 }}>{g.total}u</span>
            </div>
          )}
          {g.items.map(({ project, hours }) => {
            const override = overrides[project.id] ?? null
            const cat      = effectiveCategory({ name: project.name, hours, source: project.source }, override)
            return (
              <div key={project.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                  <span title={CAT_LABEL[cat]} style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLOR[cat], flexShrink: 0 }} />
                  {onOpenDetails ? (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenDetails(project); onClose() }}
                      title="Open detailvenster"
                      style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textAlign: 'left', background: 'none', border: 'none', padding: 0, font: 'inherit',
                        color: 'var(--text-primary)', cursor: 'pointer', textDecoration: 'underline',
                        textDecorationColor: 'var(--border)', textUnderlineOffset: 3 }}>
                      {project.name}
                    </button>
                  ) : (
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{project.name}</span>
                  )}
                  <span title={project.board} style={{ width: 8, height: 8, borderRadius: 2, background: BOARD_COLORS[project.board] ?? '#888', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{r(hours)}u</span>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {ALL_CATEGORIES.map(c => {
                    const active = cat === c
                    return (
                      <button key={c} type="button"
                        onClick={(e) => { e.stopPropagation(); setCat(project.id, c) }}
                        style={{
                          flex: 1, padding: '3px 5px', borderRadius: 5,
                          border: active ? `1.5px solid ${CAT_COLOR[c]}` : '1px solid var(--border)',
                          background: active ? `${CAT_COLOR[c]}22` : 'var(--bg-card)',
                          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                          fontSize: 10, fontWeight: active ? 700 : 500,
                          cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: CAT_COLOR[c] }} />
                        {CAT_LABEL[c]}
                      </button>
                    )
                  })}
                  {override && (
                    <button type="button" title="Reset naar automatisch"
                      onClick={(e) => { e.stopPropagation(); setCat(project.id, null) }}
                      style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>↺</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <button onClick={onClose} style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>sluiten</button>
    </div>
  )
}

// ─── Draggable timeline bar ───────────────────────────────────────────────────
type DragInfo = { mode: 'move' | 'start' | 'end'; startX: number; startY: number; origStart: string | null; origEnd: string | null }

function DraggableBar({ project, memberId, left, width, colW, small, onDragMove, onDragEnd, onClick, onReassign }: {
  project: Project; memberId: string
  left: number; width: number; colW: number
  small?: boolean
  onDragMove: (s: string | null, e: string | null) => void
  onDragEnd:  (s: string | null, e: string | null) => void
  onClick:    () => void
  onReassign?: (project: Project, fromMemberId: string, toMemberId: string) => void
}) {
  const barH = small ? 10 : BAR_H
  // Categorie 'vrij' (vakantie, hemelvaart, verlof, …) krijgt een aparte
  // groene look + palmboom-prefix zodat in één oogopslag duidelijk is dat
  // iemand niet werkt op die dagen — overruled meeting-geel en bord-kleur.
  const category = effectiveCategory(
    { name: project.name, hours: project.estHours ?? 0, source: project.source },
    loadCategoryOverrides()[project.id] ?? null,
  )
  const isVrij = category === 'vrij'
  // Meetings (small=true) get the yellow accent so they stand apart from
  // real project bars in the timeline at a glance.
  const color   = isVrij
    ? CAT_COLOR.vrij
    : (small ? '#D8B62E' : (BOARD_COLORS[project.board] ?? '#888'))
  const dragRef = useRef<DragInfo | null>(null)
  const [ghost, setGhost] = useState<{ left: number; width: number } | null>(null)
  const reassignRef = useRef<string | null>(null)
  const didDrag = useRef(false)
  const dpx = 7 / colW

  const isReadOnly = project.source === 'google'

  // Snapshot van alle member-rijen op het moment dat de drag start. Gebruiken
  // we elementFromPoint zoals voorheen, dan kan een sticky cell of een
  // overhangend element de hit blokkeren. Een Y-range op de geometrie van
  // de rij is veel directer: cursor.y → welke rij.
  const rowsRef = useRef<{ id: string; top: number; bottom: number }[]>([])
  function captureRows() {
    const rows: { id: string; top: number; bottom: number }[] = []
    for (const el of document.querySelectorAll<HTMLElement>('[data-member-id]')) {
      const r = el.getBoundingClientRect()
      const id = el.dataset.memberId
      if (!id) continue
      rows.push({ id, top: r.top, bottom: r.bottom })
    }
    rowsRef.current = rows
  }
  function memberAt(_clientX: number, clientY: number): string | null {
    for (const r of rowsRef.current) {
      if (clientY >= r.top && clientY <= r.bottom) return r.id
    }
    return null
  }

  function clearRowHighlight() {
    for (const el of document.querySelectorAll<HTMLElement>('[data-member-id][data-reassign-target]')) {
      el.style.background = ''
      el.style.outline = ''
      el.style.outlineOffset = ''
      el.removeAttribute('data-reassign-target')
    }
  }
  function highlightRow(id: string | null) {
    clearRowHighlight()
    if (!id) return
    const el = document.querySelector<HTMLElement>(`[data-member-id="${id}"]`)
    if (!el) return
    el.dataset.reassignTarget = '1'
    el.style.background = 'rgba(88,150,255,0.18)'
    el.style.outline = '2px solid rgba(88,150,255,0.85)'
    el.style.outlineOffset = '-2px'
  }

  function startDrag(e: React.MouseEvent, mode: DragInfo['mode']) {
    if (isReadOnly) return
    e.preventDefault(); e.stopPropagation()
    didDrag.current = false
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, origStart: project.startDate, origEnd: project.endDate }
    setGhost({ left, width })
    reassignRef.current = null
    captureRows()

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      // 10px threshold — drag only kicks in once the user has clearly moved
      // the mouse, so single clicks always reach the click handler.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && !didDrag.current) return
      if (Math.abs(dx) >= 10 || Math.abs(dy) >= 10) didDrag.current = true

      // Reassign-mode only applies to whole-bar drags ('move'), not edge resizes.
      // Het target is "sticky": een korte uitstap naar een tussen-rij-gap
      // (memberAt → null) wist 'm niet, anders zou loslaten op een hairsbreedte
      // buiten een rij stilletjes terugvallen op datum-drag.
      if (mode === 'move' && onReassign) {
        const hit = memberAt(ev.clientX, ev.clientY)
        if (hit === memberId) reassignRef.current = null
        else if (hit !== null) reassignRef.current = hit
        // else (hit === null): bewaar laatste target
      }
      const isReassigning = !!reassignRef.current
      highlightRow(reassignRef.current)

      if (isReassigning) {
        // Hide the date-ghost so we don't suggest both actions at once.
        setGhost(null)
        return
      }

      const ddays = Math.round(dx * dpx)
      const { mode: m, origStart, origEnd } = dragRef.current
      let newL = left, newW = width
      if (m === 'move')       { newL = left + ddays * (colW / 7) }
      else if (m === 'start') { const dl = ddays * (colW / 7); newL = left + dl; newW = Math.max(colW / 7, width - dl) }
      else                    { newW = Math.max(colW / 7, width + ddays * (colW / 7)) }
      setGhost({ left: newL, width: newW })
      let ss = origStart, se = origEnd
      if (m === 'move')       { ss = origStart ? addDays(origStart, ddays) : null; se = origEnd ? addDays(origEnd, ddays) : null }
      else if (m === 'start') { ss = origStart ? addDays(origStart, ddays) : null; if (ss && se && ss > se) ss = se }
      else                    { se = origEnd ? addDays(origEnd, ddays) : null; if (ss && se && se < ss) se = ss }
      onDragMove(ss, se)
    }

    function onUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragMove(project.startDate, project.endDate)
      if (!dragRef.current) return
      const targetId = reassignRef.current
      const dx = ev.clientX - dragRef.current.startX
      const ddays = Math.round(dx * dpx)
      const { mode: m, origStart, origEnd } = dragRef.current
      dragRef.current = null; setGhost(null); reassignRef.current = null
      clearRowHighlight()
      if (targetId && onReassign) {
        onReassign(project, memberId, targetId)
        return
      }
      let ns = origStart, ne = origEnd
      if (m === 'move')       { ns = origStart ? addDays(origStart, ddays) : null; ne = origEnd ? addDays(origEnd, ddays) : null }
      else if (m === 'start') { ns = origStart ? addDays(origStart, ddays) : null; if (ns && ne && ns > ne) ns = ne }
      else                    { ne = origEnd ? addDays(origEnd, ddays) : null; if (ns && ne && ne < ns) ne = ns }
      onDragEnd(ns, ne)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const g = ghost ?? { left, width }
  const barTop = BAR_GAP + (small ? (BAR_H - barH) / 2 : 0)
  return (
    <>
      {ghost && <div style={{ position: 'absolute', top: barTop, left: ghost.left + 2, width: ghost.width, height: barH, background: color + '44', border: `2px dashed ${color}`, borderRadius: 4, pointerEvents: 'none', zIndex: 5 }} />}
      {/* Hit-area expander — sibling of the bar (not clipped by its
          overflow:hidden) so thin bars are easy to click. Rendered BEFORE
          the bar so the bar's handles stay on top. */}
      <div
        onMouseDown={e => startDrag(e, 'move')}
        onClick={e => { if (!didDrag.current) { e.stopPropagation(); onClick() } }}
        style={{ position: 'absolute', top: barTop - 6, left: g.left + 2 - 8,
          width: g.width + 16, height: barH + 12,
          cursor: ghost ? 'grabbing' : 'grab',
          pointerEvents: 'auto' }}
      />
      <div
        onMouseDown={e => startDrag(e, 'move')}
        onClick={e => { if (!didDrag.current) { e.stopPropagation(); onClick() } }}
        style={{ position: 'absolute', top: barTop, left: g.left + 2, width: g.width, height: barH,
          background: color + 'cc', borderRadius: 4, display: 'flex', alignItems: 'center',
          overflow: 'hidden', fontSize: small ? 9.5 : 10.5, fontWeight: 600, color: '#fff',
          cursor: ghost ? 'grabbing' : 'grab', userSelect: 'none',
          pointerEvents: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18)',
          zIndex: ghost ? 1 : 'auto' }}
        title={isReadOnly ? 'Bewerk in Google Calendar' : undefined}>
        <div onMouseDown={e => { e.stopPropagation(); startDrag(e, 'start') }}
          style={{ width: HANDLE_W, height: '100%', cursor: 'ew-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.4)', borderRadius: 1 }} />
        </div>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {isVrij && <span style={{ flexShrink: 0, fontSize: small ? 12 : 14, lineHeight: 1 }} aria-label="Vrij">🌴</span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}{project.group ? ` | ${project.group}` : ''}
          </span>
          {project.source === 'google' && <span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 'auto' }}>G</span>}
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
// In week zoom we render only Mon–Fri inside each week column (5 day-cells per
// week). Saturday/Sunday events are clipped to the end of Friday so weekends
// don't waste horizontal space.
function dateToWeekPx(d: Date, gridStart: Date, weekColW: number): number {
  const days = Math.floor((d.getTime() - gridStart.getTime()) / 86400000)
  const weekIdx = Math.floor(days / 7)
  const dowMon = ((days % 7) + 7) % 7  // 0=Mon..6=Sun (gridStart is a Mon)
  const cellInWeek = Math.min(dowMon, 5) // Sat/Sun snap to col-end
  return weekIdx * weekColW + (cellInWeek / 5) * weekColW
}

function TimelineBars({ memberId, projects, cols, colW, zoom, hideMeetings, onDragMove, onDragEnd, onBarClick, onReassign }: {
  memberId: string; projects: Project[]; cols: Col[]; colW: number
  zoom: ZoomLevel
  hideMeetings?: boolean
  onDragMove: (p: Project, s: string | null, e: string | null) => void
  onDragEnd:  (p: Project, s: string | null, e: string | null) => void
  onBarClick: (p: Project) => void
  onReassign?: (p: Project, fromMemberId: string, toMemberId: string) => void
}) {
  const gridStart   = cols[0].rangeStart
  const gridStartMs = gridStart.getTime()
  const gridEndMs   = cols[cols.length - 1].rangeEnd.getTime()
  const totalWidth  = cols.reduce((s, c) => s + c.widthPx, 0)
  const msPerPx     = (gridEndMs - gridStartMs) / totalWidth
  const isWeek      = zoom === 'week'

  // Each occurrence renders as its own bar — recurring meetings stay as
  // small individual dots/bars rather than one stretched merge.
  const owned = projects.filter(p => p.ownerIds.includes(memberId) && (p.startDate || p.endDate))

  const rawBars = owned.map(p => {
      const sDate = p.startDate ? new Date(p.startDate) : new Date(gridStartMs)
      const eDate = p.endDate   ? new Date(p.endDate)   : new Date(gridEndMs - 86400000)
      const s = sDate.getTime()
      const e = eDate.getTime() + 86400000
      if (e < gridStartMs || s > gridEndMs) return null

      let left: number, width: number
      // Minimum visible width — short events were impossible to click. The
      // bar overhangs slightly to the right past its actual end date, which
      // is a small lie but a much better UX than a 6px target.
      const MIN_BAR_W = 22
      if (isWeek) {
        const csDate = s < gridStartMs ? new Date(gridStartMs) : sDate
        const ceDate = new Date(Math.min(e, gridEndMs))
        left  = dateToWeekPx(csDate, gridStart, colW)
        const right = dateToWeekPx(ceDate, gridStart, colW)
        width = Math.max(right - left - 2, MIN_BAR_W)
      } else {
        const cs = Math.max(s, gridStartMs)
        const ce = Math.min(e, gridEndMs)
        left  = (cs - gridStartMs) / msPerPx
        width = Math.max((ce - cs) / msPerPx - 2, MIN_BAR_W)
      }
      // Meetings: short Google events render at reduced height
      const isMeeting = p.source === 'google' && (p.estHours || 0) > 0 && (p.estHours || 0) <= 2
      if (hideMeetings && isMeeting) return null
      return { p, left, width, isMeeting }
    })
    .filter(Boolean) as { p: Project; left: number; width: number; isMeeting: boolean }[]

  // Collapse all meetings on the same start day into ONE wide bar that fills
  // the day cell — so we get the full width to spell out the meeting names
  // instead of N tiny stacked pills no one can click.
  type ClusterBar = { kind: 'cluster'; left: number; width: number; meetings: Project[]; isMeeting: true }
  type SingleBar  = { kind: 'single';  p: Project; left: number; width: number; isMeeting: boolean }
  type Bar = ClusterBar | SingleBar

  const dayCellW = isWeek ? colW / 5 : (zoom === 'maand' ? Math.max(colW / 6, 40) : colW)
  const meetingByDay = new Map<string, typeof rawBars>()
  const finalBars: Bar[] = []
  for (const b of rawBars) {
    if (b.isMeeting) {
      const key = `${b.p.startDate ?? '?'}@${Math.round(b.left)}`
      const arr = meetingByDay.get(key) ?? []
      arr.push(b); meetingByDay.set(key, arr)
    } else {
      finalBars.push({ kind: 'single', ...b })
    }
  }
  for (const arr of meetingByDay.values()) {
    const left = arr[0].left
    finalBars.push({
      kind: 'cluster',
      left,
      width: Math.max(dayCellW - 4, 60),
      meetings: arr.map(b => b.p),
      isMeeting: true,
    })
  }

  // Lane-pack meetings and projects SEPARATELY so meetings get their own
  // dedicated track at the top — they never compete for vertical space with
  // real project bars. Within each track we still pack horizontally so
  // adjacent days don't stack unnecessarily.
  function packLanes<T extends { left: number; width: number }>(items: T[]) {
    const sorted   = [...items].sort((a, b) => a.left - b.left)
    const laneEnds: number[] = []
    const packed   = sorted.map(b => {
      let lane = laneEnds.findIndex(end => end <= b.left + 1)
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(b.left + b.width) }
      else          laneEnds[lane] = b.left + b.width
      return { ...b, lane }
    })
    return { items: packed, numLanes: laneEnds.length }
  }

  const meetingItems = finalBars.filter((b): b is ClusterBar => b.kind === 'cluster')
  const projectItems = finalBars.filter((b): b is SingleBar => b.kind === 'single')
  const meetingPacked = packLanes(meetingItems)
  const projectPacked = packLanes(projectItems)
  const meetingLanes  = meetingPacked.numLanes
  const projectLanes  = projectPacked.numLanes

  const MEETING_LANE_H = MEETING_BAR_H + 4   // tighter than project lanes
  const PROJECT_LANE_H = BAR_H + BAR_GAP

  function meetingLaneTop(lane: number) { return BAR_GAP + lane * MEETING_LANE_H }
  function projectLaneTop(lane: number) { return BAR_GAP + meetingLanes * MEETING_LANE_H + (meetingLanes > 0 ? 6 : 0) + lane * PROJECT_LANE_H }

  type Cluster = ClusterBar & { lane: number; track: 'meeting' }
  type Single  = SingleBar  & { lane: number; track: 'project' }
  const bars: (Cluster | Single)[] = [
    ...meetingPacked.items.map(b => ({ ...b, track: 'meeting' as const })),
    ...projectPacked.items.map(b => ({ ...b, track: 'project' as const })),
  ]

  if (bars.length === 0) return null
  const height = BAR_GAP
    + meetingLanes * MEETING_LANE_H
    + (meetingLanes > 0 ? 6 : 0)
    + projectLanes * PROJECT_LANE_H
    + 6

  return (
    <div style={{ position: 'relative', height, overflow: 'visible' }}>
      {cols.map((col, i) => (
        <div key={col.key} style={{ position: 'absolute', left: cols.slice(0,i).reduce((s,c)=>s+c.widthPx,0), top: 0, bottom: 0, width: col.widthPx, borderLeft: '1px solid var(--border)', pointerEvents: 'none' }} />
      ))}
      {/* Subtle divider between meetings and project bars when both exist. */}
      {meetingLanes > 0 && projectLanes > 0 && (
        <div style={{ position: 'absolute', top: BAR_GAP + meetingLanes * MEETING_LANE_H + 2, left: 0, right: 0,
          height: 1, background: 'var(--border-light)', pointerEvents: 'none', zIndex: 0 }} />
      )}
      {bars.map((b, i) => {
        if (b.kind === 'cluster') {
          return (
            <div key={`cl_${i}`} style={{ position: 'absolute', top: meetingLaneTop(b.lane), left: b.left + 2, width: b.width, height: MEETING_BAR_H, zIndex: 1 }}>
              <MeetingCluster meetings={b.meetings} width={b.width} onPick={onBarClick} />
            </div>
          )
        }
        return (
          <div key={b.p.id} style={{ position: 'absolute', top: projectLaneTop(b.lane), left: 0, right: 0, height: PROJECT_LANE_H, pointerEvents: 'none' }}>
            <DraggableBar project={b.p} memberId={memberId} left={b.left} width={b.width} colW={colW} small={b.isMeeting}
              onDragMove={(s, e) => onDragMove(b.p, s, e)}
              onDragEnd={(s, e) => onDragEnd(b.p, s, e)}
              onClick={() => onBarClick(b.p)}
              onReassign={onReassign} />
          </div>
        )
      })}
    </div>
  )
}

// Meetings collapse to ONE clean pill per day. For a single meeting we show
// its name; for multiple we show "N meetings". Hours sum into the trailing
// label. Click opens a popover with the full list — and the popover is
// exclusive (opening this one closes any other open popover on the page).
const MEETING_BAR_H = 18

function MeetingCluster({ meetings, width, onPick }: { meetings: Project[]; width: number; onPick: (p: Project) => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef   = useRef<HTMLSpanElement>(null)
  const btnRef    = useRef<HTMLButtonElement>(null)
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null)
  const popoverId = useRef(`mc:${Math.random().toString(36).slice(2)}`).current
  const totalH    = Math.round(meetings.reduce((s, m) => s + (m.estHours || 0), 0) * 10) / 10
  const isSingle  = meetings.length === 1
  const label     = isSingle ? meetings[0].name : `${meetings.length} meetings`

  function setOpenExclusive(next: boolean) {
    if (next && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // Anchor below the button; if it would clip the right edge, nudge left.
      const popW = 320
      const left = Math.min(r.left, window.innerWidth - popW - 8)
      setPopPos({ top: r.bottom + 4, left: Math.max(8, left) })
    }
    setOpen(next)
    if (next) openExclusivePopover(popoverId)
    else      closeExclusivePopover(popoverId)
  }

  // Close when another popover opens elsewhere.
  useEffect(() => {
    if (!open) return
    return onExclusivePopoverChange(activeId => {
      if (activeId !== popoverId) setOpen(false)
    })
  }, [open, popoverId])

  // Outside click closes the popover — but unlike a full-screen overlay
  // the click still reaches whatever element the user actually clicked on,
  // so clicking another cluster opens it in one step.
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      const root = wrapRef.current
      if (!root) return
      const target = e.target as Node | null
      if (!target) return
      if (root.contains(target)) return
      if ((target as HTMLElement).closest?.(`[data-mc-popover="${popoverId}"]`)) return
      setOpenExclusive(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open, popoverId])

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <button ref={btnRef} onClick={e => { e.stopPropagation(); setOpenExclusive(!open) }}
        title={meetings.map(m => `${m.name} · ${m.estHours}u`).join('\n')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
          width, height: MEETING_BAR_H, borderRadius: 6,
          background: '#D8B62E', color: '#1a1a1a', border: 'none', cursor: 'pointer',
          fontSize: 11.5, fontWeight: 700, lineHeight: 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
          overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <span style={{ flexShrink: 0, opacity: 0.85 }}>📅</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{label}</span>
        <span style={{ flexShrink: 0, opacity: 0.75, fontWeight: 600 }}>{totalH}u</span>
      </button>
      {open && popPos && typeof document !== 'undefined' && createPortal(
        <div data-mc-popover={popoverId}
          style={{ position: 'fixed', top: popPos.top, left: popPos.left, zIndex: 9000,
            width: 320, maxHeight: 360, overflowY: 'auto',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 4,
            boxShadow: '0 16px 40px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.12)' }}>
          <div style={{ padding: '6px 10px 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {meetings.length} meeting{meetings.length === 1 ? '' : 's'} · {totalH}u totaal
          </div>
          {meetings.map(m => (
            <button key={m.id} onClick={e => { e.stopPropagation(); setOpenExclusive(false); onPick(m) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6,
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>G</span>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{m.estHours}u</span>
            </button>
          ))}
        </div>,
        document.body)}
    </span>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
function DetailPanel({ project, allGroups, onClose, onUpdate, onDuplicate }: {
  project: Project
  allGroups: Record<string, BoardGroup[]>
  onClose: () => void
  onUpdate: (p: Project, s: string | null, e: string | null, extra?: Partial<{ estHours: number; notes: string; journal: import("@/lib/boards").JournalEntry[]; ownerHours: Record<string, number>; ownerIds: string[]; links: import("@/lib/boards").ItemLink[] }>) => void
  onDuplicate?: () => void
}) {
  const color   = BOARD_COLORS[project.board] ?? '#888'
  const team    = teamData.members
  const rawItem = allGroups[project.board]?.flatMap(g => g.items).find(i => `${project.board}__${i.id}` === project.id)

  const [startDate, setStartDate] = useState(project.startDate ?? '')
  const [endDate,   setEndDate]   = useState(project.endDate ?? '')
  const [estHours,  setEstHours]  = useState(String(project.estHours ?? 0))
  const [notes,     setNotes]     = useState((rawItem?.notes as string) ?? '')
  const [journal,   setJournal]   = useState<import('@/lib/boards').JournalEntry[]>((rawItem?.journal as import('@/lib/boards').JournalEntry[]) ?? [])
  const [links,     setLinks]     = useState<import('@/lib/boards').ItemLink[]>((rawItem?.links as import('@/lib/boards').ItemLink[] | undefined) ?? [])
  const [newEntry,  setNewEntry]  = useState('')
  const [ownerHours, setOwnerHours] = useState<Record<string, number>>(
    (rawItem?.ownerHours as Record<string, number> | undefined) ?? {}
  )
  const [ownerIds, setOwnerIds] = useState<string[]>(project.ownerIds)
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const ownerPickerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!ownerPickerOpen) return
    function onDown(ev: MouseEvent) {
      const el = ownerPickerRef.current
      if (el && !el.contains(ev.target as Node)) setOwnerPickerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [ownerPickerOpen])
  const [entryMentions, setEntryMentions] = useState<string[]>([])
  const { profile } = useProfile()
  const [categoryOverride, setCategoryOverrideState] = useState<WorkloadCategory | null>(loadCategoryOverrides()[project.id] ?? null)
  useEffect(() => {
    setCategoryOverrideState(loadCategoryOverrides()[project.id] ?? null)
    return onCategoryOverridesChange(() => {
      setCategoryOverrideState(loadCategoryOverrides()[project.id] ?? null)
    })
  }, [project.id])
  const currentCategory = effectiveCategory(
    { name: project.name, hours: project.estHours ?? 0, source: project.source },
    categoryOverride,
  )
  function changeCategory(c: WorkloadCategory | null) {
    setCategoryOverrideState(c)
    setCategoryOverride(project.id, c)
  }
  const hasSubitems = ((rawItem?.subitems as { estHours?: number }[] | undefined)?.length ?? 0) > 0
  const subitemsTotal = ((rawItem?.subitems as { estHours?: number }[] | undefined) ?? [])
    .reduce((s, si) => s + (Number(si.estHours) || 0), 0)
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
    setLinks((rawItem?.links as import('@/lib/boards').ItemLink[] | undefined) ?? [])
    setOwnerHours((rawItem?.ownerHours as Record<string, number> | undefined) ?? {})
    setOwnerIds(project.ownerIds)
    setOwnerPickerOpen(false)
    setNewEntry('')
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isGoogle = rawItem?.source === 'google' || project.source === 'google'
  const isMerged = !!project.mergedFrom && project.mergedFrom.length > 1

  // Instant-save: elke veldwijziging in de popup roept commit() aan.
  // Geen Opslaan-knop nodig — Cmd+Z draait de laatste wijziging terug.
  type Patch = Partial<{
    startDate: string | null
    endDate:   string | null
    estHours:  number
    notes:     string
    journal:   import('@/lib/boards').JournalEntry[]
    ownerHours: Record<string, number>
    ownerIds:  string[]
    links:     import('@/lib/boards').ItemLink[]
  }>
  function commit(patch: Patch) {
    if (isGoogle) return
    // Bouw de volledige nieuwe state (patch overschrijft, anders fallback op
    // huidige local state) en stuur door naar handleDetailUpdate in de parent.
    const nextStart = patch.startDate !== undefined ? patch.startDate : (startDate || null)
    const nextEnd   = patch.endDate   !== undefined ? patch.endDate   : (endDate   || null)
    const nextEst   = patch.estHours  !== undefined ? patch.estHours  : (parseFloat(estHours) || 0)
    const nextNotes = patch.notes     !== undefined ? patch.notes     : notes
    const nextJournal    = patch.journal    !== undefined ? patch.journal    : journal
    const nextOwnerHours = patch.ownerHours !== undefined ? patch.ownerHours : ownerHours
    const nextLinks      = patch.links      !== undefined ? patch.links      : links
    const rawOwners      = patch.ownerIds   !== undefined ? patch.ownerIds   : ownerIds
    // 'unassigned' alleen behouden als enige owner; anders eruit filteren.
    const cleaned = rawOwners.length > 1 ? rawOwners.filter(id => id !== 'unassigned') : rawOwners
    const finalOwners = cleaned.length === 0 ? ['unassigned'] : cleaned

    const extra: Patch = {
      notes: nextNotes,
      journal: nextJournal,
      ownerHours: nextOwnerHours,
      ownerIds: finalOwners,
      links: nextLinks,
    }
    if (!hasSubitems) extra.estHours = nextEst
    onUpdate(project, nextStart, nextEnd, extra)

    // Geschiedenis + notificaties per soort wijziging (alleen wat écht veranderde).
    const rawItemId = project.id.slice(project.board.length + 2)
    if (patch.startDate !== undefined || patch.endDate !== undefined) {
      const oldStart = project.startDate ?? '—'
      const oldEnd   = project.endDate   ?? '—'
      logItemActivity(rawItemId, 'wijzigde de timeline',
        `${oldStart} – ${oldEnd}  →  ${nextStart ?? '—'} – ${nextEnd ?? '—'}`).catch(() => {})
    }
    if (patch.estHours !== undefined && !hasSubitems) {
      const oldEst = project.estHours ?? 0
      if (oldEst !== nextEst) {
        logItemActivity(rawItemId, 'zette uren', `${oldEst}u → ${nextEst}u`).catch(() => {})
      }
    }
    if (patch.ownerIds !== undefined) {
      const prevOwners = new Set(((rawItem?.ownerIds as string[] | undefined) ?? project.ownerIds) ?? [])
      for (const newId of finalOwners) {
        if (newId === 'unassigned' || prevOwners.has(newId)) continue
        createNotification({
          recipientId: newId,
          actorId:     profile?.memberId ?? null,
          kind:        'assigned',
          contextKind: 'board_item',
          contextId:   project.id,
          href:        `/projects/${project.board}`,
          body:        project.name,
        }).catch(() => {})
        const memberName = teamData.members.find(m => m.id === newId)?.name
        logItemActivity(rawItemId, 'wees iemand toe', memberName ?? newId).catch(() => {})
      }
    }
  }
  function addEntry() {
    const text = newEntry.trim()
    if (!text) return
    const entry: import('@/lib/boards').JournalEntry = {
      id: Date.now().toString(), ts: new Date().toISOString(), text, authorId: profile?.memberId,
    }
    const nextJournal = [...journal, entry]
    setJournal(nextJournal)
    commit({ journal: nextJournal })
    // Notificatie per @mention in deze journal-entry
    for (const rid of entryMentions) {
      createNotification({
        recipientId: rid,
        actorId:     profile?.memberId ?? null,
        kind:        'mention',
        contextKind: 'board_item',
        contextId:   project.id,
        href:        `/projects/${project.board}`,
        body:        text.length > 90 ? text.slice(0, 90) + '…' : text,
      }).catch(() => {})
    }
    setNewEntry('')
    setEntryMentions([])
  }
  function deleteEntry(id: string) {
    const nextJournal = journal.filter(x => x.id !== id)
    setJournal(nextJournal)
    commit({ journal: nextJournal })
  }
  const owners = team.filter(m => project.ownerIds.includes(m.id))

  return (
    <>
    {/* Backdrop — click to close */}
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 299,
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }} />
    <div style={{
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      width: 'min(480px, 92vw)', maxHeight: '85vh', zIndex: 300,
      background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--border)', background: color + '18' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
              {rawItem?.source === 'google' && <GoogleBadge href={rawItem?.externalLink as string | undefined} size={15} />}
              {project.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              in → <Link
                href={`/projects/${project.board}?focus=${encodeURIComponent(project.id.slice(project.board.length + 2))}`}
                title="Open op het bord"
                style={{ color, fontWeight: 600, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
                {project.board}
              </Link>{project.group ? <> · {project.group}</> : null}
              {rawItem?.source === 'google' && <span style={{ marginLeft: 8, color: '#a05400' }}>· Bewerk in Google Calendar</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
        </div>
      </div>
      {isMerged && (
        <div style={{ padding: '10px 18px', background: 'rgba(176,198,235,0.18)', borderBottom: '1px solid var(--border)', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {project.mergedFrom!.length} terugkerende afspraken — onderstaand alle data.
        </div>
      )}
      {isMerged && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...project.mergedFrom!]
            .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
            .map(sub => {
              const sd  = sub.startDate ? new Date(sub.startDate) : null
              const fmt = sd ? sd.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
              return (
                <a key={sub.id}
                  href={sub.externalLink ?? '#'}
                  target={sub.externalLink ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                    border: '1px solid var(--border-light)', background: 'var(--bg-hover)',
                    color: 'var(--text-primary)', textDecoration: 'none', fontSize: 13 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>G</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmt}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub.estHours}u</span>
                  {sub.externalLink && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>↗</span>}
                </a>
              )
            })}
        </div>
      )}
      {!isMerged && isGoogle && (
        <div style={{ padding: '10px 18px', background: 'rgba(216,182,46,0.18)', borderBottom: '1px solid var(--border)', fontSize: 12.5, fontWeight: 600, color: '#7a5a0a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Read-only — wijzig dit item in Google Calendar.</span>
          {rawItem?.externalLink && (
            <a href={rawItem.externalLink as string} target="_blank" rel="noopener noreferrer"
              style={{ marginLeft: 'auto', color: '#7a5a0a', fontWeight: 700, textDecoration: 'underline' }}>
              Open in Google ↗
            </a>
          )}
        </div>
      )}
      {!isMerged && <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        <Row label="Owner">
          <div ref={ownerPickerRef} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', position: 'relative' }}>
            {ownerIds.length > 0 && ownerIds.map(oid => {
              const m = team.find(t => t.id === oid)
              if (!m) return null
              return (
                <span key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-primary)', background: 'var(--bg-hover)', borderRadius: 20, padding: '3px 10px 3px 3px', border: '1px solid var(--border-light)', fontWeight: 500 }}>
                  <UserAvatar memberId={m.id} size={22} />
                  {m.name}
                  {!isGoogle && (
                    <button onClick={() => {
                        const next = ownerIds.filter(x => x !== m.id)
                        setOwnerIds(next)
                        commit({ ownerIds: next })
                      }}
                      title="Verwijder owner"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px', marginLeft: 2 }}>×</button>
                  )}
                </span>
              )
            })}
            {!isGoogle && (
              <button onClick={() => setOwnerPickerOpen(o => !o)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                + Toewijzen
              </button>
            )}
            {ownerPickerOpen && (
              <div
                style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 306,
                  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                  padding: 6, minWidth: 220, maxHeight: 280, overflowY: 'auto',
                  boxShadow: '0 14px 40px rgba(0,0,0,0.25)' }}>
                {team.filter(m => m.id !== 'unassigned').map(m => {
                  const on = ownerIds.includes(m.id)
                  return (
                    <button key={m.id}
                      onClick={() => {
                        const next = on
                          ? ownerIds.filter(x => x !== m.id)
                          : [...ownerIds.filter(x => x !== 'unassigned'), m.id]
                        setOwnerIds(next)
                        commit({ ownerIds: next })
                      }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                        background: on ? m.color + '22' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <UserAvatar memberId={m.id} size={22} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{m.name}</span>
                      {on && <span style={{ fontSize: 11, color: m.color, fontWeight: 700 }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Row>
        <Row label="Status"><span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{project.status === 'done' ? '✅ Done' : rawItem?.status as string || '—'}</span></Row>
        <Row label="Bord">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-primary)', background: 'var(--bg-hover)', borderRadius: 14, padding: '3px 10px', border: '1px solid var(--border-light)', fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: BOARD_COLORS[project.board] ?? '#888' }} />
              {project.board}
            </span>
            <select
              defaultValue=""
              onChange={(e) => {
                const target = e.target.value
                if (!target || target === project.board) return
                const targetName = BOARD_CONFIGS[target]?.name ?? target
                if (!confirm(`Verplaats '${project.name}' naar bord '${targetName}'?`)) {
                  e.target.value = ''
                  return
                }
                const rawItemId = project.id.slice(project.board.length + 2)
                const res = moveItemToBoard(rawItemId, project.board, target, allGroups)
                if (!res.ok) {
                  alert(res.message ?? 'Verplaatsen mislukt')
                  e.target.value = ''
                  return
                }
                onClose()
              }}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <option value="">→ Verplaats naar…</option>
              {BOARD_NAMES.filter(b => b !== project.board).map(b => (
                <option key={b} value={b}>{BOARD_CONFIGS[b]?.name ?? b}</option>
              ))}
            </select>
          </div>
        </Row>
        {(() => {
          // Groep-picker: kies een andere groep binnen hetzelfde bord
          // (bv. naar Done-groep slepen zonder drag-and-drop).
          const boardGroups = allGroups[project.board] ?? []
          if (isGoogle || boardGroups.length === 0) return null
          const rawItemId = project.id.slice(project.board.length + 2)
          const currentGroup = boardGroups.find(g => g.items.some(i => i.id === rawItemId))
          if (!currentGroup) return null
          return (
            <Row label="Groep">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-primary)', background: 'var(--bg-hover)', borderRadius: 14, padding: '3px 10px', border: '1px solid var(--border-light)', fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: currentGroup.color ?? '#888' }} />
                  {currentGroup.name}
                </span>
                {boardGroups.length > 1 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const targetGroupId = e.target.value
                      if (!targetGroupId || targetGroupId === currentGroup.id) return
                      const item = currentGroup.items.find(i => i.id === rawItemId)
                      if (!item) return
                      const nextGroups = boardGroups.map(g => {
                        if (g.id === currentGroup.id) return { ...g, items: g.items.filter(i => i.id !== rawItemId) }
                        if (g.id === targetGroupId)   return { ...g, items: [...g.items, item] }
                        return g
                      })
                      saveGroups(project.board, nextGroups)
                    }}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <option value="">→ Andere groep…</option>
                    {boardGroups.filter(g => g.id !== currentGroup.id).map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </Row>
          )
        })()}
        <Row label="Categorie">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {ALL_CATEGORIES.map(c => {
              const active = currentCategory === c
              const colorC = CAT_COLOR[c]
              return (
                <button key={c} type="button" onClick={() => changeCategory(c)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 16,
                    border: active ? `1.5px solid ${colorC}` : '1px solid var(--border)',
                    background: active ? `${colorC}22` : 'var(--bg-card)',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                  }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorC }} />
                  {CAT_LABEL[c]}
                </button>
              )
            })}
            {categoryOverride && (
              <button type="button" onClick={() => changeCategory(null)}
                title="Reset naar automatisch"
                style={{ padding: '4px 8px', borderRadius: 16, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>
                ↺ auto
              </button>
            )}
          </div>
        </Row>
        <Row label="Timeline">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={startDate} disabled={isGoogle}
              onChange={e => { setStartDate(e.target.value); commit({ startDate: e.target.value || null }) }}
              style={{ ...dateInput, opacity: isGoogle ? 0.6 : 1, cursor: isGoogle ? 'not-allowed' : undefined }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>→</span>
            <input type="date" value={endDate} disabled={isGoogle}
              onChange={e => { setEndDate(e.target.value); commit({ endDate: e.target.value || null }) }}
              style={{ ...dateInput, opacity: isGoogle ? 0.6 : 1, cursor: isGoogle ? 'not-allowed' : undefined }} />
          </div>
          {startDate && endDate && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{fmtIso(startDate)} → {fmtIso(endDate)}</div>}
        </Row>
        {rawItem?.deadline && <Row label="Deadline"><span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmtIso(rawItem.deadline as string)}</span></Row>}
        <Row label="Est Time">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {hasSubitems ? (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>{subitemsTotal} uur</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(som van subitems)</span>
              </>
            ) : (
              <>
                <input type="number" value={estHours} disabled={isGoogle}
                  onChange={e => setEstHours(e.target.value)}
                  onBlur={e => {
                    const v = parseFloat(e.target.value) || 0
                    if (v !== (project.estHours ?? 0)) commit({ estHours: v })
                  }}
                  style={{ ...dateInput, width: 64, opacity: isGoogle ? 0.6 : 1, cursor: isGoogle ? 'not-allowed' : undefined }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>uur</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>· {Math.round(((parseFloat(estHours) || 0) / 8) * 10) / 10} d</span>
              </>
            )}
          </div>
        </Row>
        {!isGoogle && ownerIds.filter(id => id !== 'unassigned').length > 1 && (
          <Row label="Verdeling">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Standaard verdeeld; vul in om handmatig per persoon te splitsen.
              </div>
              {ownerIds.filter(id => id !== 'unassigned').map(oid => {
                const m = team.find(t => t.id === oid)
                if (!m) return null
                const total = hasSubitems ? subitemsTotal : (parseFloat(estHours) || 0)
                const def   = total / Math.max(ownerIds.filter(id => id !== 'unassigned').length, 1)
                const cur   = ownerHours[oid]
                return (
                  <div key={oid} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserAvatar memberId={oid} size={20} />
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-primary)' }}>{m.name}</span>
                    <input type="number" step="0.5" min="0"
                      placeholder={String(Math.round(def * 10) / 10)}
                      value={cur === undefined ? '' : cur}
                      onChange={e => {
                        const v = e.target.value
                        setOwnerHours(prev => {
                          const n = { ...prev }
                          if (v === '') delete n[oid]
                          else n[oid] = parseFloat(v) || 0
                          return n
                        })
                      }}
                      onBlur={e => {
                        const v = e.target.value
                        const next = { ...ownerHours }
                        if (v === '') delete next[oid]
                        else next[oid] = parseFloat(v) || 0
                        commit({ ownerHours: next })
                      }}
                      style={{ ...dateInput, width: 70 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>uur</span>
                  </div>
                )
              })}
            </div>
          </Row>
        )}
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
          <textarea value={notes} disabled={isGoogle}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => { if (notes !== ((rawItem?.notes as string) ?? '')) commit({ notes }) }}
            rows={3} placeholder={isGoogle ? '' : 'Notities…'}
            style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', opacity: isGoogle ? 0.7 : 1, cursor: isGoogle ? 'not-allowed' : undefined }} />
        </Row>
        <Row label="Bestanden">
          <LinksRow links={links} onChange={next => { setLinks(next); commit({ links: next }) }} readonly={isGoogle} />
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
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    <TextWithItemRefs text={e.text} compact />
                  </div>
                  {profile?.memberId && (
                    <ReactionRow
                      reactions={e.reactions}
                      currentMemberId={profile.memberId}
                      onToggle={emoji => {
                        const me = profile.memberId!
                        const next = journal.map(x => {
                          if (x.id !== e.id) return x
                          const reactions = { ...(x.reactions ?? {}) }
                          const set = new Set(reactions[emoji] ?? [])
                          if (set.has(me)) set.delete(me); else set.add(me)
                          if (set.size === 0) delete reactions[emoji]
                          else                reactions[emoji] = [...set]
                          return { ...x, reactions }
                        })
                        setJournal(next)
                        commit({ journal: next })
                      }}
                    />
                  )}
                  <button onClick={() => deleteEntry(e.id)}
                    style={{ position: 'absolute', top: 2, right: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', padding: '2px 4px' }}
                    onMouseEnter={ev => (ev.currentTarget.style.color = '#e2445c')}
                    onMouseLeave={ev => (ev.currentTarget.style.color = 'var(--text-muted)')}
                    title="Verwijderen">×</button>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 6 }}>
              <MentionTextarea value={newEntry}
                onChange={setNewEntry}
                onMentionsChange={setEntryMentions}
                onSubmit={addEntry}
                placeholder="+ Voeg entry toe… (typ @ om te taggen, ⌘+Enter om te plaatsen)"
                rows={1} />
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
        <Row label="Geschiedenis">
          <ItemHistory itemId={project.id.slice(project.board.length + 2)} />
        </Row>
      </div>}
      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isGoogle && !isMerged && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Wijzigingen worden direct opgeslagen · ⌘Z voor ongedaan maken
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!isMerged && onDuplicate && (
            <button onClick={onDuplicate} title="Dupliceer dit item naar dezelfde groep"
              style={{ ...cancelBtn, color: 'var(--text-secondary)' }}>
              ⎘ Dupliceer
            </button>
          )}
          <button onClick={onClose} style={{ ...cancelBtn, background: color, color: '#000', border: 'none', fontWeight: 800 }}>Klaar</button>
        </div>
      </div>
    </div>
    </>
  )
}

// ─── New item popup (planner → agenda) ───────────────────────────────────────
function NewItemPopup({ onClose, onCreate, defaultMemberId }: {
  onClose: () => void
  onCreate: (boardName: string, item: BoardItem) => void
  defaultMemberId: string | null
}) {
  const team = teamData.members
  const today = new Date().toISOString().slice(0, 10)
  const [name,    setName]    = useState('')
  const [board,   setBoard]   = useState<string>(BOARD_NAMES[0])
  const [owner,   setOwner]   = useState<string>(defaultMemberId ?? team[0]?.id ?? '')
  const [start,   setStart]   = useState<string>(today)
  const [end,     setEnd]     = useState<string>(today)
  const [hours,   setHours]   = useState<string>('1')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function save() {
    if (!name.trim()) return
    const item: BoardItem = {
      id:        `it_${Date.now().toString(36)}`,
      name:      name.trim(),
      ownerIds:  owner ? [owner] : [],
      status:    '',
      startDate: start || null,
      endDate:   end   || null,
      deadline:  null,
      estHours:  parseFloat(hours) || 0,
      dagen:     0,
    }
    onCreate(board, item)
    onClose()
  }

  return (
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 300,
        width: 'min(440px, 92vw)', background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Nieuw item</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input ref={nameRef} type="text" placeholder="Naam"
            value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
            style={popupInput} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={popupLabel}>Agenda
              <select value={board} onChange={e => setBoard(e.target.value)} style={popupSelect}>
                {BOARD_NAMES.map(b => <option key={b} value={b}>{BOARD_CONFIGS[b]?.name ?? b}</option>)}
              </select>
            </label>
            <label style={popupLabel}>Owner
              <select value={owner} onChange={e => setOwner(e.target.value)} style={popupSelect}>
                <option value="">— geen —</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 8 }}>
            <label style={popupLabel}>Start
              <input type="date" value={start} onChange={e => setStart(e.target.value)} style={popupSelect} />
            </label>
            <label style={popupLabel}>Eind
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={popupSelect} />
            </label>
            <label style={popupLabel}>Uren
              <input type="number" step="0.5" min="0" value={hours} onChange={e => setHours(e.target.value)} style={popupSelect} />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Annuleer
            </button>
            <button onClick={save} disabled={!name.trim()}
              style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'not-allowed', opacity: name.trim() ? 1 : 0.6 }}>
              Toevoegen
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

const popupInput: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const popupLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const popupSelect: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
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
  const { profile }    = useProfile()
  const [allGroups,    setAllGroups]    = useState<Record<string, BoardGroup[]>>({})
  const [team,         setTeam]         = useState<TeamMember[]>(teamData.members)
  const [vacations,    setVacations]    = useState<Record<string, { from: string | null; until: string | null }>>({})
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
  const [freelancersOpen, setFreelancersOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('planning-freelancers-open') === '1'
  })
  useEffect(() => { localStorage.setItem('planning-freelancers-open', freelancersOpen ? '1' : '0') }, [freelancersOpen])
  const [yokoTeamOpen, setYokoTeamOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const v = localStorage.getItem('planning-yokoteam-open')
    return v === null ? true : v === '1'
  })
  useEffect(() => { localStorage.setItem('planning-yokoteam-open', yokoTeamOpen ? '1' : '0') }, [yokoTeamOpen])
  const isMobile = useIsMobile()
  const [viewSize, setViewSize] = useState<ViewSize>(() => {
    if (typeof window === 'undefined') return 'compact'
    const v = localStorage.getItem('planning-viewSize') as ViewSize
    return (v === 'compact' || v === 'large') ? v : 'compact'
  })
  const [colWZoom, setColWZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 100
    const v = parseFloat(localStorage.getItem('planning-colW-zoom') ?? '100')
    return Number.isFinite(v) ? Math.max(50, Math.min(300, v)) : 100
  })
  useEffect(() => { localStorage.setItem('planning-colW-zoom', String(colWZoom)) }, [colWZoom])
  const [hideMeetings, setHideMeetings] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('planning-hide-meetings') === '1'
  })
  useEffect(() => { localStorage.setItem('planning-hide-meetings', hideMeetings ? '1' : '0') }, [hideMeetings])

  // Keyboard shortcuts: +/= zooms in, - zooms out (skip when typing in inputs)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setColWZoom(z => Math.min(300, z + 10)) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setColWZoom(z => Math.max(50, z - 10)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [newItemOpen, setNewItemOpen] = useState(false)
  const [zoom, setZoom] = useState<ZoomLevel>(() => {
    if (typeof window === 'undefined') return 'week'
    const v = localStorage.getItem('planning-zoom') as ZoomLevel
    return (v === 'dag' || v === 'week' || v === 'maand') ? v : 'week'
  })
  const gridRef = useRef<HTMLDivElement>(null)
  const dragScrollRef = useRef<{ startX: number; scrollLeft: number } | null>(null)
  const [isDragScrolling, setIsDragScrolling] = useState(false)
  const initialScrollDoneRef = useRef(false)

  useEffect(() => {
    function refresh() {
      const loaded: Record<string, BoardGroup[]> = {}
      // Dynamische bord-lijst (uit registry) + fallback-seed waar
      // beschikbaar voor de bekende 5 borden zodat een verse install
      // niet leeg start.
      for (const name of BOARD_NAMES) {
        const seed = (RAW[name]?.groups as BoardGroup[] | undefined) ?? []
        loaded[name] = loadGroups(name, seed)
      }
      setAllGroups(loaded)
    }
    refresh()
    function onBoardUpdate() { refresh() }
    window.addEventListener('yoko-board-update', onBoardUpdate)
    window.addEventListener('yoko-boards-registry-update', onBoardUpdate)
    // Vacation lookup for the palm-tree marker
    if (typeof window !== 'undefined') {
      import('@/lib/supabase').then(({ supabase }) => {
        if (!supabase) return
        supabase.from('profiles').select('member_id, vacation_from, vacation_until').then(({ data }) => {
          if (!data) return
          const map: Record<string, { from: string | null; until: string | null }> = {}
          for (const r of data as { member_id: string; vacation_from: string | null; vacation_until: string | null }[]) {
            map[r.member_id] = { from: r.vacation_from, until: r.vacation_until }
          }
          setVacations(map)
        })
      })
    }
    return () => {
      window.removeEventListener('yoko-board-update', onBoardUpdate)
      window.removeEventListener('yoko-boards-registry-update', onBoardUpdate)
    }
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
          setTeam(ordered.map(m => m.id in capByMember ? { ...m, weeklyCapacity: capByMember[m.id] } : m))
          return
        }
      }
    } catch {}
    if (Object.keys(capByMember).length > 0) {
      setTeam(teamData.members.map(m => m.id in capByMember ? { ...m, weeklyCapacity: capByMember[m.id] } : m))
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
  const baseColW = zoom === 'dag' ? ZOOM_COL_W.dag : zoom === 'maand' ? ZOOM_COL_W.maand : (viewSize === 'large' ? 130 : 104)
  const colW = Math.round(baseColW * (colWZoom / 100))

  // On first render (and when zoom changes back to colOffset 0), scroll the grid
  // so "today" is near the left of the viewport — past columns are reachable
  // by scrolling left without first jumping back.
  useEffect(() => {
    if (colOffset !== 0) return
    const el = gridRef.current
    if (!el) return
    const back = HISTORY_BACK[zoom]
    el.scrollLeft = back * colW
    initialScrollDoneRef.current = true
  }, [zoom, colW, colOffset])

  // Compute from-date based on zoom and offset.
  // Default: render some history before today so the user can scroll left
  // to see past weeks/days/months without first hitting the "jump back" button.
  // User can scroll further via colOffset (negative) or forward (positive).
  const now   = new Date()
  const baseFrom: Date = useMemo(() => {
    if (zoom === 'dag') {
      const d = new Date(now); d.setDate(d.getDate() + colOffset - HISTORY_BACK.dag); d.setHours(0,0,0,0); return d
    }
    if (zoom === 'maand') {
      const d = new Date(now.getFullYear(), now.getMonth() + colOffset - HISTORY_BACK.maand, 1); return d
    }
    // week
    const ws = getWeekStart(now)
    const d  = new Date(ws); d.setDate(d.getDate() + (colOffset - HISTORY_BACK.week) * 7); return d
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
    pushUndo(() => apply(prevStart, prevEnd), `Datums bijgewerkt op '${project.name}'`)
  }
  function handleReassignOwner(project: Project, fromMemberId: string, toMemberId: string) {
    setShadowDrag(null)
    if (project.source === 'google') return  // Google items zijn read-only
    if (fromMemberId === toMemberId) return
    const boardName  = project.board
    const origItemId = project.id.slice(boardName.length + 2)
    const before = allGroups[boardName] ?? []
    const apply = (replaceFrom: string, replaceWith: string) => {
      const groups = (allGroups[boardName] ?? []).map(g => ({
        ...g,
        items: g.items.map(i => {
          if (i.id !== origItemId) return i
          const prev = (i.ownerIds as string[] | undefined) ?? []
          // Vervang `replaceFrom` door `replaceWith`. Als de nieuwe eigenaar
          // al in de lijst staat, verwijderen we alleen de oude (geen dupes).
          const hasNew  = prev.includes(replaceWith)
          const swapped = prev.flatMap(o => o === replaceFrom ? (hasNew ? [] : [replaceWith]) : [o])
          // Houd ownerHours schoon: hours van de oude eigenaar verhuizen mee.
          const oldHours = (i.ownerHours as Record<string, number> | undefined) ?? {}
          const newHours: Record<string, number> = {}
          for (const [k, v] of Object.entries(oldHours)) {
            if (k === replaceFrom) {
              const merged = (newHours[replaceWith] ?? 0) + (oldHours[replaceWith] ?? 0) + v
              if (merged > 0) newHours[replaceWith] = merged
            } else if (k !== replaceWith) {
              newHours[k] = v
            }
          }
          return { ...i, ownerIds: swapped.length > 0 ? swapped : ['unassigned'], ownerHours: newHours }
        }),
      }))
      saveGroups(boardName, groups)
      setAllGroups(prev => ({ ...prev, [boardName]: groups }))
    }
    apply(fromMemberId, toMemberId)
    const fromName = team.find(m => m.id === fromMemberId)?.name ?? fromMemberId
    const toName   = team.find(m => m.id === toMemberId)?.name ?? toMemberId
    logActivity('Owner gewisseld', project.name, `${fromName} → ${toName}`)
    logItemActivity(origItemId, 'wisselde owner', `${fromName} → ${toName}`).catch(() => {})
    if (toMemberId !== 'unassigned') {
      createNotification({
        recipientId: toMemberId,
        actorId:     profile?.memberId ?? null,
        kind:        'assigned',
        contextKind: 'board_item',
        contextId:   project.id,
        href:        `/projects/${project.board}`,
        body:        project.name,
      }).catch(() => {})
    }
    pushUndo(() => {
      saveGroups(boardName, before)
      setAllGroups(prev => ({ ...prev, [boardName]: before }))
    }, `'${project.name}': ${fromName} → ${toName}`)
  }
  function handleDetailUpdate(project: Project, newStart: string | null, newEnd: string | null, extra?: Partial<{ estHours: number; notes: string; journal: import("@/lib/boards").JournalEntry[]; ownerHours: Record<string, number>; ownerIds: string[]; links: import("@/lib/boards").ItemLink[] }>) {
    const boardName  = project.board
    const origItemId = project.id.slice(boardName.length + 2)
    // Snapshot huidige board-state vóór de wijziging — Cmd+Z herstelt dit
    // (alleen dit ene item verschilt; rest van het bord blijft gelijk).
    const before = allGroups[boardName] ?? []
    const groups = before.map(g => ({
      ...g, items: g.items.map(i => i.id === origItemId ? { ...i, startDate: newStart, endDate: newEnd, ...(extra ?? {}) } : i),
    }))
    saveGroups(boardName, groups)
    setAllGroups(prev => ({ ...prev, [boardName]: groups }))
    // Houd detailProject in sync zodat project.startDate/endDate up-to-date
    // blijven na een commit (gebruikt door child components zoals de bar).
    setDetailProject(prev => prev && prev.id === project.id
      ? { ...prev, startDate: newStart, endDate: newEnd, ...(extra ? { ownerIds: extra.ownerIds ?? prev.ownerIds, estHours: extra.estHours ?? prev.estHours, ownerHours: extra.ownerHours ?? prev.ownerHours } : {}) }
      : prev)
    pushUndo(() => {
      saveGroups(boardName, before)
      setAllGroups(prev => ({ ...prev, [boardName]: before }))
      // Sluit de open popup — anders zou de lokale state in DetailPanel
      // stale staan tegenover de net-herstelde data. Bij heropenen krijg
      // je een verse render met de juiste waarden.
      setDetailProject(null)
    })
  }

  function handleDetailDuplicate(project: Project) {
    const boardName = project.board
    const origItemId = project.id.slice(boardName.length + 2)
    const groupsBefore = allGroups[boardName] ?? []
    const newCloneId = 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    let cloneName = project.name
    const groupsAfter = groupsBefore.map(g => {
      const idx = g.items.findIndex(i => i.id === origItemId)
      if (idx < 0) return g
      const orig = g.items[idx]
      // Stripeen google/external markers — een clone is een nieuw, lokaal item.
      const clone: BoardItem = {
        ...orig,
        id:           newCloneId,
        name:         orig.name + ' (kopie)',
        source:       undefined,
        externalLink: undefined,
      }
      cloneName = clone.name
      return { ...g, items: [...g.items.slice(0, idx + 1), clone, ...g.items.slice(idx + 1)] }
    })
    saveGroups(boardName, groupsAfter)
    setAllGroups(prev => ({ ...prev, [boardName]: groupsAfter }))
    logActivity('Project gedupliceerd', cloneName)
    setDetailProject(null)
    pushUndo(() => {
      saveGroups(boardName, groupsBefore)
      setAllGroups(prev => ({ ...prev, [boardName]: groupsBefore }))
    }, `'${cloneName}' gedupliceerd`)
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
      <header style={{ flexShrink: 0, padding: isMobile ? '56px 14px 0' : '24px 32px 0' }}>

        {/* Title + nav */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: isMobile ? 10 : 16 }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'flex-end', gap: isMobile ? 12 : 24, flex: 1 }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: isMobile ? 28 : 36, fontWeight: 900, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.04em', lineHeight: 1 }}>
                Planning
              </h1>
              <div style={{ marginTop: 4, fontSize: isMobile ? 11 : 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                {todayLabel}
              </div>
            </div>
            {!isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                <span>
                  <strong style={{ color: kpis.pctUsed > 100 ? '#C4453A' : 'var(--text-primary)', fontSize: 15, fontWeight: 800 }}>{kpis.pctUsed}%</strong>
                  <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>cap · {kpis.totalHours}/{kpis.totalCap}u</span>
                </span>
                <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
                <span>
                  <strong style={{ color: kpis.deadlinesThis > 0 ? '#a05400' : 'var(--text-primary)', fontSize: 15, fontWeight: 800 }}>{kpis.deadlinesThis}</strong>
                  <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>deadlines</span>
                </span>
              </div>
            )}
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

          {/* Mobile: kolombreedte-slider naast de zoom-knoppen. Op desktop
              zit deze nog in de name-kolom-header. */}
          {isMobile && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2,
              background: 'var(--bg-card)', border: '1px solid var(--border-light)',
              borderRadius: 8, paddingLeft: 2, paddingRight: 2 }}>
              <button onClick={() => setColWZoom(z => Math.max(50, z - 10))}
                title="Smaller" aria-label="Smaller"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700,
                  padding: '6px 8px', lineHeight: 1 }}>−</button>
              <input type="range" min={50} max={300} step={5}
                value={colWZoom} onChange={e => setColWZoom(parseInt(e.target.value))}
                title={`Kolombreedte ${colWZoom}%`}
                style={{ width: 64, accentColor: 'var(--accent)' }} />
              <button onClick={() => setColWZoom(z => Math.min(300, z + 10))}
                title="Breder" aria-label="Breder"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700,
                  padding: '6px 8px', lineHeight: 1 }}>+</button>
            </div>
          )}

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
              <button onClick={() => setHideMeetings(v => !v)}
                title={hideMeetings ? 'Korte meetings tonen' : 'Korte meetings (≤2u) verbergen'}
                style={ghostBtn(hideMeetings)}>
                {hideMeetings ? '👁 Meetings' : '🚫 Meetings'}
              </button>
              <span style={separator} />
              <button onClick={() => setNewItemOpen(true)} style={{ ...ghostBtn(false), background: 'var(--accent)', color: '#000', borderColor: 'var(--accent)' }}>
                + Nieuw item
              </button>

              {/* View size segmented (desktop) */}
              <span style={separator} />
              <div style={segGroup}>
                {(['compact', 'large'] as ViewSize[]).map(v => (
                  <button key={v} onClick={() => setViewSize(v)} style={segBtn(viewSize === v)}>
                    {v === 'compact' ? 'Compact' : 'Standaard'}
                  </button>
                ))}
              </div>

              {/* Right-most: Sorteren + overflow (Exporteer + Deel + Verschuif) */}
              <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                <button onClick={() => setEditOrder(o => !o)} title="Volgorde teamleden" style={ghostBtn(editOrder)}>
                  <IconSort size={14} style={{ marginRight: 6 }} />{editOrder ? 'Klaar' : 'Sorteren'}
                </button>
                <button onClick={() => setOverflowOpen(o => !o)} aria-label="Meer acties"
                  style={ghostBtn(overflowOpen)}>
                  <IconMore size={16} />
                </button>
                {overflowOpen && (
                  <>
                    <div onClick={() => setOverflowOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
                    <div style={{
                      position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 101,
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: 4, minWidth: 220,
                      boxShadow: '0 14px 40px rgba(0,0,0,0.25)',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                      <button onClick={() => { setOverflowOpen(false); downloadIcs(projects) }}
                        style={overflowItemStyle}>
                        <IconDownload size={14} /> Exporteer als iCal
                      </button>
                      <button onClick={() => { setOverflowOpen(false); setShareOpen(true) }}
                        style={overflowItemStyle}>
                        <IconShare size={14} /> Deelbare link maken
                      </button>
                      <button onClick={() => { setOverflowOpen(false); setShiftOpen(true) }}
                        style={overflowItemStyle}>
                        <IconRange size={14} /> Verschuif projecten
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Mobile-only KPI bar (desktop has it inline next to title) */}
        {isMobile && (
          <div style={{
            display: 'flex', gap: 14, alignItems: 'center',
            padding: '6px 0 10px', marginBottom: 4,
            borderBottom: '1px solid var(--border-light)',
            fontSize: 13, color: 'var(--text-secondary)',
            flexWrap: 'wrap',
          }}>
            <span>
              <strong style={{ color: kpis.pctUsed > 100 ? '#C4453A' : 'var(--text-primary)', fontSize: 15, fontWeight: 800 }}>{kpis.pctUsed}%</strong>
              <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>cap · {kpis.totalHours}/{kpis.totalCap}u</span>
            </span>
            <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
            <span>
              <strong style={{ color: kpis.deadlinesThis > 0 ? '#a05400' : 'var(--text-primary)', fontSize: 15, fontWeight: 800 }}>{kpis.deadlinesThis}</strong>
              <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>deadlines</span>
            </span>
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
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: 0, textDecoration: 'underline' }}>Alles</button>
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
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: 0, textDecoration: 'underline' }}>
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

          {/* "Now" indicator — yoko-yellow vertical line at today's exact
              position with a VANDAAG pill at the top so the marker is hard
              to miss when scrolling through time. */}
          {nowOffset !== null && (
            <div aria-hidden style={{
              position: 'absolute', top: 0, bottom: 0,
              left: nowOffset, width: 0,
              borderLeft: '2px solid var(--yellow)',
              pointerEvents: 'none', zIndex: 14,
              boxShadow: '0 0 0 0.5px rgba(216, 182, 46, 0.4)',
            }}>
              <div style={{
                position: 'sticky', top: 4,
                marginLeft: -32, width: 64,
                padding: '2px 0',
                background: 'var(--yellow)', color: '#1a1a1a',
                fontSize: 9.5, fontWeight: 800,
                letterSpacing: '0.08em', textAlign: 'center',
                borderRadius: 999,
                boxShadow: '0 2px 6px rgba(216, 182, 46, 0.4)',
              }}>VANDAAG</div>
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
            <div style={{ width: nameW + namePad, flexShrink: 0, position: 'sticky', left: 0, zIndex: 12, background: stickyBg, borderRight: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: namePad }}>
              <button onClick={() => {
                  // Toggle: if all expanded → collapse all; otherwise expand all
                  if (expanded.size >= team.length) setExpanded(new Set())
                  else setExpanded(new Set(team.map(m => m.id)))
                }}
                title={expanded.size >= team.length ? 'Alles inklappen' : 'Alles uitklappen'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 9px', borderRadius: 6,
                  background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                  color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
                {expanded.size >= team.length ? '▾' : '▸'} Alles
              </button>
              {!isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                  <button onClick={() => setColWZoom(z => Math.max(50, z - 10))}
                    title="Smaller (sneltoets: −)"
                    style={{ width: 22, height: 22, background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, padding: 0, lineHeight: 1 }}>−</button>
                  <input type="range" min={50} max={300} step={5}
                    value={colWZoom} onChange={e => setColWZoom(parseInt(e.target.value))}
                    title={`Kolom-breedte ${colWZoom}%   ·   sneltoetsen +/−`}
                    style={{ width: 80, accentColor: 'var(--accent)' }} />
                  <button onClick={() => setColWZoom(z => Math.min(300, z + 10))}
                    title="Breder (sneltoets: +)"
                    style={{ width: 22, height: 22, background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, padding: 0, lineHeight: 1 }}>+</button>
                </div>
              )}
            </div>
            {cols.map(col => {
              const dow = zoom === 'dag' ? col.rangeStart.getDay() : -1
              const weekend = dow === 0 || dow === 6
              const headerBg = col.isCurrent ? 'var(--accent-light)' : weekend ? 'var(--overlay-faint)' : stickyBg
              return (
              <div key={col.key} style={{ width: col.widthPx, flexShrink: 0, padding: '8px 2px', textAlign: 'center',
                borderLeft: '1px solid var(--border-light)',
                background: headerBg }}>
                <div style={{ fontSize: zoom === 'dag' ? 10 : 11.5, fontWeight: col.isCurrent ? 700 : 600, color: col.isCurrent ? 'var(--text-primary)' : weekend ? 'var(--text-muted)' : 'var(--text-muted)', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>{col.label1}</div>
                <div style={{ fontSize: zoom === 'dag' ? 14 : 9.5, fontWeight: zoom === 'dag' ? (col.isCurrent ? 700 : 600) : 500, color: col.isCurrent ? 'var(--text-primary)' : zoom === 'dag' ? (weekend ? 'var(--text-muted)' : 'var(--text-primary)') : 'var(--text-muted)', marginTop: 2, letterSpacing: '0.02em' }}>{col.label2}</div>
                {zoom === 'week' && (
                  <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 4, fontSize: 8.5, fontWeight: 600, color: col.isCurrent ? 'var(--text-secondary)' : 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    <span>ma</span><span>di</span><span>wo</span><span>do</span><span>vr</span>
                  </div>
                )}
              </div>
              )
            })}
          </div>

          {/* Member rows (filtered by people-picker if active),
              grouped: TEAM YOKO > UNASSIGNED > FREELANCERS (collapsible) */}
          {(() => {
            const YOKO_IDS = new Set(['menno','vincent','odette','anne-fleur','kars'])
            const visible = team.filter(m => filterMembers.size === 0 || filterMembers.has(m.id))
            const yokoTeam     = visible.filter(m => YOKO_IDS.has(m.id))
            const unassigned   = visible.filter(m => m.id === 'unassigned')
            const freelancers  = visible.filter(m => !YOKO_IDS.has(m.id) && m.id !== 'unassigned')

            const sectionHeader = (label: string, count: number, opts?: { onClick?: () => void; isOpen?: boolean }) => (
              <div onClick={opts?.onClick}
                style={{ borderBottom: '1px solid var(--border-light)',
                  background: 'var(--overlay-faint)',
                  cursor: opts?.onClick ? 'pointer' : 'default', userSelect: 'none' }}>
                {/* Label blijft tegen de linker rand kleven terwijl de balk
                    horizontaal meescrolt — anders schuift de tekst uit beeld
                    zodra je naar rechts scrollt in de tijdlijn. */}
                <div style={{ position: 'sticky', left: 0, width: 'max-content',
                  padding: '10px 14px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {opts?.onClick && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', transition: 'transform 0.15s', display: 'inline-block', transform: opts.isOpen ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                  )}
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>· {count}</span>
                </div>
              </div>
            )

            const renderMember = (member: TeamMember, mIdx: number) => {
            const isExp = expanded.has(member.id)
            const cap   = colCapacity(member.weeklyCapacity)
            const memberProjects = effectiveProjects.filter(p => p.ownerIds.includes(member.id) && (p.startDate || p.endDate))

            return (
              <div key={member.id} data-member-id={member.id} style={{ borderBottom: '1px solid var(--border-light)', background: 'transparent' }}>
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
                      <button onClick={() => { if (!editOrder) toggleExpand(member.id) }}
                        title={isExp ? 'Inklappen' : 'Uitvouwen'}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', minWidth: 0, flex: 1, padding: 0, textAlign: 'left' }}>
                        <MemberAvatar member={member} size={av} />
                        <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: viewSize === 'large' ? 14 : 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.name}</span>
                          {(() => {
                            const v = vacations[member.id]
                            if (!v?.until) return null
                            const ms = new Date(v.until).getTime()
                            if (isNaN(ms) || ms < Date.now()) return null
                            const fromTxt = v.from ? new Date(v.from).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : ''
                            const untilTxt = new Date(v.until).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
                            return (
                              <span title={`Op vakantie ${fromTxt ? `${fromTxt} – ` : 'tot '}${untilTxt}`}
                                style={{ fontSize: 14, flexShrink: 0 }}>🏝</span>
                            )
                          })()}
                        </div>
                      </button>
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
                        <WorkloadCell contribs={contribs} total={total} capacity={cap} cs={cs} or={or} zoom={zoom} onOpenDetails={p => setDetailProject(p)} />
                      </div>
                    )
                  })}
                </div>

                {/* Timeline bars (expanded) */}
                {isExp && memberProjects.length > 0 && (
                  <div style={{ display: 'flex' }}>
                    <div style={{ width: nameW + namePad, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: stickyBg, borderRight: '1px solid var(--border)' }} />
                    <div style={{ width: cols.reduce((s, c) => s + c.widthPx, 0), overflow: 'visible', flexShrink: 0 }}>
                      <TimelineBars memberId={member.id} projects={effectiveProjects} cols={cols} colW={colW} zoom={zoom} hideMeetings={hideMeetings}
                        onDragMove={handleDragMove} onDragEnd={handleDragEnd} onBarClick={p => setDetailProject(p)}
                        onReassign={handleReassignOwner} />
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
            }

            const out: React.ReactNode[] = []
            if (yokoTeam.length > 0) {
              out.push(<div key="hdr-yoko">{sectionHeader('Team Yoko', yokoTeam.length, { onClick: () => setYokoTeamOpen(o => !o), isOpen: yokoTeamOpen })}</div>)
              if (yokoTeamOpen) {
                yokoTeam.forEach((m, i) => out.push(<div key={`y-${m.id}`}>{renderMember(m, i)}</div>))
              }
            }
            if (unassigned.length > 0) {
              out.push(<div key="hdr-un">{sectionHeader('Unassigned', unassigned.length)}</div>)
              unassigned.forEach((m, i) => out.push(<div key={`u-${m.id}`}>{renderMember(m, i)}</div>))
            }
            if (freelancers.length > 0) {
              out.push(<div key="hdr-fl">{sectionHeader('Freelancers', freelancers.length, { onClick: () => setFreelancersOpen(o => !o), isOpen: freelancersOpen })}</div>)
              if (freelancersOpen) {
                freelancers.forEach((m, i) => out.push(<div key={`f-${m.id}`}>{renderMember(m, i)}</div>))
              } else {
                // Ingeklapt: toon alleen freelancers die in de zichtbare
                // periode daadwerkelijk werk hebben. Voorkomt dat we de hele
                // lange lijst tonen, maar verbergt ook geen actieve mensen.
                const active = freelancers.filter(m =>
                  cols.some(col => memberHoursInCol(effectiveProjects, m.id, col).reduce((s, c) => s + c.hours, 0) > 0)
                )
                active.forEach((m, i) => out.push(<div key={`f-${m.id}`}>{renderMember(m, i)}</div>))
              }
            }
            return out
          })()}

        </div>

        {/* Footer info — sticky-left zodat de tekst altijd zichtbaar
            blijft bij horizontaal scrollen, en wat groter font ipv 11. */}
        <div style={{ padding: isMobile ? '10px 0 24px' : '12px 0 24px' }}>
          <div style={{ position: 'sticky', left: 0, width: 'max-content',
            padding: isMobile ? '0 14px' : '0 32px',
            fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {projects.length} items · {team.length} teamleden · {Object.keys(BOARD_COLORS).length} agenda&apos;s
            {!isMobile && <> · sleep een balk om datums te verschuiven · klik voor details</>}
          </div>
        </div>
      </div>

      {detailProject && (
        <DetailPanel project={detailProject} allGroups={allGroups}
          onClose={() => setDetailProject(null)} onUpdate={handleDetailUpdate}
          onDuplicate={() => handleDetailDuplicate(detailProject)} />
      )}

      {newItemOpen && (
        <NewItemPopup
          defaultMemberId={profile?.memberId ?? null}
          onClose={() => setNewItemOpen(false)}
          onCreate={(boardName, item) => {
            const cur = allGroups[boardName] ?? []
            // Drop into the first group; create one if the board has no groups yet
            const next = cur.length > 0
              ? cur.map((g, idx) => idx === 0 ? { ...g, items: [...g.items, item] } : g)
              : [{ id: `g_${Date.now().toString(36)}`, name: 'Nieuwe items', color: '#9aadbd', items: [item] }]
            saveGroups(boardName, next)
            setAllGroups(prev => ({ ...prev, [boardName]: next }))
            logActivity('Item toegevoegd', item.name, `in ${boardName}`)
          }} />
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
const overflowItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9,
  padding: '8px 12px', borderRadius: 6,
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'left',
}

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
