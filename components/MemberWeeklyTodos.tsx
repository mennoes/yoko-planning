'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { IconHourglass } from '@/components/Icon'
import { completeLinkedTask, loadPersonalCompletion } from '@/lib/personalCompletionClient'
import { onCommentsUpdate } from '@/lib/commentsStore'
import { getWeekStart, memberContributions, type Project } from '@/lib/workload'
import {
  CAT_COLOR, CAT_LABEL, effectiveCategory,
  loadCategoryOverrides, onCategoryOverridesChange,
  type WorkloadCategory,
} from '@/lib/workloadCategory'

type Row = {
  id: string
  rawItemId: string
  name: string
  parentName?: string
  board: string
  hours: number
  day: number
  startTime?: string | null
  source?: 'manual' | 'google'
  externalLink?: string
  meetLink?: string
  done: boolean
  completionParentItemId?: string
  completionSubitemId?: string
}

const DAYS = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag']

export function MemberWeeklyTodos({
  memberId, projects, capacity, weekOffset,
}: {
  memberId: string
  projects: Project[]
  capacity: number
  weekOffset: number
}) {
  const router = useRouter()
  const [categories, setCategories] = useState<Record<string, WorkloadCategory>>(() => loadCategoryOverrides())
  const [completionTick, setCompletionTick] = useState(0)
  const [localDone, setLocalDone] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem('yoko-werkdruk-done-flags') ?? '[]') as string[]) }
    catch { return new Set() }
  })

  useEffect(() => onCategoryOverridesChange(() => setCategories(loadCategoryOverrides())), [])
  useEffect(() => onCommentsUpdate(() => setCompletionTick(value => value + 1)), [])

  const week = useMemo(() => {
    const date = getWeekStart(new Date())
    date.setDate(date.getDate() + weekOffset * 7)
    return date
  }, [weekOffset])

  const rows = useMemo<Row[]>(() => {
    void completionTick
    const todayIso = new Date().toISOString().slice(0, 10)
    const today = new Date(todayIso)
    const weekEnd = new Date(week); weekEnd.setDate(weekEnd.getDate() + 7)
    return memberContributions(projects, memberId, week, { acceptedGoogleOnly: true }).map(contribution => {
      const project = contribution.project
      const start = project.startDate ? new Date(project.startDate) : null
      const end = project.endDate ? new Date(project.endDate) : start
      let reference = start ?? week
      if (start && end) reference = today < start ? start : today > end ? end : today
      if (reference < week) reference = start ?? week
      if (reference >= weekEnd && end) reference = end
      const rawItemId = project.id.startsWith(`${project.board}__`)
        ? project.id.slice(project.board.length + 2)
        : project.id
      const completionTarget = project.completionParentItemId
        ? {
            parentItemId: project.completionParentItemId,
            ...(project.completionSubitemId ? { subitemId: project.completionSubitemId } : {}),
          }
        : null
      return {
        id: project.id,
        rawItemId,
        name: project.name,
        parentName: project.parentName,
        board: project.board,
        hours: Math.round(contribution.hours * 10) / 10,
        day: (reference.getDay() + 6) % 7,
        startTime: project.startTime,
        source: project.source,
        externalLink: project.externalLink,
        meetLink: project.meetLink,
        completionParentItemId: project.completionParentItemId,
        completionSubitemId: project.completionSubitemId,
        done: project.status === 'done'
          || (completionTarget ? !!loadPersonalCompletion(completionTarget, memberId)?.done : false)
          || localDone.has(`${project.board}:${rawItemId}`),
      }
    })
  }, [projects, memberId, week, completionTick, localDone])

  const categoryOf = (row: Row) => effectiveCategory(row, categories[row.id] ?? null)
  const hoursFor = (category: WorkloadCategory) => Math.round(rows
    .filter(row => categoryOf(row) === category)
    .reduce((sum, row) => sum + row.hours, 0) * 10) / 10
  const maken = hoursFor('maken')
  const overhead = hoursFor('overhead')
  const meetings = hoursFor('meeting')
  const vrij = hoursFor('vrij')
  const total = Math.round(rows.reduce((sum, row) => sum + row.hours, 0) * 10) / 10
  const scale = Math.max(capacity, total, 1)
  const currentDay = (new Date().getDay() + 6) % 7

  async function toggle(row: Row, next: boolean) {
    const target = row.completionParentItemId
      ? { parentItemId: row.completionParentItemId, ...(row.completionSubitemId ? { subitemId: row.completionSubitemId } : {}) }
      : null
    try {
      if (target && await completeLinkedTask({ board: row.board, itemId: row.rawItemId }, memberId, next)) {
        setCompletionTick(value => value + 1)
        return
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Opslaan mislukt.')
      return
    }
    const key = `${row.board}:${row.rawItemId}`
    const updated = new Set(localDone)
    if (next) updated.add(key); else updated.delete(key)
    setLocalDone(updated)
    localStorage.setItem('yoko-werkdruk-done-flags', JSON.stringify([...updated]))
  }

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', height: '100%' }}>
      <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconHourglass size={16} />
        <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>To do&apos;s</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>uit Agenda &amp; Planning</span>
      </div>
      <div style={{ padding: '16px 18px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 10 }}>
          <span style={{ fontSize: 36, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>{total}</span>
          <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>/ {capacity} uur</span>
          {capacity > 0 && total > capacity && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#C4453A', background: 'rgba(196,69,58,0.15)', padding: '2px 8px', borderRadius: 10 }}>⚠ Overbelast</span>}
        </div>

        {rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Geen gepland werk</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--border)', marginBottom: 8 }}>
                <div style={{ width: `${maken / scale * 100}%`, background: '#5fa06e' }} />
                <div style={{ width: `${overhead / scale * 100}%`, background: '#9aadbd' }} />
                <div style={{ width: `${meetings / scale * 100}%`, background: '#D8B62E' }} />
                <div style={{ width: `${vrij / scale * 100}%`, background: '#3db883' }} />
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                {([['maken', maken], ['overhead', overhead], ['meeting', meetings], ['vrij', vrij]] as [WorkloadCategory, number][])
                  .filter(([, hours]) => hours > 0)
                  .map(([category, hours]) => <span key={category} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLOR[category] }} />
                    <strong style={{ color: 'var(--text-primary)' }}>{hours}u</strong> {CAT_LABEL[category].toLowerCase()}
                  </span>)}
              </div>
            </div>

            {DAYS.map((label, day) => {
              const dayRows = rows.filter(row => row.day === day).sort((a, b) => {
                if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
                if (a.startTime) return -1
                if (b.startTime) return 1
                return a.name.localeCompare(b.name, 'nl')
              })
              if (dayRows.length === 0) return null
              const dayTotal = Math.round(dayRows.reduce((sum, row) => sum + row.hours, 0) * 10) / 10
              const past = weekOffset === 0 && day < currentDay
              return <div key={label} style={{ opacity: past ? 0.5 : 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{label}{past ? ' · geweest' : ''}</span><span>{dayTotal}u</span>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dayRows.map(row => {
                    const category = categoryOf(row)
                    return <li key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}>
                      <input type="checkbox" checked={row.done} onChange={event => void toggle(row, event.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                      <button type="button" onClick={() => router.push(`/projects/${row.board}?focus=${encodeURIComponent(row.rawItemId)}&drawer=${encodeURIComponent(row.rawItemId)}`)}
                        style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                        <span title={CAT_LABEL[category]} style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLOR[category], flexShrink: 0 }} />
                        {row.startTime && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', minWidth: 36 }}>{row.startTime.slice(0, 5)}</span>}
                        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: category === 'maken' ? 500 : 400, color: category === 'maken' ? 'var(--text-primary)' : 'var(--text-muted)', textDecoration: row.done ? 'line-through' : 'none' }}>
                          {row.name}{row.parentName && row.parentName !== row.name && <small style={{ marginLeft: 6, color: 'var(--text-muted)' }}>↳ {row.parentName}</small>}
                        </span>
                        {row.meetLink && <a href={row.meetLink} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} style={{ padding: '1px 6px', borderRadius: 4, background: '#00ac47', color: '#fff', fontSize: 9.5, fontWeight: 700, textDecoration: 'none' }}>Meet↗</a>}
                        {row.source === 'google' && row.externalLink && <a href={row.externalLink} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--sup-yellow)', color: '#000', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>G</a>}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 34, textAlign: 'right' }}>{row.hours}u</span>
                      </button>
                    </li>
                  })}
                </ul>
              </div>
            })}
          </div>
        )}
      </div>
    </div>
  )
}
